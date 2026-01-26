import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { streamToBuffer } from '@/lib/zip/bundler';
import { buildZipPdfEntryName } from '@/lib/storage/keys';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';

/**
 * Worker endpoint that creates ZIP bundles for completed jobs.
 *
 * Simplified single-pass approach: directly creates bundle.zip from completed PDFs.
 * Optimized for jobs up to 6k PDFs with parallel downloading and streaming compression.
 */
export async function POST(request: NextRequest) {
  try {
    // Simple authentication check
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.SUPABASE_FUNCTION_SECRET || process.env.CRON_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const jobLimit = parseInt(process.env.ZIP_WORKER_JOB_LIMIT || '100', 10);
    const maxRuntime = parseInt(process.env.ZIP_WORKER_MAX_RUNTIME || '9000', 10); // 9s default
    const startTime = Date.now();

    let totalJobsProcessed = 0;
    let totalJobsSuccessful = 0;
    let totalJobsFailed = 0;
    let batchCount = 0;

    console.log(`ZIP worker drain started: maxRuntime=${maxRuntime}ms, jobLimit=${jobLimit}`);

    // Drain-loop: process jobs until time budget exhausted
    while (Date.now() - startTime < maxRuntime) {
      // Find completed/failed jobs without bundle.zip
      const { data: completedJobs, error: jobsError } = await supabaseServer
        .from('report_jobs')
        .select('id')
        .in('status', ['complete', 'failed'])
        .is('zip_path', null)
        .limit(jobLimit);

      if (jobsError) {
        console.error('Error fetching jobs:', jobsError);
        break;
      }

      if (!completedJobs || completedJobs.length === 0) {
        console.log('No more jobs without ZIP, exiting drain loop');
        break;
      }

      batchCount++;
      console.log(`ZIP batch ${batchCount}: Processing ${completedJobs.length} job(s)`);

      // Process jobs sequentially (each job can be large)
      const results = await Promise.allSettled(
        completedJobs.map(job => createBundleDirectly(job.id))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      totalJobsProcessed += completedJobs.length;
      totalJobsSuccessful += successful;
      totalJobsFailed += failed;

      console.log(`ZIP batch ${batchCount} complete: ${successful} succeeded, ${failed} failed`);

      // Check if approaching time limit
      const elapsed = Date.now() - startTime;
      const remaining = maxRuntime - elapsed;
      if (remaining < 2000) {
        console.log(`Approaching time limit (${remaining}ms remaining), stopping drain loop`);
        break;
      }
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      message: 'ZIP queue drain complete',
      batches: batchCount,
      jobsProcessed: totalJobsProcessed,
      jobsSuccessful: totalJobsSuccessful,
      jobsFailed: totalJobsFailed,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('ZIP worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Create bundle.zip directly for a job by streaming all completed PDFs.
 * Uses parallel downloading in batches to optimize network performance.
 */
async function createBundleDirectly(jobId: string): Promise<void> {
  try {
    console.log(`Creating bundle.zip for job ${jobId}`);

    // Check if bundle already exists
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('zip_path')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.zip_path && job.zip_path.endsWith('bundle.zip')) {
      console.log(`Bundle already exists for job ${jobId}, skipping`);
      return;
    }

    // Get all completed tasks
    const { data: allTasks, error: tasksError } = await supabaseServer
      .from('report_tasks')
      .select('pdf_path, school_codigo_ce, grado')
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .order('school_codigo_ce', { ascending: true })
      .order('grado', { ascending: true });

    if (tasksError) {
      throw new Error(`Failed to fetch tasks: ${tasksError.message}`);
    }

    if (!allTasks || allTasks.length === 0) {
      console.log(`No completed tasks found for job ${jobId}, skipping ZIP creation`);
      return;
    }

    console.log(`Bundling ${allTasks.length} PDFs for job ${jobId}`);

    // Create ZIP archive with optimized compression (level 6 for speed)
    const archive = archiver('zip', { zlib: { level: 6 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Download and add PDFs in parallel batches (10 at a time)
    const BATCH_SIZE = 10;
    for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
      const batch = allTasks.slice(i, i + BATCH_SIZE);

      // Download batch in parallel
      const downloadResults = await Promise.allSettled(
        batch.map(async task => {
          const pdfPath = task.pdf_path as string;
          const { data: pdfData, error: downloadError } = await supabaseServer.storage
            .from('reports')
            .download(pdfPath);

          if (downloadError || !pdfData) {
            console.error(`Failed to download ${pdfPath}:`, downloadError);
            return null;
          }

          return {
            task,
            pdfData,
          };
        })
      );

      // Add successfully downloaded PDFs to archive
      for (const result of downloadResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { task, pdfData } = result.value;
          const fileName = buildZipPdfEntryName({
            schoolCodigoCe: task.school_codigo_ce,
            grado: task.grado,
          });
          const webStream = pdfData.stream();
          const nodeStream = Readable.fromWeb(webStream as any);
          archive.append(nodeStream, { name: fileName });
        }
      }
    }

    // Finalize archive
    await archive.finalize();
    const bundleBuffer = await streamToBuffer(passThrough);

    console.log(`Bundle created with ${allTasks.length} PDFs, size: ${bundleBuffer.length} bytes`);

    // Upload bundle
    const bundlePath = `${jobId}/bundle.zip`;
    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(bundlePath, bundleBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload bundle: ${uploadError.message}`);
    }

    // Update job with bundle path
    await supabaseServer
      .from('report_jobs')
      .update({ zip_path: bundlePath, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    console.log(`Bundle finalized for job ${jobId}: ${bundlePath}`);
  } catch (error) {
    console.error(`Failed to create bundle for job ${jobId}:`, error);
    throw error;
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'ZIP worker is running' });
}
