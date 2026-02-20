-- ============================================================
-- Add REFERENCIA column to staging_demand_raw and school_demand.
-- Update migration RPC to flow referencia through to production.
-- ============================================================

-- Staging: new nullable column for CSV import
ALTER TABLE public.staging_demand_raw ADD COLUMN IF NOT EXISTS "REFERENCIA" TEXT;

-- Production: new column on school_demand (per demand row)
ALTER TABLE public.school_demand ADD COLUMN IF NOT EXISTS referencia TEXT DEFAULT '';

-- Recreate migration RPC with REFERENCIA support
CREATE OR REPLACE FUNCTION migrate_demand_staging_data()
RETURNS json AS $$
BEGIN
    -- Clear existing demand data only
    TRUNCATE public.school_demand RESTART IDENTITY;

    -- Upsert schools from staging (unchanged)
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona, fecha_inicio, transporte
    )
    SELECT DISTINCT ON (trim("CODIGO"))
        trim("CODIGO"),
        COALESCE(NULLIF(trim("NOMBRE DE CENTRO ESCOLAR"), ''), ''),
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
    ORDER BY trim("CODIGO"),
             ("NOMBRE DE CENTRO ESCOLAR" IS NULL OR trim("NOMBRE DE CENTRO ESCOLAR") = '') ASC
    ON CONFLICT (codigo_ce) DO UPDATE SET
        nombre_ce    = CASE WHEN EXCLUDED.nombre_ce <> '' THEN EXCLUDED.nombre_ce
                            ELSE schools.nombre_ce END,
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

    -- Load demand rows with normalized item names + referencia
    INSERT INTO public.school_demand (school_codigo_ce, item, tipo, categoria, cantidad, referencia)
    SELECT
        trim("CODIGO"),
        CASE upper(trim("ITEM"))
            WHEN 'UNIFORME' THEN 'UNIFORMES'
            WHEN 'UTILES'   THEN 'CAJAS'
            ELSE upper(trim("ITEM"))
        END,
        upper(trim("TIPO")),
        upper(trim("CATEGORIA")),
        trim("CANTIDAD")::int,
        COALESCE(NULLIF(trim("REFERENCIA"), ''), '')
    FROM public.staging_demand_raw
    WHERE trim("CODIGO") <> ''
      AND trim("ITEM") <> ''
      AND trim("TIPO") <> ''
      AND trim("CATEGORIA") <> ''
      AND trim("CANTIDAD") <> ''
    ON CONFLICT (school_codigo_ce, item, tipo, categoria) DO UPDATE SET
        cantidad   = EXCLUDED.cantidad,
        referencia = CASE WHEN EXCLUDED.referencia <> '' THEN EXCLUDED.referencia
                          ELSE school_demand.referencia END;

    RETURN json_build_object(
        'schools', (SELECT count(DISTINCT school_codigo_ce) FROM school_demand),
        'demand_rows', (SELECT count(*) FROM school_demand)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
