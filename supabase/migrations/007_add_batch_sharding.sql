-- ========================================================================
-- Migration: Add Batch + Shard Support for Parallel Job Processing
-- ========================================================================
-- Problem:
-- - A single job with 49k+ tasks takes hours to complete sequentially
-- - ZIP generation waits until ALL tasks complete
-- - Limited horizontal scaling opportunities
--
-- Solution:
-- - Add "batches" (user-initiated runs) that create N "shard jobs"
-- - Distribute tasks across shards using hash(school_codigo_ce || ':' || grado)
-- - Each shard completes independently → ZIPs start earlier
-- - Workers scale horizontally via multiple schedules (SKIP LOCKED makes this safe)
--
-- Benefits:
-- - 49k tasks split into 50 shards = ~1k tasks/shard
-- - Each shard completes in ~7-10 minutes (vs hours for monolithic job)
-- - ZIP generation starts per-shard (not waiting for entire dataset)
-- ========================================================================

BEGIN;

-- ========================================================================
-- Schema Changes
-- ========================================================================

-- Table: report_job_batches (tracks user-initiated bulk runs)
CREATE TABLE IF NOT EXISTS public.report_job_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running', -- running, complete, failed
  shard_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  batch_params JSONB
);

CREATE INDEX IF NOT EXISTS idx_report_job_batches_status ON public.report_job_batches(status);
CREATE INDEX IF NOT EXISTS idx_report_job_batches_created_at ON public.report_job_batches(created_at DESC);

-- Add batch_id and shard_no to report_jobs
ALTER TABLE public.report_jobs
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.report_job_batches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS shard_no INTEGER;

CREATE INDEX IF NOT EXISTS idx_report_jobs_batch_shard ON public.report_jobs(batch_id, shard_no);

-- ========================================================================
-- RPC: Create a batch with N shard jobs + distribute tasks in one pass
-- ========================================================================

CREATE OR REPLACE FUNCTION public.create_report_job_batch(
  p_shards INTEGER DEFAULT 50,
  p_batch_params JSONB DEFAULT NULL
)
RETURNS TABLE (
  batch_id UUID,
  job_ids UUID[],
  tasks_created INTEGER
) AS $$
DECLARE
  v_batch_id UUID;
  v_job_ids UUID[];
  v_tasks_created INTEGER;
  v_job_id UUID;
  i INTEGER;
BEGIN
  -- Disable statement timeout for this long-running operation
  PERFORM set_config('statement_timeout', '0', true);

  -- Validate shard count
  IF p_shards < 1 OR p_shards > 200 THEN
    RAISE EXCEPTION 'p_shards must be between 1 and 200, got %', p_shards;
  END IF;

  -- Step 1: Create the batch
  INSERT INTO public.report_job_batches(status, shard_count, batch_params, created_at, updated_at)
  VALUES ('running', p_shards, p_batch_params, now(), now())
  RETURNING id INTO v_batch_id;

  -- Step 2: Create N shard jobs
  v_job_ids := ARRAY[]::UUID[];
  FOR i IN 1..p_shards LOOP
    INSERT INTO public.report_jobs(status, batch_id, shard_no, job_params, created_at, updated_at)
    VALUES ('queued'::public.job_status, v_batch_id, i, p_batch_params, now(), now())
    RETURNING id INTO v_job_id;

    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  -- Step 3: Distribute tasks across shards in one scan
  -- Use hash(school_codigo_ce || ':' || grado) to ensure even distribution
  -- and deterministic shard assignment per task
  WITH task_assignments AS (
    SELECT DISTINCT
      s.school_codigo_ce,
      s.grado,
      -- Hash to shard number (1-based to match shard_no)
      (abs(hashtext(s.school_codigo_ce || ':' || s.grado)) % p_shards) + 1 AS shard_no
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND s.grado IS NOT NULL
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

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  RETURN QUERY SELECT v_batch_id, v_job_ids, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- RPC: Get batch progress (aggregate across shard jobs)
-- ========================================================================

CREATE OR REPLACE FUNCTION public.get_batch_progress(p_batch_id UUID)
RETURNS TABLE (
  batch_id UUID,
  shard_count INTEGER,
  total_tasks BIGINT,
  pending_tasks BIGINT,
  running_tasks BIGINT,
  complete_tasks BIGINT,
  failed_tasks BIGINT,
  jobs_queued BIGINT,
  jobs_running BIGINT,
  jobs_complete BIGINT,
  jobs_failed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.shard_count,
    COALESCE(SUM(
      CASE WHEN t.job_id IS NOT NULL THEN 1 ELSE 0 END
    ), 0) AS total_tasks,
    COALESCE(SUM(
      CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END
    ), 0) AS pending_tasks,
    COALESCE(SUM(
      CASE WHEN t.status = 'running' THEN 1 ELSE 0 END
    ), 0) AS running_tasks,
    COALESCE(SUM(
      CASE WHEN t.status = 'complete' THEN 1 ELSE 0 END
    ), 0) AS complete_tasks,
    COALESCE(SUM(
      CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END
    ), 0) AS failed_tasks,
    COALESCE(SUM(
      CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END
    ), 0) AS jobs_queued,
    COALESCE(SUM(
      CASE WHEN j.status = 'running' THEN 1 ELSE 0 END
    ), 0) AS jobs_running,
    COALESCE(SUM(
      CASE WHEN j.status = 'complete' THEN 1 ELSE 0 END
    ), 0) AS jobs_complete,
    COALESCE(SUM(
      CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END
    ), 0) AS jobs_failed
  FROM public.report_job_batches b
  LEFT JOIN public.report_jobs j ON j.batch_id = b.id
  LEFT JOIN public.report_tasks t ON t.job_id = j.id
  WHERE b.id = p_batch_id
  GROUP BY b.id, b.shard_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- Helper: Update batch status based on shard job completion
-- ========================================================================

CREATE OR REPLACE FUNCTION public.update_batch_status(p_batch_id UUID)
RETURNS VOID AS $$
DECLARE
  v_all_complete BOOLEAN;
  v_any_failed BOOLEAN;
  v_new_status TEXT;
BEGIN
  -- Check if all shard jobs are done
  SELECT
    BOOL_AND(j.status IN ('complete', 'failed')) AS all_done,
    BOOL_OR(j.status = 'failed') AS any_failed
  INTO v_all_complete, v_any_failed
  FROM public.report_jobs j
  WHERE j.batch_id = p_batch_id;

  IF v_all_complete THEN
    v_new_status := CASE WHEN v_any_failed THEN 'failed' ELSE 'complete' END;

    UPDATE public.report_job_batches
    SET status = v_new_status, updated_at = now()
    WHERE id = p_batch_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Usage Example
-- ========================================================================
-- To create a batch with 50 shards (recommended for ~49k tasks):
-- SELECT * FROM create_report_job_batch(50);
--
-- To check progress:
-- SELECT * FROM get_batch_progress('<batch_id>');
-- ========================================================================
