import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { generateCajasPDF } from '@/lib/pdf/generator';
import type { StudentQueryRow } from '@/types/database';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

// Schema for report query params (same as print routes)
const reportQuerySchema = z.object({
  school_codigo_ce: z.string().min(1, 'school_codigo_ce is required'),
  grado: z.string().optional(),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchAllStudents(params: {
  school_codigo_ce: string;
  grado: string | null;
}): Promise<StudentQueryRow[]> {
  // Must be ≤ PostgREST max-rows (Supabase default = 1000)
  const pageSize = 1000;
  const maxRows = 20000;

  let offset = 0;
  const all: StudentQueryRow[] = [];
  let useExtendedRpcSignature = false;

  while (true) {
    const baseArgs = {
      p_school_codigo_ce: params.school_codigo_ce,
      p_grado: params.grado,
      p_limit: pageSize,
      p_offset: offset,
    };

    const args = useExtendedRpcSignature ? { ...baseArgs, p_departamento: null } : baseArgs;

    let { data, error } = await supabaseServer.rpc('query_students', args);

    // If PostgREST can't resolve overloaded `query_students` candidates, retry once
    // using the longer signature to force a single match.
    if (error?.code === 'PGRST203' && !useExtendedRpcSignature) {
      useExtendedRpcSignature = true;
      ({ data, error } = await supabaseServer.rpc('query_students', {
        ...baseArgs,
        p_departamento: null,
      }));
    }

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) {
      break;
    }

    all.push(...rows);

    if (all.length >= maxRows) {
      throw new Error(`Too many rows to print (${all.length}+). Please narrow your filters.`);
    }

    // If we received fewer rows than requested, we've reached the last page
    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return all;
}

export async function GET(request: NextRequest) {
  try {
    // Validate query params with Zod
    const { school_codigo_ce, grado } = validateQueryParams(request, reportQuerySchema);

    // Fetch school metadata
    const { data: school, error: schoolError } = await supabaseServer
      .from('schools')
      .select('nombre_ce, departamento, distrito, fecha_inicio')
      .eq('codigo_ce', school_codigo_ce)
      .single();

    if (schoolError || !school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 });
    }

    // Fetch all students matching the search
    const students = await fetchAllStudents({
      school_codigo_ce,
      grado: grado || null,
    });

    if (students.length === 0) {
      return NextResponse.json({ error: 'No students found' }, { status: 404 });
    }

    // Get fecha_inicio for title
    const fechaInicio = school.fecha_inicio || new Date().toISOString().split('T')[0];

    // Generate PDF
    const pdfStream = generateCajasPDF({
      fechaInicio,
      students,
    });

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

    const gradoLabel = grado || 'todos';
    const fileName = `cajas-${slugify(school.nombre_ce)}-${slugify(gradoLabel)}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Error generating Cajas PDF:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
