/**
 * Demand-based Excel generators.
 *
 * Quantities are read directly from school_demand — no vacíos calculations.
 * Grouping and totals use the shared demand-aggregation module so numbers
 * always match what the PDF generators (ACTAS / COMANDAS) produce.
 */
import ExcelJS from 'exceljs';
import type { DemandRow, ItemType } from '@/types/database';
import {
  groupAndSortDemandBySchool,
  computeSchoolItemTotals,
} from '@/lib/reports/demand-aggregation';

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  CAJAS: 'CAJA',
  UNIFORMES: 'UNIFORME',
  ZAPATOS: 'ZAPATOS',
};

function autoWidthColumns(sheet: ExcelJS.Worksheet): void {
  sheet.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: false }, cell => {
      const len = cell.value ? cell.value.toString().length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.max(maxLength + 2, 10);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 1: Consolidado (original — CODIGO DEL CENTRO, Nombre CE, CAJA, UNIFORMES, ZAPATOS, Total general)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoDemandExcel(demandRows: DemandRow[]): Promise<Buffer> {
  const schoolGroups = groupAndSortDemandBySchool(demandRows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'CODIGO DEL CENTRO',
    'Nombre CE',
    'ZONA',
    'CAJA',
    'UNIFORMES',
    'ZAPATOS',
    'Total general',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  let rowIndex = 2;
  let grandCajas = 0;
  let grandUniformes = 0;
  let grandZapatos = 0;
  let grandTotal = 0;

  for (const group of schoolGroups) {
    const totals = computeSchoolItemTotals(group);
    const row = sheet.getRow(rowIndex);
    row.values = [
      totals.codigo_ce,
      totals.nombre_ce,
      group.zona,
      totals.cajas,
      totals.uniformes,
      totals.zapatos,
      totals.total,
    ];
    grandCajas += totals.cajas;
    grandUniformes += totals.uniformes;
    grandZapatos += totals.zapatos;
    grandTotal += totals.total;
    rowIndex++;
  }

  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = ['Total general', '', '', grandCajas, grandUniformes, grandZapatos, grandTotal];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 2: Consolidado V2 — Prendas + Cajas combined
//   CORRELATIVO | CODIGO_CE | NOMBRE_CE | DEPARTAMENTO | DISTRITO | TIPO_PRENDA | TALLA | CANTIDAD
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoDemandExcelV2(demandRows: DemandRow[]): Promise<Buffer> {
  const schoolGroups = groupAndSortDemandBySchool(demandRows);
  const schoolOrderMap = new Map(schoolGroups.map((s, i) => [s.codigo_ce, i]));

  // Prendas rows (UNIFORMES + ZAPATOS): sort by school order → tipo → categoria
  const sortedPrendas = demandRows
    .filter(r => r.item === 'UNIFORMES' || r.item === 'ZAPATOS')
    .sort((a, b) => {
      const orderA = schoolOrderMap.get(a.school_codigo_ce) ?? Infinity;
      const orderB = schoolOrderMap.get(b.school_codigo_ce) ?? Infinity;
      if (orderA !== orderB) return orderA - orderB;
      const tipoCompare = a.tipo.localeCompare(b.tipo, 'es');
      if (tipoCompare !== 0) return tipoCompare;
      return a.categoria.localeCompare(b.categoria, 'es');
    });

  // Cajas rows: sort by school order → categoria
  const sortedCajas = demandRows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => {
      const orderA = schoolOrderMap.get(a.school_codigo_ce) ?? Infinity;
      const orderB = schoolOrderMap.get(b.school_codigo_ce) ?? Infinity;
      if (orderA !== orderB) return orderA - orderB;
      return a.categoria.localeCompare(b.categoria, 'es');
    });

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
    'ZONA',
    'TIPO',
    'TIPO_PRENDA',
    'TALLA',
    'CANTIDAD',
    'REFERENCIA',
    'FECHA_INICIO',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  let correlativo = 1;
  let rowIndex = 2;

  for (const r of sortedPrendas) {
    const row = sheet.getRow(rowIndex);
    row.values = [
      correlativo,
      r.school_codigo_ce,
      r.nombre_ce,
      r.departamento,
      r.distrito,
      r.zona,
      ITEM_TYPE_LABEL[r.item],
      r.tipo,
      r.categoria,
      r.cantidad,
      r.referencia,
      r.fecha_inicio,
    ];
    correlativo++;
    rowIndex++;
  }

  for (const r of sortedCajas) {
    const row = sheet.getRow(rowIndex);
    row.values = [
      correlativo,
      r.school_codigo_ce,
      r.nombre_ce,
      r.departamento,
      r.distrito,
      r.zona,
      ITEM_TYPE_LABEL[r.item],
      'CAJAS',
      r.categoria,
      r.cantidad,
      r.referencia,
      r.fecha_inicio,
    ];
    correlativo++;
    rowIndex++;
  }

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 3: Prendas Acumulado Editable V2 (mirrors students' generateConsolidadoPivotExcelV2)
//   CORRELATIVO | CODIGO_CE | NOMBRE_CE | DEPARTAMENTO | DISTRITO | TIPO_PRENDA | TALLA | CANTIDAD
// ─────────────────────────────────────────────────────────────────────────────

export async function generatePrendasDemandExcelV2(demandRows: DemandRow[]): Promise<Buffer> {
  // Filter to UNIFORMES + ZAPATOS only (no CAJAS)
  const prendaRows = demandRows.filter(r => r.item === 'UNIFORMES' || r.item === 'ZAPATOS');

  // Group by school for sorting
  const schoolGroups = groupAndSortDemandBySchool(demandRows);
  const schoolOrderMap = new Map(schoolGroups.map((s, i) => [s.codigo_ce, i]));

  // Sort rows: by school order (distrito then total desc), then tipo, then categoria
  const sorted = [...prendaRows].sort((a, b) => {
    const orderA = schoolOrderMap.get(a.school_codigo_ce) ?? Infinity;
    const orderB = schoolOrderMap.get(b.school_codigo_ce) ?? Infinity;
    if (orderA !== orderB) return orderA - orderB;
    const tipoCompare = a.tipo.localeCompare(b.tipo, 'es');
    if (tipoCompare !== 0) return tipoCompare;
    return a.categoria.localeCompare(b.categoria, 'es');
  });

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

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const row = sheet.getRow(i + 2);
    row.values = [
      i + 1,
      r.school_codigo_ce,
      r.nombre_ce,
      r.departamento,
      r.distrito,
      r.tipo,
      r.categoria,
      r.cantidad,
    ];
  }

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 4: Cajas Acumulado Editable (mirrors students' generateCajasPivotExcel)
//   No | Codigo CE | Nombre CE | Departamento | Distrito | Grado | Cajas Totales
// ─────────────────────────────────────────────────────────────────────────────

export async function generateCajasDemandExcel(demandRows: DemandRow[]): Promise<Buffer> {
  const cajasRows = demandRows.filter(r => r.item === 'CAJAS');

  // Group by school for sorting
  const schoolGroups = groupAndSortDemandBySchool(demandRows);
  const schoolOrderMap = new Map(schoolGroups.map((s, i) => [s.codigo_ce, i]));

  // Build school → grade rows map
  const schoolGrades = new Map<string, { row: DemandRow; grades: DemandRow[] }>();
  for (const r of cajasRows) {
    if (!schoolGrades.has(r.school_codigo_ce)) {
      schoolGrades.set(r.school_codigo_ce, { row: r, grades: [] });
    }
    schoolGrades.get(r.school_codigo_ce)!.grades.push(r);
  }

  // Sort schools by the same order as groupAndSortDemandBySchool, then grades alphabetically
  const sortedSchools = Array.from(schoolGrades.values()).sort((a, b) => {
    const orderA = schoolOrderMap.get(a.row.school_codigo_ce) ?? Infinity;
    const orderB = schoolOrderMap.get(b.row.school_codigo_ce) ?? Infinity;
    return orderA - orderB;
  });

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
    'Cajas Totales',
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  let grandTotal = 0;
  let rowIndex = 2;
  let correlativo = 1;

  for (const school of sortedSchools) {
    const grades = school.grades.sort((a, b) => a.categoria.localeCompare(b.categoria));

    for (const gradeRow of grades) {
      const row = sheet.getRow(rowIndex);
      row.values = [
        correlativo,
        gradeRow.school_codigo_ce,
        gradeRow.nombre_ce,
        gradeRow.departamento,
        gradeRow.distrito,
        gradeRow.categoria,
        gradeRow.cantidad > 0 ? gradeRow.cantidad : null,
      ];

      grandTotal += gradeRow.cantidad;
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
    grandTotal > 0 ? grandTotal : null,
  ];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
