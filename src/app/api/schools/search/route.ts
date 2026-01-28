import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import type { SchoolSearchResult } from '@/types/database';
import { searchQuerySchema } from '@/lib/validation/schemas';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Validate query params with Zod
    const { q: query } = validateQueryParams(request, searchQuerySchema);

    const { data, error } = await supabaseServer.rpc('search_schools', {
      p_query: query,
      p_limit: 10,
    });

    if (error) {
      console.error('Error searching schools:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ schools: data as SchoolSearchResult[] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
