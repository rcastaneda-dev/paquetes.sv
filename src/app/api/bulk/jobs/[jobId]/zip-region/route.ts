import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import archiver from 'archiver';

/**
 * Generate a regional ZIP file on-demand.
 *
 * This endpoint generates a ZIP for a specific region (oriental, occidental, paracentral, central)
 * synchronously within the Vercel function timeout. Each region contains both "tallas" and "etiquetas"
 * PDFs for all schools in that region (approximately ~3,000 PDFs total per region).
 *
 * Query params:
 *   ?region=oriental|occidental|paracentral|central
 *
 * Flow:
 * 1. Check if ZIP already exists for this region
 * 2. If exists, return signed URL
 * 3. Query database for PDFs in this region (filter by pdf_path)
 * 4. For each school, download both tallas and etiquetas PDFs
 * 5. Download PDFs in parallel batches
 * 6. Stream into ZIP archive with folder structure preserved
 * 7. Upload to storage
 * 8. Return signed URL
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
      return NextResponse.json(
        { error: 'Job must be complete before creating ZIP' },
        { status: 400 }
      );
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

      const { data: signedUrl } = await supabase.storage
        .from('reports')
        .createSignedUrl(zipPath, 3600);

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
    // We'll use these paths to derive both tallas and etiquetas PDF paths
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
      return NextResponse.json(
        { error: `No PDFs found for region: ${regionUpper}` },
        { status: 404 }
      );
    }

    console.log(
      `Found ${tasks.length} schools in ${regionUpper} (will generate ~${tasks.length * 2} PDFs including tallas and etiquetas)`
    );

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Balanced compression
    });

    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Download and add PDFs in parallel batches
    // Process both tallas and etiquetas PDFs for each school
    const BATCH_SIZE = 20;
    let completed = 0;
    const totalExpectedPdfs = tasks.length * 2; // Each school has 2 PDFs

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async task => {
          try {
            // Derive etiquetas path from tallas path
            // task.pdf_path is the tallas path: jobId/REGION/DEPT/DIST/school-tallas.pdf
            const etiquetasPath = task.pdf_path.replace('-tallas.pdf', '-etiquetas.pdf');

            // Download both PDFs in parallel
            const [tallasResult, etiquetasResult] = await Promise.allSettled([
              supabase.storage.from('reports').download(task.pdf_path),
              supabase.storage.from('reports').download(etiquetasPath),
            ]);

            // Process tallas PDF
            if (tallasResult.status === 'fulfilled' && tallasResult.value.data) {
              const buffer = Buffer.from(await tallasResult.value.data.arrayBuffer());

              // Preserve folder structure from region onwards
              // Input: jobId/REGION/DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
              // Output: DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
              const pathParts = task.pdf_path.split('/');
              const regionIndex = pathParts.findIndex(
                (part: string) => part.toUpperCase() === regionUpper
              );
              const relativePath =
                regionIndex >= 0
                  ? pathParts.slice(regionIndex + 1).join('/') // Keep everything after REGION
                  : pathParts[pathParts.length - 1]; // Fallback to just filename

              archive.append(buffer, { name: relativePath });
              completed++;
            } else {
              console.error(`Failed to download tallas PDF: ${task.pdf_path}`);
            }

            // Process etiquetas PDF
            if (etiquetasResult.status === 'fulfilled' && etiquetasResult.value.data) {
              const buffer = Buffer.from(await etiquetasResult.value.data.arrayBuffer());

              // Preserve folder structure for etiquetas
              // Input: jobId/REGION/DEPARTAMENTO/MUNICIPIO/80107-etiquetas.pdf
              // Output: DEPARTAMENTO/MUNICIPIO/80107-etiquetas.pdf
              const pathParts = etiquetasPath.split('/');
              const regionIndex = pathParts.findIndex(
                (part: string) => part.toUpperCase() === regionUpper
              );
              const relativePath =
                regionIndex >= 0
                  ? pathParts.slice(regionIndex + 1).join('/')
                  : pathParts[pathParts.length - 1];

              archive.append(buffer, { name: relativePath });
              completed++;
            } else {
              console.error(`Failed to download etiquetas PDF: ${etiquetasPath}`);
            }

            if (completed % 100 === 0) {
              console.log(`Progress: ${completed}/${totalExpectedPdfs} PDFs`);
            }
          } catch (err) {
            console.error(`Error processing task ${task.id}:`, err);
          }
        })
      );
    }

    console.log(`Added ${completed} PDFs to archive (${tasks.length} schools × 2 PDF types)`);

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
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload ZIP' }, { status: 500 });
    }

    // Generate signed URL
    const { data: signedUrl } = await supabase.storage
      .from('reports')
      .createSignedUrl(zipPath, 3600);

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`ZIP generation completed in ${elapsedSeconds}s`);

    return NextResponse.json({
      region: regionLower,
      downloadUrl: signedUrl?.signedUrl,
      pdfCount: completed,
      schoolCount: tasks.length,
      zipSizeMB: parseFloat(zipSizeMB),
      generationTimeSeconds: parseFloat(elapsedSeconds),
      cached: false,
      message: `Included ${completed} PDFs (${tasks.length} schools × 2 types: tallas and etiquetas)`,
    });
  } catch (error) {
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Error generating ZIP after ${elapsedSeconds}s:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
