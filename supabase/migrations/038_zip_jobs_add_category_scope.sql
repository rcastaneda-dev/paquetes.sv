-- ========================================================================
-- Migration: Extend ZIP Jobs to Support Category-Scoped ZIPs
-- ========================================================================
-- Purpose:
-- - Add job_kind column to distinguish between 'region' and 'category' ZIP jobs
-- - Add category column for category-scoped ZIPs
-- - Update RPCs to handle both job kinds
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Alter zip_jobs table
-- ========================================================================

-- Add job_kind column (default 'region' for backward compatibility)
ALTER TABLE public.zip_jobs
  ADD COLUMN IF NOT EXISTS job_kind TEXT NOT NULL DEFAULT 'region'
    CHECK (job_kind IN ('region', 'category'));

-- Add category column (nullable, required only for category jobs)
ALTER TABLE public.zip_jobs
  ADD COLUMN IF NOT EXISTS category public.report_category;

-- Make region nullable (required only for region jobs)
ALTER TABLE public.zip_jobs
  ALTER COLUMN region DROP NOT NULL;

-- Drop old unique constraint
ALTER TABLE public.zip_jobs
  DROP CONSTRAINT IF EXISTS zip_jobs_report_job_id_region_key;

-- Add new partial unique constraints
-- For region jobs: unique(report_job_id, region)
CREATE UNIQUE INDEX IF NOT EXISTS uq_zip_jobs_region
  ON public.zip_jobs(report_job_id, region)
  WHERE job_kind = 'region';

-- For category jobs: unique(report_job_id, category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_zip_jobs_category
  ON public.zip_jobs(report_job_id, category)
  WHERE job_kind = 'category';

-- Add check constraint to ensure proper discriminator is set
ALTER TABLE public.zip_jobs
  ADD CONSTRAINT chk_zip_jobs_discriminator CHECK (
    (job_kind = 'region' AND region IS NOT NULL AND category IS NULL)
    OR
    (job_kind = 'category' AND category IS NOT NULL AND region IS NULL)
  );

-- Add index for category job queries
CREATE INDEX IF NOT EXISTS idx_zip_jobs_category
  ON public.zip_jobs(report_job_id, category)
  WHERE job_kind = 'category';

-- ========================================================================
-- 2. Update claim_next_zip_job to return job_kind and discriminator
-- ========================================================================

DROP FUNCTION IF EXISTS public.claim_next_zip_job();

CREATE OR REPLACE FUNCTION public.claim_next_zip_job()
RETURNS TABLE (
  job_id UUID,
  report_job_id UUID,
  job_kind TEXT,
  region TEXT,
  category TEXT
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
  RETURNING
    id,
    zip_jobs.report_job_id,
    zip_jobs.job_kind,
    zip_jobs.region,
    zip_jobs.category::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ========================================================================
-- 3. Add helper function to get fecha_inicio from job params
-- ========================================================================

CREATE OR REPLACE FUNCTION public.get_job_fecha_inicio(p_job_id UUID)
RETURNS DATE AS $$
DECLARE
  v_fecha_inicio TEXT;
BEGIN
  SELECT (job_params->>'fecha_inicio')
  INTO v_fecha_inicio
  FROM public.report_jobs
  WHERE id = p_job_id;

  IF v_fecha_inicio IS NULL THEN
    RETURN CURRENT_DATE;
  END IF;

  RETURN v_fecha_inicio::DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- After this migration:
-- - zip_jobs table supports both 'region' and 'category' job kinds
-- - claim_next_zip_job() returns job_kind and the relevant discriminator
-- - Existing region-based ZIP jobs continue to work (job_kind defaults to 'region')
-- - New category ZIP jobs can be created with job_kind='category' and category set
-- - ZIP worker needs to be updated to handle both job kinds
-- ========================================================================
