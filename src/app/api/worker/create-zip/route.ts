import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { streamToBuffer } from '@/lib/zip/bundler';
import { buildZipPdfEntryName } from '@/lib/storage/keys';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';

/**
 * Worker endpoint that creates ZIP bundles for completed jobs.
 *
 * IMPORTANT (scale): for large jobs (e.g. 40k PDFs) we create multi-part ZIPs.
 * Each part is bounded (default 100 PDFs) to keep memory/time predictable.
 */
export async function POST(request: NextRequest) {
  try {
    // Simple authentication check
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.SUPABASE_FUNCTION_SECRET || process.env.CRON_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Configurable limits for shard-job scale (recommended: 100 jobs, 5-10 parts)
    const jobLimit = parseInt(process.env.ZIP_WORKER_JOB_LIMIT || '100', 10);
    const partLimit = parseInt(process.env.ZIP_WORKER_PART_LIMIT || '5', 10);

    // Drain-loop: process multiple batches until time budget exhausted
    const maxRuntime = parseInt(process.env.ZIP_WORKER_MAX_RUNTIME || '9000', 10); // 9s default
    const startTime = Date.now();

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let batchCount = 0;
    const allJobIds = new Set<string>();

    console.log(`ZIP worker drain started: maxRuntime=${maxRuntime}ms, partLimit=${partLimit}`);

    // Drain queue until time budget exhausted
    while (Date.now() - startTime < maxRuntime) {
      // 1) Ensure zip parts exist for completed/failed jobs (idempotent)
      // Include 'failed' to allow partial downloads (ZIPs of successful PDFs only)
      const { data: completedJobs, error: jobsError } = await supabaseServer
        .from('report_jobs')
        .select('id')
        .in('status', ['complete', 'failed'])
        .is('zip_path', null)
        .limit(jobLimit);

      if (!jobsError && completedJobs && completedJobs.length > 0) {
        await Promise.allSettled(
          completedJobs.map(j =>
            supabaseServer.rpc('ensure_zip_parts', { p_job_id: j.id, p_part_size: 100 })
          )
        );
      }

      // 2) Claim pending zip parts for processing
      const { data: claimedParts, error: claimError } = await supabaseServer.rpc(
        'claim_pending_zip_parts',
        {
          p_limit: partLimit,
        }
      );

      if (claimError) {
        console.error('Error claiming zip parts:', claimError);
        break;
      }

      const parts = (claimedParts ?? []) as Array<{
        zip_part_id: string;
        job_id: string;
        part_no: number;
        part_size: number;
      }>;

      if (parts.length === 0) {
        console.log('No more pending ZIP parts, exiting drain loop');
        break;
      }

      batchCount++;
      console.log(`ZIP batch ${batchCount}: Creating ${parts.length} parts`);

      const results = await Promise.allSettled(parts.map(p => createZipPart(p)));
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      totalProcessed += parts.length;
      totalSuccessful += successful;
      totalFailed += failed;

      parts.forEach(p => allJobIds.add(p.job_id));

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

    // 3) Finalize manifests for processed jobs
    if (allJobIds.size > 0) {
      console.log(`Finalizing manifests for ${allJobIds.size} jobs`);
      await Promise.allSettled(Array.from(allJobIds).map(jobId => finalizeJobZipManifest(jobId)));
    }

    return NextResponse.json({
      message: 'ZIP queue drain complete',
      batches: batchCount,
      processed: totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('ZIP worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createZipPart(part: {
  zip_part_id: string;
  job_id: string;
  part_no: number;
  part_size: number;
}): Promise<void> {
  try {
    const { zip_part_id, job_id, part_no, part_size } = part;
    console.log(`Creating ZIP part ${part_no} for job ${job_id} (size=${part_size})`);

    const offset = (part_no - 1) * part_size;
    const to = offset + part_size - 1;

    // Fetch the subset of completed tasks (deterministic order) for this part.
    const { data: tasks, error: tasksError } = await supabaseServer
      .from('report_tasks')
      .select('pdf_path, school_codigo_ce, grado')
      .eq('job_id', job_id)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .order('school_codigo_ce', { ascending: true })
      .order('grado', { ascending: true })
      .range(offset, to);

    if (tasksError) {
      throw new Error(`Failed to fetch tasks for part: ${tasksError.message}`);
    }

    if (!tasks || tasks.length === 0) {
      await supabaseServer.rpc('update_zip_part_status', {
        p_zip_part_id: zip_part_id,
        p_status: 'complete',
        p_zip_path: null,
        p_error: 'No PDFs in this part range',
        p_pdf_count: 0,
      });
      return;
    }

    console.log(`Bundling ${tasks.length} PDFs into part ${part_no}`);

    // Create ZIP (stream PDFs into the archive to avoid buffering everything at once)
    const archive = archiver('zip', { zlib: { level: 9 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    for (const task of tasks) {
      const pdfPath = task.pdf_path as string;
      const { data: pdfData, error: downloadError } = await supabaseServer.storage
        .from('reports')
        .download(pdfPath);

      if (downloadError || !pdfData) {
        console.error(`Failed to download ${pdfPath}:`, downloadError);
        continue;
      }

      // Use sanitized ASCII-safe filename for ZIP entry
      const fileName = buildZipPdfEntryName({
        schoolCodigoCe: task.school_codigo_ce,
        grado: task.grado,
      });
      const webStream = pdfData.stream();
      const nodeStream = Readable.fromWeb(webStream as any);
      archive.append(nodeStream, { name: fileName });
    }

    await archive.finalize();

    const zipBuffer = await streamToBuffer(passThrough);

    console.log(`ZIP part created, size: ${zipBuffer.length} bytes`);

    // Upload ZIP part to storage
    const zipPath = `${job_id}/zip-parts/part-${String(part_no).padStart(5, '0')}.zip`;
    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload ZIP: ${uploadError.message}`);
    }

    // Mark zip part as complete
    await supabaseServer.rpc('update_zip_part_status', {
      p_zip_part_id: zip_part_id,
      p_status: 'complete',
      p_zip_path: zipPath,
      p_error: null,
      p_pdf_count: tasks.length,
    });

    console.log(`ZIP part ${part_no} completed for job ${job_id}`);
  } catch (error) {
    console.error(`Failed to create ZIP part ${part.part_no} for job ${part.job_id}:`, error);

    await supabaseServer.rpc('update_zip_part_status', {
      p_zip_part_id: part.zip_part_id,
      p_status: 'failed',
      p_zip_path: null,
      p_error: error instanceof Error ? error.message : 'ZIP part creation failed',
      p_pdf_count: 0,
    });

    throw error;
  }
}

async function finalizeJobZipManifest(jobId: string): Promise<void> {
  try {
    // If we've already created a bundle, skip
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('zip_path')
      .eq('id', jobId)
      .single();

    if (jobError || !job) return;

    if (job.zip_path && job.zip_path.endsWith('bundle.zip')) {
      return;
    }

    const { data: parts, error: partsError } = await supabaseServer
      .from('report_zip_parts')
      .select('part_no, status, zip_path, pdf_count')
      .eq('job_id', jobId)
      .order('part_no', { ascending: true });

    if (partsError || !parts || parts.length === 0) return;

    const allComplete = parts.every(p => p.status === 'complete' && p.zip_path);
    if (!allComplete) return;

    // Create single bundle.zip containing all PDFs from all parts
    console.log(`Creating bundle.zip for job ${jobId} from ${parts.length} parts`);

    // Get all completed tasks to rebuild a single unified ZIP
    const { data: allTasks, error: tasksError } = await supabaseServer
      .from('report_tasks')
      .select('pdf_path, school_codigo_ce, grado')
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .order('school_codigo_ce', { ascending: true })
      .order('grado', { ascending: true });

    if (tasksError || !allTasks || allTasks.length === 0) {
      console.error('No completed tasks found for bundle');
      return;
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Add all PDFs directly to the bundle (single unified ZIP)
    for (const task of allTasks) {
      const pdfPath = task.pdf_path as string;
      const { data: pdfData, error: downloadError } = await supabaseServer.storage
        .from('reports')
        .download(pdfPath);

      if (downloadError || !pdfData) {
        console.error(`Failed to download ${pdfPath}:`, downloadError);
        continue;
      }

      const fileName = buildZipPdfEntryName({
        schoolCodigoCe: task.school_codigo_ce,
        grado: task.grado,
      });
      const webStream = pdfData.stream();
      const nodeStream = Readable.fromWeb(webStream as any);
      archive.append(nodeStream, { name: fileName });
    }

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
      console.error('Failed to upload bundle:', uploadError);
      return;
    }

    // Update job with bundle path
    await supabaseServer
      .from('report_jobs')
      .update({ zip_path: bundlePath, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    console.log(`Bundle finalized for job ${jobId}: ${bundlePath}`);
  } catch (e) {
    console.error('finalizeJobZipManifest error:', e);
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'ZIP worker is running' });
}
