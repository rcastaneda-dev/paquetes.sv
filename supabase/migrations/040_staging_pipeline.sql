-- Staging table for raw CSV imports
CREATE TABLE IF NOT EXISTS public.staging_cajas_raw (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CODIGO_CE" text null,
  "NOMBRE_CE" text null,
  "DEPARTAMENTO" text null,
  "MUNICIPIO" text null,
  "DISTRITO" text null,
  "DIRECCION" text null,
  "ZONA" text null,
  "NIE" text null,
  "GRADO" text null,
  "GRADO OK" text null,
  "SEXO" text null,
  "EDAD" text null,
  "CAMISA" text null,
  "TIPO_DE_CAMISA" text null,
  "PANTALON/FALDA" text null,
  "T_PANTALON_FALDA_SHORT" text null,
  "ZAPATO" text null,
  "NOMBRE_ESTUDIANTE" text null,
  "FECHA_INICIO" text null,
  "DIFICIL_ACCESO" text null,
  "TRANSPORTE" text null
) TABLESPACE pg_default;

-- Helper to truncate staging table (callable via Supabase RPC)
CREATE OR REPLACE FUNCTION truncate_staging_cajas_raw()
RETURNS void AS $$
BEGIN
    TRUNCATE TABLE public.staging_cajas_raw;
END;
$$ LANGUAGE plpgsql;

-- Stored procedure to migrate staging data into production tables
CREATE OR REPLACE FUNCTION migrate_staging_data()
RETURNS json AS $$
DECLARE
    result_summary json;
BEGIN
    -- PART 1: Clean slate (Caution: Truncating production tables)
    TRUNCATE TABLE
        public.zip_jobs, public.report_tasks, public.report_jobs,
        public.report_job_batches, public.uniform_sizes, public.students,
        public.schools
    RESTART IDENTITY CASCADE;

    -- PART 2: Load Schools
    INSERT INTO public.schools (
        codigo_ce, nombre_ce, departamento, municipio, distrito,
        direccion, zona, fecha_inicio, dificil_acceso, transporte
    )
    SELECT DISTINCT
        trim("CODIGO_CE"), trim("NOMBRE_CE"), trim("DEPARTAMENTO"),
        trim("MUNICIPIO"), trim("DISTRITO"),
        COALESCE(NULLIF(trim("DIRECCION"), ''), 'SIN DIRECCION'),
        trim("ZONA"), trim("FECHA_INICIO")::DATE,
        trim("DIFICIL_ACCESO"), trim("TRANSPORTE")
    FROM public.staging_cajas_raw
    WHERE NULLIF(trim("CODIGO_CE"), '') IS NOT NULL
    ON CONFLICT (codigo_ce) DO NOTHING;

    -- PART 3: Load Students & Sizes (Using a CTE for cleaner NIE logic)
    WITH processed_students AS (
        SELECT DISTINCT
            COALESCE(
                NULLIF(trim("NIE"), '')::numeric::bigint::text,
                (9000000000 + abs(hashtext(coalesce(trim("NOMBRE_ESTUDIANTE"), '') || coalesce(trim("CODIGO_CE"), '') || coalesce(trim("GRADO"), ''))) % 1000000000)::text
            ) as calculated_nie,
            trim("CODIGO_CE") as ce,
            trim("NOMBRE_ESTUDIANTE") as name,
            CASE WHEN upper(trim("SEXO")) = 'HOMBRE' THEN 'Hombre' ELSE 'Mujer' END as gender,
            NULLIF(trim("EDAD"), '')::numeric::smallint as age,
            trim("GRADO") as grade,
            trim("GRADO OK") as grade_ok
        FROM public.staging_cajas_raw
        WHERE trim("CODIGO_CE") <> '' AND trim("NOMBRE_ESTUDIANTE") <> ''
    )
    INSERT INTO public.students (nie, school_codigo_ce, nombre_estudiante, sexo, edad, grado, grado_ok)
    SELECT calculated_nie, ce, name, gender, age, grade, grade_ok FROM processed_students
    ON CONFLICT (nie) DO NOTHING;

    -- Final Sizes Insert
    INSERT INTO public.uniform_sizes (nie, camisa, pantalon_falda, zapato, tipo_de_camisa, t_pantalon_falda_short)
    SELECT
        s.nie, trim(r."CAMISA"), trim(r."PANTALON/FALDA"),
        trim(r."ZAPATO"), trim(r."TIPO_DE_CAMISA"), trim(r."T_PANTALON_FALDA_SHORT")
    FROM public.staging_cajas_raw r
    JOIN public.students s ON s.nie = COALESCE(NULLIF(trim(r."NIE"), '')::numeric::bigint::text, (9000000000 + abs(hashtext(coalesce(trim(r."NOMBRE_ESTUDIANTE"), '') || coalesce(trim(r."CODIGO_CE"), '') || coalesce(trim(r."GRADO"), ''))) % 1000000000)::text)
    WHERE trim(r."CAMISA") <> ''
    ON CONFLICT (nie) DO NOTHING;

    -- Return a summary for the UI
    RETURN json_build_object(
        'schools', (SELECT count(*) FROM schools),
        'students', (SELECT count(*) FROM students),
        'sizes', (SELECT count(*) FROM uniform_sizes)
    );
END;
$$ LANGUAGE plpgsql;
