-- ========================================================================
-- Migration: Dedupe report_tasks and add unique constraint
-- ========================================================================
-- Problem:
-- - The current schema allows duplicate tasks per (job_id, school_codigo_ce, grado)
-- - This can cause Storage key collisions and wasted processing
-- - The PDF worker now generates collision-free keys using task_id, but we should
--   prevent duplicates at the DB level for data integrity
--
-- Solution:
-- 1. Remove any existing duplicate rows (keep the "best" one per combo)
-- 2. Add a unique index to prevent future duplicates
--
-- Safety:
-- - Uses a deterministic ordering to keep the best row (prefer completed tasks)
-- - Wrapped in a transaction for atomicity
-- ========================================================================

BEGIN;

-- Step 1: Delete duplicate tasks, keeping only the "best" row per (job_id, school_codigo_ce, grado)
-- We prefer rows that:
--   1. Have a pdf_path (completed successfully)
--   2. Were updated most recently
--   3. Were created most recently
-- This ensures we keep the most valuable/recent task if duplicates exist.

WITH ranked_tasks AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY job_id, school_codigo_ce, grado
      ORDER BY
        (pdf_path IS NOT NULL) DESC,  -- Prefer tasks with PDFs
        updated_at DESC,               -- Then most recently updated
        created_at DESC,               -- Then most recently created
        id                             -- Tie-breaker for determinism
    ) AS rn
  FROM public.report_tasks
),
duplicates_to_delete AS (
  SELECT id
  FROM ranked_tasks
  WHERE rn > 1
)
DELETE FROM public.report_tasks
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Step 2: Create unique index to enforce constraint going forward
-- This prevents INSERT/UPDATE operations that would create duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_tasks_unique_job_school_grade
  ON public.report_tasks(job_id, school_codigo_ce, grado);

COMMIT;

-- ========================================================================
-- Verification queries (run manually after migration if desired)
-- ========================================================================

-- Check for any remaining duplicates (should return 0 rows)
-- SELECT job_id, school_codigo_ce, grado, COUNT(*)
-- FROM public.report_tasks
-- GROUP BY job_id, school_codigo_ce, grado
-- HAVING COUNT(*) > 1;

-- Verify the unique index exists
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'report_tasks'
--   AND indexname = 'idx_report_tasks_unique_job_school_grade';
