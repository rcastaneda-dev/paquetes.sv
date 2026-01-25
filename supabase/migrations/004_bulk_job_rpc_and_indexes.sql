-- ========================================================================
-- Migration: Faster bulk job creation (avoid timeouts) + helpful indexes
-- ========================================================================
-- Problem:
-- - /api/bulk/jobs used get_school_grade_combinations() which does a GROUP BY + join
--   and returns ~50k rows to the app, then the app inserts ~50k tasks.
-- - In production, this can exceed statement_timeout and/or HTTP timeouts.
--
-- Solution:
-- - Provide a single RPC `create_report_job()` that:
--   1) disables statement_timeout for its duration
--   2) inserts report_jobs
--   3) inserts report_tasks via SELECT DISTINCT on students (no join, no counts)
-- - Add an index to make DISTINCT school+grade fast on large datasets.
--
-- Notes:
-- - This keeps auth "later": it uses service role via the server client.
-- ========================================================================

BEGIN;

-- Speed up DISTINCT school+grade scans and report queries
CREATE INDEX IF NOT EXISTS idx_students_school_grade
  ON public.students (school_codigo_ce, grado);

-- RPC: Create a job + tasks server-side (idempotent per invocation; creates a new job each time)
CREATE OR REPLACE FUNCTION public.create_report_job(
  p_job_params JSONB DEFAULT NULL
)
RETURNS TABLE (
  job_id UUID,
  tasks_created INTEGER
) AS $$
DECLARE
  v_job_id UUID;
  v_tasks_created INTEGER;
BEGIN
  -- Allow this call to run longer than the default statement_timeout
  PERFORM set_config('statement_timeout', '0', true);

  INSERT INTO public.report_jobs(status, job_params, created_at, updated_at)
  VALUES ('queued'::public.job_status, p_job_params, now(), now())
  RETURNING id INTO v_job_id;

  INSERT INTO public.report_tasks(job_id, school_codigo_ce, grado, status, created_at, updated_at)
  SELECT
    v_job_id,
    combos.school_codigo_ce,
    combos.grado,
    'pending'::public.task_status,
    now(),
    now()
  FROM (
    SELECT DISTINCT s.school_codigo_ce, s.grado
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND s.grado IS NOT NULL
  ) AS combos;

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  RETURN QUERY SELECT v_job_id, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

