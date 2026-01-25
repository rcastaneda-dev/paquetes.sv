-- ========================================================================
-- Migration: Add Multi-part ZIP Bundling for Large Jobs (e.g., 40k PDFs)
-- ========================================================================
-- Rationale:
-- - A single ZIP becomes too large/slow/memory-heavy for serverless runtimes.
-- - We create deterministic "zip parts" per job so workers can bundle in chunks.
-- - Parts are derived from completed report_tasks ordered by (school_codigo_ce, grado).
-- ========================================================================

BEGIN;

-- Zip parts table (one row per ZIP chunk)
CREATE TABLE IF NOT EXISTS public.report_zip_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.report_jobs(id) ON DELETE CASCADE,
  part_no INTEGER NOT NULL,
  part_size INTEGER NOT NULL DEFAULT 100,
  status public.task_status NOT NULL DEFAULT 'pending',
  pdf_count INTEGER DEFAULT 0,
  zip_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, part_no)
);

CREATE INDEX IF NOT EXISTS idx_report_zip_parts_job_status ON public.report_zip_parts(job_id, status);
CREATE INDEX IF NOT EXISTS idx_report_zip_parts_status ON public.report_zip_parts(status);

-- Function: Create zip part rows for a completed job (idempotent)
-- Returns the total number of parts that should exist for the job.
CREATE OR REPLACE FUNCTION public.ensure_zip_parts(
  p_job_id UUID,
  p_part_size INTEGER DEFAULT 100
)
RETURNS INTEGER AS $$
DECLARE
  v_pdf_count INTEGER;
  v_part_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO v_pdf_count
  FROM public.report_tasks
  WHERE job_id = p_job_id
    AND status = 'complete'
    AND pdf_path IS NOT NULL;

  IF v_pdf_count = 0 THEN
    RETURN 0;
  END IF;

  v_part_count := CEIL(v_pdf_count::NUMERIC / GREATEST(p_part_size, 1))::INTEGER;

  INSERT INTO public.report_zip_parts (job_id, part_no, part_size, status, pdf_count, created_at, updated_at)
  SELECT
    p_job_id,
    gs.part_no,
    GREATEST(p_part_size, 1),
    'pending'::public.task_status,
    0,
    now(),
    now()
  FROM generate_series(1, v_part_count) AS gs(part_no)
  ON CONFLICT (job_id, part_no)
  DO UPDATE SET
    part_size = EXCLUDED.part_size,
    updated_at = now();

  RETURN v_part_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Claim pending zip parts for worker processing (SKIP LOCKED)
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
    SELECT id
    FROM public.report_zip_parts
    WHERE status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, report_zip_parts.job_id, report_zip_parts.part_no, report_zip_parts.part_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update zip part status
CREATE OR REPLACE FUNCTION public.update_zip_part_status(
  p_zip_part_id UUID,
  p_status public.task_status,
  p_zip_path TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_pdf_count INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.report_zip_parts
  SET
    status = p_status,
    zip_path = COALESCE(p_zip_path, zip_path),
    error = p_error,
    pdf_count = COALESCE(p_pdf_count, pdf_count),
    updated_at = now()
  WHERE id = p_zip_part_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

