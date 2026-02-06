import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJob, ReportTask, JobProgress } from '@/types/database';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';

// Schema for job detail query params
const jobDetailQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Validate query params with Zod
    const { search, status, limit } = validateQueryParams(request, jobDetailQuerySchema);
    const searchQuery = search?.trim() || '';
    const statusFilter = status || '';

    // Get job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError) {
      // PGRST116 means no rows found - return 404 without logging
      if (jobError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      // Other errors should be logged
      console.error('Error fetching job:', jobError);
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Determine if this is a category report job (has fecha_inicio in job_params)
    const isCategoryJob = job.job_params && 'fecha_inicio' in job.job_params;

    // Get progress stats using the appropriate RPC
    const progressRpc = isCategoryJob ? 'get_category_job_progress' : 'get_job_progress';
    const { data: progressData, error: progressError } = await supabaseServer.rpc(progressRpc, {
      p_job_id: jobId,
    });

    if (progressError) {
      console.error('Error fetching progress:', progressError);
      return NextResponse.json({ error: progressError.message }, { status: 500 });
    }

    const progress = progressData?.[0] as JobProgress;

    // For category jobs, fetch category tasks instead of school tasks
    if (isCategoryJob) {
      // If searching, resolve matching school codes first
      let categorySchoolCodes: string[] | null = null;
      if (searchQuery) {
        const { data: matchingSchools } = await supabaseServer
          .from('schools')
          .select('codigo_ce')
          .or(`codigo_ce.ilike.%${searchQuery}%,nombre_ce.ilike.%${searchQuery}%`);

        categorySchoolCodes = matchingSchools?.map(s => s.codigo_ce) || [];

        if (categorySchoolCodes.length === 0) {
          // Still need progress and uniqueSchools even when no search results
          const { data: schoolRows } = await supabaseServer
            .from('report_category_tasks')
            .select('school_codigo_ce')
            .eq('job_id', jobId)
            .not('school_codigo_ce', 'is', null);

          const uniqueSchools = new Set(schoolRows?.map(r => r.school_codigo_ce)).size;

          return NextResponse.json({
            job: job as ReportJob,
            progress,
            tasks: [],
            isCategoryJob: true,
            uniqueSchools,
          });
        }
      }

      // Category jobs don't have school-level tasks, they have category-level tasks
      let categoryTasksQuery = supabaseServer
        .from('report_category_tasks')
        .select('*, schools:school_codigo_ce(nombre_ce)')
        .eq('job_id', jobId);

      // Apply school search filter
      if (categorySchoolCodes && categorySchoolCodes.length > 0) {
        categoryTasksQuery = categoryTasksQuery.in('school_codigo_ce', categorySchoolCodes);
      }

      // Apply status filter if provided
      if (statusFilter) {
        categoryTasksQuery = categoryTasksQuery.eq('status', statusFilter);
      }

      categoryTasksQuery = categoryTasksQuery.order('category', { ascending: true });

      const { data: categoryTasks, error: categoryTasksError } = await categoryTasksQuery;

      if (categoryTasksError) {
        console.error('Error fetching category tasks:', categoryTasksError);
        return NextResponse.json({ error: categoryTasksError.message }, { status: 500 });
      }

      // Count distinct schools being processed (from unfiltered tasks)
      const { data: schoolRows } = await supabaseServer
        .from('report_category_tasks')
        .select('school_codigo_ce')
        .eq('job_id', jobId)
        .not('school_codigo_ce', 'is', null);

      const uniqueSchools = new Set(schoolRows?.map(r => r.school_codigo_ce)).size;

      // Return category tasks (no school search for category reports)
      return NextResponse.json({
        job: job as ReportJob,
        progress,
        tasks: categoryTasks || [],
        isCategoryJob: true,
        uniqueSchools,
      });
    }

    // Regular job flow: Get tasks with school information, search, and filters
    // If searching, we need to query schools first to get matching codes
    let schoolCodes: string[] | null = null;
    if (searchQuery) {
      const { data: matchingSchools } = await supabaseServer
        .from('schools')
        .select('codigo_ce')
        .or(`codigo_ce.ilike.%${searchQuery}%,nombre_ce.ilike.%${searchQuery}%`);

      schoolCodes = matchingSchools?.map(s => s.codigo_ce) || [];

      // If no matching schools found, return empty results
      if (schoolCodes.length === 0) {
        return NextResponse.json({
          job: job as ReportJob,
          progress,
          tasks: [],
        });
      }
    }

    // Join with schools table to get nombre_ce
    let tasksQuery = supabaseServer
      .from('report_tasks')
      .select('*, schools!report_tasks_school_codigo_ce_fkey(nombre_ce)')
      .eq('job_id', jobId);

    // Apply school search filter
    if (schoolCodes && schoolCodes.length > 0) {
      tasksQuery = tasksQuery.in('school_codigo_ce', schoolCodes);
    }

    // Apply status filter
    if (statusFilter) {
      tasksQuery = tasksQuery.eq('status', statusFilter);
    }

    // Order and limit
    tasksQuery = tasksQuery.order('updated_at', { ascending: false }).limit(limit);

    const { data: tasks, error: tasksError } = await tasksQuery;

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    return NextResponse.json({
      job: job as ReportJob,
      progress,
      tasks: tasks as ReportTask[],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Delete a single job (only allowed for terminal states).
 *
 * Notes:
 * - Cascades to tasks via FK ON DELETE CASCADE.
 * - Does NOT delete Supabase Storage objects referenced by pdf_path/zip_path.
 */
export async function DELETE(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('id,status')
      .eq('id', jobId)
      .single();

    if (jobError) {
      const status = jobError.code === 'PGRST116' ? 404 : 500;
      return NextResponse.json(
        { error: status === 404 ? 'Job not found' : jobError.message },
        { status }
      );
    }

    const status = (job as { status: ReportJob['status'] }).status;
    const terminalStatuses: ReportJob['status'][] = ['complete', 'failed', 'cancelled'];

    if (!terminalStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Job cannot be deleted while status is "${status}"` },
        { status: 409 }
      );
    }

    const { error: deleteError, count } = await supabaseServer
      .from('report_jobs')
      .delete({ count: 'exact' })
      .eq('id', jobId);

    if (deleteError) {
      console.error('Error deleting job:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (!count) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
