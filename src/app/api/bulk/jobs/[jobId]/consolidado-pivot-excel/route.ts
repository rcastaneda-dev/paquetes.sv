import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import { calculateUniformesTotalPiezas } from '@/lib/pdf/agreement/builders';
import { CLOTHING_SIZE_ORDER, computeClothingExtra, getRestrictedSizeOrder } from '@/lib/reports/vacios';

const FILENAME = 'Consolidado_Pivot_Uniformes.xlsx';
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

/**
 * Compute per-size final counts for a given uniform type across a set of students.
 * Uses the same logic as calculateUniformesTotalPiezas in builders.ts:
 *   1. Count originals per size
 *   2. base = original × 2
 *   3. Zero out-of-range sizes
 *   4. final = base + ceilToEven(base × 0.05)
 */
function computeRowFinals(
  students: StudentQueryRow[],
  sizeField: 'camisa' | 'pantalon_falda',
  typeField: 'tipo_de_camisa' | 't_pantalon_falda_short',
  typeValue: string,
  restrictionCategory: 'tipo_de_camisa' | 't_pantalon_falda_short'
): Record<string, number> {
  const sizeOrder = [...CLOTHING_SIZE_ORDER];
  const restrictedSizes = getRestrictedSizeOrder(restrictionCategory, typeValue, sizeOrder);
  const allowedSet = new Set(restrictedSizes);

  // Count originals
  const originals: Record<string, number> = {};
  for (const size of sizeOrder) {
    originals[size] = 0;
  }
  for (const student of students) {
    const tipo = student[typeField];
    const size = student[sizeField];
    if (!tipo || !size) continue;
    const normalizedTipo =
      typeField === 'tipo_de_camisa' ? `CAMISA ${tipo.toUpperCase()}` : tipo.toUpperCase();
    if (normalizedTipo !== typeValue) continue;
    if (originals[size] !== undefined) {
      originals[size]++;
    }
  }

  // base = original × 2, zeroed outside restriction range
  const rowBases: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = originals[size] * 2;
    rowBases[size] = allowedSet.has(size) ? base : 0;
  }

  // No gap filling — if real demand is zero, it stays zero

  // Final = base + vacios
  const finals: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = rowBases[size] || 0;
    if (base > 0) {
      finals[size] = base + computeClothingExtra(base);
    } else {
      finals[size] = 0;
    }
  }

  return finals;
}

/**
 * GET /api/bulk/jobs/[jobId]/consolidado-pivot-excel
 *
 * Returns an .xlsx pivot table: schools × uniform types × sizes (T4–T2X).
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

    // Build workbook
    const sizeOrder = [...CLOTHING_SIZE_ORDER];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Consolidado', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Header row
    const headerRow = sheet.getRow(1);
    headerRow.values = ['Codigo_CE', 'Etiquetas de fila', ...sizeOrder, 'Total general'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Grand totals accumulator
    const grandTotals: Record<string, number> = {};
    for (const size of sizeOrder) {
      grandTotals[size] = 0;
    }
    let grandTotal = 0;

    let rowIndex = 2;

    for (const school of schools) {
      // Discover uniform types present for this school
      const camisaTypes = new Set<string>();
      const pantalonTypes = new Set<string>();

      for (const student of school.students) {
        if (student.tipo_de_camisa) {
          camisaTypes.add(`CAMISA ${student.tipo_de_camisa.toUpperCase()}`);
        }
        if (student.t_pantalon_falda_short) {
          pantalonTypes.add(student.t_pantalon_falda_short.toUpperCase());
        }
      }

      const allTypes = [...[...camisaTypes].sort(), ...[...pantalonTypes].sort()];

      let isFirstRow = true;

      for (const typeValue of allTypes) {
        const isCamisa = typeValue.startsWith('CAMISA ');
        const finals = computeRowFinals(
          school.students,
          isCamisa ? 'camisa' : 'pantalon_falda',
          isCamisa ? 'tipo_de_camisa' : 't_pantalon_falda_short',
          typeValue,
          isCamisa ? 'tipo_de_camisa' : 't_pantalon_falda_short'
        );

        let rowTotal = 0;
        const sizeValues: (number | null)[] = [];
        for (const size of sizeOrder) {
          const val = finals[size] || 0;
          sizeValues.push(val > 0 ? val : null);
          rowTotal += val;
          grandTotals[size] += val;
        }
        grandTotal += rowTotal;

        const row = sheet.getRow(rowIndex);
        row.values = [
          isFirstRow ? school.codigo_ce : null,
          typeValue,
          ...sizeValues,
          rowTotal > 0 ? rowTotal : null,
        ];
        rowIndex++;
        isFirstRow = false;
      }
    }

    // Grand total row
    const totalRow = sheet.getRow(rowIndex);
    const totalSizeValues: (number | null)[] = sizeOrder.map(size =>
      grandTotals[size] > 0 ? grandTotals[size] : null
    );
    totalRow.values = [
      null,
      'Total general',
      ...totalSizeValues,
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
    console.error('Error in consolidado-pivot-excel:', error);
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
