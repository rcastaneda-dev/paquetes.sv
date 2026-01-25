-- ========================================================================
-- Migration: Fix job/task RPCs to use grado_ok (compatibility with API)
-- ========================================================================
-- Symptom:
-- - Jobs remain stuck in status 'queued' ("En Cola") and never move to 'running'
--
-- Root cause:
-- - The API uses RPCs `create_report_job` and `create_report_job_batch` (004/007),
--   which build tasks from `students.grado`.
-- - After refactors, real data and other RPCs rely on `students.grado_ok`.
-- - If `students.grado` is NULL/empty for most rows, those RPCs create 0 tasks,
--   so workers have nothing to claim and jobs stay queued.
--
-- Fix:
-- - Keep existing RPC names/signatures used by the app, but update implementations
--   to derive tasks and report rows from `grado_ok`.
-- ========================================================================

BEGIN;

-- Index to speed DISTINCT school+grade scans on large datasets (grado_ok)
CREATE INDEX IF NOT EXISTS idx_students_school_grado_ok
  ON public.students (school_codigo_ce, grado_ok);

-- Worker-facing function: align to grado_ok so tasks match student lookup
-- NOTE: we DROP first because the existing function in some DBs has a different
-- OUT-parameter row type, and Postgres does not allow changing that via OR REPLACE.
DROP FUNCTION IF EXISTS public.report_students_by_school_grade(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.report_students_by_school_grade(
  p_school_codigo_ce TEXT,
  p_grado TEXT
)
RETURNS TABLE (
  nie TEXT,
  nombre_estudiante TEXT,
  sexo TEXT,
  edad SMALLINT,
  grado TEXT,
  camisa TEXT,
  pantalon_falda TEXT,
  zapato TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.nie,
    s.nombre_estudiante,
    s.sexo,
    s.edad,
    s.grado_ok AS grado,
    COALESCE(u.camisa, 'N/A') AS camisa,
    COALESCE(u.pantalon_falda, 'N/A') AS pantalon_falda,
    COALESCE(u.zapato, 'N/A') AS zapato
  FROM public.students s
  LEFT JOIN public.uniform_sizes u ON s.nie = u.nie
  WHERE s.school_codigo_ce = p_school_codigo_ce
    AND s.grado_ok = p_grado
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- API-facing RPC: preserve signature but build tasks from grado_ok
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
    SELECT DISTINCT s.school_codigo_ce, s.grado_ok AS grado
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND s.grado_ok IS NOT NULL
      AND s.grado_ok != ''
  ) AS combos;

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  RETURN QUERY SELECT v_job_id, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Batch RPC: preserve signature but hash/distribute by grado_ok
CREATE OR REPLACE FUNCTION public.create_report_job_batch(
  p_shards INTEGER DEFAULT 50,
  p_batch_params JSONB DEFAULT NULL
)
RETURNS TABLE (
  batch_id UUID,
  job_ids UUID[],
  tasks_created INTEGER
) AS $$
DECLARE
  v_batch_id UUID;
  v_job_ids UUID[];
  v_tasks_created INTEGER;
  v_job_id UUID;
  i INTEGER;
BEGIN
  -- Disable statement timeout for this long-running operation
  PERFORM set_config('statement_timeout', '0', true);

  -- Validate shard count
  IF p_shards < 1 OR p_shards > 200 THEN
    RAISE EXCEPTION 'p_shards must be between 1 and 200, got %', p_shards;
  END IF;

  -- Step 1: Create the batch
  INSERT INTO public.report_job_batches(status, shard_count, batch_params, created_at, updated_at)
  VALUES ('running', p_shards, p_batch_params, now(), now())
  RETURNING id INTO v_batch_id;

  -- Step 2: Create N shard jobs
  v_job_ids := ARRAY[]::UUID[];
  FOR i IN 1..p_shards LOOP
    INSERT INTO public.report_jobs(status, batch_id, shard_no, job_params, created_at, updated_at)
    VALUES ('queued'::public.job_status, v_batch_id, i, p_batch_params, now(), now())
    RETURNING id INTO v_job_id;

    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  -- Step 3: Distribute tasks across shards in one scan (grado_ok)
  WITH task_assignments AS (
    SELECT DISTINCT
      s.school_codigo_ce,
      s.grado_ok AS grado,
      (abs(hashtext(s.school_codigo_ce || ':' || s.grado_ok)) % p_shards) + 1 AS shard_no
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND s.grado_ok IS NOT NULL
      AND s.grado_ok != ''
  ),
  job_mapping AS (
    SELECT
      j.id AS job_id,
      j.shard_no
    FROM public.report_jobs j
    WHERE j.batch_id = v_batch_id
  )
  INSERT INTO public.report_tasks(job_id, school_codigo_ce, grado, status, created_at, updated_at)
  SELECT
    jm.job_id,
    ta.school_codigo_ce,
    ta.grado,
    'pending'::public.task_status,
    now(),
    now()
  FROM task_assignments ta
  INNER JOIN job_mapping jm ON ta.shard_no = jm.shard_no;

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  RETURN QUERY SELECT v_batch_id, v_job_ids, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

