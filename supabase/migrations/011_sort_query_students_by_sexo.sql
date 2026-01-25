-- ========================================================================
-- Migration: Update query_students to sort by sexo (Mujer → Hombre)
-- ========================================================================
-- This migration updates the query_students function to sort results by:
-- 1. Sexo (Mujer first, then Hombre, then others)
-- 2. nombre_estudiante (alphabetically)
-- 3. nie (stable tie-breaker for pagination)

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
