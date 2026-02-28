import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { supabaseServer } from '@/lib/supabase/server';
import { buildSchoolBundlePdf } from '@/lib/pdf/agreement/builders';
import { groupBySchool } from '@/lib/pdf/agreement/sections';

export const dynamic = 'force-dynamic';
import type { StudentQueryRow } from '@/types/database';
import { workerConfigSchema, authConfigSchema } from '@/lib/validation/schemas';
import { validateEnv } from '@/lib/validation/helpers';
import { createUnauthorizedResponse } from '@/lib/validation/errors';

/**
 * Worker endpoint that generates a school-bundle ZIP.
 *
 * Called by the standalone ZIP worker when it claims a `school_bundle` job.
 * Generates one merged PDF per school (Cajas + Uniformes + Zapatos) and
 * bundles them into a single ZIP, then uploads to Supabase Storage.
 *
 * POST /api/worker/process-school-bundle-zip
 * Body: { zipJobId: string, reportJobId: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check (same as process-category-tasks)
    const authConfig = validateEnv(authConfigSchema);
    const expectedSecret = authConfig.SUPABASE_FUNCTION_SECRET || authConfig.CRON_SECRET;

    const authHeader = request.headers.get('authorization');
    const workerSecret = request.headers.get('x-worker-secret');
    const providedSecret = workerSecret || (authHeader?.replace('Bearer ', '') ?? '');

    if (expectedSecret && providedSecret !== expectedSecret) {
      return createUnauthorizedResponse();
    }

    const body = await request.json();
    const { zipJobId, reportJobId } = body as {
      zipJobId: string;
      reportJobId: string;
    };

    if (!zipJobId || !reportJobId) {
      return NextResponse.json(
        { error: 'Missing required fields: zipJobId, reportJobId' },
        { status: 400 }
      );
    }

    console.log(`[school-bundle] Processing zipJob=${zipJobId}, reportJob=${reportJobId}`);

    // 1. Get fecha_inicio from report job
    const { data: reportJob, error: reportJobError } = await supabaseServer
      .from('report_jobs')
      .select('status, job_params')
      .eq('id', reportJobId)
      .single();

    if (reportJobError || !reportJob) {
      await failJob(zipJobId, 'Report job not found');
      return NextResponse.json({ error: 'Report job not found' }, { status: 404 });
    }

    const fechaInicio = (reportJob.job_params as { fecha_inicio?: string })?.fecha_inicio;
    if (!fechaInicio) {
      await failJob(zipJobId, 'Missing fecha_inicio in job params');
      return NextResponse.json({ error: 'Missing fecha_inicio' }, { status: 400 });
    }

    // 2. Get distinct schools from category tasks
    const { data: schoolRows, error: schoolsError } = await supabaseServer
      .from('report_category_tasks')
      .select('school_codigo_ce')
      .eq('job_id', reportJobId);

    if (schoolsError) {
      await failJob(zipJobId, `Failed to fetch schools: ${schoolsError.message}`);
      return NextResponse.json({ error: schoolsError.message }, { status: 500 });
    }

    const uniqueSchoolCodes = [...new Set((schoolRows ?? []).map(r => r.school_codigo_ce))];
    console.log(`[school-bundle] Found ${uniqueSchoolCodes.length} schools`);

    if (uniqueSchoolCodes.length === 0) {
      await failJob(zipJobId, 'No schools found for this job');
      return NextResponse.json({ error: 'No schools found' }, { status: 404 });
    }

    // 3. Fetch all students for this date
    const allStudents = await fetchAllStudentsForDate(fechaInicio);
    console.log(`[school-bundle] Fetched ${allStudents.length} total students`);

    if (allStudents.length === 0) {
      await failJob(zipJobId, `No students found for fecha_inicio=${fechaInicio}`);
      return NextResponse.json({ error: 'No students found' }, { status: 404 });
    }

    // Filter to job's schools
    const jobSchoolSet = new Set(uniqueSchoolCodes);
    const filteredStudents = allStudents.filter(s => jobSchoolSet.has(s.school_codigo_ce));

    // Group into SchoolGroup[]
    const schools = groupBySchool(filteredStudents);
    console.log(
      `[school-bundle] ${filteredStudents.length} students across ${schools.length} schools`
    );

    // 4. Create ZIP archive in memory
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    let pdfCount = 0;

    // 5. Generate one merged PDF per school and append to archive
    for (const school of schools) {
      try {
        const doc = buildSchoolBundlePdf({ fechaInicio, school });

        // Collect PDF buffer
        const pdfBuffer = await streamToBuffer(doc);

        // Sanitize school name for filename (keep it short & safe)
        const safeName = school.codigo_ce.replace(/[^a-zA-Z0-9_-]/g, '_');
        archive.append(pdfBuffer, { name: `${safeName}.pdf` });
        pdfCount++;

        if (pdfCount % 10 === 0) {
          console.log(`[school-bundle] Progress: ${pdfCount}/${schools.length} PDFs`);
        }
      } catch (err) {
        console.error(`[school-bundle] Failed for school ${school.codigo_ce}:`, err);
        // Continue with other schools; the ZIP will be partial but usable
      }
    }

    // 6. Finalize archive
    console.log(`[school-bundle] Finalizing ZIP (${pdfCount} PDFs)...`);
    archive.finalize();

    await new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);
    const zipSizeMB = (zipBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`[school-bundle] ZIP created: ${zipSizeMB} MB, ${pdfCount} PDFs`);

    // 7. Upload ZIP to Supabase Storage
    const zipPath = `bundles/${reportJobId}/${fechaInicio}/school_bundle.zip`;
    console.log(`[school-bundle] Uploading to: ${zipPath}`);

    const { error: uploadError } = await supabaseServer.storage
      .from('reports')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      await failJob(zipJobId, `Upload failed: ${uploadError.message}`);
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    // 8. Mark job complete
    await supabaseServer.rpc('update_zip_job_status', {
      p_job_id: zipJobId,
      p_status: 'complete',
      p_zip_path: zipPath,
      p_zip_size_bytes: zipBuffer.length,
      p_pdf_count: pdfCount,
    });

    console.log(`[school-bundle] ✅ Job ${zipJobId} completed`);

    return NextResponse.json({
      success: true,
      pdfCount,
      schoolCount: schools.length,
      zipSizeMB,
      zipPath,
    });
  } catch (error) {
    console.error('[school-bundle] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Mark a zip job as failed */
