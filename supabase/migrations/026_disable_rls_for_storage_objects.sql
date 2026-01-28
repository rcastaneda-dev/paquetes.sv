-- ========================================================================
-- Migration: Alternative Fix - Disable RLS or Use Permissive Policies
-- ========================================================================
-- Purpose:
-- - If TO service_role policies don't work, try a more permissive approach
-- - Option 1: Disable RLS entirely on storage.objects (not recommended for production)
-- - Option 2: Use a permissive policy that allows any authenticated user
-- ========================================================================

BEGIN;

-- Drop all existing policies first
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role insert" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role update" ON storage.objects;

-- OPTION 1: Very permissive policies for reports bucket only
-- This allows ANY authenticated request (including service role) to access reports bucket

-- Public read
CREATE POLICY "reports_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'reports');

-- Allow any authenticated user/service to insert to reports bucket
CREATE POLICY "reports_authenticated_insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'reports'
  AND (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
    OR auth.jwt() IS NOT NULL
  )
);

-- Allow any authenticated user/service to update in reports bucket
CREATE POLICY "reports_authenticated_update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'reports'
  AND (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
    OR auth.jwt() IS NOT NULL
  )
)
WITH CHECK (
  bucket_id = 'reports'
  AND (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
    OR auth.jwt() IS NOT NULL
  )
);

-- Allow any authenticated user/service to delete from reports bucket
CREATE POLICY "reports_authenticated_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'reports'
  AND (
    auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
    OR auth.jwt() IS NOT NULL
  )
);

COMMIT;

-- ========================================================================
-- Alternative: If policies still don't work, disable RLS entirely
-- ========================================================================
-- WARNING: Only use this as a last resort for testing
-- This disables ALL RLS on storage.objects (affects all buckets)
--
-- To disable RLS (run separately if needed):
-- ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
--
-- To re-enable RLS:
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- ========================================================================
