-- ========================================================================
-- Migration: Update report_students functions to sort by sexo (Mujer → Hombre)
-- ========================================================================
-- Why:
-- - Single school PDFs (tallas and etiquetas via query_students) order by sexo
--   (Mujer → Hombre → others)
-- - Bulk PDFs (tallas and etiquetas via report_students_by_school/report_students_by_school_grade)
--   only order by nombre_estudiante
-- - This causes inconsistency: single school PDFs show students ordered by sexo,
--   but bucket PDFs don't follow that order
--
-- Fix:
-- - Update report_students_by_school to order by sexo, then nombre_estudiante, then nie
-- - Update report_students_by_school_grade to order by sexo, then nombre_estudiante, then nie
-- - This matches the ordering used in query_students (migration 011)
-- - Fixes both tallas (report) and etiquetas (labels) PDFs for bulk operations
-- ========================================================================

BEGIN;

-- Update ALL-grades RPC (one PDF per school)
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
DECLARE
  v_school_codigo_ce TEXT := trim(p_school_codigo_ce);
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

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
  WHERE trim(s.school_codigo_ce) = v_school_codigo_ce
  ORDER BY
    CASE
      WHEN s.sexo ILIKE 'Mujer' THEN 0
      WHEN s.sexo ILIKE 'Hombre' THEN 1
      ELSE 2
    END,
    s.nombre_estudiante,
    s.nie;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update grade-specific RPC (kept for compatibility; also used by worker for non-ALL tasks)
-- NOTE: Must DROP first because changing return type (adding bodega_produccion) is not allowed
-- via CREATE OR REPLACE in Postgres. The TypeScript StudentReportRow type requires bodega_produccion.
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
DECLARE
  v_school_codigo_ce TEXT := trim(p_school_codigo_ce);
  v_grado TEXT := trim(p_grado);
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

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
  WHERE trim(s.school_codigo_ce) = v_school_codigo_ce
    AND s.grado_ok = v_grado
  ORDER BY
    CASE
      WHEN s.sexo ILIKE 'Mujer' THEN 0
      WHEN s.sexo ILIKE 'Hombre' THEN 1
      ELSE 2
    END,
    s.nombre_estudiante,
    s.nie;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
