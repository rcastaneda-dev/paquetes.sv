import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

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

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'complete') {
      return NextResponse.json({ error: 'Job not yet complete' }, { status: 400 });
    }

    if (!job.zip_path) {
      return NextResponse.json({ error: 'No ZIP file available' }, { status: 404 });
    }

    // Generate signed URL for the ZIP file
    const { data: signedUrlData, error: urlError } = await supabaseServer
      .storage
      .from('reports')
      .createSignedUrl(job.zip_path, 3600); // 1 hour expiry

    if (urlError || !signedUrlData) {
      console.error('Error generating signed URL:', urlError);
      return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
    }

    return NextResponse.json({
      downloadUrl: signedUrlData.signedUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
