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
  AGREEMENT_HORA_LINE,
  ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
  ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
  CAJAS_PAGE_OPTIONS,
  FICHA_UNIFORMES_PAGE_OPTIONS,
  FICHA_ZAPATOS_PAGE_OPTIONS,
  drawFechaDespachoEntregaLine,
  formatDateForTitle,
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

/** Group flat DemandRow[] into SchoolDemandGroup[] sorted by distrito asc, then total demand desc */
function groupDemandBySchool(rows: DemandRow[]): SchoolDemandGroup[] {
  const map = new Map<string, SchoolDemandGroup>();

  for (const row of rows) {
    if (!map.has(row.school_codigo_ce)) {
      map.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
        nombre_ce: row.nombre_ce,
        departamento: row.departamento,
        distrito: row.distrito,
        zona: row.zona,
        transporte: row.transporte,
        fecha_inicio: row.fecha_inicio,
        rows: [],
      });
    }
    map.get(row.school_codigo_ce)!.rows.push(row);
  }

  return Array.from(map.values()).sort((a, b) => {
    const districtCompare = a.distrito.localeCompare(b.distrito, 'es');
    if (districtCompare !== 0) return districtCompare;
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
  doc.text('Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________', xStart);
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

  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`, { align: 'center' });

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

  const title = 'ACTA DE RECEPCIÓN (CAJAS) FALTANTES';
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

  const title = 'ACTA DE RECEPCIÓN (UNIFORMES) FALTANTES';
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
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(
          `DEPARTAMENTO: ${(school.departamento || 'N/A').toUpperCase()} - DISTRITO: ${(school.distrito || 'N/A').toUpperCase()}`,
          { align: 'center' }
        );
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

  const title = 'ACTA DE RECEPCIÓN (ZAPATOS) FALTANTES';
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

// ─────────────────────────────────────────────────────────────────────────────
// Comanda helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Draw comanda title + school header (with ZONA, TRANSPORTE, Fecha, Hora lines) */
function drawComandaTitleAndSchoolHeader(
  doc: PDFDocumentInstance,
  title: string,
  school: SchoolDemandGroup
): void {
  addLogoToPage(doc, doc.page.width);

  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });

  // Fecha de despacho / Fecha entrega C.E. (date value rendered bold+underlined)
  const formattedDate = formatDateForTitle(school.fecha_inicio);
  drawFechaDespachoEntregaLine(doc, formattedDate);
  doc.moveDown(2);

  // School header
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`, { align: 'center' });

  const zona = (school.zona || 'N/A').toUpperCase();
  const transporte = (school.transporte || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`ZONA: ${zona} - TIPO DE VEHICULO: ${transporte}`, { align: 'center' });

  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica')
    .text(AGREEMENT_HORA_LINE, { align: 'center' });

  doc.moveDown(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Cajas PDF (landscape)
// ─────────────────────────────────────────────────────────────────────────────

function renderComandaCajasSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(CAJAS_PAGE_OPTIONS);
  }

  const title = 'DETALLE DE PROGRAMACIÓN DE CAJAS FALTANTES';
  drawComandaTitleAndSchoolHeader(doc, title, school);

  // Filter rows for CAJAS
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  let currentY = doc.y;

  // Table layout (landscape: 792pt - 60pt margins = 732pt)
  const colWidths = [80, 440, 212];
  const colHeaders = ['NO', 'GRADO', 'CANTIDAD'];
  const headerHeight = 30;
  const pageBottomMargin = 40;

  const drawTableHeader = (yPos: number): number => {
    doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
    let x = 30;
    for (let i = 0; i < colHeaders.length; i++) {
      doc.rect(x, yPos, colWidths[i], headerHeight).stroke();
      doc.text(colHeaders[i], x + 4, yPos + 8, {
        width: colWidths[i] - 8,
        align: 'center',
      });
      x += colWidths[i];
    }
    return yPos + headerHeight;
  };

  const drawContinuationHeader = (): void => {
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
    doc
      .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
      .font('Helvetica-Bold')
      .text(school.nombre_ce.toUpperCase(), { align: 'center' });
    doc
      .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
      .font('Helvetica-Bold')
      .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
    doc.moveDown(1);
  };

  const checkPageBreak = (requiredHeight: number): number => {
    const pageHeight = doc.page.height;
    if (currentY + requiredHeight > pageHeight - pageBottomMargin) {
      doc.addPage(CAJAS_PAGE_OPTIONS);
      drawContinuationHeader();
      currentY = doc.y;
      currentY = drawTableHeader(currentY);
    }
    return currentY;
  };

  // Draw initial table header
  currentY = drawTableHeader(currentY);

  // Draw grade rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
  let rowIndex = 1;
  let totalCantidad = 0;

  for (const row of cajasRows) {
    const textPadding = 8;
    const gradeTextHeight = doc.heightOfString(row.categoria, { width: colWidths[1] - 8 });
    const rowHeight = Math.max(30, gradeTextHeight + textPadding * 2);

    currentY = checkPageBreak(rowHeight);

    let x = 30;
    const rowData = [rowIndex.toString(), row.categoria, row.cantidad.toString()];

    for (let i = 0; i < rowData.length; i++) {
      doc.rect(x, currentY, colWidths[i], rowHeight).stroke();
      const cellTextHeight = doc.heightOfString(rowData[i], { width: colWidths[i] - 8 });
      const textY = currentY + (rowHeight - cellTextHeight) / 2;
      doc.text(rowData[i], x + 4, textY, {
        width: colWidths[i] - 8,
        align: 'center',
      });
      x += colWidths[i];
    }
    currentY += rowHeight;
    totalCantidad += row.cantidad;
    rowIndex++;
  }

  // Subtotal row
  const summaryRowHeight = 30;
  currentY = checkPageBreak(summaryRowHeight);

  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  let x = 30;
  const summaryData = ['', 'SUBTOTAL', totalCantidad.toString()];

  for (let i = 0; i < summaryData.length; i++) {
    doc.rect(x, currentY, colWidths[i], summaryRowHeight).stroke();
    doc.text(summaryData[i], x + 4, currentY + 8, {
      width: colWidths[i] - 8,
      align: 'center',
    });
    x += colWidths[i];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Uniformes PDF (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function renderComandaUniformesSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES) FALTANTES';
  drawComandaTitleAndSchoolHeader(doc, title, school);

  // Filter rows for UNIFORMES
  const uniformeRows = school.rows
    .filter(r => r.item === 'UNIFORMES')
    .sort((a, b) => {
      const tipoCompare = a.tipo.localeCompare(b.tipo);
      if (tipoCompare !== 0) return tipoCompare;
      return a.categoria.localeCompare(b.categoria);
    });

  let currentY = doc.y;

  // Table layout
  const xStart = 40;
  const cantidadColWidth = 100;
  const tipoTallaColWidth = doc.page.width - 80 - cantidadColWidth;
  const headerHeight = 25;
  const rowHeight = 20;

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
  doc.text('TIPO/TALLA', x + 5, currentY + 7, {
    width: tipoTallaColWidth - 10,
    align: 'center',
  });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 5, currentY + 7, {
    width: cantidadColWidth - 10,
    align: 'center',
  });

  currentY += headerHeight;

  // Data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
  let totalPiezas = 0;

  for (const row of uniformeRows) {
    // Handle page overflow
    if (currentY > doc.page.height - 100) {
      doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);
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
      currentY = doc.y;
      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    const label = `${row.tipo} - ${row.categoria}`;
    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
    doc.text(label, x + 5, currentY + 5, {
      width: tipoTallaColWidth - 10,
      align: 'center',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 5, currentY + 5, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += rowHeight;
    totalPiezas += row.cantidad;
  }

  // Footer with total
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Zapatos PDF (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function renderComandaZapatosSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean
): void {
  if (addPage) {
    doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS) FALTANTES';
  drawComandaTitleAndSchoolHeader(doc, title, school);

  // Filter rows for ZAPATOS
  const zapatosRows = school.rows
    .filter(r => r.item === 'ZAPATOS')
    .sort((a, b) => {
      const numA = parseInt(a.categoria, 10) || 0;
      const numB = parseInt(b.categoria, 10) || 0;
      return numA - numB;
    });

  let currentY = doc.y;

  // Table layout
  const xStart = 40;
  const cantidadColWidth = 100;
  const tallaColWidth = doc.page.width - 80 - cantidadColWidth;
  const headerHeight = 25;
  const rowHeight = 20;

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tallaColWidth, headerHeight).stroke();
  doc.text('TALLA', x + 5, currentY + 7, {
    width: tallaColWidth - 10,
    align: 'center',
  });
  x += tallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 5, currentY + 7, {
    width: cantidadColWidth - 10,
    align: 'center',
  });

  currentY += headerHeight;

  // Data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
  let totalPiezas = 0;

  for (const row of zapatosRows) {
    // Handle page overflow
    if (currentY > doc.page.height - 100) {
      doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);
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
      currentY = doc.y;
      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    x = xStart;

    doc.rect(x, currentY, tallaColWidth, rowHeight).stroke();
    doc.text(row.categoria, x + 5, currentY + 5, {
      width: tallaColWidth - 10,
      align: 'center',
    });
    x += tallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 5, currentY + 5, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += rowHeight;
    totalPiezas += row.cantidad;
  }

  // Footer with total
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public comanda generator functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate Comanda de Cajas PDF from demand data.
 * Landscape layout, one page per school, sorted by total descending.
 */
export function generateComandaCajasPDFFromDemand(demandRows: DemandRow[]): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'CAJAS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...CAJAS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderComandaCajasSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

/**
 * Generate Comanda de Uniformes PDF from demand data.
 * Portrait layout, one section per school, sorted by total descending.
 */
export function generateComandaUniformesPDFFromDemand(
  demandRows: DemandRow[]
): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'UNIFORMES').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...FICHA_UNIFORMES_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderComandaUniformesSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

/**
 * Generate Comanda de Zapatos PDF from demand data.
 * Portrait layout, one page per school, sorted by total descending.
 */
export function generateComandaZapatosPDFFromDemand(demandRows: DemandRow[]): PDFDocumentInstance {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'ZAPATOS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...FICHA_ZAPATOS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderComandaZapatosSchool(doc, schools[i], i > 0);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}
