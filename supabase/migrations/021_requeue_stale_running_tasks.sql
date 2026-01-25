-- ========================================================================
-- Migration: Requeue stale "running" tasks
-- ========================================================================
-- Problem:
-- - If a worker claims tasks (status -> 'running') and then crashes/timeouts,
--   those tasks can stay 'running' forever.
-- - When pending_tasks = 0 but running_tasks > 0, the drain loop exits early,
--   and the UI can "load indefinitely" because jobs never reach allDone.
--
-- Solution:
-- - Add an RPC to requeue stale 'running' tasks back to 'pending' based on
--   their updated_at age.
-- - The worker can call this when it sees an empty pending queue.
-- ========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.requeue_stale_running_tasks(
  p_stale_seconds INTEGER DEFAULT 900, -- 15 minutes
  p_limit INTEGER DEFAULT 5000
)
RETURNS INTEGER AS $$
DECLARE
  v_requeued INTEGER := 0;
BEGIN
  -- Requeue only tasks that are:
  -- - currently 'running'
  -- - haven't been updated recently (stale)
  -- - belong to jobs that are still active (queued/running)
  UPDATE public.report_tasks rt
  SET
    status = 'pending'::public.task_status,
    -- Preserve any existing error; annotate only if empty.
    error = COALESCE(rt.error, format('Requeued stale running task after %s seconds', p_stale_seconds)),
    updated_at = now()
  WHERE rt.id IN (
    SELECT rt2.id
    FROM public.report_tasks rt2
    INNER JOIN public.report_jobs rj ON rj.id = rt2.job_id
    WHERE rt2.status = 'running'::public.task_status
      AND rt2.updated_at < (now() - make_interval(secs => GREATEST(p_stale_seconds, 1)))
      AND rj.status IN ('queued'::public.job_status, 'running'::public.job_status)
    ORDER BY rt2.updated_at ASC
    LIMIT p_limit
    FOR UPDATE OF rt2 SKIP LOCKED
  );

  GET DIAGNOSTICS v_requeued = ROW_COUNT;
  RETURN v_requeued;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

