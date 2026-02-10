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
  fillSizeGaps,
  fillBaseGaps,
  getRestrictedSizeOrder,
  ceilToEven,
} from '@/lib/reports/vacios';
import type { StudentQueryRow } from '@/types/database';
import type { PDFDocumentInstance, SchoolGroup, SectionRenderContext } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Standard font sizes (used across all agreement PDFs for consistency)
// ─────────────────────────────────────────────────────────────────────────────

export const AGREEMENT_FONT = {
  /** Main report title (e.g. "DETALLE DE PROGRAMACIÓN DE CAJAS") */
  TITLE: 13,
  /** Subtitle, date, school block, footer (e.g. "TOTAL PIEZAS") */
  SUBTITLE_SCHOOL_FOOTER: 11,
  /** Table column headers (e.g. "TIPO", "CANTIDAD", "TALLA") */
  COLUMN_HEADER: 10,
  /** Table body and data rows */
  BODY: 9,
} as const;

/** Line below school header for manual fill-in of start/end time when printed */
export const AGREEMENT_HORA_LINE =
  'HORA DE INICIO:  ___________________ HORA DE FINALIZACION: ___________________';

// ─────────────────────────────────────────────────────────────────────────────
// Page options per section type (used by addPage and document creation)
// ─────────────────────────────────────────────────────────────────────────────

export const CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'landscape' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Section renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the "DETALLE DE PROGRAMACIÓN DE CAJAS" section for a single school.
 * Layout: LETTER landscape.
 */
export function renderCajasSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) {
    doc.addPage(CAJAS_PAGE_OPTIONS);
  }

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = 'DETALLE DE PROGRAMACIÓN DE CAJAS';
  const subtitle = `Fecha: ${formattedDate}`;
  const departamento = school.departamento || 'N/A';
  const distrito = school.distrito || 'N/A';
  const zona = school.zona || 'N/A';
  const transporte = school.transporte || 'N/A';

  // Helper function to draw complete header (title, date, school info). Hora line only on first page.
  const drawCompleteHeader = (includeHoraLine = true): void => {
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(AGREEMENT_FONT.TITLE).font('Helvetica-Bold').text(subtitle, { align: 'center' });
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
  // Total available width: 792pt (landscape) - 60pt (margins) = 732pt
  const colWidths = [80, 240, 137, 137, 138];
  const colHeaders = ['NO', 'GRADO', 'CAJAS HOMBRES', 'CAJAS MUJERES', 'CAJAS TOTALES'];
  const headerHeight = 30;
  const pageBottomMargin = 40; // Reserve space at bottom of page

  // Helper function to draw table header
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

    // Apply conditional increment based on student count per gender
    // If zero students, no boxes needed
    const incrementH = counts.hombres > 15 ? 1.1 : 1.15;
    const incrementM = counts.mujeres > 15 ? 1.1 : 1.15;

    const cajasHombres = counts.hombres === 0 ? 0 : Math.ceil(counts.hombres * incrementH);
    const cajasMujeres = counts.mujeres === 0 ? 0 : Math.ceil(counts.mujeres * incrementM);
    const cajasTotales = cajasHombres + cajasMujeres;

    // Store for subtotal calculation
    gradeLevelBoxes.push({ hombres: cajasHombres, mujeres: cajasMujeres });

    const rowHeight = 30;

    // Check if we need a new page before drawing this row
    currentY = checkPageBreak(rowHeight);

    let x = 30;
    const rowData = [
      rowIndex.toString(),
      grade,
      cajasHombres.toString(),
      cajasMujeres.toString(),
      cajasTotales.toString(),
    ];

    for (let i = 0; i < rowData.length; i++) {
      doc.rect(x, currentY, colWidths[i], rowHeight).stroke();
      doc.text(rowData[i], x + 4, currentY + 8, {
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

  let x = 30;
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
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`Fecha: ${formattedDate}`, { align: 'center' });
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
    const filledBases = fillBaseGaps(restrictedSizes, rowBases);

    // Step 4 & 5: Compute extra (vacíos) and final counts
    for (const size of camisaSizeOrder) {
      const base = filledBases[size] || 0;
      if (base > 0) {
        const extra = ceilToEven(base * 0.15);
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
    const filledBases = fillBaseGaps(restrictedSizes, rowBases);

    // Step 4 & 5: Compute extra (vacíos) and final counts
    for (const size of camisaSizeOrder) {
      const base = filledBases[size] || 0;
      if (base > 0) {
        const extra = ceilToEven(base * 0.15);
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
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(`Fecha: ${formattedDate}`, { align: 'center' });
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
  doc
    .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
    .font('Helvetica-Bold')
    .text(`Fecha: ${formattedDate}`, { align: 'center' });
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
  const filled = fillSizeGaps(shoeSizes, rowBases, rowFinals);
  for (const size of shoeSizes) {
    const finalCount = filled[size] || 0;
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
      doc
        .fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER)
        .font('Helvetica-Bold')
        .text(`Fecha: ${formattedDate}`, { align: 'center' });
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
