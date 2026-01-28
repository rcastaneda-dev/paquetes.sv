import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJob } from '@/types/database';
import { createJobSchema, limitSchema } from '@/lib/validation/schemas';
import { validateBody, validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

export const dynamic = 'force-dynamic';

// Create a new bulk report job (or batch of shard jobs)
export async function POST(request: NextRequest) {
  try {
    // Validate request body with Zod
    const { shards, params: batchParams } = await validateBody(request, createJobSchema);

    if (shards > 1) {
      // NEW: Create a batch with N shard jobs
      const { data, error } = await supabaseServer.rpc('create_report_job_batch', {
        p_shards: shards,
        p_batch_params: batchParams,
      });

      if (error || !data || data.length === 0) {
        console.error('Error creating report job batch:', error);
        return NextResponse.json(
          { error: error?.message || 'Failed to create batch' },
          { status: 500 }
        );
      }

      const result = data[0] as { batch_id: string; job_ids: string[]; tasks_created: number };

      return NextResponse.json({
        batchId: result.batch_id,
        jobIds: result.job_ids,
        tasksCreated: result.tasks_created,
        shards: shards,
      });
    } else {
      // LEGACY: Single job (backwards compatible)
      const { data, error } = await supabaseServer.rpc('create_report_job', {
        p_job_params: batchParams,
      });

      if (error || !data || data.length === 0) {
        console.error('Error creating report job:', error);
        return NextResponse.json(
          { error: error?.message || 'Failed to create job' },
          { status: 500 }
        );
      }

      const result = data[0] as { job_id: string; tasks_created: number };

      return NextResponse.json({ jobId: result.job_id, tasksCreated: result.tasks_created });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get all jobs
export async function GET(request: NextRequest) {
  try {
    // Validate query params with Zod
    const { limit } = validateQueryParams(request, limitSchema);

    const { data: jobs, error } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching jobs:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ jobs: jobs as ReportJob[] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Delete "past" jobs (terminal states) to declutter the Bulk jobs page.
 *
 * Usage:
 * - DELETE /api/bulk/jobs?scope=past
 *
 * Notes:
 * - DB foreign keys are set to ON DELETE CASCADE for tasks + zip parts.
 * - This does NOT delete objects from Supabase Storage; it only removes DB rows.
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scope = searchParams.get('scope');

    if (scope !== 'past') {
      return NextResponse.json(
        { error: 'Missing or invalid scope. Use ?scope=past' },
        { status: 400 }
      );
    }

    const terminalStatuses: ReportJob['status'][] = ['complete', 'failed', 'cancelled'];

    const { error, count } = await supabaseServer
      .from('report_jobs')
      .delete({ count: 'exact' })
      .in('status', terminalStatuses);

    if (error) {
      console.error('Error deleting past jobs:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedCount: count ?? 0 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
