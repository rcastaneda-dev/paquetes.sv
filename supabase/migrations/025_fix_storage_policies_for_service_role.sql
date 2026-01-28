-- ========================================================================
-- Migration: Fix Storage Policies for Service Role
-- ========================================================================
-- Purpose:
-- - Fix RLS policies on storage.objects to properly allow service role uploads
-- - The auth.role() function doesn't work correctly with Supabase JS client
-- - Instead, we check if authenticated() and bypass RLS for service role key
-- ========================================================================

BEGIN;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role insert" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role update" ON storage.objects;

-- Allow public read access to reports bucket
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'reports');

-- Allow authenticated service role to insert (for worker and API routes)
-- Note: Service role key bypasses RLS, but we still need policies for proper authorization
CREATE POLICY "Allow authenticated insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'reports');

-- Also explicitly allow service_role
CREATE POLICY "Allow service role insert"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'reports');

-- Allow authenticated service role to delete (for cleanup jobs)
CREATE POLICY "Allow authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'reports');

CREATE POLICY "Allow service role delete"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'reports');

-- Allow authenticated service role to update
CREATE POLICY "Allow authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'reports')
WITH CHECK (bucket_id = 'reports');

CREATE POLICY "Allow service role update"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'reports')
WITH CHECK (bucket_id = 'reports');

COMMIT;

-- ========================================================================
-- Migration Notes
-- ========================================================================
-- Changes:
-- - Replaced auth.role() = 'service_role' checks with explicit TO service_role
-- - Added TO authenticated policies for broader compatibility
-- - Service role key will bypass RLS anyway, but policies ensure proper access
--
-- This fixes the "new row violates row-level security policy" error when
-- the ZIP worker uploads files to storage.
-- ========================================================================
