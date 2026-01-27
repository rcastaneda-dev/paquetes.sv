import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Supabase Edge Function for creating ZIP bundles manually on user request.
 *
 * Flow:
 * 1. User clicks "Generate ZIP" button → Frontend calls /api/bulk/jobs/[jobId]/generate-zip
 * 2. That API route calls this Edge Function
 * 3. Edge Function fetches PDFs from storage
 * 4. ZIP is generated in-memory
 * 5. ZIP is uploaded to storage
 * 6. Job record is updated with zip_path
 * 7. Signed URL is returned to user
 *
 * IMPORTANT: This is a MANUAL trigger. ZIP bundles are only created when explicitly
 * requested by the user, NOT automatically after job completion.
 *
 * This replaces the Vercel worker approach with serverless execution on Supabase.
 */

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Simple ZIP file creator for Deno.
 * Creates a ZIP archive in memory from an array of file entries.
 */
class SimpleZipCreator {
  private entries: ZipEntry[] = [];

  addFile(name: string, data: Uint8Array) {
    this.entries.push({ name, data });
  }

  /**
   * Generate ZIP file using the ZIP file format specification.
   * Uses store method (no compression) for speed.
   */
  async create(): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const centralDirectory: Uint8Array[] = [];
    let offset = 0;

    // Write each file
    for (const entry of this.entries) {
      const nameBytes = encoder.encode(entry.name);
      const fileData = entry.data;

      // Local file header
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(localHeader.buffer);

      // Local file header signature
      view.setUint32(0, 0x04034b50, true);
      // Version needed to extract
      view.setUint16(4, 20, true);
      // General purpose bit flag
      view.setUint16(6, 0, true);
      // Compression method (0 = store, no compression)
      view.setUint16(8, 0, true);
      // Last mod file time
      view.setUint16(10, 0, true);
      // Last mod file date
      view.setUint16(12, 0, true);
      // CRC-32 (we'll use 0 for simplicity with store method)
      view.setUint32(14, this.crc32(fileData), true);
      // Compressed size
      view.setUint32(18, fileData.length, true);
      // Uncompressed size
      view.setUint32(22, fileData.length, true);
      // File name length
      view.setUint16(26, nameBytes.length, true);
      // Extra field length
      view.setUint16(28, 0, true);

      // Copy file name
      localHeader.set(nameBytes, 30);

      chunks.push(localHeader);
      chunks.push(fileData);

      // Central directory header
      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);

      // Central directory signature
      centralView.setUint32(0, 0x02014b50, true);
      // Version made by
      centralView.setUint16(4, 20, true);
      // Version needed to extract
      centralView.setUint16(6, 20, true);
      // General purpose bit flag
      centralView.setUint16(8, 0, true);
      // Compression method
      centralView.setUint16(10, 0, true);
      // Last mod file time
      centralView.setUint16(12, 0, true);
      // Last mod file date
      centralView.setUint16(14, 0, true);
      // CRC-32
      centralView.setUint32(16, this.crc32(fileData), true);
      // Compressed size
      centralView.setUint32(20, fileData.length, true);
      // Uncompressed size
      centralView.setUint32(24, fileData.length, true);
      // File name length
      centralView.setUint16(28, nameBytes.length, true);
      // Extra field length
      centralView.setUint16(30, 0, true);
      // File comment length
      centralView.setUint16(32, 0, true);
      // Disk number start
      centralView.setUint16(34, 0, true);
      // Internal file attributes
      centralView.setUint16(36, 0, true);
      // External file attributes
      centralView.setUint32(38, 0, true);
      // Relative offset of local header
      centralView.setUint32(42, offset, true);

      // Copy file name
      centralHeader.set(nameBytes, 46);
      centralDirectory.push(centralHeader);

      offset += localHeader.length + fileData.length;
    }

    // Calculate central directory size
    const centralDirSize = centralDirectory.reduce((sum, cd) => sum + cd.length, 0);

    // End of central directory record
    const endOfCentralDir = new Uint8Array(22);
    const endView = new DataView(endOfCentralDir.buffer);

    // End of central dir signature
    endView.setUint32(0, 0x06054b50, true);
    // Number of this disk
    endView.setUint16(4, 0, true);
    // Disk where central directory starts
    endView.setUint16(6, 0, true);
    // Number of central directory records on this disk
    endView.setUint16(8, this.entries.length, true);
    // Total number of central directory records
    endView.setUint16(10, this.entries.length, true);
    // Size of central directory
    endView.setUint32(12, centralDirSize, true);
    // Offset of start of central directory
    endView.setUint32(16, offset, true);
    // Comment length
    endView.setUint16(20, 0, true);

    // Combine all parts
    const allChunks = [...chunks, ...centralDirectory, endOfCentralDir];
    const totalLength = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let position = 0;
    for (const chunk of allChunks) {
      result.set(chunk, position);
      position += chunk.length;
    }

    return result;
  }

  /**
   * Simple CRC32 implementation
   */
  private crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}

