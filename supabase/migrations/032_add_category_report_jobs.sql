-- ========================================================================
-- Migration: Add Category Report Jobs Infrastructure
-- ========================================================================
-- Purpose:
-- - Add support for new agreement reports (Cajas, Camisas, Pantalones, Zapatos)
-- - Each job generates 4 category PDFs based on fecha_inicio filter
-- - Storage hierarchy: {job_id}/{fecha_inicio}/{category_folder}/file.pdf
-- ========================================================================

BEGIN;

-- Create enum for category types
DO $$ BEGIN
  CREATE TYPE public.report_category AS ENUM (
    'estudiantes',    -- Cajas (box distribution)
    'camisa',         -- Camisas (shirts)
    'prenda_inferior', -- Pantalones/Falda/Short (bottoms)
    'zapatos'         -- Zapatos (shoes)
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create category tasks table
CREATE TABLE IF NOT EXISTS public.report_category_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.report_jobs(id) ON DELETE CASCADE,
  category public.report_category NOT NULL,
  status public.task_status NOT NULL DEFAULT 'pending',
  pdf_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, category)
);

CREATE INDEX IF NOT EXISTS idx_report_category_tasks_job_status
  ON public.report_category_tasks(job_id, status);
CREATE INDEX IF NOT EXISTS idx_report_category_tasks_status
  ON public.report_category_tasks(status);

-- ========================================================================
-- RPC: Create a category report job with 4 tasks
-- ========================================================================
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

  -- Create 4 category tasks
  INSERT INTO public.report_category_tasks(job_id, category, status, created_at, updated_at)
  VALUES
    (v_job_id, 'estudiantes'::public.report_category, 'pending'::public.task_status, now(), now()),
    (v_job_id, 'camisa'::public.report_category, 'pending'::public.task_status, now(), now()),
    (v_job_id, 'prenda_inferior'::public.report_category, 'pending'::public.task_status, now(), now()),
    (v_job_id, 'zapatos'::public.report_category, 'pending'::public.task_status, now(), now());

  v_tasks_created := 4;

  RETURN QUERY SELECT v_job_id, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- RPC: Claim pending category tasks for worker processing
-- ========================================================================
CREATE OR REPLACE FUNCTION public.claim_pending_category_tasks(
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  task_id UUID,
  job_id UUID,
  category TEXT,
  fecha_inicio TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.report_category_tasks
    SET status = 'running',
        updated_at = now()
    WHERE id IN (
      SELECT id FROM public.report_category_tasks
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      report_category_tasks.id,
      report_category_tasks.job_id,
      report_category_tasks.category::TEXT
  )
  SELECT
    c.id AS task_id,
    c.job_id,
    c.category,
    COALESCE(
      (rj.job_params->>'fecha_inicio')::TEXT,
      CURRENT_DATE::TEXT
    ) AS fecha_inicio
  FROM claimed c
  INNER JOIN public.report_jobs rj ON c.job_id = rj.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- RPC: Update category task status
-- ========================================================================
CREATE OR REPLACE FUNCTION public.update_category_task_status(
  p_task_id UUID,
  p_status public.task_status,
  p_pdf_path TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.report_category_tasks
  SET
    status = p_status,
    pdf_path = COALESCE(p_pdf_path, pdf_path),
    error = p_error,
    updated_at = now()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- RPC: Get category job progress
-- ========================================================================
CREATE OR REPLACE FUNCTION public.get_category_job_progress(p_job_id UUID)
RETURNS TABLE (
  total_tasks BIGINT,
  pending_tasks BIGINT,
  running_tasks BIGINT,
  complete_tasks BIGINT,
  failed_tasks BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_tasks,
    COUNT(*) FILTER (WHERE status = 'running') AS running_tasks,
    COUNT(*) FILTER (WHERE status = 'complete') AS complete_tasks,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_tasks
  FROM public.report_category_tasks
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Usage Notes
-- ========================================================================
-- 1. Create a category report job:
--    SELECT * FROM create_category_report_job('2023-10-25');
--
-- 2. Worker claims tasks:
--    SELECT * FROM claim_pending_category_tasks(5);
--
-- 3. Worker updates task status:
--    SELECT update_category_task_status(
--      'task-uuid',
--      'complete',
--      'job-id/2023-10-25/zapatos/detalle_zapatos.pdf',
--      NULL
--    );
--
-- 4. Check progress:
--    SELECT * FROM get_category_job_progress('job-uuid');
-- ========================================================================
