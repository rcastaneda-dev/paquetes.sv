import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createValidationErrorResponse } from '@/lib/validation/errors';
import { env } from '@/lib/config/env';

/**
 * Create a school-bundle ZIP job (one merged PDF per school with Cajas + Uniformes + Zapatos).
 *
 * POST /api/bulk/jobs/[jobId]/create-school-bundle-zip-job
 *
 * Response:
 *   {
 *     zipJobId: UUID,
 *     status: 'queued' | 'processing' | 'complete',
 *     message: string,
 *     existingJob?: boolean
 *   }
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const reportJobId = params.jobId;

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Verify report job exists and is a category job
    const { data: reportJob, error: reportJobError } = await supabase
      .from('report_jobs')
      .select('status, job_params')
      .eq('id', reportJobId)
      .single();

    if (reportJobError || !reportJob) {
      return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
    }

    const isCategoryJob = reportJob.job_params && 'fecha_inicio' in reportJob.job_params;
    if (!isCategoryJob) {
      return NextResponse.json(
        { error: 'This endpoint is only for category report jobs (requires fecha_inicio)' },
        { status: 400 }
      );
    }

    if (reportJob.status !== 'complete' && reportJob.status !== 'failed') {
      return NextResponse.json(
        { error: 'Report job must be complete before creating ZIP' },
        { status: 400 }
      );
    }

    // Check if a school_bundle ZIP job already exists for this report
    const { data: existingZipJob, error: existingError } = await supabase
      .from('zip_jobs')
      .select('id, status, zip_path, zip_size_bytes, pdf_count, error, created_at, updated_at')
      .eq('report_job_id', reportJobId)
      .eq('job_kind', 'school_bundle')
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

      if (!retryResult) {
        const { data: refreshedJob, error: refreshError } = await supabase
          .from('zip_jobs')
          .select('status')
          .eq('id', existingZipJob.id)
          .single();

        if (refreshError || !refreshedJob) {
          return NextResponse.json({ error: 'Failed to fetch job status' }, { status: 500 });
        }

        return NextResponse.json({
          zipJobId: existingZipJob.id,
          status: refreshedJob.status,
          existingJob: true,
          message: `ZIP generation already ${refreshedJob.status}`,
        });
      }

      return NextResponse.json({
        zipJobId: existingZipJob.id,
        status: 'queued',
        existingJob: true,
        message: 'Retrying failed ZIP generation',
      });
    }

    // Create new school_bundle ZIP job
    const { data: newZipJob, error: createError } = await supabase
      .from('zip_jobs')
      .insert({
        report_job_id: reportJobId,
        job_kind: 'school_bundle',
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
      status: newZipJob.status,
      existingJob: false,
      message: 'School bundle ZIP job created. Please poll for status.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Error in create-school-bundle-zip-job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
