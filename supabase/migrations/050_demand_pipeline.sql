-- ============================================================
-- Restructure demand pipeline to match PRD spec
-- staging_demand_raw: matches CSV columns (NRO, CODIGO, etc.)
-- school_demand: uses item/tipo/categoria instead of prenda/talla
-- ============================================================

-- Drop existing RPCs that reference old schema
DROP FUNCTION IF EXISTS truncate_staging_demand_raw();
DROP FUNCTION IF EXISTS migrate_demand_staging_data();

-- Drop existing tables (school_demand has FK to schools)
DROP TABLE IF EXISTS public.school_demand;
DROP TABLE IF EXISTS public.staging_demand_raw;

-- ============================================================
-- New staging table: columns match CSV headers exactly
-- ============================================================
CREATE TABLE public.staging_demand_raw (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NRO"                      TEXT,
  "CODIGO"                   TEXT NOT NULL,
  "NOMBRE DE CENTRO ESCOLAR" TEXT,
  "TAMAÑO"                   TEXT,
  "MATRICULA"                TEXT,
  "ITEM"                     TEXT NOT NULL,
  "TIPO"                     TEXT NOT NULL,
  "CATEGORIA"                TEXT NOT NULL,
  "CANTIDAD"                 TEXT NOT NULL
);

-- ============================================================
-- New production table: one row per school + item + tipo + categoria
-- ============================================================
CREATE TABLE public.school_demand (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_codigo_ce   TEXT NOT NULL REFERENCES public.schools(codigo_ce),
  item               TEXT NOT NULL,       -- 'CAJAS', 'UNIFORMES', 'ZAPATOS'
  tipo               TEXT NOT NULL,       -- 'CAJAS', 'CAMISA BLANCA', 'ZAPATOS', etc.
  categoria          TEXT NOT NULL,       -- size ('T14', '38') or grade ('PARVULARIA 4')
  cantidad           INT  NOT NULL CHECK (cantidad >= 0),
  created_at         TIMESTAMPTZ DEFAULT now(),

  UNIQUE (school_codigo_ce, item, tipo, categoria)
);

CREATE INDEX idx_school_demand_school ON public.school_demand(school_codigo_ce);
CREATE INDEX idx_school_demand_item   ON public.school_demand(item);

-- ============================================================
-- RPC: truncate staging table
-- ============================================================
CREATE OR REPLACE FUNCTION truncate_staging_demand_raw()
RETURNS void AS $$
BEGIN
    TRUNCATE TABLE public.staging_demand_raw;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: migrate staging → schools + school_demand
-- ============================================================
CREATE OR REPLACE FUNCTION migrate_demand_staging_data()
RETURNS json AS $$
BEGIN
    -- Clear existing demand data only
    TRUNCATE public.school_demand RESTART IDENTITY;

    -- Upsert schools from staging (don't destroy existing schools)
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona
    )
    SELECT DISTINCT
        trim("CODIGO"),
        trim("NOMBRE DE CENTRO ESCOLAR"),
        '',  -- departamento not in CSV
        '',  -- municipio not in CSV
        '',  -- distrito not in CSV
        'SIN DIRECCION',
        ''   -- zona not in CSV
    FROM public.staging_demand_raw
    WHERE NULLIF(trim("CODIGO"), '') IS NOT NULL
    ON CONFLICT (codigo_ce) DO UPDATE SET
        nombre_ce = EXCLUDED.nombre_ce;

    -- Load demand rows
    INSERT INTO public.school_demand (school_codigo_ce, item, tipo, categoria, cantidad)
    SELECT
        trim("CODIGO"),
        upper(trim("ITEM")),
        upper(trim("TIPO")),
        upper(trim("CATEGORIA")),
        trim("CANTIDAD")::int
    FROM public.staging_demand_raw
    WHERE trim("CODIGO") <> ''
      AND trim("ITEM") <> ''
      AND trim("TIPO") <> ''
      AND trim("CATEGORIA") <> ''
      AND trim("CANTIDAD") <> ''
    ON CONFLICT (school_codigo_ce, item, tipo, categoria) DO UPDATE SET
        cantidad = EXCLUDED.cantidad;

    RETURN json_build_object(
        'schools', (SELECT count(DISTINCT school_codigo_ce) FROM school_demand),
        'demand_rows', (SELECT count(*) FROM school_demand)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
