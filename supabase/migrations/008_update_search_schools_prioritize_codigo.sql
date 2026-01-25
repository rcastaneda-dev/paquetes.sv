-- Migration: Update search_schools to prioritize codigo_ce searches
-- This migration modifies the search_schools RPC function to:
-- 1. Prioritize codigo_ce matches over other fields
-- 2. Order results by codigo_ce instead of nombre_ce

CREATE OR REPLACE FUNCTION public.search_schools(
  p_query TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  codigo_ce TEXT,
  nombre_ce TEXT,
  municipio TEXT,
  departamento TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.codigo_ce,
    s.nombre_ce,
    s.municipio,
    s.departamento
  FROM public.schools s
  WHERE s.codigo_ce ILIKE '%' || p_query || '%'
     OR s.nombre_ce ILIKE '%' || p_query || '%'
     OR s.municipio ILIKE '%' || p_query || '%'
  ORDER BY
    -- Prioritize exact codigo_ce matches first
    CASE WHEN s.codigo_ce ILIKE p_query THEN 1
         WHEN s.codigo_ce ILIKE p_query || '%' THEN 2
         WHEN s.codigo_ce ILIKE '%' || p_query || '%' THEN 3
         ELSE 4
    END,
    -- Then order by codigo_ce alphabetically
    s.codigo_ce
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
