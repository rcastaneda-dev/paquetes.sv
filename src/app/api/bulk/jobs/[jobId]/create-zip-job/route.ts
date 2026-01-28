import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Create a ZIP generation job for a specific region.
 *
 * This endpoint queues a background ZIP generation job instead of generating
 * the ZIP synchronously. The background worker will pick up the job and process it.
 *
 * Query params:
 *   ?region=oriental|occidental|paracentral|central
 *
 * Response:
 *   {
 *     zipJobId: UUID,
 *     region: string,
 *     status: 'queued' | 'processing' | 'complete',
 *     message: string,
 *     existingJob?: boolean  // True if job already exists
 *   }
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const reportJobId = params.jobId;
    const region = request.nextUrl.searchParams.get('region');

    // Validate region
    const validRegions = ['oriental', 'occidental', 'paracentral', 'central'];
    if (!region || !validRegions.includes(region.toLowerCase())) {
      return NextResponse.json(
        { error: 'Invalid region. Must be: oriental, occidental, paracentral, or central' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify report job exists and is complete/failed
    const { data: reportJob, error: reportJobError } = await supabase
      .from('report_jobs')
      .select('status')
      .eq('id', reportJobId)
      .single();

    if (reportJobError || !reportJob) {
      return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
    }

    if (reportJob.status !== 'complete' && reportJob.status !== 'failed') {
      return NextResponse.json(
        { error: 'Report job must be complete before creating ZIP' },
        { status: 400 }
      );
    }

    const regionLower = region.toLowerCase();

    // Check if ZIP job already exists for this region
    const { data: existingZipJob, error: existingError } = await supabase
      .from('zip_jobs')
      .select('id, status, zip_path, zip_size_bytes, pdf_count, error, created_at, updated_at')
      .eq('report_job_id', reportJobId)
      .eq('region', regionLower)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing ZIP job:', existingError);
      return NextResponse.json({ error: 'Failed to check existing ZIP job' }, { status: 500 });
    }

    // If job exists and is complete, return download URL
    if (existingZipJob && existingZipJob.status === 'complete' && existingZipJob.zip_path) {
      const { data: signedUrl } = await supabase.storage
        .from('reports')
        .createSignedUrl(existingZipJob.zip_path, 3600);

      return NextResponse.json({
        zipJobId: existingZipJob.id,
        region: regionLower,
        status: 'complete',
        downloadUrl: signedUrl?.signedUrl,
        zipSizeMB: existingZipJob.zip_size_bytes
          ? (existingZipJob.zip_size_bytes / 1024 / 1024).toFixed(2)
          : null,
        pdfCount: existingZipJob.pdf_count,
        existingJob: true,
        message: 'ZIP already generated and ready for download',
      });
    }

    // If job exists and is processing or queued, return status
    if (existingZipJob && (existingZipJob.status === 'processing' || existingZipJob.status === 'queued')) {
      return NextResponse.json({
        zipJobId: existingZipJob.id,
        region: regionLower,
        status: existingZipJob.status,
        existingJob: true,
        message: `ZIP generation already ${existingZipJob.status}`,
      });
    }

    // If job exists but failed, retry it
    if (existingZipJob && existingZipJob.status === 'failed') {
      const { error: retryError } = await supabase.rpc('retry_zip_job', {
        p_job_id: existingZipJob.id,
      });

      if (retryError) {
        console.error('Error retrying ZIP job:', retryError);
        return NextResponse.json({ error: 'Failed to retry ZIP job' }, { status: 500 });
      }

      return NextResponse.json({
        zipJobId: existingZipJob.id,
        region: regionLower,
        status: 'queued',
        existingJob: true,
        message: 'Retrying failed ZIP generation',
      });
    }

    // Create new ZIP job
    const { data: newZipJob, error: createError } = await supabase
      .from('zip_jobs')
      .insert({
        report_job_id: reportJobId,
        region: regionLower,
        status: 'queued',
      })
      .select('id, status, created_at')
      .single();

    if (createError) {
      console.error('Error creating ZIP job:', createError);
      return NextResponse.json({ error: 'Failed to create ZIP job' }, { status: 500 });
    }

    return NextResponse.json({
      zipJobId: newZipJob.id,
      region: regionLower,
      status: newZipJob.status,
      existingJob: false,
      message: 'ZIP generation job created. Please poll for status.',
    });
  } catch (error) {
    console.error('Error in create-zip-job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
