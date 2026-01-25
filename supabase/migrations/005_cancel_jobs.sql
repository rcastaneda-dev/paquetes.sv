-- ========================================================================
-- Migration: Add Job Cancellation Support
-- ========================================================================
-- This migration adds:
-- 1. 'cancelled' status to job_status and task_status enums
-- 2. RPC function to cancel a job and its tasks
-- 3. Updates to claim_pending_tasks to respect job status
-- 4. Updates to update_task_status to protect cancelled tasks
-- 5. Updates to get_job_progress to include cancelled_tasks count
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Extend enums to support 'cancelled' status
-- ========================================================================

-- Add 'cancelled' to job_status enum
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older Postgres,
-- but newer versions (12+) support it. We'll use DO block for safety.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = 'public.job_status'::regtype) THEN
    ALTER TYPE public.job_status ADD VALUE 'cancelled';
  END IF;
END $$;

-- Add 'cancelled' to task_status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = 'public.task_status'::regtype) THEN
    ALTER TYPE public.task_status ADD VALUE 'cancelled';
  END IF;
END $$;

-- ========================================================================
-- 2. Add RPC function to cancel a job
-- ========================================================================

CREATE OR REPLACE FUNCTION public.cancel_report_job(
  p_job_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  tasks_cancelled INTEGER,
  zip_parts_cancelled INTEGER
) AS $$
DECLARE
  v_job_status public.job_status;
  v_tasks_cancelled INTEGER := 0;
  v_zip_parts_cancelled INTEGER := 0;
BEGIN
  -- Check current job status
  SELECT status INTO v_job_status
  FROM public.report_jobs
  WHERE id = p_job_id;

  IF v_job_status IS NULL THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT, 0, 0;
    RETURN;
  END IF;

  -- Only allow cancellation if job is queued or running
  IF v_job_status NOT IN ('queued', 'running') THEN
    RETURN QUERY SELECT false,
      format('Job cannot be cancelled (current status: %s)', v_job_status)::TEXT,
      0, 0;
    RETURN;
  END IF;

  -- Update job status to cancelled
  UPDATE public.report_jobs
  SET
    status = 'cancelled'::public.job_status,
    error = COALESCE(p_reason, 'Cancelled by user'),
    updated_at = now()
  WHERE id = p_job_id;

  -- Cancel all pending/running tasks for this job
  UPDATE public.report_tasks
  SET
    status = 'cancelled'::public.task_status,
    error = COALESCE(p_reason, 'Job cancelled'),
    updated_at = now()
  WHERE job_id = p_job_id
    AND status IN ('pending', 'running');

  GET DIAGNOSTICS v_tasks_cancelled = ROW_COUNT;

  -- Cancel all pending/running zip parts for this job (if any)
  UPDATE public.report_zip_parts
  SET
    status = 'cancelled'::public.task_status,
    error = COALESCE(p_reason, 'Job cancelled'),
    updated_at = now()
  WHERE job_id = p_job_id
    AND status IN ('pending', 'running');

  GET DIAGNOSTICS v_zip_parts_cancelled = ROW_COUNT;

  RETURN QUERY SELECT true, 'Job cancelled successfully'::TEXT, v_tasks_cancelled, v_zip_parts_cancelled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 3. Update claim_pending_tasks to respect job status and set job to running
-- ========================================================================

CREATE OR REPLACE FUNCTION public.claim_pending_tasks(
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  task_id UUID,
  job_id UUID,
  school_codigo_ce TEXT,
  grado TEXT
) AS $$
DECLARE
  v_claimed_job_ids UUID[];
BEGIN
  -- Claim pending tasks only for jobs that are queued or running (not cancelled/complete/failed)
  RETURN QUERY
  UPDATE public.report_tasks
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT rt.id
    FROM public.report_tasks rt
    INNER JOIN public.report_jobs rj ON rt.job_id = rj.id
    WHERE rt.status = 'pending'
      AND rj.status IN ('queued', 'running')
    ORDER BY rt.created_at
    LIMIT p_limit
    FOR UPDATE OF rt SKIP LOCKED
  )
  RETURNING id, report_tasks.job_id, report_tasks.school_codigo_ce, report_tasks.grado;

  -- Collect the job IDs we just claimed tasks for
  SELECT ARRAY_AGG(DISTINCT report_tasks.job_id)
  INTO v_claimed_job_ids
  FROM public.report_tasks
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 4. Update update_task_status to protect cancelled tasks
-- ========================================================================

CREATE OR REPLACE FUNCTION public.update_task_status(
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
  FROM public.report_tasks
  WHERE id = p_task_id;

  -- Don't allow updating a cancelled task (it should stay cancelled)
  IF v_current_status = 'cancelled' THEN
    RETURN;
  END IF;

  -- Update the task
  UPDATE public.report_tasks
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 5. Update get_job_progress to include cancelled_tasks
-- ========================================================================

-- Drop existing function first since we're changing the return type
DROP FUNCTION IF EXISTS public.get_job_progress(UUID);

CREATE OR REPLACE FUNCTION public.get_job_progress(p_job_id UUID)
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
  FROM public.report_tasks
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 6. Update claim_pending_zip_parts to respect job status
-- ========================================================================

CREATE OR REPLACE FUNCTION public.claim_pending_zip_parts(
  p_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  zip_part_id UUID,
  job_id UUID,
  part_no INTEGER,
  part_size INTEGER
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.report_zip_parts
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT rzp.id
    FROM public.report_zip_parts rzp
    INNER JOIN public.report_jobs rj ON rzp.job_id = rj.id
    WHERE rzp.status = 'pending'
      AND rj.status IN ('complete')  -- Only create zips for completed jobs
    ORDER BY rzp.created_at
    LIMIT p_limit
    FOR UPDATE OF rzp SKIP LOCKED
  )
  RETURNING id, report_zip_parts.job_id, report_zip_parts.part_no, report_zip_parts.part_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- End of migration
-- ========================================================================
