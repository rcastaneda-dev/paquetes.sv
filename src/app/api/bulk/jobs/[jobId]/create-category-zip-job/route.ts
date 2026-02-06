import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';
import { env } from '@/lib/config/env';

// Valid category values
const categorySchema = z.enum([
  'estudiantes',
  'camisa',
  'prenda_inferior',
  'zapatos',
  'ficha_uniformes',
  'ficha_zapatos',
]);

/**
 * Create a category ZIP generation job for a specific category.
 *
 * Query params:
 *   ?category=estudiantes|camisa|prenda_inferior|zapatos|ficha_uniformes|ficha_zapatos
 *
 * Response:
 *   {
 *     zipJobId: UUID,
 *     category: string,
 *     status: 'queued' | 'processing' | 'complete',
 *     message: string,
 *     existingJob?: boolean
 *   }
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const reportJobId = params.jobId;

    // Validate category with Zod
    const { category } = validateQueryParams(request, z.object({ category: categorySchema }));

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify report job exists and is a category job
    const { data: reportJob, error: reportJobError } = await supabase
      .from('report_jobs')
      .select('status, job_params')
      .eq('id', reportJobId)
      .single();

    if (reportJobError || !reportJob) {
      return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
    }

    // Check if this is a category job
    const isCategoryJob = reportJob.job_params && 'fecha_inicio' in reportJob.job_params;
    if (!isCategoryJob) {
      return NextResponse.json(
        { error: 'This endpoint is only for category report jobs' },
        { status: 400 }
      );
    }

    // Check if job is complete or failed
    if (reportJob.status !== 'complete' && reportJob.status !== 'failed') {
      return NextResponse.json(
        { error: 'Report job must be complete before creating ZIP' },
        { status: 400 }
      );
    }

    // Check if ZIP job already exists for this category
    const { data: existingZipJob, error: existingError } = await supabase
      .from('zip_jobs')
      .select('id, status, zip_path, zip_size_bytes, pdf_count, error, created_at, updated_at')
      .eq('report_job_id', reportJobId)
      .eq('job_kind', 'category')
      .eq('category', category)
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
        category: category,
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
        category: category,
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

        return NextResponse.json({
          zipJobId: existingZipJob.id,
          category: category,
          status: refreshedJob.status,
          existingJob: true,
          message: `ZIP generation already ${refreshedJob.status}`,
        });
      }

      return NextResponse.json({
        zipJobId: existingZipJob.id,
        category: category,
        status: 'queued',
        existingJob: true,
        message: 'Retrying failed ZIP generation',
      });
    }

    // Create new category ZIP job
    const { data: newZipJob, error: createError } = await supabase
      .from('zip_jobs')
      .insert({
        report_job_id: reportJobId,
        job_kind: 'category',
        category: category,
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
      category: category,
      status: newZipJob.status,
      existingJob: false,
      message: 'ZIP generation job created. Please poll for status.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    console.error('Error in create-category-zip-job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
