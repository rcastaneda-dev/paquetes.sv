import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';

/**
 * Get status of a school-bundle ZIP generation job.
 *
 * GET /api/bulk/jobs/[jobId]/school-bundle-zip-status?zipJobId=<uuid>
 *
 * Response:
 *   {
 *     zipJobId: UUID,
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

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    if (zipJobId) {
      // Return single job status
      const { data: zipJob, error: zipJobError } = await supabase
        .from('zip_jobs')
        .select('*')
        .eq('id', zipJobId)
        .eq('report_job_id', reportJobId)
        .eq('job_kind', 'school_bundle')
        .maybeSingle();

      if (zipJobError) {
        console.error('Error fetching ZIP job:', zipJobError);
        return NextResponse.json({ error: 'Failed to fetch ZIP job' }, { status: 500 });
      }

      if (!zipJob) {
        return NextResponse.json({ error: 'ZIP job not found' }, { status: 404 });
      }

      let downloadUrl = null;
      if (zipJob.status === 'complete' && zipJob.zip_path) {
        const { data: signedUrl } = await supabase.storage
          .from('reports')
          .createSignedUrl(zipJob.zip_path, 3600);
        downloadUrl = signedUrl?.signedUrl;
      }

      return NextResponse.json({
        zipJobId: zipJob.id,
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

    // Return the school_bundle job for this report (there's at most one)
    const { data: zipJob, error: zipJobError } = await supabase
      .from('zip_jobs')
      .select('*')
      .eq('report_job_id', reportJobId)
      .eq('job_kind', 'school_bundle')
      .maybeSingle();

    if (zipJobError) {
      console.error('Error fetching ZIP job:', zipJobError);
      return NextResponse.json({ error: 'Failed to fetch ZIP job' }, { status: 500 });
    }

    if (!zipJob) {
      return NextResponse.json({ error: 'No school bundle ZIP job found' }, { status: 404 });
    }

    let downloadUrl = null;
    if (zipJob.status === 'complete' && zipJob.zip_path) {
      const { data: signedUrl } = await supabase.storage
        .from('reports')
        .createSignedUrl(zipJob.zip_path, 3600);
      downloadUrl = signedUrl?.signedUrl;
    }

    return NextResponse.json({
      zipJobId: zipJob.id,
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
  } catch (error) {
    console.error('Error in school-bundle-zip-status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getProgressMessage(status: string): { message: string } {
  const messages: Record<string, string> = {
    queued: 'En cola para ser procesado...',
    processing: 'Generando archivo comprimido (puede tardar entre 3 y 10 minutos)...',
    complete: 'Generación del archivo comprimido completa. Listo para descargar.',
    failed: 'La generación del archivo comprimido falló. Puedes intentarlo de nuevo.',
  };

  return { message: messages[status] || 'Unknown status' };
}
