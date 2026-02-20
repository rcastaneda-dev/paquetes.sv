import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { generateCajasPivotExcel, excelStoragePath, EXCEL_FILENAMES } from '@/lib/excel/generators';

const FILENAME = EXCEL_FILENAMES.cajasPivot;
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/**
 * GET /api/bulk/jobs/[jobId]/cajas-pivot-excel
 *
 * Returns an .xlsx with consolidated cajas data across all schools.
 * Columns: No, Codigo CE, Nombre CE, Departamento, Distrito, Grado, Cajas Hombres, Cajas Mujeres, Cajas Totales
 *
 * Serves from pre-generated storage if available; falls back to live generation.
 */
export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
  const reportJobId = params.jobId;

  try {
    const { data: reportJob, error: reportJobError } = await supabaseServer
      .from('report_jobs')
      .select('status, job_params')
      .eq('id', reportJobId)
      .single();

    if (reportJobError || !reportJob) {
      return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
    }

    const jobParams = reportJob.job_params as { fecha_inicio?: string } | null;
    const fechaInicio = jobParams?.fecha_inicio;

    if (!fechaInicio) {
      return NextResponse.json(
        { error: 'This endpoint requires a category job with fecha_inicio' },
        { status: 400 }
      );
    }

    const storedBuffer = await tryDownloadFromStorage(reportJobId);
    if (storedBuffer) {
      return excelResponse(storedBuffer);
    }

    const allStudents = await fetchAllStudentsForDate(fechaInicio);

    if (allStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for the specified date' },
        { status: 404 }
      );
    }

    const buffer = await generateCajasPivotExcel(allStudents);

    uploadToStorage(reportJobId, buffer).catch(() => {});

    return excelResponse(buffer);
  } catch (error) {
    console.error('Error in cajas-pivot-excel:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function excelResponse(buffer: Buffer) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${FILENAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function tryDownloadFromStorage(jobId: string): Promise<Buffer | null> {
  const path = excelStoragePath(jobId, FILENAME);
  const { data } = await supabaseServer.storage.from('reports').download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function uploadToStorage(jobId: string, buffer: Buffer): Promise<void> {
  const path = excelStoragePath(jobId, FILENAME);
  await supabaseServer.storage.from('reports').upload(path, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
}

async function fetchAllStudentsForDate(fechaInicio: string): Promise<StudentQueryRow[]> {
  let offset = 0;
  const all: StudentQueryRow[] = [];

  while (true) {
    const { data, error } = await supabaseServer.rpc('query_students', {
      p_school_codigo_ce: null,
      p_grado: null,
      p_departamento: null,
      p_fecha_inicio: fechaInicio,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (error) throw new Error(`Failed to fetch students: ${error.message}`);

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) break;

    all.push(...rows);
    if (all.length >= MAX_ROWS) break;
    if (rows.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return all;
}
