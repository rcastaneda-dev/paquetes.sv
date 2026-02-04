import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import {
  generateCajasPDF,
  generateCamisasPDF,
  generatePantalonesPDF,
  generateZapatosPDF,
} from '@/lib/pdf/generator';
import type { StudentQueryRow } from '@/types/database';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

// Schema for debug query params
const debugQuerySchema = z.object({
  type: z.enum(['cajas', 'camisas', 'pantalones', 'zapatos']),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * Debug endpoint that generates a combined PDF for N random schools.
 * This is used to test bulk PDF generation and pagination behavior.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate query params with Zod
    const { type, limit } = validateQueryParams(request, debugQuerySchema);

    // Get total number of schools
    const { count: totalSchools, error: countError } = await supabaseServer
      .from('schools')
      .select('*', { count: 'exact', head: true });

    if (countError || !totalSchools || totalSchools === 0) {
      return NextResponse.json({ error: 'No schools found in database' }, { status: 404 });
    }

    // Generate N unique random offsets
    const randomOffsets = new Set<number>();
    const maxAttempts = limit * 3; // Avoid infinite loop
    let attempts = 0;

    while (randomOffsets.size < Math.min(limit, totalSchools) && attempts < maxAttempts) {
      const offset = Math.floor(Math.random() * totalSchools);
      randomOffsets.add(offset);
      attempts++;
    }

    // Fetch random schools
    const schoolPromises = Array.from(randomOffsets).map(offset =>
      supabaseServer
        .from('schools')
        .select('codigo_ce, nombre_ce, departamento, distrito, fecha_inicio')
        .order('codigo_ce')
        .range(offset, offset)
        .single()
    );

    const schoolResults = await Promise.allSettled(schoolPromises);
    const schools = schoolResults
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map(result => result.value.data)
      .filter(Boolean);

    if (schools.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch random schools' }, { status: 500 });
    }

    // Fetch students for all schools and aggregate
    const allStudents: StudentQueryRow[] = [];
    let fechaInicio: string | null = null;

    for (const school of schools) {
      // Use the school's fecha_inicio if available
      if (!fechaInicio && school.fecha_inicio) {
        fechaInicio = school.fecha_inicio;
      }

      // Fetch all students for this school using the same RPC as the regular reports
      const pageSize = 2000;
      let offset = 0;
      const schoolStudents: StudentQueryRow[] = [];

      while (true) {
        const { data, error } = await supabaseServer.rpc('query_students', {
          p_school_codigo_ce: school.codigo_ce,
          p_grado: null,
          p_limit: pageSize,
          p_offset: offset,
        });

        if (error) {
          console.error(`Error fetching students for ${school.codigo_ce}:`, error);
          break;
        }

        const rows = (data as StudentQueryRow[]) ?? [];
        if (rows.length === 0) break;

        schoolStudents.push(...rows);

        // Check if we've fetched all students for this school
        const totalCount = rows[0]?.total_count ?? 0;
        if (schoolStudents.length >= totalCount) break;

        offset += pageSize;
      }

      allStudents.push(...schoolStudents);
    }

    if (allStudents.length === 0) {
      return NextResponse.json(
        { error: 'No students found for selected schools' },
        { status: 404 }
      );
    }

    // Use today's date if no fecha_inicio was found
    if (!fechaInicio) {
      fechaInicio = new Date().toISOString().split('T')[0];
    }

    // Generate the appropriate PDF based on type
    let pdfStream;
    let fileName: string;

    switch (type) {
      case 'cajas':
        pdfStream = generateCajasPDF({
          fechaInicio,
          students: allStudents,
        });
        fileName = `debug-cajas-${schools.length}-escuelas.pdf`;
        break;
      case 'camisas':
        pdfStream = generateCamisasPDF({
          fechaInicio,
          students: allStudents,
        });
        fileName = `debug-camisas-${schools.length}-escuelas.pdf`;
        break;
      case 'pantalones':
        pdfStream = generatePantalonesPDF({
          fechaInicio,
          students: allStudents,
        });
        fileName = `debug-pantalones-${schools.length}-escuelas.pdf`;
        break;
      case 'zapatos':
        pdfStream = generateZapatosPDF({
          fechaInicio,
          students: allStudents,
        });
        fileName = `debug-zapatos-${schools.length}-escuelas.pdf`;
        break;
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

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
    console.error('Error generating debug PDF:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