/**
 * Build a safe filename for a PDF entry inside a ZIP archive.
 */
function buildZipPdfEntryName(args: { schoolCodigoCe: string; grado: string }): string {
  const { schoolCodigoCe, grado } = args;
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

serve(async req => {
  try {
    // Get job ID from query params
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Missing jobId parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create Supabase client
    // Supabase Edge Functions automatically validate the Authorization header
    // We use service role key for elevated permissions (storage access)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Creating bundle.zip for job ${jobId}`);

    // Check if bundle already exists
    const { data: job, error: jobError } = await supabase
      .from('report_jobs')
      .select('zip_path, status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate job status
    if (job.status !== 'complete' && job.status !== 'failed') {
      return new Response(JSON.stringify({ error: 'Job not yet complete' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If bundle already exists, return signed URL
    if (job.zip_path && job.zip_path.endsWith('bundle.zip')) {
      console.log(`Bundle already exists for job ${jobId}, returning signed URL`);
      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from('reports')
        .createSignedUrl(job.zip_path, 3600);

      if (urlError || !signedUrlData) {
        return new Response(JSON.stringify({ error: 'Failed to generate download URL' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          downloadUrl: signedUrlData.signedUrl,
          bundlePath: job.zip_path,
          expiresIn: 3600,
          cached: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all completed tasks
    const { data: allTasks, error: tasksError } = await supabase
      .from('report_tasks')
      .select('pdf_path, school_codigo_ce, grado')
      .eq('job_id', jobId)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .order('school_codigo_ce', { ascending: true })
      .order('grado', { ascending: true });

    if (tasksError) {
      return new Response(JSON.stringify({ error: `Failed to fetch tasks: ${tasksError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!allTasks || allTasks.length === 0) {
      return new Response(JSON.stringify({ error: 'No completed tasks found for this job' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Bundling ${allTasks.length} PDFs for job ${jobId}`);

    // Create ZIP archive
    const zip = new SimpleZipCreator();

    // Download and add PDFs in batches
    const BATCH_SIZE = 20;
    let processedCount = 0;

    for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
      const batch = allTasks.slice(i, i + BATCH_SIZE);

      // Download batch in parallel
      const downloadResults = await Promise.allSettled(
        batch.map(async task => {
          const pdfPath = task.pdf_path as string;
          const { data: pdfData, error: downloadError } = await supabase.storage
            .from('reports')
            .download(pdfPath);

          if (downloadError || !pdfData) {
            console.error(`Failed to download ${pdfPath}:`, downloadError);
            return null;
          }

          return {
            task,
            pdfData: new Uint8Array(await pdfData.arrayBuffer()),
          };
        })
      );

      // Add successfully downloaded PDFs to archive
      for (const result of downloadResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { task, pdfData } = result.value;
          const fileName = buildZipPdfEntryName({
            schoolCodigoCe: task.school_codigo_ce,
            grado: task.grado,
          });
          zip.addFile(fileName, pdfData);
          processedCount++;
        }
      }

      // Log progress every 100 PDFs
      if (processedCount % 100 === 0) {
        console.log(`Progress: ${processedCount}/${allTasks.length} PDFs added to ZIP`);
      }
    }

    // Generate ZIP file
    const bundleBuffer = await zip.create();
    console.log(`Bundle created with ${processedCount} PDFs, size: ${bundleBuffer.length} bytes`);

    // Upload bundle to storage
    const bundlePath = `${jobId}/bundle.zip`;
    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(bundlePath, bundleBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      return new Response(JSON.stringify({ error: `Failed to upload bundle: ${uploadError.message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update job with bundle path
    await supabase
      .from('report_jobs')
      .update({ zip_path: bundlePath, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    // Generate signed URL for immediate download
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('reports')
      .createSignedUrl(bundlePath, 3600);

    if (urlError || !signedUrlData) {
      return new Response(JSON.stringify({ error: 'Failed to generate download URL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Bundle finalized for job ${jobId}: ${bundlePath}`);

    return new Response(
      JSON.stringify({
        downloadUrl: signedUrlData.signedUrl,
        bundlePath: bundlePath,
        expiresIn: 3600,
        filesIncluded: processedCount,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('ZIP creation error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
