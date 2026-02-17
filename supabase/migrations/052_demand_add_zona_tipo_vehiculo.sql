-- ============================================================
-- Add ZONA and TIPO_DE_VEHICULO columns to staging_demand_raw
-- and update migration RPC to populate schools.zona and
-- schools.transporte from demand CSV data.
-- ============================================================

-- Add new columns (nullable so existing rows are unaffected)
ALTER TABLE public.staging_demand_raw ADD COLUMN IF NOT EXISTS "ZONA" TEXT;
ALTER TABLE public.staging_demand_raw ADD COLUMN IF NOT EXISTS "TIPO_DE_VEHICULO" TEXT;

-- Recreate migration RPC with ZONA/TIPO_DE_VEHICULO support
CREATE OR REPLACE FUNCTION migrate_demand_staging_data()
RETURNS json AS $$
BEGIN
    -- Clear existing demand data only
    TRUNCATE public.school_demand RESTART IDENTITY;

    -- Upsert schools from staging
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona, fecha_inicio, transporte
    )
    SELECT DISTINCT ON (trim("CODIGO"))
        trim("CODIGO"),
        trim("NOMBRE DE CENTRO ESCOLAR"),
        COALESCE(NULLIF(trim("DEPARTAMENTO"), ''), ''),
        '',
        COALESCE(NULLIF(trim("DISTRITO"), ''), ''),
        'SIN DIRECCION',
        COALESCE(NULLIF(trim("ZONA"), ''), ''),
        CASE WHEN NULLIF(trim("FECHA"), '') IS NOT NULL
             THEN trim("FECHA")::date
             ELSE NULL END,
        COALESCE(NULLIF(trim("TIPO_DE_VEHICULO"), ''), '')
    FROM public.staging_demand_raw
    WHERE NULLIF(trim("CODIGO"), '') IS NOT NULL
    ON CONFLICT (codigo_ce) DO UPDATE SET
        nombre_ce    = EXCLUDED.nombre_ce,
        departamento = CASE WHEN EXCLUDED.departamento <> '' THEN EXCLUDED.departamento
                            ELSE schools.departamento END,
        distrito     = CASE WHEN EXCLUDED.distrito <> '' THEN EXCLUDED.distrito
                            ELSE schools.distrito END,
        zona         = CASE WHEN EXCLUDED.zona <> '' THEN EXCLUDED.zona
                            ELSE schools.zona END,
        transporte   = CASE WHEN EXCLUDED.transporte <> '' THEN EXCLUDED.transporte
                            ELSE schools.transporte END,
        fecha_inicio = CASE WHEN EXCLUDED.fecha_inicio IS NOT NULL THEN EXCLUDED.fecha_inicio
                            ELSE schools.fecha_inicio END;

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
