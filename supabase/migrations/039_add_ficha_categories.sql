-- ========================================================================
-- Migration: Add Ficha Uniformes & Ficha Zapatos Categories
-- ========================================================================
-- Purpose:
-- - Add 'ficha_uniformes' and 'ficha_zapatos' to report_category enum
-- - Update create_category_report_job() to generate tasks for 6 categories
-- - zip_jobs.category column already uses report_category enum, so it
--   automatically gains support for the new values
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Extend the report_category enum with new values
-- ========================================================================

ALTER TYPE public.report_category ADD VALUE IF NOT EXISTS 'ficha_uniformes';
ALTER TYPE public.report_category ADD VALUE IF NOT EXISTS 'ficha_zapatos';

COMMIT;

-- Enum ALTER TYPE ... ADD VALUE cannot run inside the same transaction as DML
-- that references the new values. We commit above, then continue in a new block.

BEGIN;

-- ========================================================================
-- 2. Update create_category_report_job to include 6 categories
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

  -- Create tasks for all schools scheduled for this fecha_inicio × all 6 categories
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
      ('zapatos'::public.report_category),
      ('ficha_uniformes'::public.report_category),
      ('ficha_zapatos'::public.report_category)
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
-- - report_category enum has 6 values:
--     estudiantes, camisa, prenda_inferior, zapatos, ficha_uniformes, ficha_zapatos
-- - create_category_report_job() creates tasks = schools(fecha_inicio) × 6 categories
-- - zip_jobs.category column (type report_category) automatically supports new values
-- - Existing jobs with 4 categories are unaffected
-- ========================================================================
