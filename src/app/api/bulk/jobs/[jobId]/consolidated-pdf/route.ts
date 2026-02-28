import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';
import { buildConsolidatedPdf } from '@/lib/pdf/agreement/builders';
import { nodeStreamToWebReadableStream } from '@/lib/pdf/streams';
import type { Readable } from 'stream';
import type { AgreementSectionType } from '@/lib/pdf/agreement/types';
import type { StudentQueryRow } from '@/types/database';
import { normalizeSchoolCode, resolveJobSchoolCodes } from '@/lib/reports/job-school-codes';

const sectionSchema = z.object({
  type: z.enum([
    'cajas',
    'ficha_uniformes',
    'ficha_zapatos',
    'acta_recepcion_zapatos',
    'acta_recepcion_uniformes',
    'acta_recepcion_cajas',
  ]),
});

const SECTION_FILENAMES: Record<AgreementSectionType, string> = {
  cajas: 'comanda_cajas.pdf',
  ficha_uniformes: 'comanda_uniformes.pdf',
  ficha_zapatos: 'comanda_zapatos.pdf',
  acta_recepcion_zapatos: 'consolidado_acta_recepcion_zapatos.pdf',
  acta_recepcion_uniformes: 'consolidado_acta_recepcion_uniformes.pdf',
  acta_recepcion_cajas: 'consolidado_acta_recepcion_cajas.pdf',
};

/**
 * Stream a consolidated PDF that merges all schools for a given date and section type.
 *
 * GET /api/bulk/jobs/[jobId]/consolidated-pdf?type=cajas|ficha_uniformes|ficha_zapatos
 *
 * Data flow:
 *   1. Read fecha_inicio from job params
 *   2. Get distinct schools from report_category_tasks
 *   3. Fetch students per school via the query_students RPC
 *   4. Build a single PDF with one school per page
 *   5. Stream back as application/pdf
 */
export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const reportJobId = params.jobId;

    // Validate query param
    const { type: section } = validateQueryParams(request, sectionSchema);

    // 1. Verify job exists and get fecha_inicio
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

    // 2. Get distinct schools from category tasks
    const { data: schoolRows, error: schoolsError } = await supabaseServer
      .from('report_category_tasks')
      .select('school_codigo_ce')
      .eq('job_id', reportJobId);

    if (schoolsError) {
      return NextResponse.json(
        { error: `Failed to fetch schools: ${schoolsError.message}` },
        { status: 500 }
      );
    }

    // 3. Fetch all students for this fecha_inicio across all schools
    const allStudents = await fetchAllStudentsForDate(fechaInicio);

    if (allStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for the specified date' },
        { status: 404 }
      );
    }

    // Resolve school codes: prefer tasks, fall back to student dataset (legacy jobs)
    const { codes: jobSchoolCodes } = resolveJobSchoolCodes({
      taskSchoolCodes: (schoolRows ?? []).map(r => r.school_codigo_ce),
      studentSchoolCodes: allStudents.map(s => s.school_codigo_ce),
    });

    if (jobSchoolCodes.length === 0) {
      return NextResponse.json({ error: 'No schools found for this job' }, { status: 404 });
    }

    const jobSchoolSet = new Set(jobSchoolCodes);
    const filteredStudents = allStudents.filter(s => {
      const code = normalizeSchoolCode(s.school_codigo_ce);
      return code ? jobSchoolSet.has(code) : false;
    });

    if (filteredStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for the schools in this job' },
        { status: 404 }
      );
    }

    // 4. Build the consolidated PDF
    const doc = buildConsolidatedPdf({
      fechaInicio,
      students: filteredStudents,
      section,
    });

    // 5. Stream back as PDF (PDFKit document is a Readable stream)
    const webStream = nodeStreamToWebReadableStream(doc as unknown as Readable);
    const fileName = SECTION_FILENAMES[section];

    return new Response(webStream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Error in consolidated-pdf:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Fetch all students for a given fecha_inicio (across all schools).
 * Uses paginated RPC calls to handle large datasets.
 *
 * PostgREST enforces a server-side `max-rows` limit (default 1000).
 * We page in increments of 1000 and use `rows.length < pageSize`
 * to detect the last page reliably.
 */
async function fetchAllStudentsForDate(fechaInicio: string): Promise<StudentQueryRow[]> {
  // Must be ≤ PostgREST max-rows (Supabase default = 1000)
  const pageSize = 1000;
  const maxRows = 200000;

  let offset = 0;
  const all: StudentQueryRow[] = [];

  while (true) {
    const { data, error } = await supabaseServer.rpc('query_students', {
      p_school_codigo_ce: null,
      p_grado: null,
      p_departamento: null,
      p_fecha_inicio: fechaInicio,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) {
      throw new Error(`Failed to fetch students: ${error.message}`);
    }

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) break;

    all.push(...rows);

    if (all.length >= maxRows) {
      console.warn(`fetchAllStudentsForDate: hit maxRows (${maxRows})`);
      break;
    }

    // If we received fewer rows than requested, we've reached the last page
    if (rows.length < pageSize) break;

    offset += pageSize;
  }

  return all;
}
