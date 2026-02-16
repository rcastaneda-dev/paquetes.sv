import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import { calculateCajasTotales } from '@/lib/pdf/agreement/builders';

const FILENAME = 'Cajas_Acumulado_Editable.xlsx';
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/**
 * Compute per-grade cajas (hombres, mujeres, total) for a school.
 * Same logic as renderCajasSection in sections.ts:
 *   1. Group students by grado_ok
 *   2. Count hombres/mujeres per grade
 *   3. Apply Math.round(count * 1.05) per gender (0 students → 0 cajas)
 */
function computeCajasPerGrade(
  students: StudentQueryRow[]
): Array<{ grado: string; hombres: number; mujeres: number; total: number }> {
  const gradeMap = new Map<string, { hombres: number; mujeres: number }>();

  for (const student of students) {
    const grade = student.grado_ok || student.grado || 'N/A';
    if (!gradeMap.has(grade)) {
      gradeMap.set(grade, { hombres: 0, mujeres: 0 });
    }
    const counts = gradeMap.get(grade)!;
    if (student.sexo === 'Hombre') {
      counts.hombres++;
    } else if (student.sexo === 'Mujer') {
      counts.mujeres++;
    }
  }

  const grades = Array.from(gradeMap.keys()).sort();

  return grades.map(grade => {
    const counts = gradeMap.get(grade)!;
    const cajasHombres = counts.hombres === 0 ? 0 : Math.round(counts.hombres * 1.05);
    const cajasMujeres = counts.mujeres === 0 ? 0 : Math.round(counts.mujeres * 1.05);
    return {
      grado: grade,
      hombres: cajasHombres,
      mujeres: cajasMujeres,
      total: cajasHombres + cajasMujeres,
    };
  });
}

/**
 * GET /api/bulk/jobs/[jobId]/cajas-pivot-excel
 *
 * Returns an .xlsx with consolidated cajas data across all schools.
 * Columns: No, Codigo CE, Nombre CE, Grado, Cajas Hombres, Cajas Mujeres, Cajas Totales
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
      (a, b) => calculateCajasTotales(b) - calculateCajasTotales(a)
    );

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cajas_Consolidado', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Header row
    const headerRow = sheet.getRow(1);
    headerRow.values = [
      'No',
      'Codigo CE',
      'Nombre CE',
      'Grado',
      'Cajas Hombres',
      'Cajas Mujeres',
      'Cajas Totales',
    ];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Grand totals accumulators
    let grandTotalH = 0;
    let grandTotalM = 0;
    let grandTotal = 0;

    let rowIndex = 2;
    let correlativo = 1;

    for (const school of schools) {
      const gradeRows = computeCajasPerGrade(school.students);

      for (const gradeRow of gradeRows) {
        const row = sheet.getRow(rowIndex);
        row.values = [
          correlativo,
          school.codigo_ce,
          school.nombre_ce,
          gradeRow.grado,
          gradeRow.hombres > 0 ? gradeRow.hombres : null,
          gradeRow.mujeres > 0 ? gradeRow.mujeres : null,
          gradeRow.total > 0 ? gradeRow.total : null,
        ];

        grandTotalH += gradeRow.hombres;
        grandTotalM += gradeRow.mujeres;
        grandTotal += gradeRow.total;

        rowIndex++;
        correlativo++;
      }
    }

    // Grand total row
    const totalRow = sheet.getRow(rowIndex);
    totalRow.values = [
      null,
      null,
      'Total general',
      null,
      grandTotalH > 0 ? grandTotalH : null,
      grandTotalM > 0 ? grandTotalM : null,
      grandTotal > 0 ? grandTotal : null,
    ];
    totalRow.font = { bold: true };

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
    console.error('Error in cajas-pivot-excel:', error);
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
