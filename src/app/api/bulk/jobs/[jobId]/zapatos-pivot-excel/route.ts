import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import { calculateZapatosTotalPiezas } from '@/lib/pdf/agreement/builders';
import { computeFinalCount } from '@/lib/reports/vacios';

const FILENAME = 'Zapatos_Acumulado_Editable.xlsx';
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/** Shoe sizes 23–45 */
const SHOE_SIZES: string[] = [];
for (let i = 23; i <= 45; i++) {
  SHOE_SIZES.push(i.toString());
}

/**
 * Compute per-size final counts for zapatos for a school.
 * Same logic as calculateZapatosTotalPiezas in builders.ts:
 *   1. Count originals per shoe size
 *   2. computeFinalCount(original, 1) → base + ceil(base × 0.06)
 *   No gap filling — sizes with zero demand stay zero
 */
function computeZapatosRowFinals(students: StudentQueryRow[]): Record<string, number> {
  const zapatoTallaMap = new Map<string, number>();
  for (const student of students) {
    const size = student.zapato;
    if (size && SHOE_SIZES.includes(size)) {
      zapatoTallaMap.set(size, (zapatoTallaMap.get(size) || 0) + 1);
    }
  }

  const rowBases: Record<string, number> = {};
  const rowFinals: Record<string, number> = {};
  for (const size of SHOE_SIZES) {
    const orig = zapatoTallaMap.get(size) || 0;
    const computed = computeFinalCount(orig, 1);
    rowBases[size] = computed.base;
    rowFinals[size] = computed.final;
  }

  // No gap filling for shoes — only produce units for sizes with real demand
  return rowFinals;
}

/**
 * GET /api/bulk/jobs/[jobId]/zapatos-pivot-excel
 *
 * Returns an .xlsx pivot table: schools × shoe sizes (23–45).
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
      (a, b) => calculateZapatosTotalPiezas(b) - calculateZapatosTotalPiezas(a)
    );

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Consolidado', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Header row
    const headerRow = sheet.getRow(1);
    headerRow.values = ['Codigo_CE', ...SHOE_SIZES, 'Total general'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Grand totals accumulator
    const grandTotals: Record<string, number> = {};
    for (const size of SHOE_SIZES) {
      grandTotals[size] = 0;
    }
    let grandTotal = 0;

    let rowIndex = 2;

    for (const school of schools) {
      const finals = computeZapatosRowFinals(school.students);

      let rowTotal = 0;
      const sizeValues: (number | null)[] = [];
      for (const size of SHOE_SIZES) {
        const val = finals[size] || 0;
        sizeValues.push(val > 0 ? val : null);
        rowTotal += val;
        grandTotals[size] += val;
      }
      grandTotal += rowTotal;

      const row = sheet.getRow(rowIndex);
      row.values = [school.codigo_ce, ...sizeValues, rowTotal > 0 ? rowTotal : null];
      rowIndex++;
    }

    // Grand total row
    const totalRow = sheet.getRow(rowIndex);
    const totalSizeValues: (number | null)[] = SHOE_SIZES.map(size =>
      grandTotals[size] > 0 ? grandTotals[size] : null
    );
    totalRow.values = ['Total general', ...totalSizeValues, grandTotal > 0 ? grandTotal : null];
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
    console.error('Error in zapatos-pivot-excel:', error);
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
