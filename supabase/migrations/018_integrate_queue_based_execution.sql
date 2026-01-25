-- ========================================================================
-- Migration: Integrate Queue-Based Execution with Job Creation
-- ========================================================================
-- Goal:
-- - Update create_report_job_batch to enqueue PDF tasks immediately after creation
-- - Add helper to auto-enqueue ZIP parts when all PDFs complete
-- - Add helper to auto-enqueue rollup when all parts complete
-- ========================================================================

BEGIN;

-- ========================================================================
-- 1. Update create_report_job_batch to enqueue PDF tasks
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
  v_enqueued INTEGER;
  i INTEGER;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  IF p_shards < 1 OR p_shards > 200 THEN
    RAISE EXCEPTION 'p_shards must be between 1 and 200, got %', p_shards;
  END IF;

  -- Create the batch
  INSERT INTO public.report_job_batches(status, shard_count, batch_params, created_at, updated_at)
  VALUES ('running', p_shards, p_batch_params, now(), now())
  RETURNING id INTO v_batch_id;

  -- Create N shard jobs
  v_job_ids := ARRAY[]::UUID[];
  FOR i IN 1..p_shards LOOP
    INSERT INTO public.report_jobs(status, batch_id, shard_no, job_params, created_at, updated_at)
    VALUES ('queued'::public.job_status, v_batch_id, i, p_batch_params, now(), now())
    RETURNING id INTO v_job_id;

    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  -- Distribute tasks across shards
  WITH task_assignments AS (
    SELECT DISTINCT
      trim(s.school_codigo_ce) AS school_codigo_ce,
      (abs(hashtext(trim(s.school_codigo_ce))) % p_shards) + 1 AS shard_no
    FROM public.students s
    WHERE s.school_codigo_ce IS NOT NULL
      AND trim(s.school_codigo_ce) != ''
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
    'ALL'::TEXT AS grado,
    'pending'::public.task_status,
    now(),
    now()
  FROM task_assignments ta
  INNER JOIN job_mapping jm ON ta.shard_no = jm.shard_no;

  GET DIAGNOSTICS v_tasks_created = ROW_COUNT;

  -- NEW: Enqueue PDF generation tasks for all shard jobs
  FOR v_job_id IN SELECT unnest(v_job_ids) LOOP
    SELECT enqueue_pdf_tasks(v_batch_id, v_job_id) INTO v_enqueued;
    RAISE NOTICE 'Enqueued % PDF tasks for job %', v_enqueued, v_job_id;
  END LOOP;

  RETURN QUERY SELECT v_batch_id, v_job_ids, v_tasks_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 2. Helper: Auto-trigger ZIP part creation when job PDFs complete
-- ========================================================================

CREATE OR REPLACE FUNCTION public.check_and_enqueue_zip_parts(
  p_job_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_run_id UUID;
  v_all_pdfs_complete BOOLEAN;
  v_enqueued INTEGER;
BEGIN
  -- Get run_id
  SELECT batch_id INTO v_run_id
  FROM public.report_jobs
  WHERE id = p_job_id;

  IF v_run_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if all PDFs for this job are complete
  SELECT
    COUNT(*) > 0
    AND COUNT(*) FILTER (WHERE status = 'complete') = COUNT(*)
  INTO v_all_pdfs_complete
  FROM public.report_work_results
  WHERE job_id = p_job_id
    AND work_type = 'pdf_generate';

  IF NOT COALESCE(v_all_pdfs_complete, false) THEN
    RETURN false;
  END IF;

  -- Mark job as complete
  UPDATE public.report_jobs
  SET status = 'complete', updated_at = now()
  WHERE id = p_job_id
    AND status = 'running';

  -- Enqueue ZIP part tasks
  SELECT enqueue_zip_part_tasks(v_run_id, p_job_id, 100) INTO v_enqueued;
  RAISE NOTICE 'Enqueued % ZIP part tasks for job %', v_enqueued, p_job_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 3. Helper: Auto-trigger ZIP rollup when all run parts complete
-- ========================================================================

CREATE OR REPLACE FUNCTION public.check_and_enqueue_rollup(
  p_run_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_all_parts_complete BOOLEAN;
  v_enqueued BOOLEAN;
BEGIN
  -- Check if all jobs in this run have completed their ZIP parts
  SELECT BOOL_AND(
    (SELECT COUNT(*) > 0
     FROM public.report_work_results
     WHERE job_id = rj.id
       AND work_type = 'zip_part'
       AND status = 'complete')
  )
  INTO v_all_parts_complete
  FROM public.report_jobs rj
  WHERE rj.batch_id = p_run_id;

  IF NOT COALESCE(v_all_parts_complete, false) THEN
    RETURN false;
  END IF;

  -- Enqueue rollup task
  SELECT enqueue_zip_rollup_task(p_run_id) INTO v_enqueued;

  IF v_enqueued THEN
    RAISE NOTICE 'Enqueued ZIP rollup task for run %', p_run_id;
  END IF;

  RETURN v_enqueued;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================================
-- 4. Add trigger-based helpers (optional, for automatic progression)
-- ========================================================================

-- Trigger on work_results update to auto-progress pipeline
CREATE OR REPLACE FUNCTION public.work_result_completion_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- If a PDF task completed, check if we should enqueue ZIP parts
  IF NEW.work_type = 'pdf_generate' AND NEW.status = 'complete' AND OLD.status != 'complete' THEN
    PERFORM check_and_enqueue_zip_parts(NEW.job_id);
  END IF;

  -- If a ZIP part completed, check if we should enqueue rollup
  IF NEW.work_type = 'zip_part' AND NEW.status = 'complete' AND OLD.status != 'complete' THEN
    PERFORM check_and_enqueue_rollup(NEW.run_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_result_completion_trigger ON public.report_work_results;
CREATE TRIGGER work_result_completion_trigger
  AFTER UPDATE ON public.report_work_results
  FOR EACH ROW
  EXECUTE FUNCTION work_result_completion_trigger();

COMMIT;

-- ========================================================================
-- Usage Notes
-- ========================================================================
-- After this migration:
-- 1. Creating a batch via create_report_job_batch will automatically enqueue PDF tasks
-- 2. As PDFs complete, ZIP parts will be auto-enqueued (via trigger)
-- 3. As ZIP parts complete, rollup will be auto-enqueued (via trigger)
-- 4. Edge Function workers drain queues independently
-- ========================================================================
