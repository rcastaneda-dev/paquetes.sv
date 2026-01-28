import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Get status of a ZIP generation job.
 *
 * Query params:
 *   ?zipJobId=<uuid> (optional - if not provided, returns all ZIP jobs for this report job)
 *   ?region=<region> (optional - filter by region)
 *
 * Response:
 *   {
 *     zipJobId: UUID,
 *     region: string,
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
    const region = request.nextUrl.searchParams.get('region');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // If zipJobId is provided, return single job status
    if (zipJobId) {
      const { data: zipJob, error: zipJobError } = await supabase
        .from('zip_jobs')
        .select('*')
        .eq('id', zipJobId)
        .eq('report_job_id', reportJobId) // Security: ensure job belongs to this report
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
        region: zipJob.region,
        status: zipJob.status,
        downloadUrl,
        zipSizeMB: zipJob.zip_size_bytes
          ? (zipJob.zip_size_bytes / 1024 / 1024).toFixed(2)
          : null,
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

    // Otherwise, return all ZIP jobs for this report (optionally filtered by region)
    let query = supabase
      .from('zip_jobs')
      .select('*')
      .eq('report_job_id', reportJobId);

    if (region) {
      query = query.eq('region', region.toLowerCase());
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
          region: job.region,
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
    console.error('Error in zip-job-status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Helper: Get user-friendly progress message based on status
 */
function getProgressMessage(status: string): { message: string } {
  const messages: Record<string, string> = {
    queued: 'Waiting in queue for processing...',
    processing: 'Generating ZIP file (this may take 1-3 minutes)...',
    complete: 'ZIP generation complete! Ready to download.',
    failed: 'ZIP generation failed. You can retry.',
  };

  return { message: messages[status] || 'Unknown status' };
}
