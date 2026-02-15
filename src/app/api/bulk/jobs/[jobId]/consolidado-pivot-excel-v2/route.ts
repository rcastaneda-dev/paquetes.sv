import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import { calculateUniformesTotalPiezas } from '@/lib/pdf/agreement/builders';
import { buildUniformesFlatRows } from '@/lib/reports/editable-v2';

const FILENAME = 'Uniformes_Acumulado_Editable_V2.xlsx';
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/**
 * GET /api/bulk/jobs/[jobId]/consolidado-pivot-excel-v2
 *
 * Returns an .xlsx with flat rows: CORRELATIVO, CODIGO_CE, NOMBRE_CE, TIPO_PRENDA, TALLA, CANTIDAD.
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

    const uniqueSchoolCodes = [...new Set((schoolRows ?? []).map(r => r.school_codigo_ce))];

    if (uniqueSchoolCodes.length === 0) {
      return NextResponse.json({ error: 'No schools found for this job' }, { status: 404 });
    }

    const allStudents = await fetchAllStudentsForDate(fechaInicio);

    if (allStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for the specified date' },
        { status: 404 }
      );
    }

    const jobSchoolSet = new Set(uniqueSchoolCodes);
    const filteredStudents = allStudents.filter(s => jobSchoolSet.has(s.school_codigo_ce));

    if (filteredStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for the schools in this job' },
        { status: 404 }
      );
    }

    const schools = groupBySchool(filteredStudents).sort(
      (a, b) => calculateUniformesTotalPiezas(b) - calculateUniformesTotalPiezas(a)
    );

    const flatRows = buildUniformesFlatRows(schools);

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Consolidado', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    const headerRow = sheet.getRow(1);
    headerRow.values = ['CORRELATIVO', 'CODIGO_CE', 'NOMBRE_CE', 'TIPO_PRENDA', 'TALLA', 'CANTIDAD'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    for (let i = 0; i < flatRows.length; i++) {
      const r = flatRows[i];
      const row = sheet.getRow(i + 2);
      row.values = [r.correlativo, r.codigo_ce, r.nombre_ce, r.tipo_prenda, r.talla, r.cantidad];
    }

    // Auto-width for columns
    sheet.columns.forEach(column => {
      if (column.values) {
        let maxLength = 0;
        column.values.forEach(val => {
          if (val !== null && val !== undefined) {
            const len = val.toString().length;
            if (len > maxLength) maxLength = len;
          }
        });
        column.width = Math.max(maxLength + 2, 8);
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${FILENAME}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error in consolidado-pivot-excel-v2:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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

    if (error) {
      throw new Error(`Failed to fetch students: ${error.message}`);
    }

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) break;

    all.push(...rows);

    if (all.length >= MAX_ROWS) break;
    if (rows.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return all;
}
