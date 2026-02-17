import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { supabaseServer } from '@/lib/supabase/server';

const BATCH_SIZE = 500;

const REQUIRED_COLUMNS = ['CODIGO', 'DEPARTAMENTO', 'DISTRITO', 'FECHA', 'ITEM', 'TIPO', 'CATEGORIA', 'CANTIDAD'];

// Columns that exist in staging_demand_raw (used to strip extra CSV columns)
const STAGING_COLUMNS = ['CODIGO', 'NOMBRE DE CENTRO ESCOLAR', 'DEPARTAMENTO', 'DISTRITO', 'FECHA', 'ITEM', 'TIPO', 'CATEGORIA', 'CANTIDAD'];

/** Keep only keys that match staging table columns */
function pickStagingColumns(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of STAGING_COLUMNS) {
    if (col in record) out[col] = record[col];
  }
  return out;
}

// POST: receive normalized demand CSV chunks and insert into staging
export async function POST(request: NextRequest) {
  try {
    const { action, rows, csvChunk, header, delimiter: clientDelimiter } = await request.json();

    // Action: truncate staging table
    if (action === 'truncate') {
      const { error } = await supabaseServer.rpc('truncate_staging_demand_raw');
      if (error) {
        return NextResponse.json(
          { error: `Error al limpiar staging: ${error.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Action: insert a chunk of CSV text (header + rows)
    if (action === 'insert' && csvChunk && header) {
      const delimiter = clientDelimiter || (header.includes(';') ? ';' : ',');

      // Validate required columns are present in header
      const headerColumns = header.split(delimiter).map((c: string) => c.trim().replace(/^"|"$/g, ''));
      const missing = REQUIRED_COLUMNS.filter((col) => !headerColumns.includes(col));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Columnas requeridas faltantes: ${missing.join(', ')}` },
          { status: 400 }
        );
      }

      const csvText = header + '\n' + csvChunk;
      const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        delimiter,
      });

      const cleaned = (records as Record<string, string>[]).map(pickStagingColumns);
      for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
        const batch = cleaned.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseServer.from('staging_demand_raw').insert(batch);
        if (error) {
          return NextResponse.json(
            { error: `Error al insertar: ${error.message}` },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ success: true, inserted: cleaned.length });
    }

    // Action: insert pre-parsed rows directly
    if (action === 'insert' && rows) {
      const cleanedRows = rows.map(pickStagingColumns);
      for (let i = 0; i < cleanedRows.length; i += BATCH_SIZE) {
        const batch = cleanedRows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseServer.from('staging_demand_raw').insert(batch);
        if (error) {
          return NextResponse.json(
            { error: `Error al insertar: ${error.message}` },
            { status: 500 }
          );
        }
      }
      return NextResponse.json({ success: true, inserted: cleanedRows.length });
    }

    // Action: run migration
    if (action === 'migrate') {
      const { data, error } = await supabaseServer.rpc('migrate_demand_staging_data');
      if (error) {
        return NextResponse.json(
          { error: `Error en migración: ${error.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
