-- ========================================================================
-- Migration: Make trimmed school_codigo_ce predicates indexable (avoid timeouts)
-- ========================================================================
-- Why:
-- - Task creation stores trimmed school codes (see 014_one_pdf_per_school.sql),
--   so report RPCs must effectively match students even when students.school_codigo_ce
--   contains trailing/leading whitespace.
-- - Using trim(s.school_codigo_ce) in WHERE is semantically correct, but without an
--   expression index it prevents using the plain (school_codigo_ce) index and can
--   cause full scans + statement timeouts on large schools.
--
-- Fix:
-- - Add expression indexes on trim(school_codigo_ce) (+ ordering fields)
-- - Update report RPCs to use trim(column) = trimmed_param (index-backed)
-- - Keep disabling statement_timeout inside the RPCs
-- ========================================================================

BEGIN;

-- Indexes that match the WHERE expression exactly
CREATE INDEX IF NOT EXISTS idx_students_trim_school_nombre
  ON public.students ((trim(school_codigo_ce)), nombre_estudiante);

CREATE INDEX IF NOT EXISTS idx_students_trim_school_grado_ok_nombre
  ON public.students ((trim(school_codigo_ce)), grado_ok, nombre_estudiante);

-- ALL-grades RPC (one PDF per school)
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
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grade-specific RPC (kept for compatibility; also used by worker for non-ALL tasks)
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
  WHERE trim(s.school_codigo_ce) = v_school_codigo_ce
    AND s.grado_ok = v_grado
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

