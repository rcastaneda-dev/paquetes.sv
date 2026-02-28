/**
 * Pure Excel workbook generators for students consolidation reports.
 *
 * Each generator takes pre-filtered students and returns a Buffer.
 * No Supabase or HTTP dependencies — safe for use in both API routes and workers.
 */
import ExcelJS from 'exceljs';
import type { StudentQueryRow } from '@/types/database';
import { groupBySchool } from '@/lib/pdf/agreement/sections';
import {
  calculateCajasTotales,
  calculateUniformesTotalPiezas,
  calculateZapatosTotalPiezas,
} from '@/lib/pdf/agreement/builders';
import { buildConsolidadoFlatRows, buildPrendasCajasFlatRows } from '@/lib/reports/editable-v2';
import {
  CLOTHING_SIZE_ORDER,
  computeClothingExtra,
  getRestrictedSizeOrder,
  computeFinalCount,
} from '@/lib/reports/vacios';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const EXCEL_FILENAMES = {
  consolidado: 'consolidado_estudiantes.xlsx',
  consolidadoPivotV2: 'Consolidado_Prendas_Final.xlsx',
  consolidadoPivot: 'Consolidado_Pivot_Uniformes.xlsx',
  zapatosPivot: 'Zapatos_Acumulado_Editable.xlsx',
  cajasPivot: 'Cajas_Acumulado_Editable.xlsx',
  consolidadoPrendasCajas: 'Consolidado_Prendas_Cajas.xlsx',
} as const;

export type ExcelType = keyof typeof EXCEL_FILENAMES;

export function excelStoragePath(jobId: string, filename: string): string {
  return `${jobId}/excel/${filename}`;
}

const SHOE_SIZES: string[] = [];
for (let i = 23; i <= 45; i++) {
  SHOE_SIZES.push(i.toString());
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function autoWidthColumns(sheet: ExcelJS.Worksheet): void {
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
}

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

  const rowBases: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = originals[size] * 2;
    rowBases[size] = allowedSet.has(size) ? base : 0;
  }

  const finals: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = rowBases[size] || 0;
    finals[size] = base > 0 ? base + computeClothingExtra(base) : 0;
  }

  return finals;
}

