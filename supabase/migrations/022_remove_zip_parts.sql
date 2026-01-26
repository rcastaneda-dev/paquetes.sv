-- ========================================================================
-- Migration: Remove Multi-Part ZIP Infrastructure
-- ========================================================================
-- Purpose:
-- - Simplify ZIP creation by removing multi-part architecture
-- - System now creates bundle.zip directly for jobs up to 6k PDFs
-- - Reduces complexity, improves performance, eliminates duplicate downloads
-- ========================================================================

BEGIN;

-- Drop functions that reference report_zip_parts
DROP FUNCTION IF EXISTS public.claim_pending_zip_parts(INTEGER);
DROP FUNCTION IF EXISTS public.update_zip_part_status(UUID, public.task_status, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.ensure_zip_parts(UUID, INTEGER);

-- Drop the multi-part ZIP table
DROP TABLE IF EXISTS public.report_zip_parts;

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- After this migration:
-- - ZIP worker creates bundle.zip directly from completed PDFs
-- - No intermediate ZIP parts are created
-- - Parallel downloading (10 PDFs at a time) optimizes network performance
-- - Compression level 6 (instead of 9) for 3x faster processing
-- - Estimated time for 6k PDFs: 2-5 minutes (down from 10-15 minutes)
-- ========================================================================
