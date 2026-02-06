/**
 * PDF generators for the agreement reports (Cajas, Camisas, Pantalones, Zapatos, Fichas).
 *
 * The three "consolidated" generators (Cajas, FichaUniformes, FichaZapatos) delegate to
 * reusable section renderers in ./agreement/sections.ts via buildConsolidatedPdf.
 * Other generators retain their original implementation but use shared helpers.
 */
import PDFDocument from 'pdfkit';
import type { StudentQueryRow } from '@/types/database';
import { computeFinalCount, fillSizeGaps } from '@/lib/reports/vacios';
import { buildConsolidatedPdf } from './agreement/builders';
import {
  addLogoToPage,
  formatDateForTitle,
  groupBySchool,
  drawSchoolHeaderBlock,
} from './agreement/sections';
import type { SchoolGroup } from './agreement/types';

// Re-export for backward compatibility and external consumers
export type { PDFDocumentInstance, SchoolGroup } from './agreement/types';
export type { SchoolHeaderBlockOptions } from './agreement/sections';
export {
  addLogoToPage,
  formatDateForTitle,
  groupBySchool,
  drawSchoolHeaderBlock,
} from './agreement/sections';

type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

interface AgreementReportOptions {
  fechaInicio: string; // YYYY-MM-DD format
  students: StudentQueryRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidated generators (thin wrappers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PDF 1: Cajas Distribution Report – "DETALLE DE PROGRAMACIÓN DE CAJAS"
 * Grouping: By codigo_ce, then by grado_ok
 */
export function generateCajasPDF(options: AgreementReportOptions): PDFDocumentInstance {
  return buildConsolidatedPdf({
    fechaInicio: options.fechaInicio,
    students: options.students,
    section: 'cajas',
  });
}

/**
 * PDF 5: School Distribution Card – Uniformes
 * "FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)"
 */
export function generateFichaUniformesPDF(options: AgreementReportOptions): PDFDocumentInstance {
  return buildConsolidatedPdf({
    fechaInicio: options.fechaInicio,
    students: options.students,
    section: 'ficha_uniformes',
  });
}

/**
 * PDF 6: School Distribution Card – Zapatos
 * "FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)"
 */
export function generateFichaZapatosPDF(options: AgreementReportOptions): PDFDocumentInstance {
  return buildConsolidatedPdf({
    fechaInicio: options.fechaInicio,
    students: options.students,
    section: 'ficha_zapatos',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-consolidated generators (original implementations using shared helpers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PDF 2: Camisas Distribution Report
 * Grouping: By codigo_ce, then by tipo_camisa
 * Dynamic size columns: T4–T2X
 */
export function generateCamisasPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 20, right: 20 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE CAMISAS`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  const xStart = 20;
  const availableWidth = doc.page.width - 40;
  const headerFontSize = 11;
  const bodyFontSize = 9;
  const schoolHeaderFontSize = 12;

  const sizeColWidth = 35;
  const totalColWidth = 50;
  const tipoColWidth = availableWidth - sizes.length * sizeColWidth - totalColWidth;
  const headerHeight = 28;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    if (s > 0) {
      doc.addPage();
    }

    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    const tipoMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const tipo = student.tipo_de_camisa || 'N/A';
      const size = student.camisa || 'N/A';

      if (!tipoMap.has(tipo)) {
        tipoMap.set(tipo, {});
      }
      const sizeCounts = tipoMap.get(tipo)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const tipos = Array.from(tipoMap.keys()).sort();

    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, tipoColWidth, headerHeight).stroke();
    doc.text('TIPO', x + 2, currentY + 8, {
      width: tipoColWidth - 4,
      align: 'center',
    });
    x += tipoColWidth;

    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    doc.font('Helvetica').fontSize(bodyFontSize);

    const tipoFinalCounts = new Map<string, Record<string, number>>();
    for (const tipo of tipos) {
      const sizeCounts = tipoMap.get(tipo)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of sizes) {
        const orig = sizeCounts[size] || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 2).final;
      }
      const filled = fillSizeGaps(sizes, rowOriginals, rowFinals);
      tipoFinalCounts.set(tipo, filled);
    }

    for (const tipo of tipos) {
      const filled = tipoFinalCounts.get(tipo)!;
      let rowTotal = 0;

      const tipoHeight = doc.heightOfString(tipo, {
        width: tipoColWidth - 4,
      });
      const dynamicRowHeight = Math.max(20, tipoHeight + 8);

      x = xStart;

      doc.rect(x, currentY, tipoColWidth, dynamicRowHeight).stroke();
      doc.text(tipo, x + 2, currentY + 4, {
        width: tipoColWidth - 4,
        align: 'center',
      });
      x += tipoColWidth;

      for (const size of sizes) {
        const finalCount = filled[size] || 0;
        rowTotal += finalCount;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(finalCount > 0 ? finalCount.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 20;
    x = xStart;

    doc.rect(x, currentY, tipoColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: tipoColWidth - 4,
      align: 'center',
    });
    x += tipoColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const filled = tipoFinalCounts.get(tipo)!;
        sizeTotal += filled[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
  }

  doc.end();
  return doc;
}

/**
 * PDF 3: Pantalones/Falda/Short Distribution Report
 * Grouping: By codigo_ce, then by tipo_prenda
 * Dynamic size columns: T4–T2X
 */
export function generatePantalonesPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 20, right: 20 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE PANTALÓN/FALDA/SHORT`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  const xStart = 20;
  const availableWidth = doc.page.width - 40;
  const headerFontSize = 11;
  const bodyFontSize = 9;
  const schoolHeaderFontSize = 12;

  const sizeColWidth = 35;
  const totalColWidth = 50;
  const tipoPrendaColWidth = availableWidth - sizes.length * sizeColWidth - totalColWidth;
  const headerHeight = 28;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    if (s > 0) {
      doc.addPage();
    }

    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    const tipoPrendMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const tipoPrenda = student.t_pantalon_falda_short || 'N/A';
      const size = student.pantalon_falda || 'N/A';

      if (!tipoPrendMap.has(tipoPrenda)) {
        tipoPrendMap.set(tipoPrenda, {});
      }
      const sizeCounts = tipoPrendMap.get(tipoPrenda)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const tipos = Array.from(tipoPrendMap.keys()).sort();

    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, tipoPrendaColWidth, headerHeight).stroke();
    doc.text('TIPO PRENDA', x + 2, currentY + 8, {
      width: tipoPrendaColWidth - 4,
      align: 'center',
    });
    x += tipoPrendaColWidth;

    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    doc.font('Helvetica').fontSize(bodyFontSize);

    const tipoPrendaFinalCounts = new Map<string, Record<string, number>>();
    for (const tipo of tipos) {
      const sizeCounts = tipoPrendMap.get(tipo)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of sizes) {
        const orig = sizeCounts[size] || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 2).final;
      }
      const filled = fillSizeGaps(sizes, rowOriginals, rowFinals);
      tipoPrendaFinalCounts.set(tipo, filled);
    }

    for (const tipo of tipos) {
      const filled = tipoPrendaFinalCounts.get(tipo)!;
      let rowTotal = 0;

      const tipoHeight = doc.heightOfString(tipo, {
        width: tipoPrendaColWidth - 4,
      });
      const dynamicRowHeight = Math.max(20, tipoHeight + 8);

      x = xStart;

      doc.rect(x, currentY, tipoPrendaColWidth, dynamicRowHeight).stroke();
      doc.text(tipo, x + 2, currentY + 4, {
        width: tipoPrendaColWidth - 4,
        align: 'center',
      });
      x += tipoPrendaColWidth;

      for (const size of sizes) {
        const finalCount = filled[size] || 0;
        rowTotal += finalCount;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(finalCount > 0 ? finalCount.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 20;
    x = xStart;

    doc.rect(x, currentY, tipoPrendaColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: tipoPrendaColWidth - 4,
      align: 'center',
    });
    x += tipoPrendaColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const filled = tipoPrendaFinalCounts.get(tipo)!;
        sizeTotal += filled[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
  }

  doc.end();
  return doc;
}

/**
 * PDF 4: Zapatos Distribution Report
 * Grouping: By codigo_ce, then by sexo
 * Dynamic size columns: 23–45
 */
export function generateZapatosPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 15, right: 15 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE ZAPATOS`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  const sizes: string[] = [];
  for (let i = 23; i <= 45; i++) {
    sizes.push(i.toString());
  }

  const xStart = 15;
  const availableWidth = doc.page.width - 30;
  const headerFontSize = 10;
  const bodyFontSize = 8;
  const schoolHeaderFontSize = 12;

  const sizeColWidth = 25;
  const totalColWidth = 40;
  const sexoColWidth = availableWidth - sizes.length * sizeColWidth - totalColWidth;
  const headerHeight = 26;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    if (s > 0) {
      doc.addPage();
    }

    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    const sexoMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const sexo = student.sexo || 'N/A';
      const size = student.zapato || 'N/A';

      if (!sexoMap.has(sexo)) {
        sexoMap.set(sexo, {});
      }
      const sizeCounts = sexoMap.get(sexo)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const sexos = Array.from(sexoMap.keys()).sort();

    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, sexoColWidth, headerHeight).stroke();
    doc.text('SEXO', x + 2, currentY + 8, {
      width: sexoColWidth - 4,
      align: 'center',
    });
    x += sexoColWidth;

    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    doc.font('Helvetica').fontSize(bodyFontSize);

    const sexoFinalCounts = new Map<string, Record<string, number>>();
    for (const sexo of sexos) {
      const sizeCounts = sexoMap.get(sexo)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of sizes) {
        const orig = sizeCounts[size] || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 1).final;
      }
      const filled = fillSizeGaps(sizes, rowOriginals, rowFinals);
      sexoFinalCounts.set(sexo, filled);
    }

    for (const sexo of sexos) {
      const filled = sexoFinalCounts.get(sexo)!;
      let rowTotal = 0;

      const sexoHeight = doc.heightOfString(sexo, {
        width: sexoColWidth - 4,
      });
      const dynamicRowHeight = Math.max(18, sexoHeight + 8);

      x = xStart;

      doc.rect(x, currentY, sexoColWidth, dynamicRowHeight).stroke();
      doc.text(sexo.toUpperCase(), x + 2, currentY + 4, {
        width: sexoColWidth - 4,
        align: 'center',
      });
      x += sexoColWidth;

      for (const size of sizes) {
        const finalCount = filled[size] || 0;
        rowTotal += finalCount;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(finalCount > 0 ? finalCount.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 18;
    x = xStart;

    doc.rect(x, currentY, sexoColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: sexoColWidth - 4,
      align: 'center',
    });
    x += sexoColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const sexo of sexos) {
        const filled = sexoFinalCounts.get(sexo)!;
        sizeTotal += filled[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
  }

  doc.end();
  return doc;
}

/**
 * PDF 7: Day Distribution Card – Zapatos
 * "FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)" with date in header
 */
export function generateDayZapatosPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'portrait',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  const title = `FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)`;
  const formattedDate = formatDateForTitle(fechaInicio);

  const schools = groupBySchool(students);

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    if (s > 0) {
      doc.addPage();
    }

    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(1);

    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`${school.nombre_ce.toUpperCase()}`, { align: 'center' });
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
    doc.fontSize(12).font('Helvetica-Bold').text(`FECHA: ${formattedDate}`, { align: 'center' });
    doc.moveDown(1);

    let currentY = doc.y;

    interface ItemCount {
      tipo_talla: string;
      cantidad: number;
    }

    const itemCounts: ItemCount[] = [];

    const shoeSizes: string[] = [];
    for (let i = 23; i <= 45; i++) {
      shoeSizes.push(i.toString());
    }

    const zapatoSexoMap = new Map<string, Map<string, number>>();
    for (const student of school.students) {
      const sexo = student.sexo;
      const size = student.zapato;
      if (sexo && size) {
        const sexoKey = sexo.toUpperCase();
        if (!zapatoSexoMap.has(sexoKey)) {
          zapatoSexoMap.set(sexoKey, new Map());
        }
        const sizeMap = zapatoSexoMap.get(sexoKey)!;
        sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
      }
    }

    const sexoTypes = Array.from(zapatoSexoMap.keys()).sort();
    for (const sexoKey of sexoTypes) {
      const sizeMap = zapatoSexoMap.get(sexoKey)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of shoeSizes) {
        const orig = sizeMap.get(size) || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 1).final;
      }
      const filled = fillSizeGaps(shoeSizes, rowOriginals, rowFinals);
      for (const size of shoeSizes) {
        const finalCount = filled[size] || 0;
        if (finalCount > 0) {
          itemCounts.push({ tipo_talla: `${sexoKey} - ${size}`, cantidad: finalCount });
        }
      }
    }

    const xStart = 40;
    const tipoTallaColWidth = 350;
    const cantidadColWidth = 100;
    const headerHeight = 25;
    const rowHeight = 20;

    doc.fontSize(11).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
    doc.text('TIPO/TALLA', x + 5, currentY + 7, {
      width: tipoTallaColWidth - 10,
      align: 'left',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
    doc.text('CANTIDAD', x + 5, currentY + 7, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += headerHeight;

    doc.font('Helvetica').fontSize(10);
    let totalPiezas = 0;

    for (const item of itemCounts) {
      x = xStart;

      doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
      doc.text(item.tipo_talla, x + 5, currentY + 5, {
        width: tipoTallaColWidth - 10,
        align: 'left',
      });
      x += tipoTallaColWidth;

      doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
      doc.text(item.cantidad.toString(), x + 5, currentY + 5, {
        width: cantidadColWidth - 10,
        align: 'center',
      });

      currentY += rowHeight;
      totalPiezas += item.cantidad;

      if (currentY > doc.page.height - 100) {
        doc.addPage();
        addLogoToPage(doc, doc.page.width);
        doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
        doc.moveDown(1);
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`${school.nombre_ce.toUpperCase()}`, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`FECHA: ${formattedDate}`, { align: 'center' });
        doc.moveDown(1);
        currentY = doc.y;
        doc.font('Helvetica').fontSize(10);
      }
    }

    currentY += 10;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
  }

  doc.end();
  return doc;
}

/**
 * PDF 8: Day Distribution Card – Uniformes
 * "FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)" with date in header
 */
export function generateDayUniformesPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'portrait',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  const title = `FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)`;
  const formattedDate = formatDateForTitle(fechaInicio);

  const schools = groupBySchool(students);

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    if (s > 0) {
      doc.addPage();
    }

    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(1);

    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`${school.nombre_ce.toUpperCase()}`, { align: 'center' });
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
    doc.fontSize(12).font('Helvetica-Bold').text(`FECHA: ${formattedDate}`, { align: 'center' });
    doc.moveDown(1);

    let currentY = doc.y;

    interface ItemCount {
      tipo_talla: string;
      cantidad: number;
    }

    const itemCounts: ItemCount[] = [];

    const camisaSizeOrder = [
      'T4',
      'T6',
      'T8',
      'T10',
      'T12',
      'T14',
      'T16',
      'T18',
      'T20',
      'T22',
      'T1X',
      'T2X',
    ];

    const camisaTipoMap = new Map<string, Map<string, number>>();
    for (const student of school.students) {
      const tipo = student.tipo_de_camisa;
      const size = student.camisa;
      if (tipo && size) {
        const tipoKey = `CAMISA ${tipo.toUpperCase()}`;
        if (!camisaTipoMap.has(tipoKey)) {
          camisaTipoMap.set(tipoKey, new Map());
        }
        const sizeMap = camisaTipoMap.get(tipoKey)!;
        sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
      }
    }

    const camisaTypes = Array.from(camisaTipoMap.keys()).sort();
    for (const tipoKey of camisaTypes) {
      const sizeMap = camisaTipoMap.get(tipoKey)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of camisaSizeOrder) {
        const orig = sizeMap.get(size) || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 2).final;
      }
      const filled = fillSizeGaps(camisaSizeOrder, rowOriginals, rowFinals);
      for (const size of camisaSizeOrder) {
        const finalCount = filled[size] || 0;
        if (finalCount > 0) {
          itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
        }
      }
    }

    const pantalonTipoMap = new Map<string, Map<string, number>>();
    for (const student of school.students) {
      const tipo = student.t_pantalon_falda_short;
      const size = student.pantalon_falda;
      if (tipo && size) {
        const tipoKey = tipo.toUpperCase();
        if (!pantalonTipoMap.has(tipoKey)) {
          pantalonTipoMap.set(tipoKey, new Map());
        }
        const sizeMap = pantalonTipoMap.get(tipoKey)!;
        sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
      }
    }

    const pantalonTypes = Array.from(pantalonTipoMap.keys()).sort();
    for (const tipoKey of pantalonTypes) {
      const sizeMap = pantalonTipoMap.get(tipoKey)!;
      const rowOriginals: Record<string, number> = {};
      const rowFinals: Record<string, number> = {};
      for (const size of camisaSizeOrder) {
        const orig = sizeMap.get(size) || 0;
        rowOriginals[size] = orig;
        rowFinals[size] = computeFinalCount(orig, 2).final;
      }
      const filled = fillSizeGaps(camisaSizeOrder, rowOriginals, rowFinals);
      for (const size of camisaSizeOrder) {
        const finalCount = filled[size] || 0;
        if (finalCount > 0) {
          itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
        }
      }
    }

    const xStart = 40;
    const tipoTallaColWidth = 350;
    const cantidadColWidth = 100;
    const headerHeight = 25;
    const rowHeight = 20;

    doc.fontSize(11).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
    doc.text('TIPO/TALLA', x + 5, currentY + 7, {
      width: tipoTallaColWidth - 10,
      align: 'left',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
    doc.text('CANTIDAD', x + 5, currentY + 7, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += headerHeight;

    doc.font('Helvetica').fontSize(10);
    let totalPiezas = 0;

    for (const item of itemCounts) {
      x = xStart;

      doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
      doc.text(item.tipo_talla, x + 5, currentY + 5, {
        width: tipoTallaColWidth - 10,
        align: 'left',
      });
      x += tipoTallaColWidth;

      doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
      doc.text(item.cantidad.toString(), x + 5, currentY + 5, {
        width: cantidadColWidth - 10,
        align: 'center',
      });

      currentY += rowHeight;
      totalPiezas += item.cantidad;

      if (currentY > doc.page.height - 100) {
        doc.addPage();
        addLogoToPage(doc, doc.page.width);
        doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
        doc.moveDown(1);
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`${school.nombre_ce.toUpperCase()}`, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`FECHA: ${formattedDate}`, { align: 'center' });
        doc.moveDown(1);
        currentY = doc.y;
        doc.font('Helvetica').fontSize(10);
      }
    }

    currentY += 10;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
  }

  doc.end();
  return doc;
}

/**
 * Legacy function – kept for backwards compatibility
 * @deprecated Use generateFichaUniformesPDF or generateFichaZapatosPDF instead
 */
export function generateFichaPDF(options: AgreementReportOptions): PDFDocumentInstance {
  return generateFichaUniformesPDF(options);
}
