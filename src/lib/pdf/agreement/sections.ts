/**
 * Per-school section renderers for agreement reports.
 *
 * Each renderer draws a single school's section into an existing PDFDocument.
 * They are composable: the consolidated builder calls one renderer per school,
 * while the school-bundle builder calls all three renderers for one school.
 */
import fs from 'fs';
import path from 'path';
import {
  computeFinalCount,
  getRestrictedSizeOrder,
  computeClothingExtra,
} from '@/lib/reports/vacios';
import type { StudentQueryRow } from '@/types/database';
import type { PDFDocumentInstance, SchoolGroup, SectionRenderContext } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Standard font sizes (used across all agreement PDFs for consistency)
// ─────────────────────────────────────────────────────────────────────────────

export const AGREEMENT_FONT = {
  /** Main report title (e.g. "DETALLE DE PROGRAMACIÓN DE CAJAS") */
  TITLE: 12,
  /** Subtitle, date, school block, footer (e.g. "TOTAL PIEZAS") */
  SUBTITLE_SCHOOL_FOOTER: 10,
  /** Table column headers (e.g. "TIPO", "CANTIDAD", "TALLA") */
  COLUMN_HEADER: 9,
  /** Table body and data rows */
  BODY: 8,
} as const;

/** Line below school header for manual fill-in of start/end time when printed */
export const AGREEMENT_HORA_LINE =
  'HORA DE INICIO:  ___________________ HORA DE FINALIZACION: ___________________';

/** Label for the date line (non-bold); value is drawn bold+underlined after it. */
const FECHA_DESPACHO_ENTREGA_LABEL = 'Fecha de despacho: ___________________  Fecha entrega C.E.: ';

/**
 * Draw the "Fecha de despacho / Fecha entrega C.E." line with correct spacing.
 * Labels are regular weight; the date value is bold and underlined.
 * Uses measured widths and explicit x so the date does not overlap the label.
 */
export function drawFechaDespachoEntregaLine(
  doc: PDFDocumentInstance,
  formattedDate: string
): void {
  const fontSize = AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER;
  doc.fontSize(fontSize).font('Helvetica');
  const labelWidth = doc.widthOfString(FECHA_DESPACHO_ENTREGA_LABEL);
  doc.font('Helvetica-Bold');
  const valueText = ` ${formattedDate}`;
  const valueWidth = doc.widthOfString(valueText);
  const totalWidth = labelWidth + valueWidth;
  const startX = (doc.page.width - totalWidth) / 2;
  doc.x = startX;
  doc.fontSize(fontSize).font('Helvetica').text(FECHA_DESPACHO_ENTREGA_LABEL, {
    continued: true,
  });
  doc.font('Helvetica-Bold').text(valueText, { underline: true });
  doc.x = doc.page.margins?.left ?? 72;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page options per section type (used by addPage and document creation)
// ─────────────────────────────────────────────────────────────────────────────

export const CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

export const FICHA_UNIFORMES_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

export const FICHA_ZAPATOS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

export const ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
};

export const ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
};

