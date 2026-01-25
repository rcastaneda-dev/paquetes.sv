import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Get job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Allow downloads for complete or failed jobs (failed = partial download of successful PDFs)
    if (job.status !== 'complete' && job.status !== 'failed') {
      return NextResponse.json({ error: 'Job not yet complete' }, { status: 400 });
    }

    // Safety check: if status is failed, ensure no work is still in progress
    if (job.status === 'failed') {
      const { data: progressData } = await supabaseServer.rpc('get_job_progress', {
        p_job_id: jobId,
      });
      const progress = progressData?.[0];
      if (progress && (progress.pending_tasks > 0 || progress.running_tasks > 0)) {
        return NextResponse.json(
          { error: 'Job has pending or running tasks. Please wait for completion.' },
          { status: 202 }
        );
      }
    }

    // Check if bundle is ready
    if (job.zip_path && job.zip_path.endsWith('bundle.zip')) {
      const { data: signedUrlData, error: urlError } = await supabaseServer.storage
        .from('reports')
        .createSignedUrl(job.zip_path, 3600); // 1 hour expiry

      if (urlError || !signedUrlData) {
        console.error('Error generating signed URL:', urlError);
        return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
      }

      return NextResponse.json({
        downloadUrl: signedUrlData.signedUrl,
        bundlePath: job.zip_path,
        expiresIn: 3600,
      });
    }

    // If no bundle yet, check ZIP parts status
    const { data: parts, error: partsErr } = await supabaseServer
      .from('report_zip_parts')
      .select('status')
      .eq('job_id', jobId);

    if (partsErr) {
      console.error('Error fetching zip parts:', partsErr);
      return NextResponse.json({ error: 'Failed to check ZIP status' }, { status: 500 });
    }

    if (!parts || parts.length === 0) {
      return NextResponse.json(
        {
          error: 'ZIP generation not started yet. Please wait for processing to begin.',
        },
        { status: 404 }
      );
    }

    const pending = parts.filter(p => p.status === 'pending').length;
    const running = parts.filter(p => p.status === 'running').length;

    if (pending > 0 || running > 0) {
      return NextResponse.json(
        {
          error: 'ZIP bundle is still being generated. Please wait.',
          status: 'generating',
          pending,
          running,
        },
        { status: 202 }
      );
    }

    return NextResponse.json(
      {
        error: 'ZIP bundle creation in progress. Please refresh in a moment.',
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
