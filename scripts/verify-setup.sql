-- ========================================================================
-- Verification Script
-- ========================================================================
-- Run this in Supabase SQL Editor to verify everything is set up correctly
-- ========================================================================

-- Check that core tables exist
SELECT
  'Core Tables' as check_type,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schools')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'students')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'uniform_sizes')
    THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status;

-- Check that reporting tables exist
SELECT
  'Reporting Tables' as check_type,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_jobs')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_tasks')
    THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status;

-- Check that RPC functions exist
SELECT
  'RPC Functions' as check_type,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_schema = 'public'
          AND routine_name IN (
            'query_students',
            'search_schools',
            'get_grades',
            'report_students_by_school_grade',
            'get_school_grade_combinations',
            'claim_pending_tasks',
            'update_task_status',
            'get_job_progress'
          )) = 8
    THEN '✓ PASS'
    ELSE '✗ FAIL - Expected 8 functions'
  END as status;

-- List all RPC functions
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Check indexes
SELECT
  'Indexes' as check_type,
  COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public';

-- Check if storage bucket exists (requires storage schema access)
SELECT
  'Storage Bucket' as check_type,
  CASE
    WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'reports')
    THEN '✓ PASS'
    ELSE '✗ FAIL - Create bucket named "reports"'
  END as status;

-- Sample data counts
SELECT 'schools' as table_name, COUNT(*) as row_count FROM public.schools
UNION ALL
SELECT 'students', COUNT(*) FROM public.students
UNION ALL
SELECT 'uniform_sizes', COUNT(*) FROM public.uniform_sizes
UNION ALL
SELECT 'report_jobs', COUNT(*) FROM public.report_jobs
UNION ALL
SELECT 'report_tasks', COUNT(*) FROM public.report_tasks;
