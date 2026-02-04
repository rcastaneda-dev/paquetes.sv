import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

// Schema for creating a category report job
const createCategoryJobSchema = z.object({
  fecha_inicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_inicio must be in YYYY-MM-DD format'),
});

/**
 * Create a new category report job (4 PDFs: Cajas, Camisas, Pantalones, Zapatos)
 */
export async function POST(request: NextRequest) {
  try {
    // Validate request body with Zod
    const { fecha_inicio } = await validateBody(request, createCategoryJobSchema);

    // Call RPC to create job with 4 category tasks
    const { data, error } = await supabaseServer.rpc('create_category_report_job', {
      p_fecha_inicio: fecha_inicio,
      p_job_params: { type: 'category_report', fecha_inicio },
    });

    if (error || !data || data.length === 0) {
      console.error('Error creating category report job:', error);
      return NextResponse.json(
        { error: error?.message || 'Failed to create category job' },
        { status: 500 }
      );
    }

    const result = data[0] as { job_id: string; tasks_created: number };

    return NextResponse.json({
      jobId: result.job_id,
      tasksCreated: result.tasks_created,
      fechaInicio: fecha_inicio,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
