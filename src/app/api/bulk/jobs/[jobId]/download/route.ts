import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Download endpoint that returns a signed URL for an existing ZIP bundle.
 *
 * This endpoint ONLY returns existing bundles. It does NOT create them.
 * Use the /generate-zip endpoint to create bundles.
 *
 * Flow:
 * 1. User clicks download → This endpoint is called
 * 2. Check if bundle exists in database
 * 3. Generate signed URL for the bundle
 * 4. Return signed URL to user
 */
export async function GET(_request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Get job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('status, zip_path')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Check if job is complete or failed
    if (job.status !== 'complete' && job.status !== 'failed') {
      return NextResponse.json({ error: 'Job not yet complete' }, { status: 400 });
    }

    // Check if bundle exists
    if (!job.zip_path || !job.zip_path.endsWith('bundle.zip')) {
      return NextResponse.json(
        { error: 'ZIP bundle not generated yet. Please generate it first.' },
        { status: 404 }
      );
    }

    // Generate signed URL for existing bundle
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
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