function computeZapatosRowFinals(students: StudentQueryRow[]): Record<string, number> {
  const zapatoTallaMap = new Map<string, number>();
  for (const student of students) {
    const size = student.zapato;
    if (size && SHOE_SIZES.includes(size)) {
      zapatoTallaMap.set(size, (zapatoTallaMap.get(size) || 0) + 1);
    }
  }

  const rowFinals: Record<string, number> = {};
  for (const size of SHOE_SIZES) {
    const orig = zapatoTallaMap.get(size) || 0;
    const computed = computeFinalCount(orig, 1);
    rowFinals[size] = computed.final;
  }

  return rowFinals;
}

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

  return Array.from(gradeMap.keys())
    .sort()
    .map(grade => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Generator 1: Consolidado (one row per school with totals)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoExcel(students: StudentQueryRow[]): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateUniformesTotalPiezas(b) - calculateUniformesTotalPiezas(a)
  );

  const generatedAt = new Date().toISOString();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', { views: [{ state: 'frozen', ySplit: 1 }] });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'CODIGO',
    'NOMBRE_CE',
    'DEPARTAMENTO',
    'DISTRITO',
    'TOTAL_ESTUDIANTES',
    'TOTAL DE UNIFORMES',
    'TOTAL DE ZAPATOS',
    'TOTAL DE CAJAS',
    'REF_KITS',
    'REF_UNIFORMES',
    'REF_ZAPATOS',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'left' };

  let rowIndex = 2;
  let grandStudents = 0;
  let grandUniformes = 0;
  let grandZapatos = 0;
  let grandCajas = 0;

  for (const school of schools) {
    const uniformes = calculateUniformesTotalPiezas(school);
    const zapatos = calculateZapatosTotalPiezas(school);
    const cajas = calculateCajasTotales(school);

    const row = sheet.getRow(rowIndex);
    row.values = [
      school.codigo_ce,
      school.nombre_ce,
      school.departamento,
      school.distrito,
      school.students.length,
      uniformes,
      zapatos,
      cajas,
      school.ref_kits,
      school.ref_uniformes,
      school.ref_zapatos,
    ];
    row.font = { bold: false };

    grandStudents += school.students.length;
    grandUniformes += uniformes;
    grandZapatos += zapatos;
    grandCajas += cajas;
    rowIndex++;
  }

  // Summary row
  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = [
    'TOTAL',
    '',
    '',
    '',
    grandStudents,
    grandUniformes,
    grandZapatos,
    grandCajas,
  ];
  totalRow.font = { bold: true };
  rowIndex++;

  // Generation metadata — helps detect data drift between reports
  const metaRow = sheet.getRow(rowIndex + 1);
  metaRow.values = [
    `Generado: ${generatedAt}`,
    '',
    '',
    '',
    `${schools.length} centros educativos`,
    '',
    '',
    `${students.length} registros`,
  ];
  metaRow.font = { italic: true, color: { argb: 'FF888888' } };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 2: Consolidado Pivot V2 (flat rows)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoPivotExcelV2(
  students: StudentQueryRow[]
): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateUniformesTotalPiezas(b) - calculateUniformesTotalPiezas(a)
  );

  const flatRows = buildConsolidadoFlatRows(schools);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado_Prendas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'CORRELATIVO',
    'CODIGO_CE',
    'NOMBRE_CE',
    'DEPARTAMENTO',
    'DISTRITO',
    'TIPO_PRENDA',
    'TALLA',
    'CANTIDAD',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i];
    const row = sheet.getRow(i + 2);
    row.values = [
      r.correlativo,
      r.codigo_ce,
      r.nombre_ce,
      r.departamento,
      r.distrito,
      r.tipo_prenda,
      r.talla,
      r.cantidad,
    ];
  }

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 3: Consolidado Pivot (uniform types × sizes T4–T2X)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoPivotExcel(students: StudentQueryRow[]): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateUniformesTotalPiezas(b) - calculateUniformesTotalPiezas(a)
  );

  const sizeOrder = [...CLOTHING_SIZE_ORDER];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = ['Codigo_CE', 'Etiquetas de fila', ...sizeOrder, 'Total general'];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  const grandTotals: Record<string, number> = {};
  for (const size of sizeOrder) {
    grandTotals[size] = 0;
  }
  let grandTotal = 0;
  let rowIndex = 2;

  for (const school of schools) {
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

  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = [
    null,
    'Total general',
    ...sizeOrder.map(size => (grandTotals[size] > 0 ? grandTotals[size] : null)),
    grandTotal > 0 ? grandTotal : null,
  ];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 4: Zapatos Pivot (schools × shoe sizes 23–45)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateZapatosPivotExcel(students: StudentQueryRow[]): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateZapatosTotalPiezas(b) - calculateZapatosTotalPiezas(a)
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = ['Codigo_CE', ...SHOE_SIZES, 'Total general'];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

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

  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = [
    'Total general',
    ...SHOE_SIZES.map(size => (grandTotals[size] > 0 ? grandTotals[size] : null)),
    grandTotal > 0 ? grandTotal : null,
  ];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 5: Cajas Pivot (schools × grades with gender breakdown)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateCajasPivotExcel(students: StudentQueryRow[]): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateCajasTotales(b) - calculateCajasTotales(a)
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cajas_Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'No',
    'Codigo CE',
    'Nombre CE',
    'Departamento',
    'Distrito',
    'Grado',
    'Cajas Hombres',
    'Cajas Mujeres',
    'Cajas Totales',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

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
        school.departamento,
        school.distrito,
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

  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = [
    null,
    null,
    'Total general',
    null,
    null,
    null,
    grandTotalH > 0 ? grandTotalH : null,
    grandTotalM > 0 ? grandTotalM : null,
    grandTotal > 0 ? grandTotal : null,
  ];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 6: Consolidado Prendas + Cajas (mirrors demand module's V2)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoPrendasCajasExcel(
  students: StudentQueryRow[]
): Promise<Buffer> {
  const schools = groupBySchool(students).sort(
    (a, b) => calculateUniformesTotalPiezas(b) - calculateUniformesTotalPiezas(a)
  );

  const flatRows = buildPrendasCajasFlatRows(schools);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado_Prendas_Cajas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'CORRELATIVO',
    'CODIGO_CE',
    'NOMBRE_CE',
    'DEPARTAMENTO',
    'DISTRITO',
    'TIPO_PRENDA',
    'TALLA',
    'CANTIDAD',
    'REFERENCIA',
    'FECHA_INICIO',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i];
    const row = sheet.getRow(i + 2);
    row.values = [
      r.correlativo,
      r.codigo_ce,
      r.nombre_ce,
      r.departamento,
      r.distrito,
      r.tipo_prenda,
      r.talla,
      r.cantidad,
      r.referencia,
      r.fecha_inicio,
    ];
  }

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch generator
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratedExcel {
  filename: string;
  buffer: Buffer;
}

export async function generateAllExcels(students: StudentQueryRow[]): Promise<GeneratedExcel[]> {
  const generators: Array<{
    filename: string;
    generate: (s: StudentQueryRow[]) => Promise<Buffer>;
  }> = [
    { filename: EXCEL_FILENAMES.consolidado, generate: generateConsolidadoExcel },
    { filename: EXCEL_FILENAMES.consolidadoPivotV2, generate: generateConsolidadoPivotExcelV2 },
    { filename: EXCEL_FILENAMES.consolidadoPivot, generate: generateConsolidadoPivotExcel },
    { filename: EXCEL_FILENAMES.zapatosPivot, generate: generateZapatosPivotExcel },
    { filename: EXCEL_FILENAMES.cajasPivot, generate: generateCajasPivotExcel },
    {
      filename: EXCEL_FILENAMES.consolidadoPrendasCajas,
      generate: generateConsolidadoPrendasCajasExcel,
    },
  ];

  const results: GeneratedExcel[] = [];
  for (const { filename, generate } of generators) {
    const buffer = await generate(students);
    results.push({ filename, buffer });
  }
  return results;
}
