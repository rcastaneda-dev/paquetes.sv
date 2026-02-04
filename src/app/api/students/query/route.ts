import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import type { StudentQueryRow } from '@/types/database';
import { studentFilterSchema } from '@/lib/validation/schemas';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export async function GET(request: NextRequest) {
  try {
    // Validate query params with Zod
    const { school_codigo_ce, grado, departamento, page, pageSize } = validateQueryParams(
      request,
      studentFilterSchema
    );
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
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
