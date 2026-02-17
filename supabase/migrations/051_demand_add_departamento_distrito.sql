-- ============================================================
-- Simplify staging_demand_raw: remove NRO, TAMAÑO, MATRICULA;
-- add DEPARTAMENTO, DISTRITO. Update migration RPC accordingly.
-- ============================================================

-- Recreate staging table with the new column set
DROP TABLE IF EXISTS public.school_demand;
DROP TABLE IF EXISTS public.staging_demand_raw;

CREATE TABLE public.staging_demand_raw (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CODIGO"                   TEXT NOT NULL,
  "NOMBRE DE CENTRO ESCOLAR" TEXT,
  "DEPARTAMENTO"             TEXT,
  "DISTRITO"                 TEXT,
  "FECHA"                    TEXT,
  "ITEM"                     TEXT NOT NULL,
  "TIPO"                     TEXT NOT NULL,
  "CATEGORIA"                TEXT NOT NULL,
  "CANTIDAD"                 TEXT NOT NULL
);

-- Recreate school_demand (same schema as before)
CREATE TABLE public.school_demand (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_codigo_ce   TEXT NOT NULL REFERENCES public.schools(codigo_ce),
  item               TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  categoria          TEXT NOT NULL,
  cantidad           INT  NOT NULL CHECK (cantidad >= 0),
  created_at         TIMESTAMPTZ DEFAULT now(),

  UNIQUE (school_codigo_ce, item, tipo, categoria)
);

CREATE INDEX idx_school_demand_school ON public.school_demand(school_codigo_ce);
CREATE INDEX idx_school_demand_item   ON public.school_demand(item);

-- Recreate truncate RPC
CREATE OR REPLACE FUNCTION truncate_staging_demand_raw()
RETURNS void AS $$
BEGIN
    TRUNCATE TABLE public.staging_demand_raw;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate migration RPC with DEPARTAMENTO/DISTRITO support
CREATE OR REPLACE FUNCTION migrate_demand_staging_data()
RETURNS json AS $$
BEGIN
    -- Clear existing demand data only
    TRUNCATE public.school_demand RESTART IDENTITY;

    -- Upsert schools from staging
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona, fecha_inicio
    )
    SELECT DISTINCT ON (trim("CODIGO"))
        trim("CODIGO"),
        trim("NOMBRE DE CENTRO ESCOLAR"),
        COALESCE(NULLIF(trim("DEPARTAMENTO"), ''), ''),
        '',
        COALESCE(NULLIF(trim("DISTRITO"), ''), ''),
        'SIN DIRECCION',
        '',
        CASE WHEN NULLIF(trim("FECHA"), '') IS NOT NULL
             THEN trim("FECHA")::date
             ELSE NULL END
    FROM public.staging_demand_raw
    WHERE NULLIF(trim("CODIGO"), '') IS NOT NULL
    ON CONFLICT (codigo_ce) DO UPDATE SET
        nombre_ce    = EXCLUDED.nombre_ce,
        departamento = CASE WHEN EXCLUDED.departamento <> '' THEN EXCLUDED.departamento
                            ELSE schools.departamento END,
        distrito     = CASE WHEN EXCLUDED.distrito <> '' THEN EXCLUDED.distrito
                            ELSE schools.distrito END,
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
