import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { regionSchema } from '@/lib/validation/schemas';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';
import { env } from '@/lib/config/env';

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

    // Validate region with Zod
    const { region } = validateQueryParams(request, z.object({ region: regionSchema }));

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

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

    // Check if ZIP job already exists for this region
    const { data: existingZipJob, error: existingError } = await supabase
      .from('zip_jobs')
      .select('id, status, zip_path, zip_size_bytes, pdf_count, error, created_at, updated_at')
      .eq('report_job_id', reportJobId)
      .eq('region', region)
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
        region: region,
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
    if (
      existingZipJob &&
      (existingZipJob.status === 'processing' || existingZipJob.status === 'queued')
    ) {
      return NextResponse.json({
        zipJobId: existingZipJob.id,
        region: region,
        status: existingZipJob.status,
        existingJob: true,
        message: `ZIP generation already ${existingZipJob.status}`,
      });
    }

    // If job exists but failed, retry it
    if (existingZipJob && existingZipJob.status === 'failed') {
      const { data: retryResult, error: retryError } = await supabase.rpc('retry_zip_job', {
        p_job_id: existingZipJob.id,
      });

      if (retryError) {
        console.error('Error calling retry_zip_job RPC:', retryError);
        return NextResponse.json({ error: 'Failed to retry ZIP job' }, { status: 500 });
      }

      // If retry_zip_job returned false, it means the job wasn't in 'failed' status
      // This can happen due to a race condition where the job status changed
      if (!retryResult) {
        console.warn(
          `retry_zip_job returned false for job ${existingZipJob.id}. Job may have already been retried.`
        );

        // Re-fetch the job to get the current status
        const { data: refreshedJob, error: refreshError } = await supabase
          .from('zip_jobs')
          .select('status')
          .eq('id', existingZipJob.id)
          .single();

        if (refreshError || !refreshedJob) {
          console.error('Error fetching refreshed job status:', refreshError);
          return NextResponse.json({ error: 'Failed to fetch job status' }, { status: 500 });
        }

        // Return the current status
        return NextResponse.json({
          zipJobId: existingZipJob.id,
          region: region,
          status: refreshedJob.status,
          existingJob: true,
          message: `ZIP generation already ${refreshedJob.status}`,
        });
      }

      return NextResponse.json({
        zipJobId: existingZipJob.id,
        region: region,
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
        region: region,
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
      region: region,
      status: newZipJob.status,
      existingJob: false,
      message: 'ZIP generation job created. Please poll for status.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Error in create-zip-job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
