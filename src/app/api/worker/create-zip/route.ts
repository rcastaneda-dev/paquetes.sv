import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { streamToBuffer } from '@/lib/zip/bundler';
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

    // 1) Ensure zip parts exist for completed jobs (idempotent)
    // We do this up-front so there is always work to claim, even if ZIP generation lags.
    const { data: completedJobs, error: jobsError } = await supabaseServer
      .from('report_jobs')
      .select('id')
      .eq('status', 'complete')
      .limit(25);

    if (jobsError) {
      console.error('Error finding completed jobs:', jobsError);
      return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }

    const jobs = completedJobs ?? [];
    if (jobs.length > 0) {
      await Promise.allSettled(
        jobs.map(j => supabaseServer.rpc('ensure_zip_parts', { p_job_id: j.id, p_part_size: 100 }))
      );
    }

    // 2) Claim pending zip parts for processing
    const { data: claimedParts, error: claimError } = await supabaseServer.rpc(
      'claim_pending_zip_parts',
      {
        p_limit: 2,
      }
    );

    if (claimError) {
      console.error('Error claiming zip parts:', claimError);
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    const parts = (claimedParts ?? []) as Array<{
      zip_part_id: string;
      job_id: string;
      part_no: number;
      part_size: number;
    }>;

    if (parts.length === 0) {
      return NextResponse.json({ message: 'No pending ZIP parts', processed: 0 });
    }

    console.log(`Creating ZIP parts: ${parts.map(p => `${p.job_id}#${p.part_no}`).join(', ')}`);

    const results = await Promise.allSettled(parts.map(p => createZipPart(p)));
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // 3) Attempt to finalize any jobs whose zip parts are complete (manifest)
    const jobIds = [...new Set(parts.map(p => p.job_id))];
    await Promise.allSettled(jobIds.map(jobId => finalizeJobZipManifest(jobId)));

    return NextResponse.json({
      message: 'ZIP part creation processed',
      processed: parts.length,
      successful,
      failed,
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

      const fileName = `${task.school_codigo_ce}-${task.grado}.pdf`;
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
    // If we've already written a manifest (zip_path pointing to manifest), skip.
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('zip_path')
      .eq('id', jobId)
      .single();

    if (jobError || !job) return;

    if (job.zip_path && job.zip_path.endsWith('.manifest.json')) {
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

    const manifestPath = `${jobId}/bundle.manifest.json`;
    const manifest = {
      jobId,
      partCount: parts.length,
      createdAt: new Date().toISOString(),
      parts: parts.map(p => ({
        partNo: p.part_no,
        zipPath: p.zip_path,
        pdfCount: p.pdf_count ?? 0,
      })),
    };

    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(manifestPath, JSON.stringify(manifest, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadError) {
      console.error('Failed to upload manifest:', uploadError);
      return;
    }

    await supabaseServer
      .from('report_jobs')
      .update({ zip_path: manifestPath, updated_at: new Date().toISOString() })
      .eq('id', jobId);
  } catch (e) {
    console.error('finalizeJobZipManifest error:', e);
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'ZIP worker is running' });
}
