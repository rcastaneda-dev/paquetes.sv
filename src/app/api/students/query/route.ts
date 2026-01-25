import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const school_codigo_ce = searchParams.get('school_codigo_ce');
    const grado = searchParams.get('grado');
    const departamento = searchParams.get('departamento');
    const region = searchParams.get('region');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const offset = (page - 1) * pageSize;

    const baseArgs = {
      p_school_codigo_ce: school_codigo_ce || null,
      p_grado: grado || null,
      p_limit: pageSize,
      p_offset: offset,
    };

    // Supabase/PostgREST can't resolve overloaded function candidates (PGRST203) when
    // multiple `query_students` signatures exist. Retry with extra optional params to
    // force a single match.
    let { data, error } = await supabaseServer.rpc('query_students', baseArgs);
    if (error?.code === 'PGRST203') {
      ({ data, error } = await supabaseServer.rpc('query_students', {
        ...baseArgs,
        p_departamento: departamento || null,
        p_region: region || null,
      }));
    }

    if (error) {
      console.error('Error querying students:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const students = data as StudentQueryRow[];
    const totalCount = students.length > 0 ? students[0].total_count : 0;

    return NextResponse.json({
      students,
      totalCount,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
