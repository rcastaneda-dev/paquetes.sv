import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolCodigoCe = searchParams.get('school_codigo_ce');

    // Require school_codigo_ce parameter
    if (!schoolCodigoCe) {
      return NextResponse.json(
        { error: 'school_codigo_ce parameter is required' },
        { status: 400 }
      );
    }

    // Query students.grado_ok and grado for the specific school
    // Use COALESCE strategy: prefer grado_ok, fall back to grado if grado_ok is null/empty
    const { data, error } = await supabaseServer
      .from('students')
      .select('grado_ok, grado')
      .eq('school_codigo_ce', schoolCodigoCe);

    if (error) {
      console.error('Error fetching grades:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // De-duplicate in Node using Set, preferring grado_ok over grado
    const grades =
      data
        ?.map(row => {
          // Prefer grado_ok, but fall back to grado if grado_ok is null/empty
          const grade = row.grado_ok && row.grado_ok.trim() !== '' ? row.grado_ok : row.grado;
          return grade;
        })
        .filter(grade => grade && grade.trim() !== '') || [];

    const uniqueGrades = Array.from(new Set(grades)).sort();

    return NextResponse.json({
      grades: uniqueGrades,
      source: 'grado_ok', // Optional metadata for debugging
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
