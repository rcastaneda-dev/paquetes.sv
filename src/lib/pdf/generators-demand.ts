/**
 * Demand-based PDF generators for Acta de Recepción reports.
 *
 * These generators read pre-computed quantities from school_demand (no vacíos
 * calculations). They replicate the exact visual layout of the existing
 * Acta de Recepción renderers in agreement/sections.ts.
 */
import PDFDocument from 'pdfkit';
import type { DemandRow, ItemType, SchoolDemandGroup } from '@/types/database';
import type { PDFDocumentInstance } from './agreement/types';
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
  drawTransportFooter,
  formatDateForTitle,
} from './agreement/sections';
import { groupAndSortDemandBySchool } from '@/lib/reports/demand-aggregation';
import { buildInternalRefCode } from '../word/generators-demand';

// Page options for Cajas — same as other acta portrait layouts
const ACTA_RECEPCION_CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 30, left: 30, right: 30 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Referencia overlay helpers (mirrors stampPageOverlays in agreement/builders.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamp referencia codes (top-right) and page numbers (bottom-center)
 * on every buffered page using switchToPage.
 */
function stampDemandOverlays(
  doc: PDFDocumentInstance,
  referenciaCodes: string[],
  internalRefCodes: string[] = []
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const idx = i - range.start;

    // Referencia code — top-right
    const code = referenciaCodes[idx];
    if (code) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
      doc.text(code, doc.page.width - 100, 20, { lineBreak: false, align: 'right' });
    }

    // Internal ref code — top-center
    if (internalRefCodes.length > 0) {
      const internalRefCode = internalRefCodes[idx] ?? '';
      if (internalRefCode) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
        const tw = doc.widthOfString(internalRefCode);
        doc.text(internalRefCode, (doc.page.width - tw) / 2, 20, {
          lineBreak: false,
          align: 'center',
        });
      }
    }

    // Page number — bottom-center
    const pageNum = `${idx + 1}`;
    doc.fontSize(8).font('Helvetica').fillColor('black');
    const tw = doc.widthOfString(pageNum);
    doc.text(pageNum, (doc.page.width - tw) / 2, doc.page.height - 20, { lineBreak: false });
  }
}

/** Get the referencia code for a school+item combination */
function getSchoolReferencia(school: SchoolDemandGroup, itemType: ItemType): string {
  const row = school.rows.find(r => r.item === itemType && r.referencia);
  return row?.referencia ?? '';
}

