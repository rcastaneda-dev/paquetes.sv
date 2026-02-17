/**
 * High-level PDF builders for consolidated exports and school bundles.
 *
 * - buildConsolidatedPdf: one PDF merging all schools for a single section type.
 * - buildSchoolBundlePdf: one PDF for a single school containing all 3 sections.
 */
import PDFDocument from 'pdfkit';
import type { StudentQueryRow } from '@/types/database';
import type { AgreementSectionType, PDFDocumentInstance, SchoolGroup } from './types';
import { addPageNumbers } from '../page-numbers';
import {
  groupBySchool,
  renderCajasSection,
  renderFichaUniformesSection,
  renderFichaZapatosSection,
  renderActaRecepcionZapatosSection,
  renderActaRecepcionUniformesSection,
  CAJAS_PAGE_OPTIONS,
  FICHA_UNIFORMES_PAGE_OPTIONS,
  FICHA_ZAPATOS_PAGE_OPTIONS,
  ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
  ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
} from './sections';
import { computeClothingExtra, computeFinalCount, getRestrictedSizeOrder } from '@/lib/reports/vacios';

interface PageOptions {
  size: 'LETTER';
  layout: 'landscape' | 'portrait';
  margins: { top: number; bottom: number; left: number; right: number };
}

const PAGE_OPTIONS_BY_SECTION: Record<AgreementSectionType, PageOptions> = {
  cajas: CAJAS_PAGE_OPTIONS,
  ficha_uniformes: FICHA_UNIFORMES_PAGE_OPTIONS,
  ficha_zapatos: FICHA_ZAPATOS_PAGE_OPTIONS,
  acta_recepcion_zapatos: ACTA_RECEPCION_ZAPATOS_PAGE_OPTIONS,
  acta_recepcion_uniformes: ACTA_RECEPCION_UNIFORMES_PAGE_OPTIONS,
};

type SectionRenderer = typeof renderCajasSection;

const RENDERER_BY_SECTION: Record<AgreementSectionType, SectionRenderer> = {
  cajas: renderCajasSection,
  ficha_uniformes: renderFichaUniformesSection,
  ficha_zapatos: renderFichaZapatosSection,
  acta_recepcion_zapatos: renderActaRecepcionZapatosSection,
  acta_recepcion_uniformes: renderActaRecepcionUniformesSection,
};

// ─────────────────────────────────────────────────────────────────────────────
// Comanda code helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Section types that should display a comanda code in the top-left corner */
const COMANDA_SECTIONS = new Set<AgreementSectionType>([
  'cajas',
  'ficha_uniformes',
  'ficha_zapatos',
]);

/**
 * Build a comanda code string: C{dd}{mm}-{id}
 * - schoolIndex is 0-based; displayed as 001, 002, …
 * - pageInSchool (1-based) adds a suffix only for page 2+  (e.g. C1702-001-2)
 */
function formatComandaCode(schoolIndex: number, pageInSchool = 1): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const id = String(schoolIndex + 1).padStart(3, '0');
  const base = `C${dd}${mm}-${id}`;
  return pageInSchool > 1 ? `${base}-${pageInSchool}` : base;
}

/**
 * Single switchToPage pass: stamps comanda codes (top-left) AND page numbers
 * (bottom-center) on every buffered page.
 */
function stampPageOverlays(doc: PDFDocumentInstance, comandaCodes: string[]): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const idx = i - range.start;

    // Comanda code — top-left
    const code = comandaCodes[idx];
    if (code) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
      doc.text(code, 30, 20, { lineBreak: false });
    }

    // Page number — bottom-center
    const pageNum = `${idx + 1}`;
    doc.fontSize(8).font('Helvetica').fillColor('black');
    const tw = doc.widthOfString(pageNum);
    doc.text(pageNum, (doc.page.width - tw) / 2, doc.page.height - 20, { lineBreak: false });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals calculators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate total CAJAS for a school (sum of hombres + mujeres boxes).
 * Exported for use by consolidado Excel export.
 */
export function calculateCajasTotales(school: SchoolGroup): number {
  const gradeMap = new Map<string, { hombres: number; mujeres: number }>();

  for (const student of school.students) {
    const grade = student.grado_ok || student.grado || 'N/A';
    if (!gradeMap.has(grade)) {
      gradeMap.set(grade, { hombres: 0, mujeres: 0 });
    }
    const existing = gradeMap.get(grade);
    const counts = existing ?? { hombres: 0, mujeres: 0 };
    if (student.sexo === 'Hombre') {
      counts.hombres++;
    } else if (student.sexo === 'Mujer') {
      counts.mujeres++;
    }
  }

  let totalBoxes = 0;
  for (const counts of gradeMap.values()) {
    const cajasHombres = counts.hombres === 0 ? 0 : Math.round(counts.hombres * 1.05);
    const cajasMujeres = counts.mujeres === 0 ? 0 : Math.round(counts.mujeres * 1.05);
    totalBoxes += cajasHombres + cajasMujeres;
  }

  return totalBoxes;
}

/**
 * Calculate total PIEZAS for uniformes (camisas + pantalones/faldas).
 * Exported for use by consolidado Excel export.
 */
