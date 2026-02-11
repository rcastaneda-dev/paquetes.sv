import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { supabaseServer } from '@/lib/supabase/server';

const BATCH_SIZE = 500;

// POST: receive a chunk of CSV rows and insert into staging
export async function POST(request: NextRequest) {
  try {
    const { action, rows, csvChunk, header, delimiter: clientDelimiter } = await request.json();

    // Action: truncate staging table
    if (action === 'truncate') {
      const { error } = await supabaseServer.rpc('truncate_staging_cajas_raw');
      if (error) {
        return NextResponse.json({ error: `Error al limpiar staging: ${error.message}` }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // Action: insert a chunk of CSV text (header + rows)
    if (action === 'insert' && csvChunk && header) {
      const delimiter = clientDelimiter || (header.includes(';') ? ';' : ',');
      const csvText = header + '\n' + csvChunk;
      const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        delimiter,
      });

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseServer.from('staging_cajas_raw').insert(batch);
        if (error) {
          return NextResponse.json({ error: `Error al insertar: ${error.message}` }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true, inserted: records.length });
    }

    // Action: insert pre-parsed rows directly
    if (action === 'insert' && rows) {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseServer.from('staging_cajas_raw').insert(batch);
        if (error) {
          return NextResponse.json({ error: `Error al insertar: ${error.message}` }, { status: 500 });
        }
      }
      return NextResponse.json({ success: true, inserted: rows.length });
    }

    // Action: run migration
    if (action === 'migrate') {
      const { data, error } = await supabaseServer.rpc('migrate_staging_data');
      if (error) {
        return NextResponse.json({ error: `Error en migración: ${error.message}` }, { status: 500 });
      }
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
