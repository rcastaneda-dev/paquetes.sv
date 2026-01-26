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

    // Parse environment variables with explicit NaN handling
    // For Vercel: 10s timeout (Free), 60s (Pro), 300s (Enterprise)
    // Use 240s (4min) as default to leave buffer for Vercel's 300s limit
    const jobLimitRaw = (process.env.ZIP_WORKER_JOB_LIMIT || '1').trim();
    const maxRuntimeRaw = (process.env.ZIP_WORKER_MAX_RUNTIME || '240000').trim();
    const jobLimitParsed = parseInt(jobLimitRaw, 10);
    const maxRuntimeParsed = parseInt(maxRuntimeRaw, 10);
    const jobLimit = Number.isNaN(jobLimitParsed) ? 1 : jobLimitParsed;
    const maxRuntime = Number.isNaN(maxRuntimeParsed) ? 240000 : maxRuntimeParsed; // 240s default (4min)
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

      // Process jobs sequentially (each job can be large and timeout-prone)
      // Process one job at a time to avoid timeouts
      for (const job of completedJobs) {
        // Check if we have enough time remaining (need at least 30s buffer)
        const elapsed = Date.now() - startTime;
        const remaining = maxRuntime - elapsed;
        if (remaining < 30000) {
          console.log(`Insufficient time remaining (${remaining}ms), stopping`);
          break;
        }

        try {
          await createBundleDirectly(job.id, startTime, maxRuntime);
          totalJobsSuccessful++;
        } catch (error) {
          console.error(`Failed to process job ${job.id}:`, error);
          totalJobsFailed++;
        }
        totalJobsProcessed++;
      }

      console.log(
        `ZIP batch ${batchCount} complete: ${totalJobsSuccessful} succeeded, ${totalJobsFailed} failed`
      );

      // Check if approaching time limit (need 30s buffer for safety)
      const elapsed = Date.now() - startTime;
      const remaining = maxRuntime - elapsed;
      if (remaining < 30000) {
        console.log(
          `Approaching time limit (${Math.round(remaining / 1000)}s remaining), stopping drain loop`
        );
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
 * @param startTime - Start time of the worker invocation (for timeout checks)
 * @param maxRuntime - Maximum runtime in milliseconds (for timeout checks)
 */
async function createBundleDirectly(
  jobId: string,
  startTime: number,
  maxRuntime: number
): Promise<void> {
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

    // Estimate if this job is too large (roughly 1 PDF per second, need 30s buffer)
    const estimatedTime = allTasks.length * 1000; // 1s per PDF estimate
    const elapsed = Date.now() - startTime;
    const remaining = maxRuntime - elapsed;
    if (estimatedTime > remaining - 30000) {
      throw new Error(
        `Job too large (${allTasks.length} PDFs, estimated ${Math.round(estimatedTime / 1000)}s, only ${Math.round(remaining / 1000)}s remaining). Will retry in next invocation.`
      );
    }

    // Create ZIP archive with optimized compression (level 1 for speed on large files)
    const archive = archiver('zip', { zlib: { level: 1 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Download and add PDFs in parallel batches (20 at a time for better throughput)
    const BATCH_SIZE = 20;
    let processedCount = 0;
    for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
      // Check timeout before each batch
      const batchElapsed = Date.now() - startTime;
      const batchRemaining = maxRuntime - batchElapsed;
      if (batchRemaining < 30000) {
        throw new Error(
          `Timeout approaching (${Math.round(batchRemaining / 1000)}s remaining). Processed ${processedCount}/${allTasks.length} PDFs. Will retry in next invocation.`
        );
      }

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
          processedCount++;
        }
      }

      // Log progress every 100 PDFs
      if (processedCount % 100 === 0) {
        console.log(`Progress: ${processedCount}/${allTasks.length} PDFs added to ZIP`);
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
