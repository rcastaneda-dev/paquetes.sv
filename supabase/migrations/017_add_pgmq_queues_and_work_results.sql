-- ========================================================================
-- Migration: Add PGMQ Queues + Work Results + Process Management
-- ========================================================================
-- Goal:
-- - Enable Supabase Queues (PGMQ) for queue-driven task execution
-- - Add idempotency/completion tracking via report_work_results
-- - Add explicit process staging via report_processes
-- - Support queue-based parallelism for ~6k PDFs/run with Edge Function workers
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Enable PGMQ Extension
-- ========================================================================

CREATE EXTENSION IF NOT EXISTS pgmq CASCADE;

-- ========================================================================
-- 2. Create PGMQ Queues
-- ========================================================================

-- Queue for PDF generation tasks (one message per school)
SELECT pgmq.create('pdf_generate');

-- Queue for ZIP part creation (one message per part)
SELECT pgmq.create('zip_part');

-- Queue for final ZIP rollup (one message per run to create single artifact)
SELECT pgmq.create('zip_rollup');

-- ========================================================================
-- 3. Work Results Table (Idempotency + Completion Tracking)
-- ========================================================================

CREATE TABLE IF NOT EXISTS public.report_work_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  work_type TEXT NOT NULL, -- 'pdf_generate', 'zip_part', 'zip_rollup'
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, complete, failed
  run_id UUID REFERENCES public.report_job_batches(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.report_jobs(id) ON DELETE CASCADE,
  artifact_path TEXT,
  error TEXT,
  attempt_count INTEGER DEFAULT 0,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_work_results_dedupe ON public.report_work_results(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_report_work_results_status ON public.report_work_results(status);
CREATE INDEX IF NOT EXISTS idx_report_work_results_run_id ON public.report_work_results(run_id);
CREATE INDEX IF NOT EXISTS idx_report_work_results_job_id ON public.report_work_results(job_id);
CREATE INDEX IF NOT EXISTS idx_report_work_results_work_type_status ON public.report_work_results(work_type, status);

-- ========================================================================
-- 4. Process Management Table
-- ========================================================================

DO $$ BEGIN
  CREATE TYPE public.process_type AS ENUM (
    'plan',
    'pdf_generate',
    'zip_parts',
    'zip_rollup',
    'finalize'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.report_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.report_job_batches(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.report_jobs(id) ON DELETE CASCADE, -- NULL for run-level processes
  process_type public.process_type NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, complete, failed, cancelled
  total_items INTEGER DEFAULT 0,
  completed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  error TEXT,
  metrics JSONB, -- JSON for timing, throughput, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(run_id, job_id, process_type)
);

CREATE INDEX IF NOT EXISTS idx_report_processes_run_id ON public.report_processes(run_id);
CREATE INDEX IF NOT EXISTS idx_report_processes_job_id ON public.report_processes(job_id);
CREATE INDEX IF NOT EXISTS idx_report_processes_status ON public.report_processes(status);
CREATE INDEX IF NOT EXISTS idx_report_processes_type_status ON public.report_processes(process_type, status);

-- ========================================================================
-- 5. Helper Functions for Queue Management
-- ========================================================================

-- Function: Enqueue PDF generation tasks for a job
CREATE OR REPLACE FUNCTION public.enqueue_pdf_tasks(
  p_run_id UUID,
  p_job_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_enqueued INTEGER := 0;
  v_school_record RECORD;
  v_dedupe_key TEXT;
  v_payload JSONB;
BEGIN
  -- For each school in this job's tasks, enqueue a message
  FOR v_school_record IN
    SELECT DISTINCT
      rt.school_codigo_ce,
      rt.grado,
      sc.nombre_ce AS school_name
    FROM public.report_tasks rt
    LEFT JOIN public.schools sc ON rt.school_codigo_ce = sc.codigo_ce
    WHERE rt.job_id = p_job_id
      AND rt.status = 'pending'
  LOOP
    v_dedupe_key := format('pdf:%s:%s:%s',
      p_job_id,
      v_school_record.school_codigo_ce,
      v_school_record.grado
    );

    -- Check if already processed (idempotency)
    IF EXISTS (
      SELECT 1 FROM public.report_work_results
      WHERE dedupe_key = v_dedupe_key
        AND status IN ('complete', 'running')
    ) THEN
      CONTINUE;
    END IF;

    -- Build payload
    v_payload := jsonb_build_object(
      'run_id', p_run_id,
      'job_id', p_job_id,
      'school_codigo_ce', v_school_record.school_codigo_ce,
      'grado', v_school_record.grado,
      'school_name', v_school_record.school_name
    );

    -- Enqueue to PGMQ
    PERFORM pgmq.send('pdf_generate', v_payload);

    -- Record in work_results for tracking
    INSERT INTO public.report_work_results (
      dedupe_key,
      work_type,
      status,
      run_id,
      job_id,
      payload
    ) VALUES (
      v_dedupe_key,
      'pdf_generate',
      'pending',
      p_run_id,
      p_job_id,
      v_payload
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN v_enqueued;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Enqueue ZIP part tasks for a job
CREATE OR REPLACE FUNCTION public.enqueue_zip_part_tasks(
  p_run_id UUID,
  p_job_id UUID,
  p_part_size INTEGER DEFAULT 100
)
RETURNS INTEGER AS $$
DECLARE
  v_enqueued INTEGER := 0;
  v_pdf_count INTEGER;
  v_part_count INTEGER;
  v_part_no INTEGER;
  v_dedupe_key TEXT;
  v_payload JSONB;
BEGIN
  -- Count completed PDFs for this job
  SELECT COUNT(*)::INTEGER
  INTO v_pdf_count
  FROM public.report_work_results
  WHERE job_id = p_job_id
    AND work_type = 'pdf_generate'
    AND status = 'complete'
    AND artifact_path IS NOT NULL;

  IF v_pdf_count = 0 THEN
    RETURN 0;
  END IF;

  v_part_count := CEIL(v_pdf_count::NUMERIC / GREATEST(p_part_size, 1))::INTEGER;

  FOR v_part_no IN 1..v_part_count LOOP
    v_dedupe_key := format('zip_part:%s:%s', p_job_id, v_part_no);

    -- Check if already processed
    IF EXISTS (
      SELECT 1 FROM public.report_work_results
      WHERE dedupe_key = v_dedupe_key
        AND status IN ('complete', 'running')
    ) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'run_id', p_run_id,
      'job_id', p_job_id,
      'part_no', v_part_no,
      'part_size', p_part_size
    );

    PERFORM pgmq.send('zip_part', v_payload);

    INSERT INTO public.report_work_results (
      dedupe_key,
      work_type,
      status,
      run_id,
      job_id,
      payload
    ) VALUES (
      v_dedupe_key,
      'zip_part',
      'pending',
      p_run_id,
      p_job_id,
      v_payload
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN v_enqueued;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Enqueue ZIP rollup task for a run (creates single artifact)
CREATE OR REPLACE FUNCTION public.enqueue_zip_rollup_task(
  p_run_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_dedupe_key TEXT;
  v_payload JSONB;
  v_all_jobs_complete BOOLEAN;
BEGIN
  v_dedupe_key := format('zip_rollup:%s', p_run_id);

  -- Check if already processed
  IF EXISTS (
    SELECT 1 FROM public.report_work_results
    WHERE dedupe_key = v_dedupe_key
      AND status IN ('complete', 'running')
  ) THEN
    RETURN false;
  END IF;

  -- Check if all shard jobs have completed their zip parts
  SELECT BOOL_AND(
    (SELECT COUNT(*) FROM public.report_work_results
     WHERE job_id = rj.id
       AND work_type = 'zip_part'
       AND status = 'complete') > 0
  )
  INTO v_all_jobs_complete
  FROM public.report_jobs rj
  WHERE rj.batch_id = p_run_id;

  IF NOT COALESCE(v_all_jobs_complete, false) THEN
    RETURN false;
  END IF;

  v_payload := jsonb_build_object('run_id', p_run_id);

  PERFORM pgmq.send('zip_rollup', v_payload);

  INSERT INTO public.report_work_results (
    dedupe_key,
    work_type,
    status,
    run_id,
    payload
  ) VALUES (
    v_dedupe_key,
    'zip_rollup',
    'pending',
    p_run_id,
    v_payload
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update work result status
CREATE OR REPLACE FUNCTION public.update_work_result(
  p_dedupe_key TEXT,
  p_status TEXT,
  p_artifact_path TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.report_work_results
  SET
    status = p_status,
    artifact_path = COALESCE(p_artifact_path, artifact_path),
    error = p_error,
    attempt_count = CASE WHEN p_status = 'failed' THEN attempt_count + 1 ELSE attempt_count END,
    updated_at = now()
  WHERE dedupe_key = p_dedupe_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get process progress
CREATE OR REPLACE FUNCTION public.get_process_progress(
  p_run_id UUID,
  p_process_type public.process_type DEFAULT NULL
)
RETURNS TABLE (
  process_id UUID,
  process_type public.process_type,
  status TEXT,
  total_items INTEGER,
  completed_items INTEGER,
  failed_items INTEGER,
  completion_percentage INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.process_type,
    p.status,
    p.total_items,
    p.completed_items,
    p.failed_items,
    CASE
      WHEN p.total_items > 0 THEN ROUND((p.completed_items::NUMERIC / p.total_items::NUMERIC) * 100)::INTEGER
      ELSE 0
    END AS completion_percentage
  FROM public.report_processes p
  WHERE p.run_id = p_run_id
    AND (p_process_type IS NULL OR p.process_type = p_process_type)
  ORDER BY p.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Usage Notes
-- ========================================================================
-- After creating a batch/run, call enqueue_pdf_tasks for each shard job:
--   SELECT enqueue_pdf_tasks('<run_id>', '<job_id>');
--
-- Edge Function workers will:
--   1. Read from queue: pgmq.read('pdf_generate', 30, 10) -- vt=30s, batch=10
--   2. Process work
--   3. Call update_work_result() with status
--   4. Archive message: pgmq.archive('pdf_generate', <msg_id>)
-- ========================================================================
