-- ========================================================================
-- Migration: Add municipio field to query_students return type
-- ========================================================================
-- Purpose: expose sc.municipio so the editable-v2 Excel export can include
-- DEPARTAMENTO, MUNICIPIO, and DISTRITO columns.
-- ========================================================================

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
  total_count           BIGINT
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
      COALESCE(u.zapato,                'N/A') AS zapato
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
    t.cnt::BIGINT AS total_count
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
  'Returns students with school and uniform information. '
  'Includes departamento, municipio, distrito, zona, and transporte for report generation. '
  'Supports filtering by school, grade, department, and fecha_inicio.';
