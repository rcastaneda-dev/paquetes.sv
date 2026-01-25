import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generateStudentReportPDF } from '@/lib/pdf/generator';
import type { ClaimedTask, StudentReportRow } from '@/types/database';

/**
 * Worker endpoint that processes pending tasks in batches.
 * Can be triggered by:
 * - Vercel Cron (add to vercel.json)
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

    const batchSize = 5; // Process 5 tasks per run

    // Claim pending tasks
    const { data: claimedTasks, error: claimError } = await supabaseServer.rpc('claim_pending_tasks', {
      p_limit: batchSize,
    });

    if (claimError) {
      console.error('Error claiming tasks:', claimError);
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    const tasks = claimedTasks as ClaimedTask[];

    if (tasks.length === 0) {
      return NextResponse.json({ message: 'No pending tasks', processed: 0 });
    }

    console.log(`Processing ${tasks.length} tasks`);

    // Process each task
    const results = await Promise.allSettled(
      tasks.map(task => processTask(task))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // Check if any jobs are now complete
    const jobIds = [...new Set(tasks.map(t => t.job_id))];
    for (const jobId of jobIds) {
      await checkAndCompleteJob(jobId);
    }

    return NextResponse.json({
      message: 'Batch processed',
      processed: tasks.length,
      successful,
      failed,
    });
  } catch (error) {
    console.error('Worker error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function processTask(task: ClaimedTask): Promise<void> {
  try {
    console.log(`Processing task ${task.task_id} for ${task.school_codigo_ce} - ${task.grado}`);

    // Fetch school name
    const { data: school, error: schoolError } = await supabaseServer
      .from('schools')
      .select('nombre_ce')
      .eq('codigo_ce', task.school_codigo_ce)
      .single();

    if (schoolError || !school) {
      throw new Error(`School not found: ${task.school_codigo_ce}`);
    }

    // Fetch student data
    const { data: students, error: studentsError } = await supabaseServer.rpc(
      'report_students_by_school_grade',
      {
        p_school_codigo_ce: task.school_codigo_ce,
        p_grado: task.grado,
      }
    );

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
        p_error: 'No students found',
      });
      return;
    }

    // Generate PDF
    const pdfStream = generateStudentReportPDF({
      schoolName: school.nombre_ce,
      grado: task.grado,
      students: studentRows,
    });

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

    // Upload to Supabase Storage
    const fileName = `${task.job_id}/${task.school_codigo_ce}-${task.grado}.pdf`;
    const { error: uploadError } = await supabaseServer
      .storage
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

async function checkAndCompleteJob(jobId: string): Promise<void> {
  try {
    // Get job progress
    const { data: progressData } = await supabaseServer.rpc('get_job_progress', {
      p_job_id: jobId,
    });

    if (!progressData || progressData.length === 0) {
      return;
    }

    const progress = progressData[0];

    // Check if all tasks are done (complete or failed)
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
      .eq('id', jobId);

    console.log(`Job ${jobId} marked as ${newStatus}`);
  } catch (error) {
    console.error(`Error checking job completion for ${jobId}:`, error);
  }
}

// GET endpoint for health check
export async function GET() {
  return NextResponse.json({ status: 'Worker is running' });
}
