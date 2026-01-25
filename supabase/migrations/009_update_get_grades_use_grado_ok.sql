-- Migration: Update get_grades to use grado_ok instead of grado
-- This migration modifies the get_grades RPC function to use the grado_ok column
-- which contains the cleaned/normalized grade values instead of the raw grado column

-- First, ensure the grado_ok column exists (in case it was added manually)
-- This is safe to run even if the column already exists
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS grado_ok TEXT;

-- Update the get_grades function to use grado_ok instead of grado
CREATE OR REPLACE FUNCTION public.get_grades()
RETURNS TABLE (grado TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT s.grado_ok AS grado
  FROM public.students s
  WHERE s.grado_ok IS NOT NULL AND s.grado_ok != ''
  ORDER BY s.grado_ok;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