export function calculateUniformesTotalPiezas(school: SchoolGroup): number {
  let totalPiezas = 0;
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

  // Count camisas
  const camisaTipoMap = new Map<string, Map<string, number>>();
  for (const student of school.students) {
    const tipo = student.tipo_de_camisa;
    const size = student.camisa;
    if (tipo && size) {
      const tipoKey = `CAMISA ${tipo.toUpperCase()}`;
      if (!camisaTipoMap.has(tipoKey)) {
        camisaTipoMap.set(tipoKey, new Map());
      }
      const sizeMap = camisaTipoMap.get(tipoKey) ?? new Map<string, number>();
      sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    }
  }

  for (const tipoKey of camisaTipoMap.keys()) {
    const sizeMap = camisaTipoMap.get(tipoKey) ?? new Map<string, number>();
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
        totalPiezas += base + extra;
      }
    }
  }

  // Count pantalones/faldas
  const pantalonTipoMap = new Map<string, Map<string, number>>();
  for (const student of school.students) {
    const tipo = student.t_pantalon_falda_short;
    const size = student.pantalon_falda;
    if (tipo && size) {
      const tipoKey = tipo.toUpperCase();
      if (!pantalonTipoMap.has(tipoKey)) {
        pantalonTipoMap.set(tipoKey, new Map());
      }
      const sizeMap = pantalonTipoMap.get(tipoKey) ?? new Map<string, number>();
      sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    }
  }

  for (const tipoKey of pantalonTipoMap.keys()) {
    const sizeMap = pantalonTipoMap.get(tipoKey) ?? new Map<string, number>();
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
        totalPiezas += base + extra;
      }
    }
  }

  return totalPiezas;
}

/**
 * Calculate total PIEZAS for zapatos.
 * Exported for use by consolidado Excel export.
 */
export function calculateZapatosTotalPiezas(school: SchoolGroup): number {
  let totalPiezas = 0;
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

  const rowBases: Record<string, number> = {};
  const rowFinals: Record<string, number> = {};
  for (const size of shoeSizes) {
    const orig = zapatoTallaMap.get(size) || 0;
    const computed = computeFinalCount(orig, 1);
    rowBases[size] = computed.base;
    rowFinals[size] = computed.final;
  }
  // No gap filling for shoes — only produce units for sizes with real demand
  for (const finalCount of Object.values(rowFinals)) {
    totalPiezas += finalCount;
  }

  return totalPiezas;
}

/**
 * Sort schools by their calculated totals in descending order
 */
function sortSchoolsByTotal(schools: SchoolGroup[], section: AgreementSectionType): SchoolGroup[] {
  return schools.sort((a, b) => {
    let totalA = 0;
    let totalB = 0;

    if (section === 'cajas') {
      totalA = calculateCajasTotales(a);
      totalB = calculateCajasTotales(b);
    } else if (section === 'ficha_uniformes' || section === 'acta_recepcion_uniformes') {
      totalA = calculateUniformesTotalPiezas(a);
      totalB = calculateUniformesTotalPiezas(b);
    } else if (section === 'ficha_zapatos' || section === 'acta_recepcion_zapatos') {
      totalA = calculateZapatosTotalPiezas(a);
      totalB = calculateZapatosTotalPiezas(b);
    }

    // Sort descending (highest first)
    return totalB - totalA;
  });
}

/**
 * Build a consolidated PDF merging all schools for a single section type.
 * Each school starts on a new page. The document is finalized (doc.end()) before return.
 */
export function buildConsolidatedPdf(options: {
  fechaInicio: string;
  students: StudentQueryRow[];
  section: AgreementSectionType;
}): PDFDocumentInstance {
  const { fechaInicio, students, section } = options;
  const schools = groupBySchool(students);

  // Sort schools by their totals in descending order
  const sortedSchools = sortSchoolsByTotal(schools, section);

  const pageOptions = PAGE_OPTIONS_BY_SECTION[section];
  const renderer = RENDERER_BY_SECTION[section];

  const doc = new PDFDocument({ ...pageOptions, bufferPages: true }) as PDFDocumentInstance;
  const useComanda = COMANDA_SECTIONS.has(section);
  const pageCodes: string[] = [];

  for (let i = 0; i < sortedSchools.length; i++) {
    const pagesBefore = doc.bufferedPageRange().count;

    renderer({
      doc,
      school: sortedSchools[i],
      fechaInicio,
      addPage: i > 0,
    });

    if (useComanda) {
      const pagesAfter = doc.bufferedPageRange().count;
      const pagesForSchool = i === 0 ? pagesAfter : pagesAfter - pagesBefore;
      for (let p = 1; p <= pagesForSchool; p++) {
        pageCodes.push(formatComandaCode(i, p));
      }
    }
  }

  if (useComanda) {
    stampPageOverlays(doc, pageCodes);
  } else {
    addPageNumbers(doc);
  }
  doc.end();
  return doc;
}

/**
 * Build a merged PDF for a single school containing all 3 sections:
 *   1. Cajas (landscape)
 *   2. Ficha Uniformes (portrait)
 *   3. Ficha Zapatos (portrait)
 *
 * Each section starts on its own page. The document is finalized before return.
 */
export function buildSchoolBundlePdf(options: {
  fechaInicio: string;
  school: SchoolGroup;
}): PDFDocumentInstance {
  const { fechaInicio, school } = options;

  // Start with Cajas layout (landscape)
  const doc = new PDFDocument({ ...CAJAS_PAGE_OPTIONS, bufferPages: true }) as PDFDocumentInstance;

  // Section 1: Cajas – uses the initial page
  renderCajasSection({ doc, school, fechaInicio, addPage: false });

  // Section 2: Ficha Uniformes – adds a portrait page
  renderFichaUniformesSection({ doc, school, fechaInicio, addPage: true });

  // Section 3: Ficha Zapatos – adds another portrait page
  renderFichaZapatosSection({ doc, school, fechaInicio, addPage: true });

  addPageNumbers(doc);
  doc.end();
  return doc;
}
