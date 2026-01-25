import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Cancel a bulk report job and all its pending/running tasks
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Optional: get reason from request body
    let reason: string | null = null;
    try {
      const body = await request.json();
      reason = body.reason || null;
    } catch {
      // No body or invalid JSON, use default reason
    }

    // Call the cancel RPC
    const { data, error } = await supabaseServer.rpc('cancel_report_job', {
      p_job_id: jobId,
      p_reason: reason,
    });

    if (error) {
      console.error('Error cancelling job:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 });
    }

    const result = data[0] as {
      success: boolean;
      message: string;
      tasks_cancelled: number;
      zip_parts_cancelled: number;
    };

    if (!result.success) {
      // Job couldn't be cancelled (wrong status, not found, etc.)
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
      tasksCancelled: result.tasks_cancelled,
      zipPartsCancelled: result.zip_parts_cancelled,
      job: job || null,
    });
  } catch (error) {
    console.error('Unexpected error cancelling job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
