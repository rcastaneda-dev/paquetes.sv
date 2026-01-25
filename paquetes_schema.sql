-- Schema for paquetes CSV (Supabase/PostgreSQL)

CREATE TABLE IF NOT EXISTS public.schools (
  codigo_ce            text PRIMARY KEY,
  nombre_ce            text NOT NULL,
  departamento         text NOT NULL,
  region               text NOT NULL,
  ruta                 text NOT NULL,
  municipio            text NOT NULL,
  distrito             text NOT NULL,
  direccion            text NOT NULL,
  zona                 text NOT NULL,
  latitud              numeric(9,6),
  longitud             numeric(9,6)
);

CREATE TABLE IF NOT EXISTS public.students (
  nie                  text PRIMARY KEY,
  school_codigo_ce     text NOT NULL REFERENCES public.schools(codigo_ce) ON UPDATE CASCADE ON DELETE RESTRICT,
  nombre_estudiante    text NOT NULL,
  sexo                 text NOT NULL CHECK (sexo IN ('Hombre','Mujer')),
  edad                 smallint,
  grado                text NOT NULL,
  grado_ok             text NOT NULL,
  bodega_produccion    text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.uniform_sizes (
  nie                  text PRIMARY KEY REFERENCES public.students(nie) ON UPDATE CASCADE ON DELETE CASCADE,
  camisa               text NOT NULL,
  pantalon_falda       text NOT NULL,
  zapato               text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_school ON public.students (school_codigo_ce);

-- Staging table for CSV imports (used by cajas_part_X_of_10_import.sql)
-- This table is created/managed by the import scripts with quoted column names
-- matching the CSV headers exactly (e.g., "GRADO OK", "PANTALON/FALDA")
-- No need to create it here as the import script handles it.
