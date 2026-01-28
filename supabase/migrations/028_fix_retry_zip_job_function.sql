-- ========================================================================
-- Migration: Fix retry_zip_job function to properly handle return values
-- ========================================================================
-- Purpose:
-- - Fix the retry_zip_job function to use ROW_COUNT correctly
-- - Add better documentation for the return value
-- - Ensure proper handling when job is not in 'failed' status
-- ========================================================================

BEGIN;

-- Drop and recreate the retry_zip_job function with proper error handling
DROP FUNCTION IF EXISTS public.retry_zip_job(UUID);

-- Function: Retry failed ZIP job
-- Returns: TRUE if job was successfully retried (status was 'failed' and updated to 'queued')
--          FALSE if job wasn't in failed status, doesn't exist, or no update occurred
CREATE OR REPLACE FUNCTION public.retry_zip_job(p_job_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_row_count INTEGER;
BEGIN
  UPDATE public.zip_jobs
  SET
    status = 'queued',
    error = NULL,
    failed_at = NULL,
    updated_at = now()
  WHERE id = p_job_id
    AND status = 'failed';

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- This migration fixes an issue where the retry_zip_job function's return
-- value wasn't being properly interpreted by the API layer, causing errors
-- when users tried to retry a ZIP generation that was already being retried.
-- ========================================================================
