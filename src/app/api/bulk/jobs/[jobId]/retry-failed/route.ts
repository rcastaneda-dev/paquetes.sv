import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Retry all failed tasks for a bulk report job
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Call the retry RPC
    const { data, error } = await supabaseServer.rpc('retry_failed_tasks', {
      p_job_id: jobId,
    });

    if (error) {
      console.error('Error retrying failed tasks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Failed to retry tasks' }, { status: 500 });
    }

    const result = data[0] as {
      success: boolean;
      message: string;
      tasks_retried: number;
    };

    if (!result.success) {
      // RPC returned an error message (e.g., job not found, wrong status)
      const statusCode = result.message.includes('not found') ? 404 : 409;
      return NextResponse.json(
        {
          error: result.message,
          success: false,
        },
        { status: statusCode }
      );
    }

    // Fetch updated job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError) {
      console.error('Error fetching updated job:', jobError);
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      tasksRetried: result.tasks_retried,
      job: job || null,
    });
  } catch (error) {
    console.error('Unexpected error retrying failed tasks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
