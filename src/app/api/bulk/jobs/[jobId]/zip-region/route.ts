import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import archiver from 'archiver';
import { Readable } from 'stream';

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
 * 3. If not, generate ZIP on-the-fly
 * 4. Upload to storage
 * 5. Return signed URL
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

    console.log(`Generating ZIP for region: ${regionLower}`);

    // Fetch PDFs for this region from storage
    // Storage structure: [jobId]/[region]/school-grade.pdf
    const { data: files, error: listError } = await supabase.storage
      .from('reports')
      .list(`${jobId}/${regionLower}`, {
        limit: 10000,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (listError) {
      console.error('Error listing files:', listError);
      return NextResponse.json({ error: 'Failed to list PDFs' }, { status: 500 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: `No PDFs found for region: ${regionLower}` }, { status: 404 });
    }

    // Filter only PDF files
    const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));
    console.log(`Found ${pdfFiles.length} PDFs for ${regionLower}`);

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 }, // Balanced compression
    });

    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Download and add PDFs in parallel batches
    const BATCH_SIZE = 20;
    let completed = 0;

    for (let i = 0; i < pdfFiles.length; i += BATCH_SIZE) {
      const batch = pdfFiles.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async file => {
          try {
            const filePath = `${jobId}/${regionLower}/${file.name}`;
            const { data: pdfData, error: downloadError } = await supabase.storage
              .from('reports')
              .download(filePath);

            if (downloadError || !pdfData) {
              console.error(`Failed to download ${filePath}`);
              return;
            }

            const buffer = Buffer.from(await pdfData.arrayBuffer());
            archive.append(buffer, { name: file.name });
            completed++;

            if (completed % 100 === 0) {
              console.log(`Progress: ${completed}/${pdfFiles.length} PDFs`);
            }
          } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
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
