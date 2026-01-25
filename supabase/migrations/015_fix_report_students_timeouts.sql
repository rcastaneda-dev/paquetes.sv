-- ========================================================================
-- Migration: Prevent statement_timeout + improve index usage in report RPCs
-- ========================================================================
-- Symptom:
-- - Worker tasks (especially grado='ALL' / "Todos") sometimes fail with:
--     "canceling statement due to statement timeout"
--
-- Root causes:
-- - report_students_by_school() used:
--     WHERE trim(s.school_codigo_ce) = trim(p_school_codigo_ce)
--   which prevents using the plain (school_codigo_ce) index and can trigger
--   full-table scans on large datasets.
-- - Report RPCs did not explicitly disable statement_timeout (unlike job RPCs).
--
-- Fix:
-- - Make predicates index-friendly by trimming the INPUT once, not the column.
-- - Add composite indexes to support ORDER BY nombre_estudiante under a school
--   (and under school+grado_ok for the grade-specific RPC).
-- - Disable statement_timeout inside report RPCs.
-- ========================================================================

BEGIN;

-- Speed up filtering + ordering for ALL-grades reports
CREATE INDEX IF NOT EXISTS idx_students_school_nombre
  ON public.students (school_codigo_ce, nombre_estudiante);

-- Speed up filtering + ordering for grade-specific reports
CREATE INDEX IF NOT EXISTS idx_students_school_grado_ok_nombre
  ON public.students (school_codigo_ce, grado_ok, nombre_estudiante);

-- Worker-facing RPC: fetch all students for a school (grado_ok-based)
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
  -- Allow this call to run longer than the default statement_timeout
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
  WHERE s.school_codigo_ce = v_school_codigo_ce
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grade-specific RPC: also disable statement_timeout + keep predicate indexable
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
DECLARE
  v_school_codigo_ce TEXT := trim(p_school_codigo_ce);
  v_grado TEXT := trim(p_grado);
BEGIN
  -- Allow this call to run longer than the default statement_timeout
  PERFORM set_config('statement_timeout', '0', true);

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
  WHERE s.school_codigo_ce = v_school_codigo_ce
    AND s.grado_ok = v_grado
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

