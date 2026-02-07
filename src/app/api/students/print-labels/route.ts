import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { generateStudentLabelsPDF } from '@/lib/pdf/generator';
import type { StudentQueryRow, StudentReportRow } from '@/types/database';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

// Schema for print labels query params
const printLabelsQuerySchema = z.object({
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
    const { school_codigo_ce, grado } = validateQueryParams(request, printLabelsQuerySchema);

    // Fetch school name (for PDF title + filename)
    const { data: school, error: schoolError } = await supabaseServer
      .from('schools')
      .select('nombre_ce')
      .eq('codigo_ce', school_codigo_ce)
      .single();

    if (schoolError || !school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 });
    }

    // Fetch all students matching the performed search
    const students = await fetchAllStudents({
      school_codigo_ce,
      grado: grado || null,
    });

    const studentRows: StudentReportRow[] = students.map(s => ({
      nie: s.nie,
      nombre_estudiante: s.nombre_estudiante,
      sexo: s.sexo,
      edad: s.edad,
      grado: s.grado,
      camisa: s.camisa,
      pantalon_falda: s.pantalon_falda,
      zapato: s.zapato,
    }));

    const gradoLabel = grado || 'Todos los grados';

    const pdfStream = generateStudentLabelsPDF({
      schoolName: school.nombre_ce,
      codigo_ce: school_codigo_ce,
      grado: gradoLabel,
      students: studentRows,
    });

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

    const fileName = `etiquetas-${slugify(school.nombre_ce)}-${slugify(gradoLabel)}.pdf`;

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
    console.error('Error generating labels PDF:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