async function failJob(zipJobId: string, errorMessage: string): Promise<void> {
  try {
    await supabaseServer.rpc('update_zip_job_status', {
      p_job_id: zipJobId,
      p_status: 'failed',
      p_error: errorMessage,
    });
  } catch (err) {
    console.error(`[school-bundle] Failed to update job status for ${zipJobId}:`, err);
  }
}

/**
 * Fetch all students for a fecha_inicio with paginated RPC calls.
 *
 * PostgREST enforces a server-side `max-rows` limit (default 1000).
 * We page in increments of 1000 and use `rows.length < pageSize`
 * to detect the last page reliably.
 */
async function fetchAllStudentsForDate(fechaInicio: string): Promise<StudentQueryRow[]> {
  // Must be ≤ PostgREST max-rows (Supabase default = 1000)
  const pageSize = 1000;
  const maxRows = 200000;

  let offset = 0;
  const all: StudentQueryRow[] = [];

  while (true) {
    const { data, error } = await supabaseServer.rpc('query_students', {
      p_school_codigo_ce: null,
      p_grado: null,
      p_departamento: null,
      p_fecha_inicio: fechaInicio,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) {
      throw new Error(`Failed to fetch students: ${error.message}`);
    }

    const rows = (data as StudentQueryRow[]) ?? [];
    if (rows.length === 0) break;

    all.push(...rows);

    if (all.length >= maxRows) {
      console.warn(`fetchAllStudentsForDate: hit maxRows (${maxRows})`);
      break;
    }

    // If we received fewer rows than requested, we've reached the last page
    if (rows.length < pageSize) break;

    offset += pageSize;
  }

  return all;
}

/** Collect a PDFKit document stream into a Buffer */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('finish', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// Health check
export async function GET() {
  return NextResponse.json({ status: 'School bundle ZIP processor is available' });
}
