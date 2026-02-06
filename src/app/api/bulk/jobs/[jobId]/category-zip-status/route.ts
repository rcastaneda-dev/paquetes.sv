import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { validateQueryParams } from '@/lib/validation/helpers';
import { createValidationErrorResponse } from '@/lib/validation/errors';
import { env } from '@/lib/config/env';

// Valid category values
const categorySchema = z.enum(['estudiantes', 'camisa', 'prenda_inferior', 'zapatos']);

/**
 * Get status of a category ZIP generation job.
 *
 * Query params:
 *   ?zipJobId=<uuid> (optional)
 *   ?category=<category> (optional - returns all category ZIPs if omitted)
 *
 * Response:
 *   {
 *     zipJobId: UUID,
 *     category: string,
 *     status: 'queued' | 'processing' | 'complete' | 'failed',
 *     downloadUrl?: string (if complete),
 *     zipSizeMB?: number,
 *     pdfCount?: number,
 *     error?: string (if failed),
 *     progress?: { message: string },
 *     timestamps: { created, started, completed/failed }
 *   }
 */
export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const reportJobId = params.jobId;
    const zipJobId = request.nextUrl.searchParams.get('zipJobId');
    const categoryParam = request.nextUrl.searchParams.get('category');

    // Validate category if provided
    let category: string | null = null;
    if (categoryParam) {
      try {
        const validated = validateQueryParams(request, z.object({ category: categorySchema }));
        category = validated.category;
      } catch (error) {
        if (error instanceof z.ZodError) {
          return createValidationErrorResponse(error);
        }
        throw error;
      }
    }

    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // If zipJobId is provided, return single job status
    if (zipJobId) {
      const { data: zipJob, error: zipJobError } = await supabase
        .from('zip_jobs')
        .select('*')
        .eq('id', zipJobId)
        .eq('report_job_id', reportJobId)
        .eq('job_kind', 'category')
        .maybeSingle();

      if (zipJobError) {
        console.error('Error fetching ZIP job:', zipJobError);
        return NextResponse.json({ error: 'Failed to fetch ZIP job' }, { status: 500 });
      }

      if (!zipJob) {
        return NextResponse.json({ error: 'ZIP job not found' }, { status: 404 });
      }

      // If complete, generate signed download URL
      let downloadUrl = null;
      if (zipJob.status === 'complete' && zipJob.zip_path) {
        const { data: signedUrl } = await supabase.storage
          .from('reports')
          .createSignedUrl(zipJob.zip_path, 3600);

        downloadUrl = signedUrl?.signedUrl;
      }

      return NextResponse.json({
        zipJobId: zipJob.id,
        category: zipJob.category,
        status: zipJob.status,
        downloadUrl,
        zipSizeMB: zipJob.zip_size_bytes ? (zipJob.zip_size_bytes / 1024 / 1024).toFixed(2) : null,
        pdfCount: zipJob.pdf_count,
        error: zipJob.error,
        attemptCount: zipJob.attempt_count,
        timestamps: {
          created: zipJob.created_at,
          started: zipJob.started_at,
          completed: zipJob.completed_at,
          failed: zipJob.failed_at,
          updated: zipJob.updated_at,
        },
        progress: getProgressMessage(zipJob.status),
      });
    }

    // Otherwise, return all category ZIP jobs for this report (optionally filtered by category)
    let query = supabase
      .from('zip_jobs')
      .select('*')
      .eq('report_job_id', reportJobId)
      .eq('job_kind', 'category');

    if (category) {
      query = query.eq('category', category);
    }

    const { data: zipJobs, error: zipJobsError } = await query.order('created_at', {
      ascending: true,
    });

    if (zipJobsError) {
      console.error('Error fetching ZIP jobs:', zipJobsError);
      return NextResponse.json({ error: 'Failed to fetch ZIP jobs' }, { status: 500 });
    }

    // Generate signed URLs for completed jobs
    const jobsWithUrls = await Promise.all(
      (zipJobs || []).map(async job => {
        let downloadUrl = null;
        if (job.status === 'complete' && job.zip_path) {
          const { data: signedUrl } = await supabase.storage
            .from('reports')
            .createSignedUrl(job.zip_path, 3600);

          downloadUrl = signedUrl?.signedUrl;
        }

        return {
          zipJobId: job.id,
          category: job.category,
          status: job.status,
          downloadUrl,
          zipSizeMB: job.zip_size_bytes ? (job.zip_size_bytes / 1024 / 1024).toFixed(2) : null,
          pdfCount: job.pdf_count,
          error: job.error,
          attemptCount: job.attempt_count,
          timestamps: {
            created: job.created_at,
            started: job.started_at,
            completed: job.completed_at,
            failed: job.failed_at,
            updated: job.updated_at,
          },
          progress: getProgressMessage(job.status),
        };
      })
    );

    return NextResponse.json({
      reportJobId,
      jobs: jobsWithUrls,
      count: jobsWithUrls.length,
    });
  } catch (error) {
    console.error('Error in category-zip-status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Helper: Get user-friendly progress message based on status
 */
function getProgressMessage(status: string): { message: string } {
  const messages: Record<string, string> = {
    queued: 'En cola para ser procesado...',
    processing: 'Generando archivo ZIP (puede tardar entre 1 y 3 minutos)...',
    complete: 'Generación del ZIP completa. Listo para descargar.',
    failed: 'La generación del ZIP falló. Puedes intentarlo de nuevo.',
  };

  return { message: messages[status] || 'Unknown status' };
}
