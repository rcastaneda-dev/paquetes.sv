-- ========================================================================
-- Migration: Add bodega_produccion to report/query RPC outputs
-- ========================================================================

BEGIN;

-- NOTE:
-- - This migration MUST remain consistent with the grado_ok-based pipeline introduced in 010/012.
-- - We DROP before CREATE because changing the OUT-parameter row type (adding bodega_produccion)
--   is not allowed via CREATE OR REPLACE in Postgres.

DROP FUNCTION IF EXISTS public.query_students(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.query_students(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);

-- Latest signature (incl. departamento/region), filters by grado_ok, and adds bodega_produccion
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
  bodega_produccion TEXT,
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
      s.bodega_produccion,
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
    fs.bodega_produccion,
    fs.school_codigo_ce,
    fs.nombre_ce,
    fs.camisa,
    fs.pantalon_falda,
    fs.zapato,
    t.cnt::BIGINT AS total_count
  FROM filtered_students fs
  CROSS JOIN total t
  ORDER BY
    CASE
      WHEN fs.sexo ILIKE 'Mujer' THEN 0
      WHEN fs.sexo ILIKE 'Hombre' THEN 1
      ELSE 2
    END,
    fs.nombre_estudiante,
    fs.nie
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adds bodega_produccion to the report rows used by the worker pipeline
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
  WHERE s.school_codigo_ce = p_school_codigo_ce
    AND s.grado_ok = p_grado
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

