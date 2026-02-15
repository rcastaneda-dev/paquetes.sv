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
    .select('school_codigo_ce, item, tipo, categoria, cantidad, schools!inner(nombre_ce)')
    .order('school_codigo_ce');

  if (params?.schoolCodigoCe) {
    query = query.eq('school_codigo_ce', params.schoolCodigoCe);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error querying school demand: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    school_codigo_ce: row.school_codigo_ce,
    nombre_ce: (row.schools as unknown as { nombre_ce: string }).nombre_ce,
    item: row.item,
    tipo: row.tipo,
    categoria: row.categoria,
    cantidad: row.cantidad,
  }));
}
