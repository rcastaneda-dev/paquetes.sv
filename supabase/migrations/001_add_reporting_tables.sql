-- ========================================================================
-- Migration: Add Reporting Infrastructure for Bulk PDF Generation
-- ========================================================================
-- This migration adds tables and functions to support:
-- 1. Bulk report job tracking
-- 2. Per-school-per-grade task management
-- 3. RPC functions for queries and report generation
-- ========================================================================

BEGIN;

-- Create custom types for job and task status
DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'complete', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM ('pending', 'running', 'complete', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Report Jobs table
CREATE TABLE IF NOT EXISTS public.report_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.job_status NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  zip_path TEXT,
  error TEXT,
  job_params JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- If the table already existed (from a previous/partial run), ensure expected columns exist
ALTER TABLE public.report_jobs
  ADD COLUMN IF NOT EXISTS status public.job_status NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS zip_path TEXT,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS job_params JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON public.report_jobs(status);
CREATE INDEX IF NOT EXISTS idx_report_jobs_created_at ON public.report_jobs(created_at DESC);

-- Report Tasks table (one task per school+grade combination)
CREATE TABLE IF NOT EXISTS public.report_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.report_jobs(id) ON DELETE CASCADE,
  school_codigo_ce TEXT NOT NULL REFERENCES public.schools(codigo_ce) ON DELETE CASCADE,
  grado TEXT NOT NULL,
  status public.task_status NOT NULL DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  pdf_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, school_codigo_ce, grado)
);

-- If the table already existed (from a previous/partial run), ensure expected columns exist
ALTER TABLE public.report_tasks
  ADD COLUMN IF NOT EXISTS job_id UUID,
  ADD COLUMN IF NOT EXISTS school_codigo_ce TEXT,
  ADD COLUMN IF NOT EXISTS grado TEXT,
  ADD COLUMN IF NOT EXISTS status public.task_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_report_tasks_job_status ON public.report_tasks(job_id, status);
CREATE INDEX IF NOT EXISTS idx_report_tasks_status ON public.report_tasks(status);
CREATE INDEX IF NOT EXISTS idx_report_tasks_updated ON public.report_tasks(updated_at);

-- ========================================================================
-- RPC Functions
-- ========================================================================

-- Function: Get report-ready rows for a specific school and grade
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
    s.grado,
    COALESCE(u.camisa, 'N/A') AS camisa,
    COALESCE(u.pantalon_falda, 'N/A') AS pantalon_falda,
    COALESCE(u.zapato, 'N/A') AS zapato
  FROM public.students s
  LEFT JOIN public.uniform_sizes u ON s.nie = u.nie
  WHERE s.school_codigo_ce = p_school_codigo_ce
    AND s.grado = p_grado
  ORDER BY s.nombre_estudiante;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Query students with pagination and filters
CREATE OR REPLACE FUNCTION public.query_students(
  p_school_codigo_ce TEXT DEFAULT NULL,
  p_grado TEXT DEFAULT NULL,
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
      s.grado,
      s.school_codigo_ce,
      sc.nombre_ce,
      COALESCE(u.camisa, 'N/A') AS camisa,
      COALESCE(u.pantalon_falda, 'N/A') AS pantalon_falda,
      COALESCE(u.zapato, 'N/A') AS zapato
    FROM public.students s
    INNER JOIN public.schools sc ON s.school_codigo_ce = sc.codigo_ce
    LEFT JOIN public.uniform_sizes u ON s.nie = u.nie
    WHERE (p_school_codigo_ce IS NULL OR s.school_codigo_ce = p_school_codigo_ce)
      AND (p_grado IS NULL OR s.grado = p_grado)
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
    fs.school_codigo_ce,
    fs.nombre_ce,
    fs.camisa,
    fs.pantalon_falda,
    fs.zapato,
    t.cnt
  FROM filtered_students fs, total t
  ORDER BY fs.nombre_estudiante
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Search schools (autocomplete)
CREATE OR REPLACE FUNCTION public.search_schools(
  p_query TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  codigo_ce TEXT,
  nombre_ce TEXT,
  municipio TEXT,
  departamento TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.codigo_ce,
    s.nombre_ce,
    s.municipio,
    s.departamento
  FROM public.schools s
  WHERE s.nombre_ce ILIKE '%' || p_query || '%'
     OR s.codigo_ce ILIKE '%' || p_query || '%'
     OR s.municipio ILIKE '%' || p_query || '%'
  ORDER BY s.nombre_ce
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get all distinct grades
CREATE OR REPLACE FUNCTION public.get_grades()
RETURNS TABLE (grado TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT s.grado
  FROM public.students s
  ORDER BY s.grado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get school and grade combinations for job creation
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
    s.grado,
    COUNT(*) AS student_count
  FROM public.students s
  INNER JOIN public.schools sc ON s.school_codigo_ce = sc.codigo_ce
  GROUP BY s.school_codigo_ce, sc.nombre_ce, s.grado
  ORDER BY sc.nombre_ce, s.grado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Claim pending tasks for worker processing
CREATE OR REPLACE FUNCTION public.claim_pending_tasks(
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  task_id UUID,
  job_id UUID,
  school_codigo_ce TEXT,
  grado TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.report_tasks
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT id FROM public.report_tasks
    WHERE status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, report_tasks.job_id, report_tasks.school_codigo_ce, report_tasks.grado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update task status
CREATE OR REPLACE FUNCTION public.update_task_status(
  p_task_id UUID,
  p_status public.task_status,
  p_pdf_path TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.report_tasks
  SET
    status = p_status,
    pdf_path = COALESCE(p_pdf_path, pdf_path),
    error = p_error,
    updated_at = now(),
    attempt_count = CASE
      WHEN p_status = 'failed' THEN attempt_count + 1
      ELSE attempt_count
    END
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get job progress stats
CREATE OR REPLACE FUNCTION public.get_job_progress(p_job_id UUID)
RETURNS TABLE (
  total_tasks BIGINT,
  pending_tasks BIGINT,
  running_tasks BIGINT,
  complete_tasks BIGINT,
  failed_tasks BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_tasks,
    COUNT(*) FILTER (WHERE status = 'running') AS running_tasks,
    COUNT(*) FILTER (WHERE status = 'complete') AS complete_tasks,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_tasks
  FROM public.report_tasks
  WHERE job_id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- End of migration
-- ========================================================================
