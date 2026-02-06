/**
 * High-level PDF builders for consolidated exports and school bundles.
 *
 * - buildConsolidatedPdf: one PDF merging all schools for a single section type.
 * - buildSchoolBundlePdf: one PDF for a single school containing all 3 sections.
 */
import PDFDocument from 'pdfkit';
import type { StudentQueryRow } from '@/types/database';
import type { AgreementSectionType, PDFDocumentInstance, SchoolGroup } from './types';
import {
  groupBySchool,
  renderCajasSection,
  renderFichaUniformesSection,
  renderFichaZapatosSection,
  CAJAS_PAGE_OPTIONS,
  FICHA_UNIFORMES_PAGE_OPTIONS,
  FICHA_ZAPATOS_PAGE_OPTIONS,
} from './sections';

interface PageOptions {
  size: 'LETTER';
  layout: 'landscape' | 'portrait';
  margins: { top: number; bottom: number; left: number; right: number };
}

const PAGE_OPTIONS_BY_SECTION: Record<AgreementSectionType, PageOptions> = {
  cajas: CAJAS_PAGE_OPTIONS,
  ficha_uniformes: FICHA_UNIFORMES_PAGE_OPTIONS,
  ficha_zapatos: FICHA_ZAPATOS_PAGE_OPTIONS,
};

type SectionRenderer = typeof renderCajasSection;

const RENDERER_BY_SECTION: Record<AgreementSectionType, SectionRenderer> = {
  cajas: renderCajasSection,
  ficha_uniformes: renderFichaUniformesSection,
  ficha_zapatos: renderFichaZapatosSection,
};

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
  const pageOptions = PAGE_OPTIONS_BY_SECTION[section];
  const renderer = RENDERER_BY_SECTION[section];

  const doc = new PDFDocument(pageOptions) as PDFDocumentInstance;

  for (let i = 0; i < schools.length; i++) {
    renderer({
      doc,
      school: schools[i],
      fechaInicio,
      addPage: i > 0,
    });
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
  const doc = new PDFDocument(CAJAS_PAGE_OPTIONS) as PDFDocumentInstance;

  // Section 1: Cajas – uses the initial page
  renderCajasSection({ doc, school, fechaInicio, addPage: false });

  // Section 2: Ficha Uniformes – adds a portrait page
  renderFichaUniformesSection({ doc, school, fechaInicio, addPage: true });

  // Section 3: Ficha Zapatos – adds another portrait page
  renderFichaZapatosSection({ doc, school, fechaInicio, addPage: true });

  doc.end();
  return doc;
}
