import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import type { ReportJobBatch, ReportJob, BatchProgress } from '@/types/database';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bulk/batches/[batchId]
 * Returns batch details + shard jobs + aggregated progress
 */
export async function GET(request: NextRequest, { params }: { params: { batchId: string } }) {
  try {
    const batchId = params.batchId;

    // Fetch batch details
    const { data: batch, error: batchError } = await supabaseServer
      .from('report_job_batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Fetch shard jobs
    const { data: jobs, error: jobsError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('batch_id', batchId)
      .order('shard_no', { ascending: true });

    if (jobsError) {
      console.error('Error fetching shard jobs:', jobsError);
      return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }

    // Fetch aggregated progress
    const { data: progressData } = await supabaseServer.rpc('get_batch_progress', {
      p_batch_id: batchId,
    });

    const progress = progressData?.[0] as BatchProgress | undefined;

    return NextResponse.json({
      batch: batch as ReportJobBatch,
      jobs: jobs as ReportJob[],
      progress,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
