/**
 * Demand-based Excel generator for Consolidado report.
 *
 * Produces an .xlsx file with one row per school:
 *   CODIGO DEL CENTRO | CAJA | UNIFORMES | ZAPATOS | Total general
 *
 * Quantities are read directly from school_demand — no vacíos calculations.
 */
import ExcelJS from 'exceljs';
import type { DemandRow } from '@/types/database';

interface SchoolTotals {
  codigo_ce: string;
  cajas: number;
  uniformes: number;
  zapatos: number;
  total: number;
}

/**
 * Generate Consolidado Excel from demand data.
 * Returns an .xlsx buffer ready to be streamed.
 */
export async function generateConsolidadoDemandExcel(
  demandRows: DemandRow[]
): Promise<Buffer> {
  // Aggregate by school
  const schoolMap = new Map<string, SchoolTotals>();

  for (const row of demandRows) {
    if (!schoolMap.has(row.school_codigo_ce)) {
      schoolMap.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
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

  // Calculate totals and sort descending
  const schools = Array.from(schoolMap.values()).map((s) => ({
    ...s,
    total: s.cajas + s.uniformes + s.zapatos,
  }));
  schools.sort((a, b) => b.total - a.total);

  // Build workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consolidado', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Header row
  const headerRow = sheet.getRow(1);
  headerRow.values = ['CODIGO DEL CENTRO', 'CAJA', 'UNIFORMES', 'ZAPATOS', 'Total general'];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };

  // Data rows
  let rowIndex = 2;
  let grandCajas = 0;
  let grandUniformes = 0;
  let grandZapatos = 0;
  let grandTotal = 0;

  for (const school of schools) {
    const row = sheet.getRow(rowIndex);
    row.values = [school.codigo_ce, school.cajas, school.uniformes, school.zapatos, school.total];
    grandCajas += school.cajas;
    grandUniformes += school.uniformes;
    grandZapatos += school.zapatos;
    grandTotal += school.total;
    rowIndex++;
  }

  // Total general row
  const totalRow = sheet.getRow(rowIndex);
  totalRow.values = ['Total general', grandCajas, grandUniformes, grandZapatos, grandTotal];
  totalRow.font = { bold: true };

  // Auto-width columns
  sheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value ? cell.value.toString().length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.max(maxLength + 2, 10);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
