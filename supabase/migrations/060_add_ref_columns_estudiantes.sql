-- ========================================================================
-- Migration: Add REF_KITS, REF_UNIFORMES, REF_ZAPATOS to estudiantes pipeline
-- ========================================================================
-- Purpose: Store per-school reference/dispatch codes uploaded via the
-- estudiantes CSV. These codes are stamped on the top-left corner of
-- generated PDF documents (cajas → REF_KITS, uniformes → REF_UNIFORMES,
-- zapatos → REF_ZAPATOS).
-- ========================================================================

-- 1. Staging table — nullable so existing CSVs without these columns still work
ALTER TABLE public.staging_cajas_raw
  ADD COLUMN IF NOT EXISTS "REF_KITS" TEXT,
  ADD COLUMN IF NOT EXISTS "REF_UNIFORMES" TEXT,
  ADD COLUMN IF NOT EXISTS "REF_ZAPATOS" TEXT;

-- 2. Production table — default empty string
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS ref_kits TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ref_uniformes TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ref_zapatos TEXT DEFAULT '';

-- 3. Recreate migrate_staging_data() to propagate the ref columns
CREATE OR REPLACE FUNCTION migrate_staging_data()
RETURNS json AS $$
DECLARE
    result_summary json;
BEGIN
    -- PART 1: Clean slate (Caution: Truncating production tables)
    TRUNCATE TABLE
        public.zip_jobs, public.report_tasks, public.report_jobs,
        public.report_job_batches, public.uniform_sizes, public.students,
        public.schools
    CASCADE;

    -- PART 2: Load Schools (now includes ref columns)
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona, fecha_inicio, dificil_acceso, transporte,
        ref_kits, ref_uniformes, ref_zapatos
    )
    SELECT DISTINCT ON (trim("CODIGO_CE"))
        trim("CODIGO_CE"), trim("NOMBRE_CE"), trim("DEPARTAMENTO"),
        trim("MUNICIPIO"), trim("DISTRITO"),
        COALESCE(NULLIF(trim("DIRECCION"), ''), 'SIN DIRECCION'),
        trim("ZONA"), trim("FECHA_INICIO")::DATE,
        trim("DIFICIL_ACCESO"), trim("TRANSPORTE"),
        COALESCE(NULLIF(trim("REF_KITS"), ''), ''),
        COALESCE(NULLIF(trim("REF_UNIFORMES"), ''), ''),
        COALESCE(NULLIF(trim("REF_ZAPATOS"), ''), '')
    FROM public.staging_cajas_raw
    WHERE NULLIF(trim("CODIGO_CE"), '') IS NOT NULL
    ORDER BY trim("CODIGO_CE")
    ON CONFLICT (codigo_ce) DO UPDATE SET
        nombre_ce     = EXCLUDED.nombre_ce,
        departamento  = EXCLUDED.departamento,
        municipio     = EXCLUDED.municipio,
        distrito      = EXCLUDED.distrito,
        direccion     = EXCLUDED.direccion,
        zona          = EXCLUDED.zona,
        fecha_inicio  = EXCLUDED.fecha_inicio,
        dificil_acceso = EXCLUDED.dificil_acceso,
        transporte    = EXCLUDED.transporte,
        ref_kits      = CASE WHEN EXCLUDED.ref_kits <> '' THEN EXCLUDED.ref_kits
                              ELSE public.schools.ref_kits END,
        ref_uniformes = CASE WHEN EXCLUDED.ref_uniformes <> '' THEN EXCLUDED.ref_uniformes
                              ELSE public.schools.ref_uniformes END,
        ref_zapatos   = CASE WHEN EXCLUDED.ref_zapatos <> '' THEN EXCLUDED.ref_zapatos
                              ELSE public.schools.ref_zapatos END;

    -- PART 3: Load Students & Sizes (Using a CTE for cleaner NIE logic)
    WITH processed_students AS (
        SELECT DISTINCT
            COALESCE(
                NULLIF(trim("NIE"), '')::numeric::bigint::text,
                (9000000000 + abs(hashtext(coalesce(trim("NOMBRE_ESTUDIANTE"), '') || coalesce(trim("CODIGO_CE"), '') || coalesce(trim("GRADO"), ''))) % 1000000000)::text
            ) as calculated_nie,
            trim("CODIGO_CE") as ce,
            trim("NOMBRE_ESTUDIANTE") as name,
            CASE WHEN upper(trim("SEXO")) = 'HOMBRE' THEN 'Hombre' ELSE 'Mujer' END as gender,
            NULLIF(trim("EDAD"), '')::numeric::smallint as age,
            trim("GRADO") as grade,
            trim("GRADO OK") as grade_ok
        FROM public.staging_cajas_raw
        WHERE trim("CODIGO_CE") <> '' AND trim("NOMBRE_ESTUDIANTE") <> ''
    )
    INSERT INTO public.students (nie, school_codigo_ce, nombre_estudiante, sexo, edad, grado, grado_ok)
    SELECT calculated_nie, ce, name, gender, age, grade, grade_ok FROM processed_students
    ON CONFLICT (nie) DO NOTHING;

    -- Final Sizes Insert
    INSERT INTO public.uniform_sizes (nie, camisa, pantalon_falda, zapato, tipo_de_camisa, t_pantalon_falda_short)
    SELECT
        s.nie, trim(r."CAMISA"), trim(r."PANTALON/FALDA"),
        trim(r."ZAPATO"), trim(r."TIPO_DE_CAMISA"), trim(r."T_PANTALON_FALDA_SHORT")
    FROM public.staging_cajas_raw r
    JOIN public.students s ON s.nie = COALESCE(NULLIF(trim(r."NIE"), '')::numeric::bigint::text, (9000000000 + abs(hashtext(coalesce(trim(r."NOMBRE_ESTUDIANTE"), '') || coalesce(trim(r."CODIGO_CE"), '') || coalesce(trim(r."GRADO"), ''))) % 1000000000)::text)
    WHERE trim(r."CAMISA") <> ''
    ON CONFLICT (nie) DO NOTHING;

    -- Return a summary for the UI
    RETURN json_build_object(
        'schools', (SELECT count(*) FROM schools),
        'students', (SELECT count(*) FROM students),
        'sizes', (SELECT count(*) FROM uniform_sizes)
    );
