/**
 * Unit tests for V2 flat-format editable exports.
 *
 * Tests the pure row-building functions that transform SchoolGroup[] into
 * flat rows with columns: CORRELATIVO, CODIGO_CE, NOMBRE_CE, TIPO_PRENDA, TALLA, CANTIDAD.
 */

import { describe, it, expect } from 'vitest';
import type { StudentQueryRow } from '@/types/database';
import type { SchoolGroup } from '@/lib/pdf/agreement/types';
import { buildUniformesFlatRows, buildZapatosFlatRows } from '@/lib/reports/editable-v2';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStudent(overrides: Partial<StudentQueryRow> = {}): StudentQueryRow {
  return {
    nie: '0000000',
    nombre_estudiante: 'Test Student',
    sexo: 'M',
    edad: 10,
    grado: '3',
    grado_ok: '3',
    school_codigo_ce: '10740',
    nombre_ce: 'Escuela Test',
    departamento: 'San Salvador',
    distrito: '01',
    zona: 'URBANA',
    transporte: 'NO',
    fecha_inicio: '2025-01-01',
    camisa: '',
    tipo_de_camisa: '',
    pantalon_falda: '',
    t_pantalon_falda_short: '',
    zapato: '',
    total_count: 1,
    ...overrides,
  };
}

function makeSchool(
  codigo_ce: string,
  nombre_ce: string,
  students: StudentQueryRow[]
): SchoolGroup {
  return {
    codigo_ce,
    nombre_ce,
    departamento: students[0]?.departamento ?? 'San Salvador',
    distrito: students[0]?.distrito ?? '01',
    zona: students[0]?.zona ?? 'URBANA',
    transporte: students[0]?.transporte ?? 'NO',
    students,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniformes V2 flat output
// ─────────────────────────────────────────────────────────────────────────────

describe('buildUniformesFlatRows', () => {
  it('should return empty array for empty schools', () => {
    const rows = buildUniformesFlatRows([]);
    expect(rows).toEqual([]);
  });

  it('should return empty array for school with no uniform data', () => {
    const school = makeSchool('10740', 'Escuela A', [makeStudent()]);
    const rows = buildUniformesFlatRows([school]);
    expect(rows).toEqual([]);
  });

  it('should produce flat rows for single school with single garment type', () => {
    const students = [
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
      makeStudent({ camisa: 'T6', tipo_de_camisa: 'CELESTE' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    // T4: 2 students → base=4, extra=ceilToEven(0.2)=2, final=6
    // T6: 1 student → base=2, extra=ceilToEven(0.1)=2, final=4
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      correlativo: 1,
      codigo_ce: '10740',
      nombre_ce: 'Escuela A',
      tipo_prenda: 'CAMISA CELESTE',
      talla: 'T4',
      cantidad: 6,
    });
    expect(rows[1]).toEqual({
      correlativo: 2,
      codigo_ce: '10740',
      nombre_ce: 'Escuela A',
      tipo_prenda: 'CAMISA CELESTE',
      talla: 'T6',
      cantidad: 4,
    });
  });

  it('should handle multiple garment types with continuous CORRELATIVO', () => {
    const students = [
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE', pantalon_falda: 'T4', t_pantalon_falda_short: 'SHORT AZUL' }),
      makeStudent({ camisa: 'T6', tipo_de_camisa: 'CELESTE', pantalon_falda: 'T6', t_pantalon_falda_short: 'SHORT AZUL' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    // Should have CAMISA CELESTE rows first, then SHORT AZUL rows
    expect(rows.length).toBe(4);

    // Camisa rows
    expect(rows[0].tipo_prenda).toBe('CAMISA CELESTE');
    expect(rows[0].correlativo).toBe(1);
    expect(rows[1].tipo_prenda).toBe('CAMISA CELESTE');
    expect(rows[1].correlativo).toBe(2);

    // Short rows
    expect(rows[2].tipo_prenda).toBe('SHORT AZUL');
    expect(rows[2].correlativo).toBe(3);
    expect(rows[3].tipo_prenda).toBe('SHORT AZUL');
    expect(rows[3].correlativo).toBe(4);
  });

  it('should continue CORRELATIVO across multiple schools', () => {
    const studentsA = [
      makeStudent({ school_codigo_ce: '10740', nombre_ce: 'Escuela A', camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
    ];
    const studentsB = [
      makeStudent({ school_codigo_ce: '12504', nombre_ce: 'Escuela B', camisa: 'T6', tipo_de_camisa: 'CELESTE' }),
    ];
    const schoolA = makeSchool('10740', 'Escuela A', studentsA);
    const schoolB = makeSchool('12504', 'Escuela B', studentsB);
    const rows = buildUniformesFlatRows([schoolA, schoolB]);

    expect(rows).toHaveLength(2);
    expect(rows[0].correlativo).toBe(1);
    expect(rows[0].codigo_ce).toBe('10740');
    expect(rows[1].correlativo).toBe(2);
    expect(rows[1].codigo_ce).toBe('12504');
  });

  it('should omit sizes with zero quantity', () => {
    // Only T4 has students; T6, T8, etc. should not appear
    const students = [
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    expect(rows).toHaveLength(1);
    expect(rows[0].talla).toBe('T4');
  });

  it('should populate NOMBRE_CE on every row', () => {
    const students = [
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
      makeStudent({ camisa: 'T6', tipo_de_camisa: 'CELESTE' }),
    ];
    const school = makeSchool('10740', 'Mi Escuela', students);
    const rows = buildUniformesFlatRows([school]);

    for (const row of rows) {
      expect(row.nombre_ce).toBe('Mi Escuela');
    }
  });

  it('should normalize tipo_de_camisa to CAMISA prefix', () => {
    const students = [
      makeStudent({ camisa: 'T6', tipo_de_camisa: 'BLANCA' }),
    ];
    const school = makeSchool('10647', 'Escuela C', students);
    const rows = buildUniformesFlatRows([school]);

    expect(rows[0].tipo_prenda).toBe('CAMISA BLANCA');
  });

  it('should use pantalon type directly without prefix', () => {
    const students = [
      makeStudent({ pantalon_falda: 'T4', t_pantalon_falda_short: 'FALDA AZUL CON TIRANTE' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    expect(rows[0].tipo_prenda).toBe('FALDA AZUL CON TIRANTE');
  });

  it('should enforce size restrictions (out-of-range sizes produce no row)', () => {
    // CAMISA CELESTE is restricted to T4–T12
    // A student with T14 should produce no row for that size
    const students = [
      makeStudent({ camisa: 'T14', tipo_de_camisa: 'CELESTE' }),
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    // Only T4 should appear (T14 is out of range for CELESTE)
    expect(rows).toHaveLength(1);
    expect(rows[0].talla).toBe('T4');
  });

  it('should start CORRELATIVO at 1', () => {
    const students = [
      makeStudent({ camisa: 'T4', tipo_de_camisa: 'CELESTE' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildUniformesFlatRows([school]);

    expect(rows[0].correlativo).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zapatos V2 flat output
// ─────────────────────────────────────────────────────────────────────────────

describe('buildZapatosFlatRows', () => {
  it('should return empty array for empty schools', () => {
    const rows = buildZapatosFlatRows([]);
    expect(rows).toEqual([]);
  });

  it('should return empty array for school with no shoe data', () => {
    const school = makeSchool('10740', 'Escuela A', [makeStudent()]);
    const rows = buildZapatosFlatRows([school]);
    expect(rows).toEqual([]);
  });

  it('should produce flat rows for single school with multiple shoe sizes', () => {
    const students = [
      makeStudent({ zapato: '25' }),
      makeStudent({ zapato: '25' }),
      makeStudent({ zapato: '27' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildZapatosFlatRows([school]);

    // 25: 2 students → base=2, extra=ceil(0.1)=1, final=3
    // 27: 1 student → base=1, extra=ceil(0.05)=1, final=2
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      correlativo: 1,
      codigo_ce: '10740',
      nombre_ce: 'Escuela A',
      tipo_prenda: 'ZAPATO',
      talla: '25',
      cantidad: 3,
    });
    expect(rows[1]).toEqual({
      correlativo: 2,
      codigo_ce: '10740',
      nombre_ce: 'Escuela A',
      tipo_prenda: 'ZAPATO',
      talla: '27',
      cantidad: 2,
    });
  });

  it('should always use ZAPATO as TIPO_PRENDA', () => {
    const students = [
      makeStudent({ zapato: '30' }),
      makeStudent({ zapato: '35' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildZapatosFlatRows([school]);

    for (const row of rows) {
      expect(row.tipo_prenda).toBe('ZAPATO');
    }
  });

  it('should omit sizes with zero demand', () => {
    const students = [
      makeStudent({ zapato: '28' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildZapatosFlatRows([school]);

    // Only size 28 should appear
    expect(rows).toHaveLength(1);
    expect(rows[0].talla).toBe('28');
  });

  it('should continue CORRELATIVO across multiple schools', () => {
    const studentsA = [
      makeStudent({ school_codigo_ce: '10740', nombre_ce: 'Escuela A', zapato: '25' }),
    ];
    const studentsB = [
      makeStudent({ school_codigo_ce: '12504', nombre_ce: 'Escuela B', zapato: '30' }),
    ];
    const schoolA = makeSchool('10740', 'Escuela A', studentsA);
    const schoolB = makeSchool('12504', 'Escuela B', studentsB);
    const rows = buildZapatosFlatRows([schoolA, schoolB]);

    expect(rows).toHaveLength(2);
    expect(rows[0].correlativo).toBe(1);
    expect(rows[0].codigo_ce).toBe('10740');
    expect(rows[1].correlativo).toBe(2);
    expect(rows[1].codigo_ce).toBe('12504');
  });

  it('should populate NOMBRE_CE on every row', () => {
    const students = [
      makeStudent({ zapato: '25' }),
      makeStudent({ zapato: '30' }),
    ];
    const school = makeSchool('10740', 'Mi Escuela', students);
    const rows = buildZapatosFlatRows([school]);

    for (const row of rows) {
      expect(row.nombre_ce).toBe('Mi Escuela');
    }
  });

  it('should start CORRELATIVO at 1', () => {
    const students = [
      makeStudent({ zapato: '25' }),
    ];
    const school = makeSchool('10740', 'Escuela A', students);
    const rows = buildZapatosFlatRows([school]);

    expect(rows[0].correlativo).toBe(1);
  });
});
