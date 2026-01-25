-- Migration: Refactor all RPC functions to use grado_ok instead of grado
-- This migration updates all database functions to use the cleaned grado_ok column
-- instead of the raw grado column for consistency and data quality

-- ========================================================================
-- 1. Update get_school_grade_combinations to use grado_ok
-- ========================================================================
CREATE OR REPLACE FUNCTION public.get_school_grade_combinations()
RETURNS TABLE (
  school_codigo_ce TEXT,
  nombre_ce TEXT,
  grado TEXT,
  student_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.school_codigo_ce,
    sc.nombre_ce,
    s.grado_ok AS grado,
    COUNT(*) AS student_count
  FROM public.students s
  INNER JOIN public.schools sc ON s.school_codigo_ce = sc.codigo_ce
  WHERE s.grado_ok IS NOT NULL AND s.grado_ok != ''
  GROUP BY s.school_codigo_ce, sc.nombre_ce, s.grado_ok
  ORDER BY sc.nombre_ce, s.grado_ok;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 2. Update get_students_for_report to use grado_ok
-- ========================================================================
CREATE OR REPLACE FUNCTION public.get_students_for_report(
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

-- ========================================================================
-- 3. Update query_students to use grado_ok
-- ========================================================================
CREATE OR REPLACE FUNCTION public.query_students(
  p_school_codigo_ce TEXT DEFAULT NULL,
  p_grado TEXT DEFAULT NULL,
  p_departamento TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  nie TEXT,
  nombre_estudiante TEXT,
  sexo TEXT,
  edad SMALLINT,
  grado TEXT,
  school_codigo_ce TEXT,
  nombre_ce TEXT,
  camisa TEXT,
  pantalon_falda TEXT,
  zapato TEXT,
  total_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_students AS (
    SELECT
      s.nie,
      s.nombre_estudiante,
      s.sexo,
      s.edad,
      s.grado_ok,
      s.school_codigo_ce,
      sc.nombre_ce,
      COALESCE(u.camisa, 'N/A') AS camisa,
      COALESCE(u.pantalon_falda, 'N/A') AS pantalon_falda,
      COALESCE(u.zapato, 'N/A') AS zapato
    FROM public.students s
    INNER JOIN public.schools sc ON s.school_codigo_ce = sc.codigo_ce
    LEFT JOIN public.uniform_sizes u ON s.nie = u.nie
    WHERE (p_school_codigo_ce IS NULL OR s.school_codigo_ce = p_school_codigo_ce)
      AND (p_grado IS NULL OR s.grado_ok = p_grado)
      AND (p_departamento IS NULL OR sc.departamento = p_departamento)
      AND (p_region IS NULL OR sc.region = p_region)
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM filtered_students
  )
  SELECT
    fs.nie,
    fs.nombre_estudiante,
    fs.sexo,
    fs.edad,
    fs.grado_ok AS grado,
    fs.school_codigo_ce,
    fs.nombre_ce,
    fs.camisa,
    fs.pantalon_falda,
    fs.zapato,
    t.cnt::BIGINT AS total_count
  FROM filtered_students fs
  CROSS JOIN total t
  ORDER BY fs.nombre_estudiante
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 4. Update create_bulk_report_job to use grado_ok
-- ========================================================================
CREATE OR REPLACE FUNCTION public.create_bulk_report_job(p_job_params JSONB DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_job_id UUID;
  v_tasks_created INTEGER;
BEGIN
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

  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 5. Update create_bulk_report_batch to use grado_ok
-- ========================================================================
CREATE OR REPLACE FUNCTION public.create_bulk_report_batch(
  p_shards INTEGER DEFAULT 1,
  p_batch_params JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_batch_id UUID;
  v_job_ids UUID[];
  v_job_id UUID;
  i INTEGER;
BEGIN
  INSERT INTO public.report_job_batches(status, shard_count, batch_params, created_at, updated_at)
  VALUES ('queued', p_shards, p_batch_params, now(), now())
  RETURNING id INTO v_batch_id;

  FOR i IN 1..p_shards LOOP
    INSERT INTO public.report_jobs(status, batch_id, shard_no, created_at, updated_at)
    VALUES ('queued'::public.job_status, v_batch_id, i, now(), now())
    RETURNING id INTO v_job_id;

    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  WITH task_assignments AS (
    SELECT DISTINCT
      s.school_codigo_ce,
      s.grado_ok AS grado,
      -- Hash to shard number (1-based to match shard_no)
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

  RETURN v_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
