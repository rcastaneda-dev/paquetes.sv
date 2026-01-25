-- ========================================================================
-- Migration: Add retry_failed_tasks RPC
-- ========================================================================
-- Purpose:
-- - Allow users to retry only failed tasks for a job
-- - Reset failed tasks to pending and clear errors
-- - Reset job to queued status and clear zip artifacts
-- - Delete existing zip parts so they regenerate with newly-successful PDFs
-- ========================================================================

BEGIN;

-- RPC: Retry all failed tasks for a job
CREATE OR REPLACE FUNCTION public.retry_failed_tasks(
  p_job_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  tasks_retried INTEGER,
  zip_parts_deleted INTEGER
) AS $$
DECLARE
  v_job_status public.job_status;
  v_tasks_retried INTEGER := 0;
  v_zip_parts_deleted INTEGER := 0;
  v_old_zip_path TEXT;
BEGIN
  -- Check if job exists and get current status
  SELECT status, zip_path INTO v_job_status, v_old_zip_path
  FROM public.report_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT, 0, 0;
    RETURN;
  END IF;

  -- Only allow retry for failed or complete jobs (complete = user wants to retry some tasks that failed earlier)
  IF v_job_status NOT IN ('failed', 'complete') THEN
    RETURN QUERY SELECT
      false,
      format('Cannot retry tasks for job with status "%s". Only failed or complete jobs can be retried.', v_job_status)::TEXT,
      0,
      0;
    RETURN;
  END IF;

  -- Reset failed tasks to pending (clear error, keep attempt_count)
  UPDATE public.report_tasks
  SET
    status = 'pending'::public.task_status,
    error = NULL,
    updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'failed';

  GET DIAGNOSTICS v_tasks_retried = ROW_COUNT;

  IF v_tasks_retried = 0 THEN
    RETURN QUERY SELECT false, 'No failed tasks found to retry'::TEXT, 0, 0;
    RETURN;
  END IF;

  -- Delete existing zip parts so they regenerate with new results
  DELETE FROM public.report_zip_parts
  WHERE job_id = p_job_id;

  GET DIAGNOSTICS v_zip_parts_deleted = ROW_COUNT;

  -- Reset job status to queued and clear zip_path
  UPDATE public.report_jobs
  SET
    status = 'queued'::public.job_status,
    zip_path = NULL,
    updated_at = now()
  WHERE id = p_job_id;

  -- If old zip_path pointed to a manifest, we could optionally delete it from storage here
  -- (but for safety, we leave storage cleanup to manual processes)

  RETURN QUERY SELECT
    true,
    format('Successfully reset %s failed task(s) to pending', v_tasks_retried)::TEXT,
    v_tasks_retried,
    v_zip_parts_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Usage Notes
-- ========================================================================
-- After this migration:
-- - Call retry_failed_tasks(job_id) to retry only failed tasks
-- - Failed tasks are reset to pending
-- - Job is reset to queued
-- - ZIP parts are deleted and will regenerate
-- - Workers will pick up the pending tasks automatically
-- ========================================================================
