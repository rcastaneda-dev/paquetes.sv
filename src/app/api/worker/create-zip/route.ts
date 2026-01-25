import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { createZipArchive, streamToBuffer } from '@/lib/zip/bundler';

/**
 * Worker endpoint that creates ZIP bundles for completed jobs.
 * This runs after all PDFs have been generated.
 */
export async function POST(request: NextRequest) {
  try {
    // Simple authentication check
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.SUPABASE_FUNCTION_SECRET || process.env.CRON_SECRET;
    
    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find jobs that have all tasks complete but no ZIP yet
    const { data: jobs, error: jobsError } = await supabaseServer
      .from('report_jobs')
      .select('id')
      .eq('status', 'complete')
      .is('zip_path', null)
      .limit(5);

    if (jobsError) {
      console.error('Error finding jobs:', jobsError);
      return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ message: 'No jobs need ZIP creation', processed: 0 });
    }

    console.log(`Creating ZIPs for ${jobs.length} jobs`);

    // Process each job
    const results = await Promise.allSettled(
      jobs.map(job => createZipForJob(job.id))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return NextResponse.json({
      message: 'ZIP creation processed',
      processed: jobs.length,
      successful,
      failed,
    });
  } catch (error) {
    console.error('ZIP worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createZipForJob(jobId: string): Promise<void> {
  try {
    console.log(`Creating ZIP for job ${jobId}`);

    // Get all completed tasks with PDF paths
    const { data: tasks, error: tasksError } = await supabaseServer
      .from('report_tasks')
      .select('pdf_path, school_codigo_ce, grado')
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null);

    if (tasksError) {
      throw new Error(`Failed to fetch tasks: ${tasksError.message}`);
    }

    if (!tasks || tasks.length === 0) {
      throw new Error('No completed tasks with PDFs found');
    }

    console.log(`Found ${tasks.length} PDFs to bundle`);

    // Download all PDFs from storage
    const pdfFiles: Array<{ name: string; data: Buffer }> = [];
    
    for (const task of tasks) {
      const { data: pdfData, error: downloadError } = await supabaseServer
        .storage
        .from('reports')
        .download(task.pdf_path);

      if (downloadError) {
        console.error(`Failed to download ${task.pdf_path}:`, downloadError);
        continue;
      }

      const buffer = Buffer.from(await pdfData.arrayBuffer());
      const fileName = `${task.school_codigo_ce}-${task.grado}.pdf`;
      pdfFiles.push({ name: fileName, data: buffer });
    }

    if (pdfFiles.length === 0) {
      throw new Error('No PDFs could be downloaded');
    }

    console.log(`Downloaded ${pdfFiles.length} PDFs, creating ZIP...`);

    // Create ZIP
    const zipStream = createZipArchive(pdfFiles);
    const zipBuffer = await streamToBuffer(zipStream);

    console.log(`ZIP created, size: ${zipBuffer.length} bytes`);

    // Upload ZIP to storage
    const zipPath = `${jobId}/bundle.zip`;
    const { error: uploadError } = await supabaseServer
      .storage
      .from('reports')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload ZIP: ${uploadError.message}`);
    }

    // Update job with ZIP path
    const { error: updateError } = await supabaseServer
      .from('report_jobs')
      .update({
        zip_path: zipPath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (updateError) {
      throw new Error(`Failed to update job: ${updateError.message}`);
    }

    console.log(`ZIP created successfully for job ${jobId}`);
  } catch (error) {
    console.error(`Failed to create ZIP for job ${jobId}:`, error);
    
    // Mark job as failed
    await supabaseServer
      .from('report_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'ZIP creation failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    throw error;
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'ZIP worker is running' });
}
