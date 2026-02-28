import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generateStudentReportPDF, generateStudentLabelsPDF } from '@/lib/pdf/generator';
import { buildReportPdfStorageKey, buildReportEtiquetasStorageKey } from '@/lib/storage/keys';
import type { ClaimedTask, StudentReportRow } from '@/types/database';

export const dynamic = 'force-dynamic';
import { workerConfigSchema, authConfigSchema } from '@/lib/validation/schemas';
import { validateEnv } from '@/lib/validation/helpers';
import { createUnauthorizedResponse } from '@/lib/validation/errors';

/**
 * Worker endpoint that processes pending tasks in batches.
 * Can be triggered by:
 * - Supabase Scheduled Edge Function (recommended)
 * - Manual POST request
 * - Supabase Edge Function
 */
export async function POST(request: NextRequest) {
  try {
    // Validate auth secrets with Zod
    const authConfig = validateEnv(authConfigSchema);
    const expectedSecret = authConfig.SUPABASE_FUNCTION_SECRET || authConfig.CRON_SECRET;

    // Simple authentication check (for cron jobs and Supabase Edge Functions)
    // Accept either Authorization: Bearer <secret> or x-worker-secret: <secret>
    const authHeader = request.headers.get('authorization');
    const workerSecret = request.headers.get('x-worker-secret');

    const providedSecret = workerSecret || (authHeader?.replace('Bearer ', '') ?? '');

    if (expectedSecret && providedSecret !== expectedSecret) {
      return createUnauthorizedResponse();
    }

    // Validate and get worker configuration with Zod
    const { WORKER_BATCH_SIZE, WORKER_CONCURRENCY, WORKER_MAX_RUNTIME } =
      validateEnv(workerConfigSchema);

    const batchSize = WORKER_BATCH_SIZE;
    const concurrency = WORKER_CONCURRENCY;
    const maxRuntime = WORKER_MAX_RUNTIME;
    const startTime = Date.now();

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let batchCount = 0;
    const allJobIds = new Set<string>();
    let didRequeueStale = false;

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
        // If there are no pending tasks, we might still be "stuck" with stale running tasks
        // left behind by crashed/time-limited workers. Try requeuing them once per invocation.
        if (!didRequeueStale) {
          didRequeueStale = true;

          const staleSeconds = parseInt(process.env.WORKER_STALE_TASK_SECONDS || '900', 10); // 15m default
          const requeueLimit = parseInt(process.env.WORKER_STALE_TASK_LIMIT || '5000', 10);

          const { data: requeuedCount, error: requeueError } = await supabaseServer.rpc(
            'requeue_stale_running_tasks',
            {
              p_stale_seconds: staleSeconds,
              p_limit: requeueLimit,
            }
          );

          if (requeueError) {
            console.error('Error requeuing stale running tasks:', requeueError);
            break;
          }

          const count =
            typeof requeuedCount === 'number' ? requeuedCount : Number(requeuedCount ?? 0);
          if (count > 0) {
            continue;
          }
        }

        break;
      }

      batchCount++;

      // Process tasks with concurrency limit to avoid memory spikes
      const results = await processTasksWithConcurrencyLimit(tasks, concurrency);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      totalProcessed += tasks.length;
      totalSuccessful += successful;
      totalFailed += failed;

      // Collect job IDs for completion check
      tasks.forEach(t => allJobIds.add(t.job_id));

      // Check if approaching time limit (leave 2s buffer)
      const elapsed = Date.now() - startTime;
      const remaining = maxRuntime - elapsed;
      if (remaining < 2000) {
        break;
      }
    }

    const elapsed = Date.now() - startTime;

    // Check if any jobs are now complete
    if (allJobIds.size > 0) {
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
      // Task is already marked cancelled by the cancel RPC, just return
      return;
    }

    // Fetch school info (used in PDF header and Storage path)
    const { data: school, error: schoolError } = await supabaseServer
      .from('schools')
      .select('nombre_ce, region, departamento, distrito')
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
      // Mark as complete even though no students (empty report)
      await supabaseServer.rpc('update_task_status', {
        p_task_id: task.task_id,
        p_status: 'complete',
        p_pdf_path: null,
        p_error: `No students found (rpc=${rpcUsed}, school=${schoolCodigoCe}, grado=${taskGrado})`,
      });
      return;
    }

    // Generate tallas PDF
    const tallasPdfStream = generateStudentReportPDF({
      schoolName: school.nombre_ce,
      codigo_ce: schoolCodigoCe,
      grado: taskGrado,
      students: studentRows,
    });

    // Generate etiquetas PDF
    const etiquetasPdfStream = generateStudentLabelsPDF({
      schoolName: school.nombre_ce,
      codigo_ce: schoolCodigoCe,
      grado: taskGrado,
      students: studentRows,
    });

    // Convert PDF outputs to buffers.
    // NOTE: `pdfkit.standalone` does not implement AsyncIterable, so `for await (...)` can throw.
    const tallasPdfBuffer = await toBuffer(tallasPdfStream);
    const etiquetasPdfBuffer = await toBuffer(etiquetasPdfStream);

    // Build storage keys for both PDFs
    const tallasFileName = buildReportPdfStorageKey({
      jobId: task.job_id,
      region: school.region,
      departamento: school.departamento,
      distrito: school.distrito,
      schoolCodigoCe: schoolCodigoCe,
    });

    const etiquetasFileName = buildReportEtiquetasStorageKey({
      jobId: task.job_id,
      region: school.region,
      departamento: school.departamento,
      distrito: school.distrito,
      schoolCodigoCe: schoolCodigoCe,
    });

    // Upload tallas PDF to Supabase Storage
    const { error: tallasUploadError } = await supabaseServer.storage
      .from('reports')
      .upload(tallasFileName, tallasPdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (tallasUploadError) {
      throw new Error(`Failed to upload tallas PDF: ${tallasUploadError.message}`);
    }

    // Upload etiquetas PDF to Supabase Storage
    const { error: etiquetasUploadError } = await supabaseServer.storage
      .from('reports')
      .upload(etiquetasFileName, etiquetasPdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (etiquetasUploadError) {
      throw new Error(`Failed to upload etiquetas PDF: ${etiquetasUploadError.message}`);
    }

    // Use tallas file name for the task's pdf_path (backward compatibility)
    const fileName = tallasFileName;

    // Mark task as complete
    await supabaseServer.rpc('update_task_status', {
      p_task_id: task.task_id,
      p_status: 'complete',
      p_pdf_path: fileName,
      p_error: null,
    });
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

/**
 * Type guard to check if an object is AsyncIterable
 */
function isAsyncIterable(obj: unknown): obj is AsyncIterable<unknown> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    Symbol.asyncIterator in obj &&
    typeof (obj as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Type for event emitter-like streams
 */
interface StreamLike {
  on(event: 'data', listener: (chunk: Buffer | Uint8Array | string) => void): void;
  on(event: 'end' | 'finish', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

/**
 * Type guard to check if an object is a stream-like object
 */
function isStreamLike(obj: unknown): obj is StreamLike {
  return obj !== null && typeof obj === 'object' && 'on' in obj && typeof obj.on === 'function';
}

function toBuffer(streamLike: unknown): Promise<Buffer> {
  // Case 1: AsyncIterable (Node Readable streams support this in many cases)
  if (isAsyncIterable(streamLike)) {
    return (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of streamLike) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
        } else if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk));
        }
      }
      return Buffer.concat(chunks);
    })();
  }

  // Case 2: EventEmitter-style stream (covers pdfkit + pdfkit.standalone output)
  if (isStreamLike(streamLike)) {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      streamLike.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      streamLike.on('end', () => resolve(Buffer.concat(chunks)));
      streamLike.on('finish', () => resolve(Buffer.concat(chunks)));
      streamLike.on('error', reject);
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
