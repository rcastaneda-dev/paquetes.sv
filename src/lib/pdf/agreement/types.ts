/**
 * Shared types for the agreement PDF composition system.
 */
import type PDFDocument from 'pdfkit';
import type { StudentQueryRow } from '@/types/database';

export type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

/** Section types available for consolidated agreement reports */
export type AgreementSectionType =
  | 'cajas'
  | 'ficha_uniformes'
  | 'ficha_zapatos'
  | 'acta_recepcion_zapatos'
  | 'acta_recepcion_uniformes'
  | 'acta_recepcion_cajas';

/** School group produced by grouping students by codigo_ce */
export interface SchoolGroup {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  municipio: string;
  distrito: string;
  zona: string;
  transporte: string;
  students: StudentQueryRow[];
}

/** Context passed to each section renderer */
export interface SectionRenderContext {
  doc: PDFDocumentInstance;
  school: SchoolGroup;
  fechaInicio: string;
  /** If true, the renderer will call doc.addPage() before drawing */
  addPage: boolean;
}
