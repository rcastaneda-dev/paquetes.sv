/**
 * Demand-based Excel generators.
 *
 * Quantities are read directly from school_demand — no vacíos calculations.
 */
import ExcelJS from 'exceljs';
import type { DemandRow } from '@/types/database';

interface SchoolTotals {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  cajas: number;
  uniformes: number;
  zapatos: number;
  total: number;
}

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

function aggregateBySchool(demandRows: DemandRow[]): SchoolTotals[] {
  const schoolMap = new Map<string, SchoolTotals>();

  for (const row of demandRows) {
    if (!schoolMap.has(row.school_codigo_ce)) {
      schoolMap.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
        nombre_ce: row.nombre_ce,
        departamento: row.departamento,
        distrito: row.distrito,
        cajas: 0,
        uniformes: 0,
        zapatos: 0,
        total: 0,
      });
    }
    const entry = schoolMap.get(row.school_codigo_ce)!;
    if (row.item === 'CAJAS') {
      entry.cajas += row.cantidad;
    } else if (row.item === 'UNIFORMES') {
      entry.uniformes += row.cantidad;
    } else if (row.item === 'ZAPATOS') {
      entry.zapatos += row.cantidad;
    }
  }

  const schools = Array.from(schoolMap.values()).map(s => ({
    ...s,
    total: s.cajas + s.uniformes + s.zapatos,
  }));
  schools.sort((a, b) => {
    const districtCompare = a.distrito.localeCompare(b.distrito, 'es');
    if (districtCompare !== 0) return districtCompare;
    return b.total - a.total;
  });

  return schools;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 1: Consolidado (original — CODIGO DEL CENTRO, Nombre CE, CAJA, UNIFORMES, ZAPATOS, Total general)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoDemandExcel(demandRows: DemandRow[]): Promise<Buffer> {
  const schools = aggregateBySchool(demandRows);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.getRow(1);
  headerRow.values = [
    'CODIGO DEL CENTRO',
    'Nombre CE',
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

  for (const school of schools) {
    const row = sheet.getRow(rowIndex);
    row.values = [
      school.codigo_ce,
      school.nombre_ce,
      school.cajas,
      school.uniformes,
      school.zapatos,
      school.total,
    ];
    grandCajas += school.cajas;
    grandUniformes += school.uniformes;
    grandZapatos += school.zapatos;
    grandTotal += school.total;
    rowIndex++;
  }

  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = ['Total general', '', grandCajas, grandUniformes, grandZapatos, grandTotal];
  totalRow.font = { bold: true };

  autoWidthColumns(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator 2: Consolidado V2 — Prendas + Cajas combined
//   CORRELATIVO | CODIGO_CE | NOMBRE_CE | DEPARTAMENTO | DISTRITO | TIPO_PRENDA | TALLA | CANTIDAD
// ─────────────────────────────────────────────────────────────────────────────

export async function generateConsolidadoDemandExcelV2(demandRows: DemandRow[]): Promise<Buffer> {
  const schoolOrder = aggregateBySchool(demandRows);
  const schoolOrderMap = new Map(schoolOrder.map((s, i) => [s.codigo_ce, i]));

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
    'TIPO_PRENDA',
    'TALLA',
    'CANTIDAD',
    'REFERENCIA',
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
      r.tipo,
      r.categoria,
      r.cantidad,
      r.referencia,
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
      'CAJAS',
      r.categoria,
      r.cantidad,
      r.referencia,
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
  const schoolOrder = aggregateBySchool(demandRows);
  const schoolOrderMap = new Map(schoolOrder.map((s, i) => [s.codigo_ce, i]));

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
  const schoolOrder = aggregateBySchool(demandRows);
  const schoolOrderMap = new Map(schoolOrder.map((s, i) => [s.codigo_ce, i]));

  // Build school → grade rows map
  const schoolGrades = new Map<string, { row: DemandRow; grades: DemandRow[] }>();
  for (const r of cajasRows) {
    if (!schoolGrades.has(r.school_codigo_ce)) {
      schoolGrades.set(r.school_codigo_ce, { row: r, grades: [] });
    }
    schoolGrades.get(r.school_codigo_ce)!.grades.push(r);
  }

  // Sort schools by the same order as aggregateBySchool, then grades alphabetically
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
