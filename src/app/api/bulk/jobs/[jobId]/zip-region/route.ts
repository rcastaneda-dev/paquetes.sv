import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import archiver from 'archiver';

/**
 * Generate a regional ZIP file on-demand.
 *
 * This endpoint generates a ZIP for a specific region (oriental, occidental, paracentral, central)
 * synchronously within the Vercel function timeout. Since each region has ~1,500 PDFs,
 * this completes in 30-60 seconds.
 *
 * Query params:
 *   ?region=oriental|occidental|paracentral|central
 *
 * Flow:
 * 1. Check if ZIP already exists for this region
 * 2. If exists, return signed URL
 * 3. Query database for PDFs in this region (filter by pdf_path)
 * 4. Download PDFs in parallel batches
 * 5. Stream into ZIP archive
 * 6. Upload to storage
 * 7. Return signed URL
 */
export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  const startTime = Date.now();

  try {
    const jobId = params.jobId;
    const region = request.nextUrl.searchParams.get('region');

    // Validate region
    const validRegions = ['oriental', 'occidental', 'paracentral', 'central'];
    if (!region || !validRegions.includes(region.toLowerCase())) {
      return NextResponse.json(
        { error: 'Invalid region. Must be: oriental, occidental, paracentral, or central' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if job exists
    const { data: job, error: jobError } = await supabase
      .from('report_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'complete' && job.status !== 'failed') {
      return NextResponse.json({ error: 'Job must be complete before creating ZIP' }, { status: 400 });
    }

    const regionLower = region.toLowerCase();
    const regionUpper = region.toUpperCase();
    const zipPath = `bundles/${jobId}-${regionLower}.zip`;

    // Check if ZIP already exists
    const { data: existingZip } = await supabase.storage.from('reports').list(`bundles`, {
      search: `${jobId}-${regionLower}.zip`,
    });

    if (existingZip && existingZip.length > 0) {
      console.log(`ZIP already exists for ${regionLower}, returning cached version`);

      const { data: signedUrl } = await supabase.storage.from('reports').createSignedUrl(zipPath, 3600);

      return NextResponse.json({
        region: regionLower,
        downloadUrl: signedUrl?.signedUrl,
        cached: true,
        message: 'ZIP already exists',
      });
    }

    console.log(`Generating ZIP for region: ${regionUpper}`);

    // Fetch tasks with PDFs from this region using database
    // PDF paths are stored as: jobId/REGION/DEPARTAMENTO/MUNICIPIO/school-tallas.pdf
    const { data: tasks, error: tasksError } = await supabase
      .from('report_tasks')
      .select('id, pdf_path, school_codigo_ce, grado')
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .ilike('pdf_path', `%/${regionUpper}/%`) // Filter by region in path (case-insensitive)
      .order('school_codigo_ce', { ascending: true });

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ error: `No PDFs found for region: ${regionUpper}` }, { status: 404 });
    }

    console.log(`Found ${tasks.length} PDFs for ${regionUpper}`);

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Balanced compression
    });

    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Download and add PDFs in parallel batches
    const BATCH_SIZE = 20;
    let completed = 0;

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async task => {
          try {
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from('reports')
              .download(task.pdf_path);

            if (downloadError || !pdfData) {
              console.error(`Failed to download ${task.pdf_path}`);
              return;
            }

            const buffer = Buffer.from(await pdfData.arrayBuffer());

            // Preserve folder structure from region onwards
            // Input: jobId/REGION/DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
            // Output: DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
            const pathParts = task.pdf_path.split('/');
            const regionIndex = pathParts.findIndex(part => part.toUpperCase() === regionUpper);
            const relativePath = regionIndex >= 0
              ? pathParts.slice(regionIndex + 1).join('/')  // Keep everything after REGION
              : pathParts[pathParts.length - 1];  // Fallback to just filename

            archive.append(buffer, { name: relativePath });
            completed++;

            if (completed % 100 === 0) {
              console.log(`Progress: ${completed}/${tasks.length} PDFs`);
            }
          } catch (err) {
            console.error(`Error processing ${task.pdf_path}:`, err);
          }
        })
      );
    }

    console.log(`Added ${completed} PDFs to archive`);

    // Finalize ZIP
    archive.finalize();

    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);
    const zipSizeMB = (zipBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`ZIP created: ${zipSizeMB} MB`);

    // Upload to storage
    const { error: uploadError } = await supabase.storage.from('reports').upload(zipPath, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload ZIP' }, { status: 500 });
    }

    // Generate signed URL
    const { data: signedUrl } = await supabase.storage.from('reports').createSignedUrl(zipPath, 3600);

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`ZIP generation completed in ${elapsedSeconds}s`);

    return NextResponse.json({
      region: regionLower,
      downloadUrl: signedUrl?.signedUrl,
      pdfCount: completed,
      zipSizeMB: parseFloat(zipSizeMB),
      generationTimeSeconds: parseFloat(elapsedSeconds),
      cached: false,
    });
  } catch (error) {
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Error generating ZIP after ${elapsedSeconds}s:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
