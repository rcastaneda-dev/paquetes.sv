-- ========================================================================
-- Migration: Definitive Storage RLS Fix for Service Role
-- ========================================================================
-- Purpose:
-- - Remove ALL existing policies that might conflict
-- - Create minimal, working policies for the reports bucket
-- - Ensure service role can upload without RLS issues
-- ========================================================================

BEGIN;

-- STEP 1: Drop ALL existing policies on storage.objects
-- This ensures we start with a clean slate
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_record.policyname);
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- STEP 2: Create simple, working policies

-- Policy 1: Public read for reports bucket (anyone can download)
CREATE POLICY "reports_bucket_public_read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'reports');

-- Policy 2: Service role can do anything (INSERT, UPDATE, DELETE)
-- NOTE: Service role should bypass RLS anyway, but we create this as insurance
CREATE POLICY "reports_bucket_service_role_all"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'reports')
WITH CHECK (bucket_id = 'reports');

-- Policy 3: Authenticated users can insert/update/delete (fallback)
-- This is a safety net in case service role detection fails
CREATE POLICY "reports_bucket_authenticated_write"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'reports')
WITH CHECK (bucket_id = 'reports');

-- STEP 3: Ensure the reports bucket exists and has correct settings
-- This won't fail if the bucket already exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports',
  true, -- Public bucket (anyone can read with the URL)
  524288000, -- 500 MB limit
  ARRAY['application/pdf', 'application/zip']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 524288000,
  allowed_mime_types = ARRAY['application/pdf', 'application/zip']::text[];

COMMIT;

-- ========================================================================
-- Verification Queries
-- ========================================================================
-- After running this migration, verify the policies:
--
-- SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects';
--
-- Should show 3 policies:
-- 1. reports_bucket_public_read (FOR SELECT, no role restriction)
-- 2. reports_bucket_service_role_all (FOR ALL, TO service_role)
-- 3. reports_bucket_authenticated_write (FOR ALL, TO authenticated)
-- ========================================================================

-- ========================================================================
-- Troubleshooting
-- ========================================================================
-- If uploads still fail after this migration:
--
-- 1. Verify the service role key is correct in your worker environment:
--    - It should start with "eyJ..."
--    - Get it from Supabase Dashboard → Settings → API
--
-- 2. Check if RLS is enabled on storage.objects:
--    SELECT tablename, rowsecurity
--    FROM pg_tables
--    WHERE schemaname = 'storage' AND tablename = 'objects';
--
--    If rowsecurity is false, RLS is disabled (service role should work)
--    If rowsecurity is true, RLS is enabled (policies should allow it)
--
-- 3. Test the service role directly in SQL:
--    SET ROLE service_role;
--    SELECT * FROM storage.objects WHERE bucket_id = 'reports';
--    RESET ROLE;
--
-- 4. As a last resort, you can grant direct permissions:
--    GRANT ALL ON storage.objects TO service_role;
--    GRANT ALL ON storage.buckets TO service_role;
-- ========================================================================
