-- ========================================================================
-- Migration: Allow ZIP generation for failed jobs (partial downloads)
-- ========================================================================
-- Problem:
-- - Jobs with failed_tasks > 0 are marked as status='failed'
-- - claim_pending_zip_parts() only processes jobs with status='complete'
-- - Result: no ZIP parts created, no downloads available
--
-- Solution:
-- - Update claim_pending_zip_parts() to also process jobs with status='failed'
-- - This allows partial downloads (ZIPs containing only successful PDFs)
-- - User can retry failed tasks separately
-- ========================================================================

BEGIN;

-- Update claim_pending_zip_parts to allow processing failed jobs
CREATE OR REPLACE FUNCTION public.claim_pending_zip_parts(
  p_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  zip_part_id UUID,
  job_id UUID,
  part_no INTEGER,
  part_size INTEGER
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.report_zip_parts
  SET status = 'running',
      updated_at = now()
  WHERE id IN (
    SELECT rzp.id
    FROM public.report_zip_parts rzp
    INNER JOIN public.report_jobs rj ON rzp.job_id = rj.id
    WHERE rzp.status = 'pending'
      AND rj.status IN ('complete', 'failed')  -- Allow ZIP creation for failed jobs (partial downloads)
    ORDER BY rzp.created_at
    LIMIT p_limit
    FOR UPDATE OF rzp SKIP LOCKED
  )
  RETURNING id, report_zip_parts.job_id, report_zip_parts.part_no, report_zip_parts.part_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ========================================================================
-- Usage Notes
-- ========================================================================
-- After this migration:
-- - Jobs with status='failed' can still have their ZIP parts created
-- - ZIPs will contain only the successfully-generated PDFs
-- - Users can download partial results even if some tasks failed
-- ========================================================================
