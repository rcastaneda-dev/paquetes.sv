-- ========================================================================
-- Migration: Fix Foreign Key Constraints to Support NIE Updates
-- ========================================================================
-- This script updates the foreign key constraints to include ON UPDATE CASCADE
-- so that when NIE values are updated in students table, they automatically
-- update in uniform_sizes table.
--
-- Run this ONCE in Supabase SQL Editor before attempting to update NIE values.
-- ========================================================================

BEGIN;

-- 1) Drop and recreate the foreign key constraint on uniform_sizes
ALTER TABLE public.uniform_sizes
DROP CONSTRAINT IF EXISTS uniform_sizes_nie_fkey;

ALTER TABLE public.uniform_sizes
ADD CONSTRAINT uniform_sizes_nie_fkey
  FOREIGN KEY (nie)
  REFERENCES public.students(nie)
  ON UPDATE CASCADE
  ON DELETE CASCADE;

-- 2) Drop and recreate the foreign key constraint on students
ALTER TABLE public.students
DROP CONSTRAINT IF EXISTS students_school_codigo_ce_fkey;

ALTER TABLE public.students
ADD CONSTRAINT students_school_codigo_ce_fkey
  FOREIGN KEY (school_codigo_ce)
  REFERENCES public.schools(codigo_ce)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

COMMIT;

-- ========================================================================
-- Now you can update NIE values in the students table and it will
-- automatically cascade to uniform_sizes:
--
-- UPDATE public.students
-- SET nie = nie::numeric::bigint::text
-- WHERE nie LIKE '%.0';
-- ========================================================================
