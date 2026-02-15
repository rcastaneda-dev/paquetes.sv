/**
 * Pure functions for building flat-format editable export rows.
 * No Supabase or ExcelJS dependencies — safe for unit testing.
 */

import type { StudentQueryRow } from '@/types/database';
import type { SchoolGroup } from '@/lib/pdf/agreement/types';
import { CLOTHING_SIZE_ORDER, ceilToEven, getRestrictedSizeOrder, computeFinalCount } from '@/lib/reports/vacios';

export interface FlatRow {
  correlativo: number;
  codigo_ce: string;
  nombre_ce: string;
  tipo_prenda: string;
  talla: string;
  cantidad: number;
}

/** Shoe sizes 23–45 */
const SHOE_SIZES: string[] = [];
for (let i = 23; i <= 45; i++) {
  SHOE_SIZES.push(i.toString());
}

/**
 * Compute per-size final counts for a given uniform type across a set of students.
 */
function computeRowFinals(
  students: StudentQueryRow[],
  sizeField: 'camisa' | 'pantalon_falda',
  typeField: 'tipo_de_camisa' | 't_pantalon_falda_short',
  typeValue: string,
  restrictionCategory: 'tipo_de_camisa' | 't_pantalon_falda_short'
): Record<string, number> {
  const sizeOrder = [...CLOTHING_SIZE_ORDER];
  const restrictedSizes = getRestrictedSizeOrder(restrictionCategory, typeValue, sizeOrder);
  const allowedSet = new Set(restrictedSizes);

  const originals: Record<string, number> = {};
  for (const size of sizeOrder) {
    originals[size] = 0;
  }
  for (const student of students) {
    const tipo = student[typeField];
    const size = student[sizeField];
    if (!tipo || !size) continue;
    const normalizedTipo =
      typeField === 'tipo_de_camisa' ? `CAMISA ${tipo.toUpperCase()}` : tipo.toUpperCase();
    if (normalizedTipo !== typeValue) continue;
    if (originals[size] !== undefined) {
      originals[size]++;
    }
  }

  const rowBases: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = originals[size] * 2;
    rowBases[size] = allowedSet.has(size) ? base : 0;
  }

  const finals: Record<string, number> = {};
  for (const size of sizeOrder) {
    const base = rowBases[size] || 0;
    if (base > 0) {
      finals[size] = base + ceilToEven(base * 0.05);
    } else {
      finals[size] = 0;
    }
  }

  return finals;
}

/**
 * Compute per-size final counts for zapatos for a school.
 */
function computeZapatosRowFinals(students: StudentQueryRow[]): Record<string, number> {
  const zapatoTallaMap = new Map<string, number>();
  for (const student of students) {
    const size = student.zapato;
    if (size && SHOE_SIZES.includes(size)) {
      zapatoTallaMap.set(size, (zapatoTallaMap.get(size) || 0) + 1);
    }
  }

  const rowFinals: Record<string, number> = {};
  for (const size of SHOE_SIZES) {
    const orig = zapatoTallaMap.get(size) || 0;
    const computed = computeFinalCount(orig, 1);
    rowFinals[size] = computed.final;
  }

  return rowFinals;
}

/**
 * Build flat rows for uniformes from sorted school groups.
 */
export function buildUniformesFlatRows(schools: SchoolGroup[]): FlatRow[] {
  const sizeOrder = [...CLOTHING_SIZE_ORDER];
  const rows: FlatRow[] = [];
  let correlativo = 1;

  for (const school of schools) {
    const camisaTypes = new Set<string>();
    const pantalonTypes = new Set<string>();

    for (const student of school.students) {
      if (student.tipo_de_camisa) {
        camisaTypes.add(`CAMISA ${student.tipo_de_camisa.toUpperCase()}`);
      }
      if (student.t_pantalon_falda_short) {
        pantalonTypes.add(student.t_pantalon_falda_short.toUpperCase());
      }
    }

    const allTypes = [...[...camisaTypes].sort(), ...[...pantalonTypes].sort()];

    for (const typeValue of allTypes) {
      const isCamisa = typeValue.startsWith('CAMISA ');
      const finals = computeRowFinals(
        school.students,
        isCamisa ? 'camisa' : 'pantalon_falda',
        isCamisa ? 'tipo_de_camisa' : 't_pantalon_falda_short',
        typeValue,
        isCamisa ? 'tipo_de_camisa' : 't_pantalon_falda_short'
      );

      for (const size of sizeOrder) {
        const val = finals[size] || 0;
        if (val > 0) {
          rows.push({
            correlativo: correlativo++,
            codigo_ce: school.codigo_ce,
            nombre_ce: school.nombre_ce,
            tipo_prenda: typeValue,
            talla: size,
            cantidad: val,
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Build flat rows for zapatos from sorted school groups.
 */
export function buildZapatosFlatRows(schools: SchoolGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  let correlativo = 1;

  for (const school of schools) {
    const finals = computeZapatosRowFinals(school.students);

    for (const size of SHOE_SIZES) {
      const val = finals[size] || 0;
      if (val > 0) {
        rows.push({
          correlativo: correlativo++,
          codigo_ce: school.codigo_ce,
          nombre_ce: school.nombre_ce,
          tipo_prenda: 'ZAPATOS',
          talla: size,
          cantidad: val,
        });
      }
    }
  }

  return rows;
}

/**
 * Build combined flat rows: uniforms first, then zapatos.
 * CORRELATIVO is continuous across both sections.
 */
export function buildConsolidadoFlatRows(schools: SchoolGroup[]): FlatRow[] {
  const uniformRows = buildUniformesFlatRows(schools);
  const zapatoRows = buildZapatosFlatRows(schools);
  const combined = [...uniformRows, ...zapatoRows];

  // Re-number CORRELATIVO sequentially
  for (let i = 0; i < combined.length; i++) {
    combined[i].correlativo = i + 1;
  }

  return combined;
}
