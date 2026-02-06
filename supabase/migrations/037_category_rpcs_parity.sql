-- ========================================================================
-- Migration: Update Category RPCs for Parity with Regular Tasks
-- ========================================================================
-- Purpose:
-- - Update claim_pending_category_tasks to filter by job status and transition jobs to running
-- - Update update_category_task_status to protect cancelled tasks and track attempt_count
-- - Update get_category_job_progress to return cancelled_tasks
-- - Add requeue_stale_running_category_tasks for stuck task recovery
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Update claim_pending_category_tasks
-- ========================================================================
-- Changes:
-- - Only claim tasks for jobs in ('queued', 'running') status
-- - Transition parent job from 'queued' to 'running' after claiming
-- - Return school_codigo_ce in addition to other fields

DROP FUNCTION IF EXISTS public.claim_pending_category_tasks(INTEGER);

CREATE OR REPLACE FUNCTION public.claim_pending_category_tasks(
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  task_id UUID,
  job_id UUID,
  school_codigo_ce TEXT,
  category TEXT,
  fecha_inicio TEXT
) AS $$
DECLARE
  v_claimed_job_ids UUID[];
BEGIN
  -- Claim pending tasks only for jobs that are queued or running (not cancelled/complete/failed)
  RETURN QUERY
  UPDATE public.report_category_tasks
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT rct.id
    FROM public.report_category_tasks rct
    INNER JOIN public.report_jobs rj ON rct.job_id = rj.id
    WHERE rct.status = 'pending'
      AND rj.status IN ('queued', 'running')
    ORDER BY rct.created_at
    LIMIT p_limit
    FOR UPDATE OF rct SKIP LOCKED
  )
  RETURNING
    report_category_tasks.id,
    report_category_tasks.job_id,
    report_category_tasks.school_codigo_ce,
    report_category_tasks.category::TEXT,
    (
      SELECT COALESCE((rj.job_params->>'fecha_inicio')::TEXT, CURRENT_DATE::TEXT)
      FROM public.report_jobs rj
      WHERE rj.id = report_category_tasks.job_id
    );

  -- Collect the job IDs we just claimed tasks for
  SELECT ARRAY_AGG(DISTINCT report_category_tasks.job_id)
  INTO v_claimed_job_ids
  FROM public.report_category_tasks
  WHERE status = 'running'
    AND updated_at >= (now() - interval '5 seconds');

  -- Transition any queued jobs to running if we just claimed tasks for them
  IF v_claimed_job_ids IS NOT NULL THEN
    UPDATE public.report_jobs
    SET status = 'running',
        updated_at = now()
    WHERE id = ANY(v_claimed_job_ids)
      AND status = 'queued';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ========================================================================
-- 2. Update update_category_task_status
-- ========================================================================
-- Changes:
-- - Protect cancelled tasks (don't allow updates if already cancelled)
-- - Increment attempt_count on 'failed' status

DROP FUNCTION IF EXISTS public.update_category_task_status(UUID, public.task_status, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_category_task_status(
  p_task_id UUID,
  p_status public.task_status,
  p_pdf_path TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_status public.task_status;
BEGIN
  -- Check current task status
  SELECT status INTO v_current_status
  FROM public.report_category_tasks
  WHERE id = p_task_id;

  -- Don't allow updating a cancelled task (it should stay cancelled)
  IF v_current_status = 'cancelled' THEN
    RETURN;
  END IF;

  -- Update the task
  UPDATE public.report_category_tasks
  SET
    status = p_status,
    pdf_path = COALESCE(p_pdf_path, pdf_path),
    error = p_error,
    updated_at = now(),
    attempt_count = CASE
      WHEN p_status = 'failed' THEN attempt_count + 1
      ELSE attempt_count
    END
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ========================================================================
-- 3. Update get_category_job_progress
-- ========================================================================
-- Changes:
-- - Add cancelled_tasks to match UI expectations

DROP FUNCTION IF EXISTS public.get_category_job_progress(UUID);

CREATE OR REPLACE FUNCTION public.get_category_job_progress(p_job_id UUID)
RETURNS TABLE (
  total_tasks BIGINT,
  pending_tasks BIGINT,
  running_tasks BIGINT,
  complete_tasks BIGINT,
  failed_tasks BIGINT,
  cancelled_tasks BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_tasks,
    COUNT(*) FILTER (WHERE status = 'running') AS running_tasks,
    COUNT(*) FILTER (WHERE status = 'complete') AS complete_tasks,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_tasks,
    COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_tasks
  FROM public.report_category_tasks
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ========================================================================
-- 4. Add requeue_stale_running_category_tasks
-- ========================================================================
-- Purpose: Requeue category tasks that have been stuck in 'running' status

CREATE OR REPLACE FUNCTION public.requeue_stale_running_category_tasks(
  p_stale_seconds INTEGER DEFAULT 900,
  p_limit INTEGER DEFAULT 5000
)
RETURNS INTEGER AS $$
DECLARE
  v_requeued INTEGER;
BEGIN
  UPDATE public.report_category_tasks
  SET
    status = 'pending'::public.task_status,
    updated_at = now(),
    error = COALESCE(
      error,
      format('Requeued stale running task after %s seconds', p_stale_seconds)
    )
  WHERE id IN (
    SELECT rct.id
    FROM public.report_category_tasks rct
    INNER JOIN public.report_jobs rj ON rct.job_id = rj.id
    WHERE rct.status = 'running'::public.task_status
      AND rct.updated_at < (now() - (p_stale_seconds || ' seconds')::INTERVAL)
      AND rj.status IN ('queued'::public.job_status, 'running'::public.job_status)
    ORDER BY rct.updated_at
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_requeued = ROW_COUNT;
  RETURN v_requeued;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ========================================================================
-- 5. Add cancel_category_tasks for job cancellation
-- ========================================================================
-- Purpose: Cancel all pending/running category tasks for a job

CREATE OR REPLACE FUNCTION public.cancel_category_tasks(
  p_job_id UUID,
  p_reason TEXT DEFAULT 'Job cancelled'
)
RETURNS INTEGER AS $$
DECLARE
  v_cancelled INTEGER;
BEGIN
  UPDATE public.report_category_tasks
  SET
    status = 'cancelled'::public.task_status,
    error = p_reason,
    updated_at = now()
  WHERE job_id = p_job_id
    AND status IN ('pending', 'running');

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN v_cancelled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- After this migration:
-- - Category task RPCs now have parity with regular task RPCs
-- - claim_pending_category_tasks respects job status and transitions jobs to running
-- - update_category_task_status protects cancelled tasks and tracks attempt_count
-- - get_category_job_progress returns cancelled_tasks
-- - requeue_stale_running_category_tasks available for anti-stuck logic
-- - cancel_category_tasks available for job cancellation flows
-- ========================================================================