export const ACTA_RECEPCION_CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (relocated from generators-agreement.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Add GOES logo to the top-right corner of the current page */
export function addLogoToPage(doc: PDFDocumentInstance, pageWidth: number): void {
  const logoPath = path.join(process.cwd(), 'public', 'goes_logo_2.png');

  if (fs.existsSync(logoPath)) {
    const savedY = doc.y;

    const logoWidth = 50;
    const logoHeight = 50;
    const rightMargin = 40;
    const topMargin = 20;
    const logoX = pageWidth - logoWidth - rightMargin;
    const logoY = topMargin;

    doc.image(logoPath, logoX, logoY, {
      width: logoWidth,
      height: logoHeight,
      fit: [logoWidth, logoHeight],
      align: 'center',
      valign: 'center',
    });

    doc.y = savedY;
  }
}

/** Format YYYY-MM-DD → DD-MM-YYYY for display in titles */
export function formatDateForTitle(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

/** Group students by school (codigo_ce) sorted by code */
export function groupBySchool(students: StudentQueryRow[]): SchoolGroup[] {
  const schoolMap = new Map<string, SchoolGroup>();

  for (const student of students) {
    const key = student.school_codigo_ce;
    if (!schoolMap.has(key)) {
      schoolMap.set(key, {
        codigo_ce: student.school_codigo_ce,
        nombre_ce: student.nombre_ce,
        departamento: student.departamento,
        municipio: student.municipio,
        distrito: student.distrito,
        zona: student.zona,
        transporte: student.transporte,
        students: [],
      });
    }
    schoolMap.get(key)!.students.push(student);
  }

  return Array.from(schoolMap.values()).sort((a, b) => a.codigo_ce.localeCompare(b.codigo_ce));
}

/** Draw per-school header block with school name, CODIGO, DEPTO, DIST, ZONA */
export interface SchoolHeaderBlockOptions {
  doc: PDFDocumentInstance;
  xStart: number;
  yStart: number;
  availableWidth: number;
  school: SchoolGroup;
  fontSize: number;
}

export function drawSchoolHeaderBlock(options: SchoolHeaderBlockOptions): number {
  const { doc, school, fontSize } = options;

  doc
    .fontSize(fontSize)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });

  doc
    .fontSize(fontSize)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  doc
    .fontSize(fontSize)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`, { align: 'center' });

  const zona = (school.zona || 'N/A').toUpperCase();
  const transporte = (school.transporte || 'N/A').toUpperCase();
  doc
    .fontSize(fontSize)
    .font('Helvetica-Bold')
    .text(`ZONA: ${zona} - TIPO DE VEHICULO: ${transporte}`, { align: 'center' });

  doc.fontSize(fontSize).font('Helvetica').text(AGREEMENT_HORA_LINE, { align: 'center' });

  return doc.y + 8;
}

/** Draw two-column transport/signature footer with extra interline spacing */
export function drawTransportFooter(doc: PDFDocumentInstance, xStart: number): void {
  const rightMargin = doc.page.margins?.right ?? xStart;
  const availableWidth = doc.page.width - xStart - rightMargin;
  const colGap = 20;
  const colWidth = (availableWidth - colGap) / 2;
  const leftX = xStart;
  const rightX = xStart + colWidth + colGap;
  const lineSpacing = 25;

  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DEL TRANSPORTE', leftX, doc.y, { align: 'left' });
  let currentY = doc.y + 10;

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  const underscoreW = doc.widthOfString('_');

  const rows: [string, string][] = [
    ['Motorista: ', 'Encargado del Despacho: '],
    ['Placa: ', 'Firma del Encargado: '],
    ['Telefono: ', 'Encargado del C.E.: '],
    ['Firma Motorista: ', 'Firma: '],
  ];

  for (const [leftLabel, rightLabel] of rows) {
    const leftFill = Math.floor((colWidth - doc.widthOfString(leftLabel)) / underscoreW);
    const rightFill = Math.floor((colWidth - doc.widthOfString(rightLabel)) / underscoreW);

    doc.text(leftLabel + '_'.repeat(Math.max(0, leftFill)), leftX, currentY, {
      width: colWidth,
      lineBreak: false,
    });
    doc.text(rightLabel + '_'.repeat(Math.max(0, rightFill)), rightX, currentY, {
      width: colWidth,
      lineBreak: false,
    });
    currentY += lineSpacing;
  }

  doc.y = currentY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the "DETALLE DE PROGRAMACIÓN DE CAJAS" section for a single school.
 * Layout: LETTER portrait.
 */
export function renderCajasSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(CAJAS_PAGE_OPTIONS);
  }

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = 'DETALLE DE PROGRAMACIÓN DE CAJAS';
  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';
  const zona = school.zona || 'N/A';
  const transporte = school.transporte || 'N/A';

  // Helper function to draw complete header (title, date, school info). Hora line only on first page.
  const drawCompleteHeader = (includeHoraLine = true): void => {
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
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
    doc
      .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
      .font('Helvetica-Bold')
      .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
        align: 'center',
      });
    doc
      .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
      .font('Helvetica-Bold')
      .text(`ZONA: ${zona.toUpperCase()} - TIPO DE VEHICULO: ${transporte.toUpperCase()}`, {
        align: 'center',
      });
    if (includeHoraLine) {
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica')
        .text(AGREEMENT_HORA_LINE, { align: 'center' });
    }
    doc.moveDown(1);
  };

  // Draw initial header
  drawCompleteHeader();
  let currentY = doc.y;

  // Group students by grado_ok
  const gradeMap = new Map<string, { hombres: number; mujeres: number }>();
  for (const student of school.students) {
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

  const grades = Array.from(gradeMap.keys()).sort();

  // Define table structure (fixed column widths)
  // Total available width: 612pt (portrait) - 80pt (margins) = 532pt
  const colWidths = [50, 180, 100, 100, 102];
  const colHeaders = ['NO', 'GRADO', 'CAJAS HOMBRES', 'CAJAS MUJERES', 'CAJAS TOTALES'];
  const headerHeight = 30;
  const pageBottomMargin = 40; // Reserve space at bottom of page

  // Helper function to draw table header
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

  // Helper function to check if we need a new page
  const checkPageBreak = (requiredHeight: number): number => {
    const pageHeight = doc.page.height;
    if (currentY + requiredHeight > pageHeight - pageBottomMargin) {
      // Add new page and redraw header (no hora line on continuation pages)
      doc.addPage(CAJAS_PAGE_OPTIONS);
      drawCompleteHeader(false);
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

  // Track per-grade calculated boxes for accurate subtotal
  const gradeLevelBoxes: Array<{ hombres: number; mujeres: number }> = [];

  for (const grade of grades) {
    const counts = gradeMap.get(grade)!;

    // Apply flat 5% increment per gender. If zero students, no boxes needed.
    const cajasHombres = counts.hombres === 0 ? 0 : Math.round(counts.hombres * 1.05);
    const cajasMujeres = counts.mujeres === 0 ? 0 : Math.round(counts.mujeres * 1.05);
    const cajasTotales = cajasHombres + cajasMujeres;

    // Store for subtotal calculation
    gradeLevelBoxes.push({ hombres: cajasHombres, mujeres: cajasMujeres });

    // Calculate row height dynamically based on GRADO text length
    const textPadding = 8;
    const gradeTextHeight = doc.heightOfString(grade, { width: colWidths[1] - 8 });
    const rowHeight = Math.max(30, gradeTextHeight + textPadding * 2);

    // Check if we need a new page before drawing this row
    currentY = checkPageBreak(rowHeight);

    let x = 40;
    const rowData = [
      rowIndex.toString(),
      grade,
      cajasHombres.toString(),
      cajasMujeres.toString(),
      cajasTotales.toString(),
    ];

    for (let i = 0; i < rowData.length; i++) {
      doc.rect(x, currentY, colWidths[i], rowHeight).stroke();
      // Vertically center text within the cell
      const cellTextHeight = doc.heightOfString(rowData[i], { width: colWidths[i] - 8 });
      const textY = currentY + (rowHeight - cellTextHeight) / 2;
      doc.text(rowData[i], x + 4, textY, {
        width: colWidths[i] - 8,
        align: 'center',
      });
      x += colWidths[i];
    }
    currentY += rowHeight;
    rowIndex++;
  }

  // School summary row - sum of grade-level calculated boxes
  const summaryRowHeight = 30;

  // Check if we need a new page before drawing summary
  currentY = checkPageBreak(summaryRowHeight);

  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  const schoolTotalBoxesH = gradeLevelBoxes.reduce((sum, b) => sum + b.hombres, 0);
  const schoolTotalBoxesM = gradeLevelBoxes.reduce((sum, b) => sum + b.mujeres, 0);
  const schoolTotalBoxes = schoolTotalBoxesH + schoolTotalBoxesM;

  let x = 40;
  const summaryData = [
    '',
    'SUBTOTAL',
    schoolTotalBoxesH.toString(),
    schoolTotalBoxesM.toString(),
    schoolTotalBoxes.toString(),
  ];

  for (let i = 0; i < summaryData.length; i++) {
    doc.rect(x, currentY, colWidths[i], summaryRowHeight).stroke();
    doc.text(summaryData[i], x + 4, currentY + 8, {
      width: colWidths[i] - 8,
      align: 'center',
    });
    x += colWidths[i];
  }
}

/**
 * Render the "FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)" section for a single school.
 * Layout: LETTER portrait.
 */
export function renderFichaUniformesSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)';
  const formattedDate = formatDateForTitle(fechaInicio);

  addLogoToPage(doc, doc.page.width);
  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  drawFechaDespachoEntregaLine(doc, formattedDate);
  doc.moveDown(1);

  // School header
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
      align: 'center',
    });

  const zona = school.zona || 'N/A';
  const transporte = school.transporte || 'N/A';
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`ZONA: ${zona.toUpperCase()} - TIPO DE VEHICULO: ${transporte.toUpperCase()}`, {
      align: 'center',
    });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica')
    .text(AGREEMENT_HORA_LINE, { align: 'center' });

  doc.moveDown(1);

  let currentY = doc.y;

  // Aggregate data from all sources
  interface ItemCount {
    tipo_talla: string;
    cantidad: number;
  }

  const itemCounts: ItemCount[] = [];

  // Source 1: Camisas (tipo_camisa + camisa)
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
    const restrictedSizes = getRestrictedSizeOrder('tipo_de_camisa', tipoKey, camisaSizeOrder);
    const allowedSet = new Set(restrictedSizes);

    // Step 1 & 2: Compute original and base counts
    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      const base = orig * 2;
      rowBases[size] = allowedSet.has(size) ? base : 0;
    }

    // Step 3: Fill gaps in base counts
    // No gap filling — if real demand is zero, it stays zero

    // Step 4 & 5: Compute extra (vacíos) and final counts
    for (const size of camisaSizeOrder) {
      const base = rowBases[size] || 0;
      if (base > 0) {
        const extra = computeClothingExtra(base);
        const finalCount = base + extra;
        itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
      }
    }
  }

  // Source 2: Pantalones/Faldas (t_pantalon_falda_short + pantalon_falda)
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
    const restrictedSizes = getRestrictedSizeOrder(
      't_pantalon_falda_short',
      tipoKey,
      camisaSizeOrder
    );
    const allowedSet = new Set(restrictedSizes);

    // Step 1 & 2: Compute original and base counts
    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      const base = orig * 2;
      rowBases[size] = allowedSet.has(size) ? base : 0;
    }

    // Step 3: Fill gaps in base counts
    // No gap filling — if real demand is zero, it stays zero

    // Step 4 & 5: Compute extra (vacíos) and final counts
    for (const size of camisaSizeOrder) {
      const base = rowBases[size] || 0;
      if (base > 0) {
        const extra = computeClothingExtra(base);
        const finalCount = base + extra;
        itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
      }
    }
  }

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

  // Draw data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
  let totalPiezas = 0;

  for (const item of itemCounts) {
    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
    doc.text(item.tipo_talla, x + 5, currentY + 5, {
      width: tipoTallaColWidth - 10,
      align: 'center',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(item.cantidad.toString(), x + 5, currentY + 5, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += rowHeight;
    totalPiezas += item.cantidad;

    // Handle page overflow
    if (currentY > doc.page.height - 100) {
      doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
      drawFechaDespachoEntregaLine(doc, formattedDate);
      doc.moveDown(1);
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
        .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
          align: 'center',
        });
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(`ZONA: ${zona.toUpperCase()} - TIPO DE VEHICULO: ${transporte.toUpperCase()}`, {
          align: 'center',
        });
      doc.moveDown(1);
      currentY = doc.y;
      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }
  }

  // Footer with total
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

/**
 * Render the "FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)" section for a single school.
 * Layout: LETTER portrait.
 */
export function renderFichaZapatosSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)';
  const formattedDate = formatDateForTitle(fechaInicio);

  addLogoToPage(doc, doc.page.width);
  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  drawFechaDespachoEntregaLine(doc, formattedDate);
  doc.moveDown(1);

  // School header
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(school.nombre_ce.toUpperCase(), { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });

  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
      align: 'center',
    });

  const zona = school.zona || 'N/A';
  const transporte = school.transporte || 'N/A';
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`ZONA: ${zona.toUpperCase()}`, { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`TIPO DE VEHICULO: ${transporte.toUpperCase()}`, { align: 'center' });
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica')
    .text(AGREEMENT_HORA_LINE, { align: 'center' });

  doc.moveDown(1);

  let currentY = doc.y;

  // Aggregate shoe data
  interface ItemCount {
    talla: string;
    cantidad: number;
  }

  const itemCounts: ItemCount[] = [];

  const shoeSizes: string[] = [];
  for (let i = 23; i <= 45; i++) {
    shoeSizes.push(i.toString());
  }

  // Group by talla only (aggregate across all students)
  const zapatoTallaMap = new Map<string, number>();
  for (const student of school.students) {
    const size = student.zapato;
    if (size && shoeSizes.includes(size)) {
      zapatoTallaMap.set(size, (zapatoTallaMap.get(size) || 0) + 1);
    }
  }

  // Apply gap-filling over the aggregated size distribution
  const rowOriginals: Record<string, number> = {};
  const rowBases: Record<string, number> = {};
  const rowFinals: Record<string, number> = {};
  for (const size of shoeSizes) {
    const orig = zapatoTallaMap.get(size) || 0;
    rowOriginals[size] = orig;
    const computed = computeFinalCount(orig, 1);
    rowBases[size] = computed.base;
    rowFinals[size] = computed.final;
  }
  // No gap filling for shoes — only produce units for sizes with real demand
  for (const size of shoeSizes) {
    const finalCount = rowFinals[size] || 0;
    if (finalCount > 0) {
      itemCounts.push({ talla: size, cantidad: finalCount });
    }
  }

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

  // Draw data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
  let totalPiezas = 0;

  for (const item of itemCounts) {
    x = xStart;

    doc.rect(x, currentY, tallaColWidth, rowHeight).stroke();
    doc.text(item.talla, x + 5, currentY + 5, {
      width: tallaColWidth - 10,
      align: 'center',
    });
    x += tallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
    doc.text(item.cantidad.toString(), x + 5, currentY + 5, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += rowHeight;
    totalPiezas += item.cantidad;

    // Handle page overflow
    if (currentY > doc.page.height - 100) {
      doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
      drawFechaDespachoEntregaLine(doc, formattedDate);
      doc.moveDown(1);
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
        .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
          align: 'center',
        });
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(`ZONA: ${zona.toUpperCase()} - TIPO DE VEHICULO: ${transporte.toUpperCase()}`, {
          align: 'center',
        });
      doc.moveDown(1);
      currentY = doc.y;
      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }
  }

  // Footer with total
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

/**
 * Render the "ACTA DE RECEPCIÓN (ZAPATOS)" section for a single school.
 * Layout: LETTER portrait, single table with compact rows, two-column footer.
 *
 * Structure:
 *   1. Title: ACTA DE RECEPCIÓN (ZAPATOS)
 *   2. Pre-table fields: DATOS DE LOS PRODUCTOS (Fecha, Hora, Bodega)
 *   3. Data table: TALLA | CANTIDAD | COMENTARIOS/OBSERVACIONES with Total row
 *   4. Footer: Transport & signature fields
 */
export function renderActaRecepcionZapatosSection(ctx: SectionRenderContext): void {
  const { doc, school, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (ZAPATOS)';
  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';

  addLogoToPage(doc, doc.page.width);

  // 1. Title
  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(1);

  // School header
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
    .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
      align: 'center',
    });

  doc.moveDown(1);

  // 2. Pre-table: DATOS DE LOS PRODUCTOS
  const xStart = 40;
  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DE LOS PRODUCTOS', xStart, doc.y, { align: 'left' });
  doc.moveDown(0.5);

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text('Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________', xStart);
  doc.moveDown(1);

  // 3. Data table — aggregate shoe data by talla
  const shoeSizes: string[] = [];
  for (let i = 23; i <= 45; i++) {
    shoeSizes.push(i.toString());
  }

  const zapatoTallaMap = new Map<string, number>();
  for (const student of school.students) {
    const size = student.zapato;
    if (size && shoeSizes.includes(size)) {
      zapatoTallaMap.set(size, (zapatoTallaMap.get(size) || 0) + 1);
    }
  }

  // Apply gap-filling and size calculations (same logic as ficha_zapatos)
  const actaRowBases: Record<string, number> = {};
  const actaRowFinals: Record<string, number> = {};
  for (const size of shoeSizes) {
    const orig = zapatoTallaMap.get(size) || 0;
    const computed = computeFinalCount(orig, 1);
    actaRowBases[size] = computed.base;
    actaRowFinals[size] = computed.final;
  }
  // No gap filling for shoes — only produce units for sizes with real demand

  interface ActaTallaRow {
    talla: string;
    cantidad: number;
  }

  const tallaRows: ActaTallaRow[] = [];
  for (const size of shoeSizes) {
    const finalCount = actaRowFinals[size] || 0;
    if (finalCount > 0) {
      tallaRows.push({ talla: size, cantidad: finalCount });
    }
  }

  // Single table layout with minimal padding to fit on one landscape page
  let currentY = doc.y;
  const tallaColWidth = 60;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - tallaColWidth - cantidadColWidth;
  const actaHeaderHeight = 20;
  const actaRowHeight = 14;

  const totalCantidad = tallaRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tallaColWidth, actaHeaderHeight).stroke();
  doc.text('TALLA', x + 2, currentY + 5, { width: tallaColWidth - 4, align: 'center' });
  x += tallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaHeaderHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaHeaderHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += actaHeaderHeight;

  // Draw data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of tallaRows) {
    x = xStart;

    doc.rect(x, currentY, tallaColWidth, actaRowHeight).stroke();
    doc.text(row.talla, x + 2, currentY + 2, { width: tallaColWidth - 4, align: 'center' });
    x += tallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

    currentY += actaRowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = xStart;

  doc.rect(x, currentY, tallaColWidth, actaRowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: tallaColWidth - 4, align: 'center' });
  x += tallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

  currentY += actaRowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, xStart);
}

/**
 * Render the "ACTA DE RECEPCIÓN (UNIFORMES)" section for a single school.
 * Layout: LETTER portrait, single table with compact rows, two-column footer.
 *
 * Structure:
 *   1. Title: ACTA DE RECEPCIÓN (UNIFORMES)
 *   2. Pre-table fields: DATOS DE LOS PRODUCTOS (Fecha, Hora, Bodega)
 *   3. Data table: TIPO/TALLA | CANTIDAD | COMENTARIOS/OBSERVACIONES with Total row
 *   4. Footer: Transport & signature fields
 */
export function renderActaRecepcionUniformesSection(ctx: SectionRenderContext): void {
  const { doc, school, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (UNIFORMES)';
  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';

  addLogoToPage(doc, doc.page.width);

  // 1. Title
  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(1);

  // School header
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
    .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
      align: 'center',
    });

  doc.moveDown(1);

  // 2. Pre-table: DATOS DE LOS PRODUCTOS
  const xStart = 30;
  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DE LOS PRODUCTOS', xStart, doc.y, { align: 'left' });
  doc.moveDown(0.5);

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text('Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________', xStart);
  doc.moveDown(1);

  // 3. Data table — aggregate uniform data by tipo/talla
  interface ActaUniformeRow {
    tipo_talla: string;
    cantidad: number;
  }

  const itemCounts: ActaUniformeRow[] = [];

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

  // Source 1: Camisas (tipo_camisa + camisa)
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
    const restrictedSizes = getRestrictedSizeOrder('tipo_de_camisa', tipoKey, camisaSizeOrder);
    const allowedSet = new Set(restrictedSizes);

    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      const base = orig * 2;
      rowBases[size] = allowedSet.has(size) ? base : 0;
    }

    // No gap filling — if real demand is zero, it stays zero

    for (const size of camisaSizeOrder) {
      const base = rowBases[size] || 0;
      if (base > 0) {
        const extra = computeClothingExtra(base);
        const finalCount = base + extra;
        itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
      }
    }
  }

  // Source 2: Pantalones/Faldas (t_pantalon_falda_short + pantalon_falda)
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
    const restrictedSizes = getRestrictedSizeOrder(
      't_pantalon_falda_short',
      tipoKey,
      camisaSizeOrder
    );
    const allowedSet = new Set(restrictedSizes);

    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      const base = orig * 2;
      rowBases[size] = allowedSet.has(size) ? base : 0;
    }

    // No gap filling — if real demand is zero, it stays zero

    for (const size of camisaSizeOrder) {
      const base = rowBases[size] || 0;
      if (base > 0) {
        const extra = computeClothingExtra(base);
        const finalCount = base + extra;
        itemCounts.push({ tipo_talla: `${tipoKey} - ${size}`, cantidad: finalCount });
      }
    }
  }

  // Table layout — 3 columns for acta format
  let currentY = doc.y;
  const tipoTallaColWidth = 200;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - tipoTallaColWidth - cantidadColWidth;
  const actaHeaderHeight = 20;
  const actaRowHeight = 14;

  const totalCantidad = itemCounts.reduce((sum, r) => sum + r.cantidad, 0);

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, actaHeaderHeight).stroke();
  doc.text('TIPO/TALLA', x + 2, currentY + 5, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaHeaderHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaHeaderHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += actaHeaderHeight;

  // Draw data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of itemCounts) {
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
        .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
          align: 'center',
        });
      doc.moveDown(1);
      currentY = doc.y;

      // Redraw table header on new page
      doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
      x = xStart;
      doc.rect(x, currentY, tipoTallaColWidth, actaHeaderHeight).stroke();
      doc.text('TIPO/TALLA', x + 2, currentY + 5, {
        width: tipoTallaColWidth - 4,
        align: 'center',
      });
      x += tipoTallaColWidth;
      doc.rect(x, currentY, cantidadColWidth, actaHeaderHeight).stroke();
      doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
      x += cantidadColWidth;
      doc.rect(x, currentY, comentariosColWidth, actaHeaderHeight).stroke();
      doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
        width: comentariosColWidth - 4,
        align: 'center',
      });
      currentY += actaHeaderHeight;

      doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);
    }

    x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, actaRowHeight).stroke();
    doc.text(row.tipo_talla, x + 2, currentY + 2, {
      width: tipoTallaColWidth - 4,
      align: 'center',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

    currentY += actaRowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = xStart;

  doc.rect(x, currentY, tipoTallaColWidth, actaRowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: tipoTallaColWidth - 4, align: 'center' });
  x += tipoTallaColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

  currentY += actaRowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, xStart);
}

/**
 * Render the "ACTA DE RECEPCIÓN (CAJAS)" section for a single school.
 * Layout: LETTER portrait, single table with compact rows, transport footer.
 *
 * Structure:
 *   1. Title: ACTA DE RECEPCIÓN (CAJAS)
 *   2. Pre-table fields: DATOS DE LOS PRODUCTOS (Fecha, Hora, Bodega)
 *   3. Data table: GRADO | CANTIDAD | COMENTARIOS/OBSERVACIONES with Total row
 *   4. Footer: Transport & signature fields
 */
export function renderActaRecepcionCajasSection(ctx: SectionRenderContext): void {
  const { doc, school, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(ACTA_RECEPCION_CAJAS_PAGE_OPTIONS);
  }

  const title = 'ACTA DE RECEPCIÓN (CAJAS)';
  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';

  addLogoToPage(doc, doc.page.width);

  // 1. Title
  doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(1);

  // School header
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
    .text(`DEPARTAMENTO: ${departamento.toUpperCase()} - DISTRITO: ${distrito.toUpperCase()}`, {
      align: 'center',
    });

  doc.moveDown(1);

  // 2. Pre-table: DATOS DE LOS PRODUCTOS
  const actaXStart = 40;
  doc.fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER).font('Helvetica-Bold');
  doc.text('DATOS DE LOS PRODUCTOS', actaXStart, doc.y, { align: 'left' });
  doc.moveDown(0.5);

  doc.fontSize(AGREEMENT_FONT.BODY).font('Helvetica');
  doc.text('Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________', actaXStart);
  doc.moveDown(1);

  // 3. Data table — aggregate cajas by grade
  const gradeMap = new Map<string, { hombres: number; mujeres: number }>();
  for (const student of school.students) {
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

  const grades = Array.from(gradeMap.keys()).sort();

  interface ActaCajasRow {
    grado: string;
    cantidad: number;
  }

  const cajasRows: ActaCajasRow[] = [];
  for (const grade of grades) {
    const counts = gradeMap.get(grade)!;
    // Apply flat 5% increment per gender (same as renderCajasSection)
    const cajasHombres = counts.hombres === 0 ? 0 : Math.round(counts.hombres * 1.05);
    const cajasMujeres = counts.mujeres === 0 ? 0 : Math.round(counts.mujeres * 1.05);
    const cajasTotales = cajasHombres + cajasMujeres;
    if (cajasTotales > 0) {
      cajasRows.push({ grado: grade, cantidad: cajasTotales });
    }
  }

  // Table layout — 3 columns
  let currentY = doc.y;
  const gradoColWidth = 200;
  const cantidadColWidth = 80;
  const comentariosColWidth = doc.page.width - 60 - gradoColWidth - cantidadColWidth;
  const actaHeaderHeight = 20;
  const actaRowHeight = 14;

  const totalCantidad = cajasRows.reduce((sum, r) => sum + r.cantidad, 0);

  // Draw table header
  doc.fontSize(AGREEMENT_FONT.COLUMN_HEADER).font('Helvetica-Bold');
  let x = actaXStart;

  doc.rect(x, currentY, gradoColWidth, actaHeaderHeight).stroke();
  doc.text('GRADO', x + 2, currentY + 5, { width: gradoColWidth - 4, align: 'center' });
  x += gradoColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaHeaderHeight).stroke();
  doc.text('CANTIDAD', x + 2, currentY + 5, { width: cantidadColWidth - 4, align: 'center' });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaHeaderHeight).stroke();
  doc.text('COMENTARIOS/OBSERVACIONES', x + 2, currentY + 5, {
    width: comentariosColWidth - 4,
    align: 'center',
  });

  currentY += actaHeaderHeight;

  // Draw data rows
  doc.font('Helvetica').fontSize(AGREEMENT_FONT.BODY);

  for (const row of cajasRows) {
    x = actaXStart;

    doc.rect(x, currentY, gradoColWidth, actaRowHeight).stroke();
    doc.text(row.grado, x + 2, currentY + 2, { width: gradoColWidth - 4, align: 'center' });
    x += gradoColWidth;

    doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
    doc.text(row.cantidad.toString(), x + 2, currentY + 2, {
      width: cantidadColWidth - 4,
      align: 'center',
    });
    x += cantidadColWidth;

    doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

    currentY += actaRowHeight;
  }

  // Total row
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.BODY);
  x = actaXStart;

  doc.rect(x, currentY, gradoColWidth, actaRowHeight).stroke();
  doc.text('TOTAL', x + 2, currentY + 2, { width: gradoColWidth - 4, align: 'center' });
  x += gradoColWidth;

  doc.rect(x, currentY, cantidadColWidth, actaRowHeight).stroke();
  doc.text(totalCantidad.toString(), x + 2, currentY + 2, {
    width: cantidadColWidth - 4,
    align: 'center',
  });
  x += cantidadColWidth;

  doc.rect(x, currentY, comentariosColWidth, actaRowHeight).stroke();

  currentY += actaRowHeight;
  doc.y = currentY;
  doc.moveDown(2);

  drawTransportFooter(doc, actaXStart);
}