/** Draw the pre-table fields: DATOS DE LOS PRODUCTOS (Fecha, Hora, Bodega) */
function drawPreTableFields(doc: PDFDocumentInstance, xStart: number): void {
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('DATOS DE LOS PRODUCTOS', xStart, doc.y, { align: 'left' });
  doc.moveDown(0.5);

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text(
    'Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________',
    xStart
  );
  doc.moveDown(1);
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
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
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
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_CAJAS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (CAJAS)' + (faltantes ? ' FALTANTES' : '');
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
  const headerHeight = 18;
  const rowHeight = 12;

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
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (UNIFORMES)' + (faltantes ? ' FALTANTES' : '');
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
  const headerHeight = 16;
  const rowHeight = 10;

  const totalCantidad = uniformeRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
  doc.text('TIPO/TALLA', x + 2, currentY + 4, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 4, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 4, {
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
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
        .font('Helvetica-Bold')
        .text(school.nombre_ce.toUpperCase(), { align: 'center' });
      doc
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
        .font('Helvetica-Bold')
        .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
      doc
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
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
      doc.text('TIPO/TALLA', x + 2, currentY + 4, {
        width: tipoTallaColWidth - 4,
        align: 'center',
      });
      x += tipoTallaColWidth;
      doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
      doc.text('CANTIDAD', x + 2, currentY + 4, {
        width: cantidadColWidth - 4,
        align: 'center',
      });
      x += cantidadColWidth;
      doc.rect(x, currentY, comentariosColWidth, headerHeight).stroke();
      doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 4, {
        width: comentariosColWidth - 4,
        align: 'center',
      });
      currentY += headerHeight;

      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    const label = `${row.tipo} - ${row.categoria}`;
    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
    doc.text(label, x + 2, currentY + 1, { width: tipoTallaColWidth - 4, align: 'center' });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 1, {
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
  doc.text('TOTAL', x + 2, currentY + 1, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 1, {
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
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (ZAPATOS)' + (faltantes ? ' FALTANTES' : '');
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
  const headerHeight = 18;
  const rowHeight = 12;

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
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'CAJAS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_CAJAS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderActaCajasSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'CAJAS');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);

  doc.end();
  return doc;
}

/**
 * Generate Acta de Recepción (UNIFORMES) PDF from demand data.
 * One section per school, sorted by total descending.
 */
export function generateActaRecepcionUniformesPDFFromDemand(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'UNIFORMES').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderActaUniformesSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'UNIFORMES');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);

  doc.end();
  return doc;
}

/**
 * Generate Acta de Recepción (ZAPATOS) PDF from demand data.
 * One page per school, sorted by total descending.
 */
export function generateActaRecepcionZapatosPDFFromDemand(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'ZAPATOS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderActaZapatosSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'ZAPATOS');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);

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
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`, { align: 'center' });

  const zona = (school.zona || 'N/A').toUpperCase();
  const transporte = (school.transporte || 'N/A').toUpperCase();
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`ZONA: ${zona} - TIPO DE VEHICULO: ${transporte}`, { align: 'center' });

  doc
    .fontSize(AGREEMENT_FONT.COLUMN_HEADER)
    .font('Helvetica')
    .text(AGREEMENT_HORA_LINE, { align: 'center' });

  doc.moveDown(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Cajas PDF (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function renderComandaCajasSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(CAJAS_PAGE_OPTIONS);
  }

  const title = 'DETALLE DE PROGRAMACIÓN DE CAJAS' + (faltantes ? ' FALTANTES' : '');
  drawComandaTitleAndSchoolHeader(doc, title, school);

  // Filter rows for CAJAS
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  let currentY = doc.y;

  // Table layout (portrait: 612pt - 80pt margins = 532pt)
  const colWidths = [60, 320, 152];
  const colHeaders = ['NO', 'GRADO', 'CANTIDAD'];
  const headerHeight = 30;
  const pageBottomMargin = 40;

  const drawTableHeader = (yPos: number): number => {
    doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
    let x = 40;
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
      .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
      .font('Helvetica-Bold')
      .text(school.nombre_ce.toUpperCase(), { align: 'center' });
    doc
      .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
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

    let x = 40;
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
  let x = 40;
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
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)' + (faltantes ? ' FALTANTES' : '');
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
  const headerHeight = 17;
  const rowHeight = 11;

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
  doc.text('TIPO/TALLA', x + 5, currentY + 4, {
    width: tipoTallaColWidth - 10,
    align: 'center',
  });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
  doc.text('CANTIDAD', x + 5, currentY + 4, {
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
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
        .font('Helvetica-Bold')
        .text(school.nombre_ce.toUpperCase(), { align: 'center' });
      doc
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
        .font('Helvetica-Bold')
        .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    const label = `${row.tipo} - ${row.categoria}`;
    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
    doc.text(label, x + 5, currentY + 1, {
      width: tipoTallaColWidth - 10,
      align: 'center',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 5, currentY + 1, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += rowHeight;
    totalPiezas += row.cantidad;
  }

  // Footer with total
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SCHOOL_HEADER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Zapatos PDF (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function renderComandaZapatosSchool(
  doc: PDFDocumentInstance,
  school: SchoolDemandGroup,
  addPage: boolean,
  faltantes: boolean
): void {
  if (addPage) {
    doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)' + (faltantes ? ' FALTANTES' : '');
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
  const headerHeight = 22;
  const rowHeight = 18;

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
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
        .font('Helvetica-Bold')
        .text(school.nombre_ce.toUpperCase(), { align: 'center' });
      doc
        .fontSize(AGREEMENT_FONT.SCHOOL_HEADER)
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
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SCHOOL_HEADER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public comanda generator functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate Comanda de Cajas PDF from demand data.
 * Portrait layout, one page per school, sorted by total descending.
 */
export function generateComandaCajasPDFFromDemand(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'CAJAS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...CAJAS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderComandaCajasSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'CAJAS');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);
  doc.end();
  return doc;
}

/**
 * Generate Comanda de Uniformes PDF from demand data.
 * Portrait layout, one section per school, sorted by total descending.
 */
export function generateComandaUniformesPDFFromDemand(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'UNIFORMES').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...FICHA_UNIFORMES_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderComandaUniformesSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'UNIFORMES');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);
  doc.end();
  return doc;
}

/**
 * Generate Comanda de Zapatos PDF from demand data.
 * Portrait layout, one page per school, sorted by total descending.
 */
export function generateComandaZapatosPDFFromDemand(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): PDFDocumentInstance {
  const isFaltantes = options?.faltantes ?? true;
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === 'ZAPATOS').reduce((sum, r) => sum + r.cantidad, 0) > 0
  );
  const doc = new PDFDocument({
    ...FICHA_ZAPATOS_PAGE_OPTIONS,
    bufferPages: true,
  }) as PDFDocumentInstance;

  const referenciaCodes: string[] = [];
  const internalRefCodes: string[] = [];
  for (let i = 0; i < schools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;
    renderComandaZapatosSchool(doc, schools[i], i > 0, isFaltantes);
    const pagesAfter = doc.bufferedPageRange().count;
    const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
    const code = getSchoolReferencia(schools[i], 'ZAPATOS');
    const internalCode = buildInternalRefCode(schools[i]);
    for (let p = 0; p < pagesForSchool; p++) {
      referenciaCodes.push(code);
      internalRefCodes.push(internalCode);
    }
  }

  stampDemandOverlays(doc, referenciaCodes, isFaltantes ? internalRefCodes : undefined);
  doc.end();
  return doc;
}
