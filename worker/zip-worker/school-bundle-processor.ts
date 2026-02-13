/**
 * Self-contained school-bundle PDF + ZIP processor for the standalone worker.
 *
 * This module duplicates the rendering logic from the Next.js app
 * (src/lib/pdf/agreement/sections.ts, builders.ts, vacios.ts) so
 * the worker can generate PDFs without calling back to the web app.
 *
 * Keep in sync with the source modules when rendering logic changes.
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrored from src/types/database.ts & src/lib/pdf/agreement/types.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface StudentQueryRow {
  nie: string;
  nombre_estudiante: string;
  sexo: string;
  edad: number | null;
  grado: string;
  grado_ok: string;
  school_codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  zona: string;
  transporte: string;
  fecha_inicio: string;
  camisa: string;
  tipo_de_camisa: string;
  pantalon_falda: string;
  t_pantalon_falda_short: string;
  zapato: string;
  total_count: number;
}

type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

interface SchoolGroup {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  zona: string;
  transporte: string;
  students: StudentQueryRow[];
}

interface SectionRenderContext {
  doc: PDFDocumentInstance;
  school: SchoolGroup;
  fechaInicio: string;
  addPage: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vacíos helpers (mirrored from src/lib/reports/vacios.ts)
// ─────────────────────────────────────────────────────────────────────────────

function ceilToEven(n: number): number {
  if (n <= 0) return 0;
  const ceiled = Math.ceil(n);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

function computeFinalCount(
  original: number,
  multiplier: 1 | 2
): { base: number; extra: number; final: number } {
  const base = original * multiplier;
  const extra = ceilToEven(base * 0.06);
  const final = base + extra;
  return { base, extra, final };
}

function fillBaseGaps(
  orderedSizes: string[],
  baseCounts: Record<string, number>
): Record<string, number> {
  const result = { ...baseCounts };

  for (let n = 0; n < orderedSizes.length - 1; n++) {
    const size = orderedSizes[n];
    const currentBase = result[size] || 0;
    if (currentBase > 0) continue;

    const nextSize = orderedSizes[n + 1];
    const nextBase = result[nextSize] || 0;
    if (nextBase > 0) {
      result[size] = ceilToEven(nextBase / 2);
    }
  }

  return result;
}

function fillSizeGaps(
  orderedSizes: string[],
  baseCounts: Record<string, number>,
  finalCounts: Record<string, number>
): Record<string, number> {
  const result = { ...finalCounts };

  for (let n = 0; n < orderedSizes.length - 1; n++) {
    const size = orderedSizes[n];
    const currentFinal = result[size] || 0;
    if (currentFinal > 0) continue;

    const nextSize = orderedSizes[n + 1];
    const nextBase = baseCounts[nextSize] || 0;
    if (nextBase > 0) {
      result[size] = ceilToEven(nextBase / 2);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page options
// ─────────────────────────────────────────────────────────────────────────────

const CAJAS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'landscape' as const,
  margins: { top: 40, bottom: 40, left: 30, right: 30 },
};

const FICHA_UNIFORMES_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

const FICHA_ZAPATOS_PAGE_OPTIONS = {
  size: 'LETTER' as const,
  layout: 'portrait' as const,
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

// Standard font sizes (must match src/lib/pdf/agreement/sections.ts AGREEMENT_FONT)
const AGREEMENT_FONT = {
  TITLE: 13,
  SUBTITLE_SCHOOL_FOOTER: 11,
  COLUMN_HEADER: 10,
  BODY: 9,
} as const;

// Line below school header for manual fill-in of start/end time (match sections.ts)
const AGREEMENT_HORA_LINE =
  'HORA DE INICIO:  ___________________ HORA DE FINALIZACION: ___________________';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (mirrored from src/lib/pdf/agreement/sections.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try multiple paths for the GOES logo.
 * In the Docker image the logo is at /app/assets/goes_logo_2.png
 * During dev it's at the project root under public/.
 */
function findLogoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'assets', 'goes_logo_2.png'),
    path.join(__dirname, 'assets', 'goes_logo_2.png'),
    path.join(process.cwd(), 'public', 'goes_logo_2.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function addLogoToPage(doc: PDFDocumentInstance, pageWidth: number): void {
  const logoPath = findLogoPath();
  if (!logoPath) return;

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

function formatDateForTitle(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return isoDate;
}

function groupBySchool(students: StudentQueryRow[]): SchoolGroup[] {
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

// ─────────────────────────────────────────────────────────────────────────────
// Section renderers (mirrored from src/lib/pdf/agreement/sections.ts)
// ─────────────────────────────────────────────────────────────────────────────

function renderCajasSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) doc.addPage(CAJAS_PAGE_OPTIONS);

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
    if (!gradeMap.has(grade)) gradeMap.set(grade, { hombres: 0, mujeres: 0 });
    const counts = gradeMap.get(grade)!;
    if (student.sexo === 'Hombre') counts.hombres++;
    else if (student.sexo === 'Mujer') counts.mujeres++;
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
    const incrementH = counts.hombres > 15 ? 1.06 : 1.15;
    const incrementM = counts.mujeres > 15 ? 1.06 : 1.15;

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

  // Subtotal row - sum of grade-level calculated boxes
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

function renderFichaUniformesSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) doc.addPage(FICHA_UNIFORMES_PAGE_OPTIONS);

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

  // Aggregate uniform data
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

  // Source 1: Camisas (tipo_camisa + camisa)
  const camisaTipoMap = new Map<string, Map<string, number>>();
  for (const student of school.students) {
    const tipo = student.tipo_de_camisa;
    const size = student.camisa;
    if (tipo && size) {
      const tipoKey = `CAMISA ${tipo.toUpperCase()}`;
      if (!camisaTipoMap.has(tipoKey)) camisaTipoMap.set(tipoKey, new Map());
      const sizeMap = camisaTipoMap.get(tipoKey)!;
      sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    }
  }

  const camisaTypes = Array.from(camisaTipoMap.keys()).sort();
  for (const tipoKey of camisaTypes) {
    const sizeMap = camisaTipoMap.get(tipoKey)!;

    // Step 1 & 2: Compute base counts
    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      rowBases[size] = orig * 2;
    }

    // Step 3: Fill gaps in base counts
    const filledBases = fillBaseGaps(camisaSizeOrder, rowBases);

    // Step 4 & 5: Compute extra and final counts
    for (const size of camisaSizeOrder) {
      const base = filledBases[size] || 0;
      if (base > 0) {
        const extra = ceilToEven(base * 0.06);
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
      if (!pantalonTipoMap.has(tipoKey)) pantalonTipoMap.set(tipoKey, new Map());
      const sizeMap = pantalonTipoMap.get(tipoKey)!;
      sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    }
  }

  const pantalonTypes = Array.from(pantalonTipoMap.keys()).sort();
  for (const tipoKey of pantalonTypes) {
    const sizeMap = pantalonTipoMap.get(tipoKey)!;

    // Step 1 & 2: Compute base counts
    const rowBases: Record<string, number> = {};
    for (const size of camisaSizeOrder) {
      const orig = sizeMap.get(size) || 0;
      rowBases[size] = orig * 2;
    }

    // Step 3: Fill gaps in base counts
    const filledBases = fillBaseGaps(camisaSizeOrder, rowBases);

    // Step 4 & 5: Compute extra and final counts
    for (const size of camisaSizeOrder) {
      const base = filledBases[size] || 0;
      if (base > 0) {
        const extra = ceilToEven(base * 0.06);
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

  // Table header
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

    // Page overflow
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

  // Footer
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

function renderFichaZapatosSection(ctx: SectionRenderContext): void {
  const { doc, school, fechaInicio, addPage: shouldAddPage } = ctx;

  if (shouldAddPage) doc.addPage(FICHA_ZAPATOS_PAGE_OPTIONS);

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

  // Table header
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

    // Page overflow
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

  // Footer
  currentY += 10;
  doc.font('Helvetica-Bold').fontSize(AGREEMENT_FONT.SUBTITLE_SCHOOL_FOOTER);
  doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSchoolBundlePdf(options: {
  fechaInicio: string;
  school: SchoolGroup;
}): PDFDocumentInstance {
  const { fechaInicio, school } = options;

  // Start with Cajas layout (landscape)
  const doc = new PDFDocument(CAJAS_PAGE_OPTIONS);

  // Section 1: Cajas
  renderCajasSection({ doc, school, fechaInicio, addPage: false });
  // Section 2: Ficha Uniformes (portrait)
  renderFichaUniformesSection({ doc, school, fechaInicio, addPage: true });
  // Section 3: Ficha Zapatos (portrait)
  renderFichaZapatosSection({ doc, school, fechaInicio, addPage: true });

  doc.end();
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream helper
// ─────────────────────────────────────────────────────────────────────────────

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('finish', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginated student fetcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostgREST enforces a server-side `max-rows` limit (default 1000).
 * We page in increments of 1000 and use `rows.length < pageSize`
 * to detect the last page reliably.
 */
async function fetchAllStudentsForDate(
  supabase: SupabaseClient,
  fechaInicio: string
): Promise<StudentQueryRow[]> {
  // Must be ≤ PostgREST max-rows (Supabase default = 1000)
  const pageSize = 1000;
  const maxRows = 200000;

  let offset = 0;
  const all: StudentQueryRow[] = [];

  while (true) {
    const { data, error } = await supabase.rpc('query_students', {
      p_school_codigo_ce: null,
      p_grado: null,
      p_departamento: null,
      p_fecha_inicio: fechaInicio,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) throw new Error(`Failed to fetch students: ${error.message}`);

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) break;

    all.push(...rows);

    if (all.length >= maxRows) {
      console.warn(`fetchAllStudentsForDate: hit maxRows (${maxRows})`);
      break;
    }

    // If we received fewer rows than requested, we've reached the last page
    if (rows.length < pageSize) break;

    offset += pageSize;
  }

  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export: process a school-bundle ZIP job
// ─────────────────────────────────────────────────────────────────────────────

export async function processSchoolBundleDirectly(
  supabase: SupabaseClient,
  jobId: string,
  reportJobId: string,
  compressionLevel: number
): Promise<{ zipPath: string; zipSizeBytes: number; pdfCount: number }> {
  // 1. Get fecha_inicio from report job
  const { data: reportJob, error: reportJobError } = await supabase
    .from('report_jobs')
    .select('status, job_params')
    .eq('id', reportJobId)
    .single();

  if (reportJobError || !reportJob) {
    throw new Error(`Report job not found: ${reportJobError?.message ?? 'not found'}`);
  }

  const fechaInicio = (reportJob.job_params as { fecha_inicio?: string })?.fecha_inicio;
  if (!fechaInicio) {
    throw new Error('Missing fecha_inicio in job params');
  }

  // 2. Get distinct schools from category tasks
  await supabase.rpc('update_zip_job_status', {
    p_job_id: jobId,
    p_status: 'processing',
    p_progress: { message: 'Fetching school list...' },
  });

  const { data: schoolRows, error: schoolsError } = await supabase
    .from('report_category_tasks')
    .select('school_codigo_ce')
    .eq('job_id', reportJobId);

  if (schoolsError) {
    throw new Error(`Failed to fetch schools: ${schoolsError.message}`);
  }

  const uniqueSchoolCodes = [
    ...new Set((schoolRows ?? []).map((r: { school_codigo_ce: string }) => r.school_codigo_ce)),
  ];
  console.log(`   📋 Found ${uniqueSchoolCodes.length} schools`);

  if (uniqueSchoolCodes.length === 0) {
    throw new Error('No schools found for this job');
  }

  // 3. Fetch all students for this date (paginated)
  await supabase.rpc('update_zip_job_status', {
    p_job_id: jobId,
    p_progress: { message: 'Fetching student data...' },
  });

  const allStudents = await fetchAllStudentsForDate(supabase, fechaInicio);
  console.log(`   📋 Fetched ${allStudents.length} total students`);

  if (allStudents.length === 0) {
    throw new Error(`No students found for fecha_inicio=${fechaInicio}`);
  }

  // Filter to only schools in this job
  const jobSchoolSet = new Set(uniqueSchoolCodes);
  const filteredStudents = allStudents.filter(s => jobSchoolSet.has(s.school_codigo_ce));
  const schools = groupBySchool(filteredStudents);
  console.log(`   📋 ${filteredStudents.length} students across ${schools.length} schools`);

  // 4. Create ZIP archive
  const archive = archiver('zip', { zlib: { level: compressionLevel } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  let pdfCount = 0;

  // 5. Generate one merged PDF per school
  for (const school of schools) {
    try {
      await supabase.rpc('update_zip_job_status', {
        p_job_id: jobId,
        p_progress: {
          message: `Generating PDF ${pdfCount + 1}/${schools.length}: ${school.codigo_ce}`,
        },
      });

      const doc = buildSchoolBundlePdf({ fechaInicio, school });
      const pdfBuffer = await streamToBuffer(doc);

      const safeName = school.codigo_ce.replace(/[^a-zA-Z0-9_-]/g, '_');
      archive.append(pdfBuffer, { name: `${safeName}.pdf` });
      pdfCount++;

      if (pdfCount % 25 === 0) {
        console.log(`   📊 Progress: ${pdfCount}/${schools.length} PDFs`);
      }
    } catch (err) {
      console.error(
        `   ⚠️  Failed for school ${school.codigo_ce}:`,
        err instanceof Error ? err.message : err
      );
      // Continue with other schools
    }
  }

  // 6. Finalize archive
  await supabase.rpc('update_zip_job_status', {
    p_job_id: jobId,
    p_progress: { message: 'Finalizing ZIP archive...' },
  });

  console.log(`   🗜️  Finalizing ZIP (${pdfCount} PDFs)...`);
  archive.finalize();

  await new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const zipBuffer = Buffer.concat(chunks);
  const zipSizeMB = (zipBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`   ✅ ZIP created: ${zipSizeMB} MB, ${pdfCount} PDFs`);

  // 7. Upload ZIP to Supabase Storage
  await supabase.rpc('update_zip_job_status', {
    p_job_id: jobId,
    p_progress: { message: 'Uploading ZIP to storage...' },
  });

  const zipPath = `bundles/${reportJobId}/${fechaInicio}/school_bundle.zip`;
  console.log(`   ⬆️  Uploading to: ${zipPath}`);

  const { error: uploadError } = await supabase.storage.from('reports').upload(zipPath, zipBuffer, {
    contentType: 'application/zip',
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  console.log(`   ✅ Upload complete`);

  return { zipPath, zipSizeBytes: zipBuffer.length, pdfCount };
}
