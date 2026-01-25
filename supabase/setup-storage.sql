-- ========================================================================
-- Storage Setup for Reports Bucket
-- ========================================================================
-- Run this in Supabase SQL Editor after creating the 'reports' bucket
-- ========================================================================

-- Allow public read access to reports (adjust as needed)
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'reports');

-- Allow service role to insert (for worker)
CREATE POLICY "Allow service role insert"
ON storage.objects FOR INSERT
WITH CHECK (auth.role() = 'service_role' AND bucket_id = 'reports');

-- Allow service role to delete (for cleanup jobs)
CREATE POLICY "Allow service role delete"
ON storage.objects FOR DELETE
USING (auth.role() = 'service_role' AND bucket_id = 'reports');

-- Optional: Allow service role to update
CREATE POLICY "Allow service role update"
ON storage.objects FOR UPDATE
USING (auth.role() = 'service_role' AND bucket_id = 'reports')
WITH CHECK (auth.role() = 'service_role' AND bucket_id = 'reports');

-- ========================================================================
-- Verification Queries
-- ========================================================================

-- Check that policies were created
-- Supabase Storage does not expose a `storage.policies` table; use Postgres catalog views instead.
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects';

-- Check bucket configuration
SELECT * FROM storage.buckets WHERE id = 'reports';
