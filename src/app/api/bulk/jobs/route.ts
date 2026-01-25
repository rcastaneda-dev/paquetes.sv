import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJob } from '@/types/database';

export const dynamic = 'force-dynamic';

// Create a new bulk report job
export async function POST() {
  try {
    // IMPORTANT (scale): do job+task creation inside Postgres to avoid timeouts
    // and avoid returning ~50k combinations over HTTP.
    const { data, error } = await supabaseServer.rpc('create_report_job', {
      p_job_params: null,
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
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Get all jobs
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

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
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
