import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import {
  generateCajasPDF,
  generateCamisasPDF,
  generatePantalonesPDF,
  generateZapatosPDF,
  generateFichaPDF,
  generateFichaUniformesPDF,
  generateFichaZapatosPDF,
  generateDayZapatosPDF,
  generateDayUniformesPDF,
} from '@/lib/pdf/generator';
import { buildAgreementReportStorageKey } from '@/lib/storage/keys';
import type { StudentQueryRow } from '@/types/database';
import { workerConfigSchema, authConfigSchema } from '@/lib/validation/schemas';
import { validateEnv } from '@/lib/validation/helpers';
import { createUnauthorizedResponse } from '@/lib/validation/errors';

/**
 * Worker endpoint that processes pending category report tasks in batches.
 * Can be triggered by:
 * - Supabase Scheduled Edge Function (recommended)
 * - Manual POST request
 */
export async function POST(request: NextRequest) {
  try {
    // Validate auth secrets with Zod
    const authConfig = validateEnv(authConfigSchema);
    const expectedSecret = authConfig.SUPABASE_FUNCTION_SECRET || authConfig.CRON_SECRET;

    // Simple authentication check (for cron jobs)
    const authHeader = request.headers.get('authorization');

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
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

    // Drain queue until time budget exhausted or no more tasks
    while (Date.now() - startTime < maxRuntime) {
      // Claim pending category tasks
      const { data: claimedTasks, error: claimError } = await supabaseServer.rpc(
        'claim_pending_category_tasks',
        {
          p_limit: batchSize,
        }
      );

      if (claimError) {
        console.error('Error claiming category tasks:', claimError);
        break;
      }

      const tasks = claimedTasks as Array<{
        task_id: string;
        job_id: string;
        category: string;
        fecha_inicio: string;
      }>;

      if (tasks.length === 0) {
        break;
      }

      batchCount++;

      // Process tasks with concurrency limit
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
        await checkAndCompleteCategoryJob(jobId);
      }
    }

    return NextResponse.json({
      message: 'Category queue drain complete',
      batches: batchCount,
      processed: totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('Category worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Process category tasks with a concurrency limit
 */
async function processTasksWithConcurrencyLimit(
  tasks: Array<{
    task_id: string;
    job_id: string;
    category: string;
    fecha_inicio: string;
  }>,
  concurrency: number
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(task => processCategoryTask(task)));
    results.push(...chunkResults);
  }

  return results;
}

async function processCategoryTask(task: {
  task_id: string;
  job_id: string;
  category: string;
  fecha_inicio: string;
}): Promise<void> {
  try {
    const { task_id, job_id, category, fecha_inicio } = task;

    // Check if the parent job is cancelled
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('status')
      .eq('id', job_id)
      .single();

    if (jobError) {
      throw new Error(`Failed to check job status: ${jobError.message}`);
    }

    if (job.status === 'cancelled') {
      return;
    }

    // Fetch all students for this fecha_inicio
    const students = await fetchStudentsByFechaInicio(fecha_inicio);

    if (students.length === 0) {
      await supabaseServer.rpc('update_category_task_status', {
        p_task_id: task_id,
        p_status: 'complete',
        p_pdf_path: null,
        p_error: `No students found for fecha_inicio=${fecha_inicio}`,
      });
      return;
    }

    // Generate the appropriate PDF based on category
    let pdfStream;
    let fileName: string;

    switch (category) {
      case 'estudiantes':
        pdfStream = generateCajasPDF({ fechaInicio: fecha_inicio, students });
        fileName = 'detalle_cajas.pdf';
        break;
      case 'camisa':
        pdfStream = generateCamisasPDF({ fechaInicio: fecha_inicio, students });
        fileName = 'detalle_camisas.pdf';
        break;
      case 'prenda_inferior':
        pdfStream = generatePantalonesPDF({ fechaInicio: fecha_inicio, students });
        fileName = 'detalle_prenda_inferior.pdf';
        break;
      case 'zapatos':
        pdfStream = generateZapatosPDF({ fechaInicio: fecha_inicio, students });
        fileName = 'detalle_zapatos.pdf';
        break;
      case 'distribucion_por_escuela':
        pdfStream = generateFichaPDF({ fechaInicio: fecha_inicio, students });
        fileName = 'ficha_distribucion.pdf';
        break;
      default:
        throw new Error(`Unknown category: ${category}`);
    }

    // Convert stream to buffer
    const pdfBuffer = await toBuffer(pdfStream);

    // Build storage key using new hierarchy
    const storagePath = buildAgreementReportStorageKey({
      jobId: job_id,
      fechaInicio: fecha_inicio,
      categoryFolder: category as 'estudiantes' | 'camisa' | 'prenda_inferior' | 'zapatos' | 'distribucion_por_escuela',
      fileName: fileName,
    });

    // Upload PDF to Supabase Storage
    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Mark task as complete
    await supabaseServer.rpc('update_category_task_status', {
      p_task_id: task_id,
      p_status: 'complete',
      p_pdf_path: storagePath,
      p_error: null,
    });
  } catch (error) {
    console.error(`Category task ${task.task_id} failed:`, error);

    // Mark task as failed
    await supabaseServer.rpc('update_category_task_status', {
      p_task_id: task.task_id,
      p_status: 'failed',
      p_pdf_path: null,
      p_error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Fetch all students matching the fecha_inicio filter
 */
async function fetchStudentsByFechaInicio(fechaInicio: string): Promise<StudentQueryRow[]> {
  const pageSize = 2000;
  const maxRows = 100000; // Higher limit for bulk operations

  let offset = 0;
  let totalCount: number | null = null;
  const all: StudentQueryRow[] = [];
  let useFechaInicioParam = true;

  while (true) {
    const baseArgs = {
      p_school_codigo_ce: null,
      p_grado: null,
      p_departamento: null,
      p_limit: pageSize,
      p_offset: offset,
    };

    // Try with p_fecha_inicio parameter first (new migration)
    const args = useFechaInicioParam
      ? { ...baseArgs, p_fecha_inicio: fechaInicio }
      : baseArgs;

    let { data, error } = await supabaseServer.rpc('query_students', args);

    // Fallback: if PostgREST returns PGRST203 (unknown parameter), retry without p_fecha_inicio
    if (error?.code === 'PGRST203' && useFechaInicioParam) {
      useFechaInicioParam = false;
      ({ data, error } = await supabaseServer.rpc('query_students', baseArgs));
    }

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) {
      break;
    }

    // If we're not using the fecha_inicio parameter, filter client-side
    const filtered = useFechaInicioParam
      ? rows
      : rows.filter(row => row.fecha_inicio === fechaInicio);
    all.push(...filtered);

    if (totalCount === null && rows.length > 0) {
      totalCount = rows[0]?.total_count ?? 0;
    }

    if (all.length >= maxRows) {
      break;
    }

    if (totalCount !== null && offset + pageSize >= totalCount) {
      break;
    }

    offset += pageSize;
  }

  return all;
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
  // Case 1: AsyncIterable
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

  // Case 2: EventEmitter-style stream
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

async function checkAndCompleteCategoryJob(jobId: string): Promise<void> {
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
    const { data: progressData } = await supabaseServer.rpc('get_category_job_progress', {
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
      .eq('status', job.status);
  } catch (error) {
    console.error(`Error checking category job completion for ${jobId}:`, error);
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'Category worker is running' });
}
