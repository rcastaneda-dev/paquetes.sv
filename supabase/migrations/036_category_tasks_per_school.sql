-- ========================================================================
-- Migration: Refactor Category Tasks to be Per-School × Category
-- ========================================================================
-- Purpose:
-- - Change category report tasks from "4 per job" to "schools × categories"
-- - Add school_codigo_ce column to report_category_tasks
-- - Update create_category_report_job() to create tasks for all schools
--   scheduled for the given fecha_inicio
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Alter report_category_tasks table to add per-school tracking
-- ========================================================================

-- Add school_codigo_ce column (nullable initially for migration)
ALTER TABLE public.report_category_tasks
  ADD COLUMN IF NOT EXISTS school_codigo_ce TEXT;

-- Add attempt_count column
ALTER TABLE public.report_category_tasks
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- Add foreign key constraint to schools table
ALTER TABLE public.report_category_tasks
  ADD CONSTRAINT fk_report_category_tasks_school
    FOREIGN KEY (school_codigo_ce)
    REFERENCES public.schools(codigo_ce);

-- Drop old unique constraint (job_id, category)
ALTER TABLE public.report_category_tasks
  DROP CONSTRAINT IF EXISTS report_category_tasks_job_id_category_key;

-- Add new unique constraint (job_id, school_codigo_ce, category)
ALTER TABLE public.report_category_tasks
  ADD CONSTRAINT uq_category_tasks_job_school_category
    UNIQUE (job_id, school_codigo_ce, category);

-- Add indexes for efficient worker queries
CREATE INDEX IF NOT EXISTS idx_category_tasks_pending
  ON public.report_category_tasks(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_category_tasks_job_status
  ON public.report_category_tasks(job_id, status);

CREATE INDEX IF NOT EXISTS idx_category_tasks_job_category_status
  ON public.report_category_tasks(job_id, category, status);

CREATE INDEX IF NOT EXISTS idx_category_tasks_school
  ON public.report_category_tasks(school_codigo_ce);

-- ========================================================================
-- 2. Update create_category_report_job to create tasks per school × category
-- ========================================================================

DROP FUNCTION IF EXISTS public.create_category_report_job(DATE, JSONB);

CREATE OR REPLACE FUNCTION public.create_category_report_job(
  p_fecha_inicio DATE,
  p_job_params JSONB DEFAULT NULL
)
RETURNS TABLE (
  job_id UUID,
  tasks_created INTEGER
) AS $$
DECLARE
  v_job_id UUID;
  v_tasks_created INTEGER;
  v_job_params JSONB;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  -- Merge fecha_inicio into job_params
  v_job_params := COALESCE(p_job_params, '{}'::jsonb);
  v_job_params := jsonb_set(v_job_params, '{fecha_inicio}', to_jsonb(p_fecha_inicio::TEXT));

  -- Create job
  INSERT INTO public.report_jobs(status, job_params, created_at, updated_at)
  VALUES ('queued'::public.job_status, v_job_params, now(), now())
  RETURNING id INTO v_job_id;

  -- Create tasks for all schools scheduled for this fecha_inicio × all categories
  -- Categories: estudiantes, camisa, prenda_inferior, zapatos
  INSERT INTO public.report_category_tasks(
    job_id,
    school_codigo_ce,
    category,
    status,
    created_at,
    updated_at
  )
  SELECT
    v_job_id,
    sc.codigo_ce,
    cat.category,
    'pending'::public.task_status,
    now(),
    now()
  FROM public.schools sc
  CROSS JOIN (
    VALUES
      ('estudiantes'::public.report_category),
      ('camisa'::public.report_category),
      ('prenda_inferior'::public.report_category),
      ('zapatos'::public.report_category)
  ) AS cat(category)
  WHERE sc.fecha_inicio = p_fecha_inicio
    AND sc.codigo_ce IS NOT NULL
    AND trim(sc.codigo_ce) != '';

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  RETURN QUERY SELECT v_job_id, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- After this migration:
-- - report_category_tasks now tracks school_codigo_ce
-- - create_category_report_job() creates tasks = schools(fecha_inicio) × 4 categories
-- - Old jobs with NULL school_codigo_ce will be left as-is (can be cleaned up separately)
-- - Next step: update claim/update/progress RPCs in a follow-up migration
-- ========================================================================
