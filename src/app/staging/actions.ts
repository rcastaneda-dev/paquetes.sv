'use server';

import { parse } from 'csv-parse/sync';
import { supabaseServer } from '@/lib/supabase/server';

const REQUIRED_COLUMNS = [
  'CODIGO_CE',
  'NOMBRE_CE',
  'DEPARTAMENTO',
  'MUNICIPIO',
  'DISTRITO',
  'DIRECCION',
  'ZONA',
  'NIE',
  'GRADO',
  'GRADO OK',
  'SEXO',
  'EDAD',
  'CAMISA',
  'TIPO_DE_CAMISA',
  'PANTALON/FALDA',
  'T_PANTALON_FALDA_SHORT',
  'ZAPATO',
  'NOMBRE_ESTUDIANTE',
  'FECHA_INICIO',
  'DIFICIL_ACCESO',
  'TRANSPORTE',
] as const;

type StagingRow = Record<(typeof REQUIRED_COLUMNS)[number], string>;

interface UploadResult {
  success: boolean;
  data?: { schools: number; students: number; sizes: number; stagingRows: number };
  error?: string;
}

const BATCH_SIZE = 500;

export async function uploadStagingCSV(formData: FormData): Promise<UploadResult> {
  try {
    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: 'No se proporcionó un archivo.' };
    }

    if (!file.name.endsWith('.csv')) {
      return { success: false, error: 'El archivo debe ser un CSV.' };
    }

    const text = await file.text();
    if (!text.trim()) {
      return { success: false, error: 'El archivo CSV está vacío.' };
    }

    // Detect delimiter (comma or semicolon)
    const firstLine = text.split(/\r?\n/)[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';

    // Parse CSV
    let records: StagingRow[];
    try {
      records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter,
        relax_column_count: true,
      });
    } catch (parseErr) {
      const detail = parseErr instanceof Error ? parseErr.message : '';
      return { success: false, error: `Error al leer el CSV: ${detail}` };
    }

    if (records.length === 0) {
      return { success: false, error: 'El archivo CSV no contiene registros.' };
    }

    // Validate columns
    const headers = Object.keys(records[0]);
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
    if (missingColumns.length > 0) {
      return {
        success: false,
        error: `Columnas faltantes en el CSV: ${missingColumns.join(', ')}`,
      };
    }

    // Truncate staging table
    const { error: truncateError } = await supabaseServer.rpc('truncate_staging_cajas_raw');

    if (truncateError) {
      return { success: false, error: `Error al limpiar tabla staging: ${truncateError.message}` };
    }

    // Bulk insert in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabaseServer
        .from('staging_cajas_raw')
        .insert(batch);

      if (insertError) {
        return {
          success: false,
          error: `Error al insertar lote ${Math.floor(i / BATCH_SIZE) + 1}: ${insertError.message}`,
        };
      }
    }

    // Execute migration procedure
    const { data, error: rpcError } = await supabaseServer.rpc('migrate_staging_data');

    if (rpcError) {
      return { success: false, error: `Error en migración: ${rpcError.message}` };
    }

    const summary = data as { schools: number; students: number; sizes: number };

    return {
      success: true,
      data: {
        ...summary,
        stagingRows: records.length,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, error: message };
  }
}
