/**
 * Demand-based PDF generators for Acta de Recepción reports.
 *
 * These generators read pre-computed quantities from school_demand (no vacíos
 * calculations). They replicate the exact visual layout of the existing
 * Acta de Recepción renderers in agreement/sections.ts.
 */
import PDFDocument from 'pdfkit';
import type { DemandRow, SchoolDemandGroup } from '@/types/database';
import type { PDFDocumentInstance } from './agreement/types';
import { addPageNumbers } from './page-numbers';
import {
  addLogoToPage,
  AGREEMENT_FONT,
  ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
  ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
} from './agreement/sections';

// Page options for Cajas — same as other acta portrait layouts
const ACTA_RECEPCION_CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Group flat DemandRow[] into SchoolDemandGroup[] sorted by total descending */
function groupDemandBySchool(rows: DemandRow[]): SchoolDemandGroup[] {
  const map = new Map<string, SchoolDemandGroup>();

  for (const row of rows) {
    if (!map.has(row.school_codigo_ce)) {
      map.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
        nombre_ce: row.nombre_ce,
        rows: [],
      });
    }
    map.get(row.school_codigo_ce)!.rows.push(row);
  }

  return Array.from(map.values()).sort((a, b) => {
    const totalA = a.rows.reduce((s, r) => s + r.cantidad, 0);
    const totalB = b.rows.reduce((s, r) => s + r.cantidad, 0);
    return totalB - totalA;
  });
}

/** Draw the pre-table fields: DATOS DE LOS PRODUCTOS (Fecha, Hora, Bodega) */
function drawPreTableFields(doc: PDFDocumentInstance, xStart: number): void {
  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DE LOS PRODUCTOS', xStart, doc.y, { align: 'left' });
  doc.moveDown(0.5);

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text('Fecha: ________________________________', xStart);
  doc.moveDown(0.3);
  doc.text('Hora: ________________________________', xStart);
  doc.moveDown(0.3);
  doc.text('Bodega: ________________________________', xStart);
  doc.moveDown(1);
}

/** Draw the transport/signature footer */
function drawTransportFooter(doc: PDFDocumentInstance, xStart: number): void {
  const footerLeftX = xStart;

  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DEL TRANSPORTE', footerLeftX, doc.y, { align: 'left' });
  const footerStartY = doc.y + 6;

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text('Nombre del conductor: ________________________________', footerLeftX, footerStartY);
  doc.text('Número de placa: ________________________________', footerLeftX, doc.y + 5);
  doc.text('Número de contacto: ________________________________', footerLeftX, doc.y + 5);
  doc.text('Firma del conductor: ________________________________', footerLeftX, doc.y + 5);
  doc.text(
    'Firma y Nombre del Encargado del Despacho: ________________________________',
    footerLeftX,
    doc.y + 5
  );
  doc.text(
    'Firma y Nombre del Encargado del Centro Educativo: ________________________________',
    footerLeftX,
    doc.y + 5
  );
}

/** Draw title + school header (centered) */
function drawTitleAndSchoolHeader(
  doc: PDFDocumentInstance,
  title: string,
  school: SchoolDemandGroup
): void {
  addLogoToPage(doc, doc.page.width);

  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(1);

  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  doc.moveDown(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cajas PDF
// ─────────────────────────────────────────────────────────────────────────────

function renderActaCajasSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_CAJAS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (CAJAS)';
  drawTitleAndSchoolHeader(doc, title, school);

  const xStart = 40;
  drawPreTableFields(doc, xStart);

  // Filter rows for CAJAS
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  // Table layout
  let currentY = doc.y;
  const gradoColWidth = 200;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - gradoColWidth - cantidadColWidth;
  const headerHeight = 20;
  const rowHeight = 14;

  const totalCantidad = cajasRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, gradoColWidth, headerHeight).stroke();
  doc.text('GRADO', x + 2, currentY + 5, { width: gradoColWidth - 4, align: 'center' });
  x += gradoColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += headerHeight;

  // Data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of cajasRows) {
    x = xStart;

    doc.rect(x, currentY, gradoColWidth, rowHeight).stroke();
    doc.text(row.categoria, x + 2, currentY + 2, { width: gradoColWidth - 4, align: 'center' });
    x += gradoColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
    currentY += rowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = xStart;

  doc.rect(x, currentY, gradoColWidth, rowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: gradoColWidth - 4, align: 'center' });
  x += gradoColWidth;

  doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
  currentY += rowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, xStart);
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniformes PDF
// ─────────────────────────────────────────────────────────────────────────────

function renderActaUniformesSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (UNIFORMES)';
  drawTitleAndSchoolHeader(doc, title, school);

  const xStart = 30;
  drawPreTableFields(doc, xStart);

  // Filter rows for UNIFORMES — format as "TIPO - CATEGORIA"
  const uniformeRows = school.rows
    .filter(r => r.item === 'UNIFORMES')
    .sort((a, b) => {
      const tipoCompare = a.tipo.localeCompare(b.tipo);
      if (tipoCompare !== 0) return tipoCompare;
      return a.categoria.localeCompare(b.categoria);
    });

  // Table layout
  let currentY = doc.y;
  const tipoTallaColWidth = 200;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - tipoTallaColWidth - cantidadColWidth;
  const headerHeight = 20;
  const rowHeight = 14;

  const totalCantidad = uniformeRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
  doc.text('TIPO/TALLA', x + 2, currentY + 5, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += headerHeight;

  // Data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of uniformeRows) {
    // Handle page overflow
    if (currentY > doc.page.height - 120) {
      doc.addPage(ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS);
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(school.nombre_ce.toUpperCase(), { align: 'center' });
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;

      // Redraw table header on new page
      doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
      x = xStart;
      doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
      doc.text('TIPO/TALLA', x + 2, currentY + 5, {
        width: tipoTallaColWidth - 4,
        align: 'center',
      });
      x += tipoTallaColWidth;
      doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
      doc.text('CANTIDAD', x + 2, currentY + 5, {
        width: cantidadColWidth - 4,
        align: 'center',
      });
      x += cantidadColWidth;
      doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
      doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
        width: comentariosColWidth - 4,
        align: 'center',
      });
      currentY += headerHeight;

      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    const label = `${row.tipo} - ${row.categoria}`;
    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
    doc.text(label, x + 2, currentY + 2, { width: tipoTallaColWidth - 4, align: 'center' });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
    currentY += rowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
  currentY += rowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, xStart);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zapatos PDF
// ─────────────────────────────────────────────────────────────────────────────

function renderActaZapatosSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (ZAPATOS)';
  drawTitleAndSchoolHeader(doc, title, school);

  const xStart = 40;
  drawPreTableFields(doc, xStart);

  // Filter rows for ZAPATOS
  const zapatosRows = school.rows
    .filter(r => r.item === 'ZAPATOS')
    .sort((a, b) => {
      const numA = parseInt(a.categoria, 10) || 0;
      const numB = parseInt(b.categoria, 10) || 0;
      return numA - numB;
    });

  // Table layout
  let currentY = doc.y;
  const tallaColWidth = 60;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - tallaColWidth - cantidadColWidth;
  const headerHeight = 20;
  const rowHeight = 14;

  const totalCantidad = zapatosRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tallaColWidth, headerHeight).stroke();
  doc.text('TALLA', x + 2, currentY + 5, { width: tallaColWidth - 4, align: 'center' });
  x += tallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += headerHeight;

  // Data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of zapatosRows) {
    x = xStart;

    doc.rect(x, currentY, tallaColWidth, rowHeight).stroke();
    doc.text(row.categoria, x + 2, currentY + 2, { width: tallaColWidth - 4, align: 'center' });
    x += tallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
    currentY += rowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = xStart;

  doc.rect(x, currentY, tallaColWidth, rowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: tallaColWidth - 4, align: 'center' });
  x += tallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, rowHeight).stroke();
  currentY += rowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, xStart);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public generator functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate Acta de Recepción (CAJAS) PDF from demand data.
 * One page per school, sorted by total descending.
 */
export function generateActaRecepcionCajasPDFFromDemand(
  demandRows: DemandRow[]
): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'CAJAS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_CAJAS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderActaCajasSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

/**
 * Generate Acta de Recepción (UNIFORMES) PDF from demand data.
 * One section per school, sorted by total descending.
 */
export function generateActaRecepcionUniformesPDFFromDemand(
  demandRows: DemandRow[]
): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'UNIFORMES').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderActaUniformesSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

/**
 * Generate Acta de Recepción (ZAPATOS) PDF from demand data.
 * One page per school, sorted by total descending.
 */
export function generateActaRecepcionZapatosPDFFromDemand(
  demandRows: DemandRow[]
): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'ZAPATOS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderActaZapatosSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}
