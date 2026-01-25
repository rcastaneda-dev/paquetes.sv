import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJob, SchoolGradeCombination } from '@/types/database';

export const dynamic = 'force-dynamic';

// Create a new bulk report job
export async function POST() {
  try {
    // Get all school-grade combinations
    const { data: combinations, error: combError } = await supabaseServer.rpc('get_school_grade_combinations');

    if (combError) {
      console.error('Error getting combinations:', combError);
      return NextResponse.json({ error: combError.message }, { status: 500 });
    }

    const schoolGrades = combinations as SchoolGradeCombination[];

    if (schoolGrades.length === 0) {
      return NextResponse.json({ error: 'No school-grade combinations found' }, { status: 400 });
    }

    // Create job
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .insert({
        status: 'queued',
        job_params: { total_combinations: schoolGrades.length },
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    // Create tasks for each school-grade combination
    const tasks = schoolGrades.map((combo) => ({
      job_id: job.id,
      school_codigo_ce: combo.school_codigo_ce,
      grado: combo.grado,
      status: 'pending' as const,
    }));

    const { error: tasksError } = await supabaseServer
      .from('report_tasks')
      .insert(tasks);

    if (tasksError) {
      console.error('Error creating tasks:', tasksError);
      // Try to clean up the job
      await supabaseServer.from('report_jobs').delete().eq('id', job.id);
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      tasksCreated: tasks.length,
    });
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
