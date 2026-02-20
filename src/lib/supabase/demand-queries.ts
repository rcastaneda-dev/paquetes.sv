import { supabaseServer } from './server';
import type { DemandRow } from '@/types/database';

/**
 * Query school demand data, optionally filtered by school code.
 * Joins with schools table to include nombre_ce.
 */
export async function querySchoolDemand(params?: {
  schoolCodigoCe?: string;
}): Promise<DemandRow[]> {
  let query = supabaseServer
    .from('school_demand')
    .select(
      'school_codigo_ce, item, tipo, categoria, cantidad, referencia, schools!inner(nombre_ce, departamento, distrito, zona, transporte, fecha_inicio)'
    )
    .order('school_codigo_ce');

  if (params?.schoolCodigoCe) {
    query = query.eq('school_codigo_ce', params.schoolCodigoCe);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error querying school demand: ${error.message}`);
  }

  return (data ?? []).map(row => {
    const school = row.schools as unknown as {
      nombre_ce: string;
      departamento: string;
      distrito: string;
      zona: string;
      transporte: string;
      fecha_inicio: string | null;
    };
    return {
      school_codigo_ce: row.school_codigo_ce,
      nombre_ce: school.nombre_ce,
      departamento: school.departamento ?? '',
      distrito: school.distrito ?? '',
      zona: school.zona ?? '',
      transporte: school.transporte ?? '',
      fecha_inicio: school.fecha_inicio ?? new Date().toISOString().split('T')[0],
      item: row.item,
      tipo: row.tipo,
      categoria: row.categoria,
      cantidad: row.cantidad,
      referencia: (row as Record<string, unknown>).referencia as string ?? '',
    };
  });
}
