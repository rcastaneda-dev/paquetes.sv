-- ========================================================================
-- Migration: Generate ONE PDF per school (tasks no longer split by grade)
-- ========================================================================
-- Goal:
-- - When a bulk job is created, generate one PDF per school (all grades inside)
--
-- Approach:
-- - Keep existing table schema (report_tasks.grado is NOT NULL) by using a
--   sentinel value: 'ALL'
-- - Update create_report_job / create_report_job_batch to create tasks as:
--     (job_id, school_codigo_ce, grado='ALL')
-- - Add a worker-facing RPC to fetch ALL students for a school:
--     report_students_by_school(p_school_codigo_ce)
--
-- Notes:
-- - Existing report_students_by_school_grade stays for backwards compatibility.
-- - PDF generator already groups rows by student.grado inside a single PDF.
-- - Sharding now distributes by school (hashtext(school_codigo_ce)).
-- ========================================================================

BEGIN;

-- Fast DISTINCT school scans
CREATE INDEX IF NOT EXISTS idx_students_school_codigo_ce
  ON public.students (school_codigo_ce);

-- Worker-facing RPC: fetch all students for a school (grado_ok-based)
DROP FUNCTION IF EXISTS public.report_students_by_school(TEXT);
CREATE OR REPLACE FUNCTION public.report_students_by_school(
  p_school_codigo_ce TEXT
)
RETURNS TABLE (
  nie TEXT,
  nombre_estudiante TEXT,
  sexo TEXT,
  edad SMALLINT,
  grado TEXT,
  bodega_produccion TEXT,
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
    s.bodega_produccion,
    COALESCE(u.camisa, 'N/A') AS camisa,
    COALESCE(u.pantalon_falda, 'N/A') AS pantalon_falda,
    COALESCE(u.zapato, 'N/A') AS zapato
  FROM public.students s
  LEFT JOIN public.uniform_sizes u ON s.nie = u.nie
  WHERE trim(s.school_codigo_ce) = trim(p_school_codigo_ce)
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- API-facing RPC: create a job + one task per school (grado='ALL')
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
  PERFORM set_config('statement_timeout', '0', true);

  INSERT INTO public.report_jobs(status, job_params, created_at, updated_at)
  VALUES ('queued'::public.job_status, p_job_params, now(), now())
  RETURNING id INTO v_job_id;

  INSERT INTO public.report_tasks(job_id, school_codigo_ce, grado, status, created_at, updated_at)
  SELECT
    v_job_id,
    combos.school_codigo_ce,
    'ALL'::TEXT AS grado,
    'pending'::public.task_status,
    now(),
    now()
  FROM (
    SELECT DISTINCT trim(s.school_codigo_ce) AS school_codigo_ce
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND trim(s.school_codigo_ce) != ''
  ) AS combos;

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;
  RETURN QUERY SELECT v_job_id, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Batch RPC: create a batch with N shard jobs + distribute tasks by school (grado='ALL')
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
  PERFORM set_config('statement_timeout', '0', true);

  IF p_shards < 1 OR p_shards > 200 THEN
    RAISE EXCEPTION 'p_shards must be between 1 and 200, got %', p_shards;
  END IF;

  INSERT INTO public.report_job_batches(status, shard_count, batch_params, created_at, updated_at)
  VALUES ('running', p_shards, p_batch_params, now(), now())
  RETURNING id INTO v_batch_id;

  v_job_ids := ARRAY[]::UUID[];
  FOR i IN 1..p_shards LOOP
    INSERT INTO public.report_jobs(status, batch_id, shard_no, job_params, created_at, updated_at)
    VALUES ('queued'::public.job_status, v_batch_id, i, p_batch_params, now(), now())
    RETURNING id INTO v_job_id;

    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  WITH task_assignments AS (
    SELECT DISTINCT
      trim(s.school_codigo_ce) AS school_codigo_ce,
      (abs(hashtext(trim(s.school_codigo_ce))) % p_shards) + 1 AS shard_no
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND trim(s.school_codigo_ce) != ''
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
    'ALL'::TEXT AS grado,
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

