-- ========================================================================
-- Migration: Add ZIP Jobs Queue for Background Processing
-- ========================================================================
-- Purpose:
-- - Move ZIP generation from synchronous Vercel routes to async background worker
-- - Support TUS resumable uploads for large ZIPs (>6MB, up to 500MB per region)
-- - Track ZIP job status for user polling
-- ========================================================================

BEGIN;

-- ZIP jobs table (queue for background worker)
CREATE TABLE IF NOT EXISTS public.zip_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_job_id UUID NOT NULL REFERENCES public.report_jobs(id) ON DELETE CASCADE,
  region TEXT NOT NULL CHECK (region IN ('oriental', 'occidental', 'paracentral', 'central')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed')),

  -- Metadata
  zip_path TEXT,
  zip_size_bytes BIGINT,
  pdf_count INTEGER,

  -- Error tracking
  error TEXT,
  attempt_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Uniqueness: one ZIP job per report job + region
  UNIQUE(report_job_id, region)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_zip_jobs_status ON public.zip_jobs(status);
CREATE INDEX IF NOT EXISTS idx_zip_jobs_report_job ON public.zip_jobs(report_job_id);
CREATE INDEX IF NOT EXISTS idx_zip_jobs_created_at ON public.zip_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_zip_jobs_queue ON public.zip_jobs(status, created_at)
  WHERE status = 'queued';

-- Function: Claim next pending ZIP job (for worker polling)
CREATE OR REPLACE FUNCTION public.claim_next_zip_job()
RETURNS TABLE (
  job_id UUID,
  report_job_id UUID,
  region TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.zip_jobs
  SET
    status = 'processing',
    started_at = now(),
    updated_at = now(),
    attempt_count = attempt_count + 1
  WHERE id IN (
    SELECT id
    FROM public.zip_jobs
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, zip_jobs.report_job_id, zip_jobs.region;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update ZIP job status
CREATE OR REPLACE FUNCTION public.update_zip_job_status(
  p_job_id UUID,
  p_status TEXT,
  p_zip_path TEXT DEFAULT NULL,
  p_zip_size_bytes BIGINT DEFAULT NULL,
  p_pdf_count INTEGER DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.zip_jobs
  SET
    status = p_status,
    zip_path = COALESCE(p_zip_path, zip_path),
    zip_size_bytes = COALESCE(p_zip_size_bytes, zip_size_bytes),
    pdf_count = COALESCE(p_pdf_count, pdf_count),
    error = CASE WHEN p_status = 'failed' THEN p_error ELSE error END,
    completed_at = CASE WHEN p_status = 'complete' THEN now() ELSE completed_at END,
    failed_at = CASE WHEN p_status = 'failed' THEN now() ELSE failed_at END,
    updated_at = now()
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Retry failed ZIP job
-- Returns: TRUE if job was retried, FALSE if job wasn't in failed status or doesn't exist
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

-- Function: Clean up old completed ZIP jobs (optional, for maintenance)
CREATE OR REPLACE FUNCTION public.cleanup_old_zip_jobs(p_days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.zip_jobs
  WHERE status = 'complete'
    AND completed_at < (now() - (p_days_old || ' days')::INTERVAL);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- After this migration:
-- - ZIP generation moves to background worker (Railway/Render/Lambda)
-- - Worker polls claim_next_zip_job() for queued jobs
-- - Frontend creates jobs via API route, then polls for status
-- - Large ZIPs (>6MB) uploaded using TUS protocol (chunked, resumable)
-- - Vercel routes only create jobs and check status (fast, no timeout)
-- ========================================================================
