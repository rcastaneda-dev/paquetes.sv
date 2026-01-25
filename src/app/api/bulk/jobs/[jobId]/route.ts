import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJob, ReportTask, JobProgress } from '@/types/database';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId;

    // Get job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError) {
      console.error('Error fetching job:', jobError);
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get progress stats
    const { data: progressData, error: progressError } = await supabaseServer.rpc('get_job_progress', {
      p_job_id: jobId,
    });

    if (progressError) {
      console.error('Error fetching progress:', progressError);
      return NextResponse.json({ error: progressError.message }, { status: 500 });
    }

    const progress = progressData?.[0] as JobProgress;

    // Get tasks
    const { data: tasks, error: tasksError } = await supabaseServer
      .from('report_tasks')
      .select('*')
      .eq('job_id', jobId)
      .order('updated_at', { ascending: false });

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
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Delete a single job (only allowed for terminal states).
 *
 * Notes:
 * - Cascades to tasks + zip parts via FK ON DELETE CASCADE.
 * - Does NOT delete Supabase Storage objects referenced by pdf_path/zip_path.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId;

    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('id,status')
      .eq('id', jobId)
      .single();

    if (jobError) {
      const status = jobError.code === 'PGRST116' ? 404 : 500;
      return NextResponse.json({ error: status === 404 ? 'Job not found' : jobError.message }, { status });
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
