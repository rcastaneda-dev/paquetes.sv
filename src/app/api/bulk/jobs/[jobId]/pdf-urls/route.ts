import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Get signed URLs for all PDFs in a job for client-side ZIP creation.
 *
 * This endpoint fetches all completed tasks for a job and returns
 * signed URLs that the client can use to download PDFs and create
 * a ZIP bundle in the browser.
 */
export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('report_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get all completed tasks with PDFs
    // Use range(0, 9999) to explicitly fetch up to 10k rows (default is 1000)
    const {
      data: tasks,
      error: tasksError,
      count,
    } = await supabase
      .from('report_tasks')
      .select('id, pdf_path, school_codigo_ce, grado', { count: 'exact' })
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .order('school_codigo_ce', { ascending: true })
      .order('grado', { ascending: true })
      .range(0, 9999); // Explicitly allow up to 10k rows

    console.log(`Fetched ${tasks?.length || 0} tasks (total count: ${count})`);

    if (tasksError) {
      return NextResponse.json(
        { error: `Failed to fetch tasks: ${tasksError.message}` },
        { status: 500 }
      );
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ error: 'No completed tasks found for this job' }, { status: 404 });
    }

    if (count && count > tasks.length) {
      console.warn(
        `Warning: Only fetched ${tasks.length} of ${count} total tasks. Some PDFs will be missing from ZIP.`
      );
    }

    // Generate signed URLs for all PDFs (valid for 1 hour)
    console.log(`Generating signed URLs for ${tasks.length} PDFs...`);
    const startTime = Date.now();

    const pdfUrls = await Promise.all(
      tasks.map(async task => {
        const { data: signedUrl, error } = await supabase.storage
          .from('reports')
          .createSignedUrl(task.pdf_path!, 3600);

        if (error || !signedUrl) {
          console.error(`Failed to create signed URL for ${task.pdf_path}:`, error);
          return null;
        }

        return {
          url: signedUrl.signedUrl,
          fileName: buildFileName(task.school_codigo_ce, task.grado),
          schoolCode: task.school_codigo_ce,
          grado: task.grado,
        };
      })
    );

    const elapsedMs = Date.now() - startTime;
    console.log(`Generated ${pdfUrls.length} signed URLs in ${elapsedMs}ms`);

    // Filter out any failed URL generations
    const validUrls = pdfUrls.filter(url => url !== null);
    console.log(`Valid URLs: ${validUrls.length} / ${pdfUrls.length}`);

    return NextResponse.json({
      pdfs: validUrls,
      total: validUrls.length,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Error generating PDF URLs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Build a safe filename for a PDF
 */
function buildFileName(schoolCodigoCe: string, grado: string): string {
  const safeSchool = toSafePathSegment(schoolCodigoCe, 50);
  const safeGrado = toSafePathSegment(grado, 80);
  if (grado === 'ALL') {
    return `${safeSchool}.pdf`;
  }
  return `${safeSchool}-${safeGrado}.pdf`;
}

/**
 * Strip diacritics and convert to safe path segment
 */
function toSafePathSegment(input: string, maxLength = 200): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}
