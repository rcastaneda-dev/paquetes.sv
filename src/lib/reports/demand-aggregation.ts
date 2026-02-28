/**
 * Shared demand aggregation module.
 *
 * Single source of truth for grouping, sorting, and totalling demand data.
 * Used by both Excel and PDF generators so numbers always match.
 */
import type { DemandRow, SchoolDemandGroup } from '@/types/database';

export interface SchoolItemTotals {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  cajas: number;
  uniformes: number;
  zapatos: number;
  total: number;
}

/**
 * Group flat DemandRow[] into SchoolDemandGroup[] sorted by
 * distrito asc, then total demand desc.
 */
export function groupAndSortDemandBySchool(rows: DemandRow[]): SchoolDemandGroup[] {
  const map = new Map<string, SchoolDemandGroup>();

  for (const row of rows) {
    if (!map.has(row.school_codigo_ce)) {
      map.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
        nombre_ce: row.nombre_ce,
        departamento: row.departamento,
        distrito: row.distrito,
        zona: row.zona,
        transporte: row.transporte,
        fecha_inicio: row.fecha_inicio,
        rows: [],
      });
    }
    map.get(row.school_codigo_ce)!.rows.push(row);
  }

  return Array.from(map.values()).sort((a, b) => {
    const districtCompare = a.distrito.localeCompare(b.distrito, 'es');
    if (districtCompare !== 0) return districtCompare;
    const totalA = a.rows.reduce((s, r) => s + r.cantidad, 0);
    const totalB = b.rows.reduce((s, r) => s + r.cantidad, 0);
    return totalB - totalA;
  });
}

/** Derive per-item totals from a SchoolDemandGroup. */
export function computeSchoolItemTotals(school: SchoolDemandGroup): SchoolItemTotals {
  let cajas = 0;
  let uniformes = 0;
  let zapatos = 0;

  for (const row of school.rows) {
    if (row.item === 'CAJAS') {
      cajas += row.cantidad;
    } else if (row.item === 'UNIFORMES') {
      uniformes += row.cantidad;
    } else if (row.item === 'ZAPATOS') {
      zapatos += row.cantidad;
    }
  }

  return {
    codigo_ce: school.codigo_ce,
    nombre_ce: school.nombre_ce,
    departamento: school.departamento,
    distrito: school.distrito,
    cajas,
    uniformes,
    zapatos,
    total: cajas + uniformes + zapatos,
  };
}