END;
$$ LANGUAGE plpgsql;

-- 4. Recreate query_students to include ref columns from schools
DROP FUNCTION IF EXISTS public.query_students(TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.query_students(
  p_school_codigo_ce TEXT DEFAULT NULL,
  p_grado            TEXT DEFAULT NULL,
  p_departamento     TEXT DEFAULT NULL,
  p_fecha_inicio     DATE DEFAULT NULL,
  p_limit            INTEGER DEFAULT 50,
  p_offset           INTEGER DEFAULT 0
)
RETURNS TABLE (
  nie                   TEXT,
  nombre_estudiante     TEXT,
  sexo                  TEXT,
  edad                  SMALLINT,
  grado                 TEXT,
  grado_ok              TEXT,
  school_codigo_ce      TEXT,
  nombre_ce             TEXT,
  departamento          TEXT,
  municipio             TEXT,
  distrito              TEXT,
  zona                  TEXT,
  transporte            TEXT,
  fecha_inicio          TEXT,
  camisa                TEXT,
  tipo_de_camisa        TEXT,
  pantalon_falda        TEXT,
  t_pantalon_falda_short TEXT,
  zapato                TEXT,
  total_count           BIGINT,
  ref_kits              TEXT,
  ref_uniformes         TEXT,
  ref_zapatos           TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_students AS (
    SELECT
      s.nie,
      s.nombre_estudiante,
      s.sexo,
      s.edad,
      s.grado,
      s.grado_ok,
      s.school_codigo_ce,
      sc.nombre_ce,
      sc.departamento,
      sc.municipio,
      sc.distrito,
      sc.zona,
      sc.transporte,
      sc.fecha_inicio::TEXT AS fecha_inicio,
      COALESCE(u.camisa,                'N/A') AS camisa,
      COALESCE(u.tipo_de_camisa,        'N/A') AS tipo_de_camisa,
      COALESCE(u.pantalon_falda,        'N/A') AS pantalon_falda,
      COALESCE(u.t_pantalon_falda_short,'N/A') AS t_pantalon_falda_short,
      COALESCE(u.zapato,                'N/A') AS zapato,
      COALESCE(sc.ref_kits,     '') AS ref_kits,
      COALESCE(sc.ref_uniformes, '') AS ref_uniformes,
      COALESCE(sc.ref_zapatos,  '') AS ref_zapatos
    FROM public.students s
    INNER JOIN public.schools sc
      ON s.school_codigo_ce = sc.codigo_ce
    LEFT JOIN public.uniform_sizes u
      ON s.nie = u.nie
    WHERE
      (p_school_codigo_ce IS NULL OR s.school_codigo_ce = p_school_codigo_ce)
      AND (p_grado         IS NULL OR s.grado_ok         = p_grado)
      AND (p_departamento  IS NULL OR sc.departamento     = p_departamento)
      AND (p_fecha_inicio  IS NULL OR sc.fecha_inicio     = p_fecha_inicio)
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM filtered_students
  )
  SELECT
    fs.nie,
    fs.nombre_estudiante,
    fs.sexo,
    fs.edad,
    fs.grado,
    fs.grado_ok,
    fs.school_codigo_ce,
    fs.nombre_ce,
    fs.departamento,
    fs.municipio,
    fs.distrito,
    fs.zona,
    fs.transporte,
    fs.fecha_inicio,
    fs.camisa,
    fs.tipo_de_camisa,
    fs.pantalon_falda,
    fs.t_pantalon_falda_short,
    fs.zapato,
    t.cnt::BIGINT AS total_count,
    fs.ref_kits,
    fs.ref_uniformes,
    fs.ref_zapatos
  FROM filtered_students fs
  CROSS JOIN total t
  ORDER BY
    CASE
      WHEN fs.sexo ILIKE 'Mujer'  THEN 0
      WHEN fs.sexo ILIKE 'Hombre' THEN 1
      ELSE 2
    END,
    fs.nombre_estudiante,
    fs.nie
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION public.query_students IS
  'Returns students with school, uniform, and reference code information. '
  'Includes ref_kits, ref_uniformes, ref_zapatos for PDF overlay codes. '
  'Supports filtering by school, grade, department, and fecha_inicio.';
