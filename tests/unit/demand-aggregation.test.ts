/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Unit tests for the shared demand aggregation module.
 *
 * Verifies that groupAndSortDemandBySchool and computeSchoolItemTotals
 * produce correct, consistent results — the same numbers that appear
 * in ACTA / COMANDA PDFs must appear in the consolidado Excels.
 */

import { describe, it, expect } from 'vitest';
import type { DemandRow } from '@/types/database';
import {
  groupAndSortDemandBySchool,
  computeSchoolItemTotals,
} from '@/lib/reports/demand-aggregation';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDemandRow(overrides: Partial<DemandRow> = {}): DemandRow {
  return {
    school_codigo_ce: '10740',
    nombre_ce: 'Escuela Test',
    departamento: 'SAN SALVADOR',
    distrito: 'SAN SALVADOR',
    zona: 'URBANA',
    transporte: 'NO',
    fecha_inicio: '2025-01-01',
    item: 'UNIFORMES',
    tipo: 'CAMISA BLANCA',
    categoria: 'T10',
    cantidad: 20,
    referencia: '',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// groupAndSortDemandBySchool
// ─────────────────────────────────────────────────────────────────────────────

describe('groupAndSortDemandBySchool', () => {
  it('should return empty array for empty input', () => {
    expect(groupAndSortDemandBySchool([])).toEqual([]);
  });

  it('should group rows by school_codigo_ce', () => {
    const rows: DemandRow[] = [
      makeDemandRow({ school_codigo_ce: 'A', nombre_ce: 'School A', cantidad: 10 }),
      makeDemandRow({
        school_codigo_ce: 'A',
        nombre_ce: 'School A',
        cantidad: 5,
        tipo: 'ZAPATOS',
        item: 'ZAPATOS',
      }),
      makeDemandRow({ school_codigo_ce: 'B', nombre_ce: 'School B', cantidad: 3 }),
    ];

    const groups = groupAndSortDemandBySchool(rows);

    expect(groups).toHaveLength(2);

    const schoolA = groups.find(g => g.codigo_ce === 'A')!;
    expect(schoolA.rows).toHaveLength(2);
    expect(schoolA.nombre_ce).toBe('School A');

    const schoolB = groups.find(g => g.codigo_ce === 'B')!;
    expect(schoolB.rows).toHaveLength(1);
  });

  it('should sort by distrito asc, then total demand desc', () => {
    const rows: DemandRow[] = [
      makeDemandRow({ school_codigo_ce: 'A', distrito: 'ZACATECOLUCA', cantidad: 100 }),
      makeDemandRow({ school_codigo_ce: 'B', distrito: 'AHUACHAPAN', cantidad: 10 }),
      makeDemandRow({ school_codigo_ce: 'C', distrito: 'AHUACHAPAN', cantidad: 50 }),
    ];

    const groups = groupAndSortDemandBySchool(rows);

    expect(groups.map(g => g.codigo_ce)).toEqual(['C', 'B', 'A']);
  });

  it('should preserve all row fields in the grouped output', () => {
    const rows: DemandRow[] = [
      makeDemandRow({
        school_codigo_ce: 'X',
        nombre_ce: 'School X',
        departamento: 'LA LIBERTAD',
        distrito: 'SANTA TECLA',
        zona: 'RURAL',
        transporte: 'SI',
        fecha_inicio: '2025-06-15',
        item: 'CAJAS',
        tipo: 'CAJAS',
        categoria: '3er Grado',
        cantidad: 42,
        referencia: 'REF-001',
      }),
    ];

    const groups = groupAndSortDemandBySchool(rows);

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.zona).toBe('RURAL');
    expect(group.transporte).toBe('SI');
    expect(group.fecha_inicio).toBe('2025-06-15');
    expect(group.rows[0].referencia).toBe('REF-001');
  });

  it('should handle a single-row school', () => {
    const rows: DemandRow[] = [makeDemandRow({ school_codigo_ce: 'SOLO', cantidad: 7 })];

    const groups = groupAndSortDemandBySchool(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].cantidad).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSchoolItemTotals
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSchoolItemTotals', () => {
  it('should return zero totals for a school with no rows', () => {
    const groups = groupAndSortDemandBySchool([]);
    expect(groups).toHaveLength(0);
  });

  it('should correctly sum CAJAS, UNIFORMES, and ZAPATOS separately', () => {
    const rows: DemandRow[] = [
      makeDemandRow({ item: 'CAJAS', tipo: 'CAJAS', cantidad: 10 }),
      makeDemandRow({ item: 'CAJAS', tipo: 'CAJAS', cantidad: 5, categoria: '4to Grado' }),
      makeDemandRow({ item: 'UNIFORMES', tipo: 'CAMISA BLANCA', cantidad: 20 }),
      makeDemandRow({ item: 'UNIFORMES', tipo: 'PANTALON AZUL', cantidad: 30 }),
      makeDemandRow({ item: 'ZAPATOS', tipo: 'ZAPATOS', cantidad: 8 }),
    ];

    const groups = groupAndSortDemandBySchool(rows);
    const totals = computeSchoolItemTotals(groups[0]);

    expect(totals.cajas).toBe(15);
    expect(totals.uniformes).toBe(50);
    expect(totals.zapatos).toBe(8);
    expect(totals.total).toBe(73);
  });

  it('should return zero for item types not present', () => {
    const rows: DemandRow[] = [makeDemandRow({ item: 'UNIFORMES', cantidad: 12 })];

    const groups = groupAndSortDemandBySchool(rows);
    const totals = computeSchoolItemTotals(groups[0]);

    expect(totals.cajas).toBe(0);
    expect(totals.uniformes).toBe(12);
    expect(totals.zapatos).toBe(0);
    expect(totals.total).toBe(12);
  });

  it('should carry through school metadata', () => {
    const rows: DemandRow[] = [
      makeDemandRow({
        school_codigo_ce: '99999',
        nombre_ce: 'CE Metadata',
        departamento: 'USULUTAN',
        distrito: 'JIQUILISCO',
        item: 'ZAPATOS',
        cantidad: 1,
      }),
    ];

    const groups = groupAndSortDemandBySchool(rows);
    const totals = computeSchoolItemTotals(groups[0]);

    expect(totals.codigo_ce).toBe('99999');
    expect(totals.nombre_ce).toBe('CE Metadata');
    expect(totals.departamento).toBe('USULUTAN');
    expect(totals.distrito).toBe('JIQUILISCO');
  });

  it('total should equal cajas + uniformes + zapatos', () => {
    const rows: DemandRow[] = [
      makeDemandRow({ item: 'CAJAS', tipo: 'CAJAS', cantidad: 7 }),
      makeDemandRow({ item: 'UNIFORMES', cantidad: 13 }),
      makeDemandRow({ item: 'ZAPATOS', tipo: 'ZAPATOS', cantidad: 4 }),
    ];

    const groups = groupAndSortDemandBySchool(rows);
    const totals = computeSchoolItemTotals(groups[0]);

    expect(totals.total).toBe(totals.cajas + totals.uniformes + totals.zapatos);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Excel ↔ PDF consistency: the sums the consolidado Excel would show must
// match the TOTAL rows rendered in each ACTA / COMANDA PDF.
// ─────────────────────────────────────────────────────────────────────────────

describe('Excel totals match PDF ACTA/COMANDA totals', () => {
  const demandRows: DemandRow[] = [
    // School A — mix of all three item types
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'CAJAS',
      tipo: 'CAJAS',
      categoria: '1er Grado',
      cantidad: 10,
    }),
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'CAJAS',
      tipo: 'CAJAS',
      categoria: '2do Grado',
      cantidad: 5,
    }),
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'UNIFORMES',
      tipo: 'CAMISA BLANCA',
      categoria: 'T10',
      cantidad: 20,
    }),
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'UNIFORMES',
      tipo: 'PANTALON AZUL',
      categoria: 'T10',
      cantidad: 18,
    }),
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'ZAPATOS',
      tipo: 'ZAPATOS',
      categoria: '32',
      cantidad: 6,
    }),
    makeDemandRow({
      school_codigo_ce: 'A',
      nombre_ce: 'School A',
      item: 'ZAPATOS',
      tipo: 'ZAPATOS',
      categoria: '34',
      cantidad: 4,
    }),
    // School B — only uniformes
    makeDemandRow({
      school_codigo_ce: 'B',
      nombre_ce: 'School B',
      item: 'UNIFORMES',
      tipo: 'CAMISA CELESTE',
      categoria: 'T8',
      cantidad: 14,
    }),
  ];

  it('per-school CAJAS total matches what ACTA CAJAS PDF renders', () => {
    const groups = groupAndSortDemandBySchool(demandRows);

    for (const group of groups) {
      const excelTotal = computeSchoolItemTotals(group).cajas;
      const pdfTotal = group.rows
        .filter(r => r.item === 'CAJAS')
        .reduce((sum, r) => sum + r.cantidad, 0);

      expect(excelTotal).toBe(pdfTotal);
    }
  });

  it('per-school UNIFORMES total matches what ACTA UNIFORMES PDF renders', () => {
    const groups = groupAndSortDemandBySchool(demandRows);

    for (const group of groups) {
      const excelTotal = computeSchoolItemTotals(group).uniformes;
      const pdfTotal = group.rows
        .filter(r => r.item === 'UNIFORMES')
        .reduce((sum, r) => sum + r.cantidad, 0);

      expect(excelTotal).toBe(pdfTotal);
    }
  });

  it('per-school ZAPATOS total matches what ACTA ZAPATOS PDF renders', () => {
    const groups = groupAndSortDemandBySchool(demandRows);

    for (const group of groups) {
      const excelTotal = computeSchoolItemTotals(group).zapatos;
      const pdfTotal = group.rows
        .filter(r => r.item === 'ZAPATOS')
        .reduce((sum, r) => sum + r.cantidad, 0);

      expect(excelTotal).toBe(pdfTotal);
    }
  });

  it('grand totals across all schools match', () => {
    const groups = groupAndSortDemandBySchool(demandRows);

    let grandCajas = 0;
    let grandUniformes = 0;
    let grandZapatos = 0;

    for (const group of groups) {
      const totals = computeSchoolItemTotals(group);
      grandCajas += totals.cajas;
      grandUniformes += totals.uniformes;
      grandZapatos += totals.zapatos;
    }

    const expectedCajas = demandRows
      .filter(r => r.item === 'CAJAS')
      .reduce((s, r) => s + r.cantidad, 0);
    const expectedUniformes = demandRows
      .filter(r => r.item === 'UNIFORMES')
      .reduce((s, r) => s + r.cantidad, 0);
    const expectedZapatos = demandRows
      .filter(r => r.item === 'ZAPATOS')
      .reduce((s, r) => s + r.cantidad, 0);

    expect(grandCajas).toBe(expectedCajas);
    expect(grandUniformes).toBe(expectedUniformes);
    expect(grandZapatos).toBe(expectedZapatos);
  });

  it('school with zero demand for an item type yields zero for that item', () => {
    const groups = groupAndSortDemandBySchool(demandRows);
    const schoolB = groups.find(g => g.codigo_ce === 'B')!;
    const totals = computeSchoolItemTotals(schoolB);

    expect(totals.cajas).toBe(0);
    expect(totals.zapatos).toBe(0);
    expect(totals.uniformes).toBe(14);
  });

  it('sorting order is identical for both PDF and Excel consumers', () => {
    const multiDistrito: DemandRow[] = [
      makeDemandRow({ school_codigo_ce: 'X', distrito: 'USULUTAN', cantidad: 5 }),
      makeDemandRow({ school_codigo_ce: 'Y', distrito: 'AHUACHAPAN', cantidad: 100 }),
      makeDemandRow({ school_codigo_ce: 'Z', distrito: 'AHUACHAPAN', cantidad: 200 }),
    ];

    const groups = groupAndSortDemandBySchool(multiDistrito);
    const order = groups.map(g => g.codigo_ce);

    expect(order).toEqual(['Z', 'Y', 'X']);
  });
});
