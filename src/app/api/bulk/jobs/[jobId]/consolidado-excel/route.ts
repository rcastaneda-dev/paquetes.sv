import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import {
  calculateCajasTotales,
  calculateUniformesTotalPiezas,
  calculateZapatosTotalPiezas,
} from '@/lib/pdf/agreement/builders';

const FILENAME = 'Consolidado_Portafolio.xlsx';

/** PostgREST max-rows (Supabase default = 1000). Page in increments of 1000. */
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/**
 * GET /api/bulk/jobs/[jobId]/consolidado-excel
 *
 * Returns an .xlsx file with one row per school: codigo, total_zapatos, total_uniformes, total_cajas.
 * First row is header (bold, caps). No title or padding rows. Not part of ZIP bundle logic.
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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Consolidado', { views: [{ state: 'frozen', ySplit: 1 }] });

    const headerRow = sheet.getRow(1);
    headerRow.values = ['CODIGO', 'TOTAL DE UNIFORMES', 'TOTAL DE ZAPATOS', 'TOTAL DE CAJAS'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'left' };

    let rowIndex = 2;
    for (const school of schools) {
      const totalZapatos = calculateZapatosTotalPiezas(school);
      const totalUniformes = calculateUniformesTotalPiezas(school);
      const totalCajas = calculateCajasTotales(school);

      const row = sheet.getRow(rowIndex);
      row.values = [school.codigo_ce, totalUniformes, totalZapatos, totalCajas];
      row.font = { bold: false };
      rowIndex++;
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${FILENAME}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error in consolidado-excel:', error);
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
