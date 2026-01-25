import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generateStudentReportPDF } from '@/lib/pdf/generator';
import { buildReportPdfStorageKey } from '@/lib/storage/keys';
import type { ClaimedTask, StudentReportRow } from '@/types/database';

/**
 * Worker endpoint that processes pending tasks in batches.
 * Can be triggered by:
 * - Supabase Scheduled Edge Function (recommended)
 * - Manual POST request
 * - Supabase Edge Function
 */
export async function POST(request: NextRequest) {
  try {
    // Simple authentication check (for cron jobs)
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.SUPABASE_FUNCTION_SECRET || process.env.CRON_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Configurable batch size and concurrency (optimized for 49k+ PDFs)
    // Recommended: WORKER_BATCH_SIZE=25, WORKER_CONCURRENCY=3 on Vercel Free (10s timeout, 1GB)
    const batchSize = parseInt(process.env.WORKER_BATCH_SIZE || '25', 10);
    const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '3', 10);

    // Drain-loop: process multiple batches until time budget exhausted
    // For Vercel: 10s timeout (Free), 60s (Pro), 300s (Enterprise)
    const maxRuntime = parseInt(process.env.WORKER_MAX_RUNTIME || '9000', 10); // 9s default
    const startTime = Date.now();

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let batchCount = 0;
    const allJobIds = new Set<string>();

    console.log(
      `Worker drain started: maxRuntime=${maxRuntime}ms, batchSize=${batchSize}, concurrency=${concurrency}`
    );

    // Drain queue until time budget exhausted or no more tasks
    while (Date.now() - startTime < maxRuntime) {
      // Claim pending tasks
      const { data: claimedTasks, error: claimError } = await supabaseServer.rpc(
        'claim_pending_tasks',
        {
          p_limit: batchSize,
        }
      );

      if (claimError) {
        console.error('Error claiming tasks:', claimError);
        break; // Exit loop on error, return what we've processed so far
      }

      const tasks = claimedTasks as ClaimedTask[];

      if (tasks.length === 0) {
        console.log('No more pending tasks, exiting drain loop');
        break;
      }

      batchCount++;
      console.log(
        `Processing batch ${batchCount}: ${tasks.length} tasks with concurrency=${concurrency}`
      );

      // Process tasks with concurrency limit to avoid memory spikes
      const results = await processTasksWithConcurrencyLimit(tasks, concurrency);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      totalProcessed += tasks.length;
      totalSuccessful += successful;
      totalFailed += failed;

      // Collect job IDs for completion check
      tasks.forEach(t => allJobIds.add(t.job_id));

      console.log(`Batch ${batchCount} complete: ${successful} succeeded, ${failed} failed`);

      // Check if approaching time limit (leave 2s buffer)
      const elapsed = Date.now() - startTime;
      const remaining = maxRuntime - elapsed;
      if (remaining < 2000) {
        console.log(`Approaching time limit (${remaining}ms remaining), stopping drain loop`);
        break;
      }
    }

    const elapsed = Date.now() - startTime;

    // Check if any jobs are now complete
    if (allJobIds.size > 0) {
      console.log(`Checking completion for ${allJobIds.size} jobs`);
      for (const jobId of allJobIds) {
        await checkAndCompleteJob(jobId);
      }
    }

    return NextResponse.json({
      message: 'Queue drain complete',
      batches: batchCount,
      processed: totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('Worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Process tasks with a concurrency limit to avoid memory spikes from PDF buffers.
 * Each PDF generation creates a ~500KB-2MB buffer; limiting concurrency keeps memory predictable.
 */
async function processTasksWithConcurrencyLimit(
  tasks: ClaimedTask[],
  concurrency: number
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];

  // Process in chunks of `concurrency` size
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(task => processTask(task)));
    results.push(...chunkResults);
  }

  return results;
}

async function processTask(task: ClaimedTask): Promise<void> {
  try {
    console.log(`Processing task ${task.task_id} for ${task.school_codigo_ce} - ${task.grado}`);

    const schoolCodigoCe = (task.school_codigo_ce || '').trim();
    const rawGrado = (task.grado || '').trim();
    const isAllGrades =
      rawGrado === 'ALL' || rawGrado.toLowerCase() === 'todos' || rawGrado.toLowerCase() === 'todo';
    const taskGrado = isAllGrades ? 'ALL' : rawGrado;

    // Check if the parent job is cancelled before doing expensive work
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('status')
      .eq('id', task.job_id)
      .single();

    if (jobError) {
      throw new Error(`Failed to check job status: ${jobError.message}`);
    }

    if (job.status === 'cancelled') {
      console.log(`Task ${task.task_id} belongs to cancelled job ${task.job_id}, skipping`);
      // Task is already marked cancelled by the cancel RPC, just return
      return;
    }

    // Fetch school name
    const { data: school, error: schoolError } = await supabaseServer
      .from('schools')
      .select('nombre_ce')
      .eq('codigo_ce', schoolCodigoCe)
      .single();

    if (schoolError || !school) {
      throw new Error(`School not found: ${schoolCodigoCe}`);
    }

    // Fetch student data
    const rpcUsed = isAllGrades ? 'report_students_by_school' : 'report_students_by_school_grade';
    const { data: students, error: studentsError } = isAllGrades
      ? await supabaseServer.rpc(rpcUsed, {
          p_school_codigo_ce: schoolCodigoCe,
        })
      : await supabaseServer.rpc(rpcUsed, {
          p_school_codigo_ce: schoolCodigoCe,
          p_grado: taskGrado,
        });

    if (studentsError) {
      throw new Error(`Failed to fetch students: ${studentsError.message}`);
    }

    const studentRows = students as StudentReportRow[];

    if (studentRows.length === 0) {
      console.log(`No students found for ${task.school_codigo_ce} - ${task.grado}, skipping`);
      // Mark as complete even though no students (empty report)
      await supabaseServer.rpc('update_task_status', {
        p_task_id: task.task_id,
        p_status: 'complete',
        p_pdf_path: null,
        p_error: `No students found (rpc=${rpcUsed}, school=${schoolCodigoCe}, grado=${taskGrado})`,
      });
      return;
    }

    // Generate PDF
    const pdfStream = generateStudentReportPDF({
      schoolName: school.nombre_ce,
      codigo_ce: schoolCodigoCe,
      grado: taskGrado,
      students: studentRows,
    });

    // Convert PDF output to buffer.
    // NOTE: `pdfkit.standalone` does not implement AsyncIterable, so `for await (...)` can throw.
    const pdfBuffer = await toBuffer(pdfStream);

    // Upload to Supabase Storage with safe, collision-free key
    const fileName = buildReportPdfStorageKey({
      jobId: task.job_id,
      schoolCodigoCe: schoolCodigoCe,
      grado: taskGrado,
      taskId: task.task_id,
    });
    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Mark task as complete
    await supabaseServer.rpc('update_task_status', {
      p_task_id: task.task_id,
      p_status: 'complete',
      p_pdf_path: fileName,
      p_error: null,
    });

    console.log(`Task ${task.task_id} completed successfully`);
  } catch (error) {
    console.error(`Task ${task.task_id} failed:`, error);

    // Mark task as failed
    await supabaseServer.rpc('update_task_status', {
      p_task_id: task.task_id,
      p_status: 'failed',
      p_pdf_path: null,
      p_error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

function toBuffer(streamLike: unknown): Promise<Buffer> {
  // Case 1: AsyncIterable (Node Readable streams support this in many cases)
  if (
    streamLike &&
    typeof streamLike === 'object' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (streamLike as any)[Symbol.asyncIterator] === 'function'
  ) {
    return (async () => {
      const chunks: Buffer[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of streamLike as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    })();
  }

  // Case 2: EventEmitter-style stream (covers pdfkit + pdfkit.standalone output)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = streamLike as any;
  if (s && typeof s.on === 'function') {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      s.on('data', (chunk: unknown) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
      });
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('finish', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });
  }

  return Promise.reject(
    new Error('pdfStream is not async iterable and does not support data/end events')
  );
}

async function checkAndCompleteJob(jobId: string): Promise<void> {
  try {
    // Check current job status first
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return;
    }

    // Don't override cancelled jobs
    if (job.status === 'cancelled') {
      console.log(`Job ${jobId} is cancelled, skipping completion check`);
      return;
    }

    // Get job progress
    const { data: progressData } = await supabaseServer.rpc('get_job_progress', {
      p_job_id: jobId,
    });

    if (!progressData || progressData.length === 0) {
      return;
    }

    const progress = progressData[0];

    // Check if all tasks are done (complete, failed, or cancelled)
    const allDone = progress.pending_tasks === 0 && progress.running_tasks === 0;

    if (!allDone) {
      return;
    }

    // Update job status
    const newStatus = progress.failed_tasks > 0 ? 'failed' : 'complete';

    await supabaseServer
      .from('report_jobs')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', job.status); // Only update if status hasn't changed (extra safety)

    console.log(`Job ${jobId} marked as ${newStatus}`);

    // If this job is part of a batch, update the batch status
    const { data: jobData } = await supabaseServer
      .from('report_jobs')
      .select('batch_id')
      .eq('id', jobId)
      .single();

    if (jobData?.batch_id) {
      await supabaseServer.rpc('update_batch_status', { p_batch_id: jobData.batch_id });
    }
  } catch (error) {
    console.error(`Error checking job completion for ${jobId}:`, error);
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'Worker is running' });
}
