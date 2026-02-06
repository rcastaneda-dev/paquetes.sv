import { createClient, SupabaseClient } from '@supabase/supabase-js';
import archiver from 'archiver';
import { Readable } from 'stream';

/**
 * Background ZIP Worker
 *
 * This worker runs continuously, polling for queued ZIP jobs from the database.
 * When a job is found, it:
 * 1. Downloads PDFs for the specified region from Supabase Storage
 * 2. Streams them into a ZIP archive
 * 3. Uploads the ZIP back to Supabase Storage using standard upload (TUS automatic)
 * 4. Updates the job status
 *
 * Deploy to Railway, Render, or any platform with persistent processes.
 */

interface ZipJob {
  job_id: string;
  report_job_id: string;
  job_kind: 'region' | 'category';
  region: string | null;
  category: string | null;
}

interface Task {
  id: string;
  pdf_path: string;
  school_codigo_ce: string;
  grado: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.DOWNLOAD_BATCH_SIZE || '50', 10);
const COMPRESSION_LEVEL = parseInt(process.env.COMPRESSION_LEVEL || '6', 10);

// Validate environment
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Missing required environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Main worker loop
 */
async function main() {
  console.log('🚀 ZIP Worker starting...');
  console.log(
    `📊 Config: Poll interval=${POLL_INTERVAL_MS}ms, Batch size=${BATCH_SIZE}, Compression=${COMPRESSION_LEVEL}`
  );

  while (true) {
    try {
      // Claim next queued job
      const { data: jobs, error } = await supabase.rpc('claim_next_zip_job');

      if (error) {
        console.error('❌ Error claiming job:', error);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (!jobs || jobs.length === 0) {
        // No jobs available, wait and poll again
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const job = jobs[0] as ZipJob;
      console.log(`\n📦 Processing ZIP job: ${job.job_id}`);
      console.log(
        `   Report: ${job.report_job_id}, Kind: ${job.job_kind}, ${
          job.job_kind === 'region' ? `Region: ${job.region?.toUpperCase()}` : `Category: ${job.category}`
        }`
      );

      // Process the job
      await processZipJob(supabase, job);
    } catch (error) {
      console.error('❌ Unexpected error in main loop:', error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/**
 * Process a single ZIP job (region or category)
 */
async function processZipJob(supabase: SupabaseClient, job: ZipJob) {
  const startTime = Date.now();

  try {
    if (job.job_kind === 'region') {
      await processRegionZipJob(supabase, job, startTime);
    } else if (job.job_kind === 'category') {
      await processCategoryZipJob(supabase, job, startTime);
    } else {
      throw new Error(`Unknown job_kind: ${job.job_kind}`);
    }
  } catch (error) {
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error(`   ❌ Job failed after ${elapsedSeconds}s:`, errorMessage);

    // Update job status to failed
    try {
      await supabase.rpc('update_zip_job_status', {
        p_job_id: job.job_id,
        p_status: 'failed',
        p_error: errorMessage,
      });
    } catch (updateError) {
      console.error('   ❌ Failed to update job status:', updateError);
    }
  }
}

/**
 * Process a region-scoped ZIP job
 */
async function processRegionZipJob(
  supabase: SupabaseClient,
  job: ZipJob,
  startTime: number
) {
  if (!job.region) {
    throw new Error('Region is required for region ZIP jobs');
  }

  const regionUpper = job.region.toUpperCase();

    // 1. Fetch all completed tasks for this region from database
    console.log(`   🔍 Fetching PDFs for region ${regionUpper}...`);
    const { data: tasks, error: tasksError } = await supabase
      .from('report_tasks')
      .select('id, pdf_path, school_codigo_ce, grado')
      .eq('job_id', job.report_job_id)
      .eq('status', 'complete')
      .not('pdf_path', 'is', null)
      .ilike('pdf_path', `%/${regionUpper}/%`)
      .order('school_codigo_ce', { ascending: true });

    if (tasksError) {
      throw new Error(`Failed to fetch tasks: ${tasksError.message}`);
    }

    if (!tasks || tasks.length === 0) {
      throw new Error(`No PDFs found for region ${regionUpper}`);
    }

    console.log(
      `   ✅ Found ${tasks.length} schools (will generate ~${tasks.length * 2} PDFs: tallas + etiquetas)`
    );

    // 2. Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: COMPRESSION_LEVEL },
    });

    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    let pdfCount = 0;

    // 3. Download PDFs in batches and add to archive
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const batchProgress = `${i + batch.length}/${tasks.length}`;

      console.log(`   📥 Downloading batch: ${batchProgress} schools`);

      await Promise.all(
        batch.map(async (task: Task) => {
          try {
            // Derive both tallas and etiquetas paths
            const tallasPath = task.pdf_path;
            const etiquetasPath = task.pdf_path.replace('-tallas.pdf', '-etiquetas.pdf');

            // Download both PDFs in parallel
            const [tallasResult, etiquetasResult] = await Promise.allSettled([
              supabase.storage.from('reports').download(tallasPath),
              supabase.storage.from('reports').download(etiquetasPath),
            ]);

            // Process tallas PDF
            if (tallasResult.status === 'fulfilled' && tallasResult.value.data) {
              const buffer = Buffer.from(await tallasResult.value.data.arrayBuffer());
              const relativePath = getRelativePath(tallasPath, regionUpper);
              archive.append(buffer, { name: relativePath });
              pdfCount++;
            } else {
              console.warn(`   ⚠️  Failed to download tallas: ${tallasPath}`);
            }

            // Process etiquetas PDF
            if (etiquetasResult.status === 'fulfilled' && etiquetasResult.value.data) {
              const buffer = Buffer.from(await etiquetasResult.value.data.arrayBuffer());
              const relativePath = getRelativePath(etiquetasPath, regionUpper);
              archive.append(buffer, { name: relativePath });
              pdfCount++;
            } else {
              console.warn(`   ⚠️  Failed to download etiquetas: ${etiquetasPath}`);
            }
          } catch (err) {
            console.error(`   ❌ Error processing task ${task.id}:`, err);
          }
        })
      );

      if ((i + batch.length) % 100 === 0 || i + batch.length >= tasks.length) {
        console.log(`   📊 Progress: ${pdfCount} PDFs added to archive`);
      }
    }

    // 4. Finalize ZIP
    console.log(`   🗜️  Finalizing ZIP archive...`);
    archive.finalize();

    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);
    const zipSizeMB = (zipBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`   ✅ ZIP created: ${zipSizeMB} MB, ${pdfCount} PDFs`);

    // 5. Upload ZIP to Supabase Storage
    // NOTE: Supabase SDK automatically uses TUS for files > 6MB
    const zipPath = `bundles/${job.report_job_id}-${job.region}.zip`;
    console.log(`   ⬆️  Uploading to storage: ${zipPath}...`);

    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(zipPath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
        // TUS is used automatically for large files
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log(`   ✅ Upload complete`);

    // 6. Update job status to complete
    await supabase.rpc('update_zip_job_status', {
      p_job_id: job.job_id,
      p_status: 'complete',
      p_zip_path: zipPath,
      p_zip_size_bytes: zipBuffer.length,
      p_pdf_count: pdfCount,
    });

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Job completed in ${elapsedSeconds}s`);
}

/**
 * Process a category-scoped ZIP job
 */
async function processCategoryZipJob(
  supabase: SupabaseClient,
  job: ZipJob,
  startTime: number
) {
  if (!job.category) {
    throw new Error('Category is required for category ZIP jobs');
  }

  const category = job.category;
  console.log(`   🔍 Fetching PDFs for category ${category}...`);

  // 1. Get fecha_inicio from job params
  const { data: jobData, error: jobError } = await supabase
    .from('report_jobs')
    .select('job_params')
    .eq('id', job.report_job_id)
    .single();

  if (jobError || !jobData) {
    throw new Error(`Failed to fetch job params: ${jobError?.message}`);
  }

  const fechaInicio = (jobData.job_params as { fecha_inicio?: string })?.fecha_inicio || '';

  // 2. Fetch all completed category tasks for this job + category
  const { data: tasks, error: tasksError } = await supabase
    .from('report_category_tasks')
    .select('id, pdf_path, school_codigo_ce, category')
    .eq('job_id', job.report_job_id)
    .eq('category', category)
    .eq('status', 'complete')
    .not('pdf_path', 'is', null)
    .order('school_codigo_ce', { ascending: true });

  if (tasksError) {
    throw new Error(`Failed to fetch tasks: ${tasksError.message}`);
  }

  if (!tasks || tasks.length === 0) {
    throw new Error(`No PDFs found for category ${category}`);
  }

  console.log(`   ✅ Found ${tasks.length} schools with PDFs for category ${category}`);

  // 3. Create ZIP archive
  const archive = archiver('zip', {
    zlib: { level: COMPRESSION_LEVEL },
  });

  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  let pdfCount = 0;

  // 4. Download PDFs in batches and add to archive
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchProgress = `${i + batch.length}/${tasks.length}`;

    console.log(`   📥 Downloading batch: ${batchProgress} schools`);

    await Promise.all(
      batch.map(async task => {
        try {
          const pdfPath = task.pdf_path!;

          // Download PDF
          const { data: pdfData, error: downloadError } = await supabase.storage
            .from('reports')
            .download(pdfPath);

          if (downloadError || !pdfData) {
            console.warn(`   ⚠️  Failed to download: ${pdfPath}`);
            return;
          }

          const buffer = Buffer.from(await pdfData.arrayBuffer());

          // Use school code as filename in ZIP
          const fileName = `${task.school_codigo_ce}.pdf`;
          archive.append(buffer, { name: fileName });
          pdfCount++;
        } catch (err) {
          console.error(`   ❌ Error processing task ${task.id}:`, err);
        }
      })
    );

    if ((i + batch.length) % 100 === 0 || i + batch.length >= tasks.length) {
      console.log(`   📊 Progress: ${pdfCount} PDFs added to archive`);
    }
  }

  // 5. Finalize ZIP
  console.log(`   🗜️  Finalizing ZIP archive...`);
  archive.finalize();

  await new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const zipBuffer = Buffer.concat(chunks);
  const zipSizeMB = (zipBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`   ✅ ZIP created: ${zipSizeMB} MB, ${pdfCount} PDFs`);

  // 6. Upload ZIP to Supabase Storage
  const zipPath = `bundles/${job.report_job_id}/${fechaInicio}/${category}.zip`;
  console.log(`   ⬆️  Uploading to storage: ${zipPath}...`);

  const { error: uploadError } = await supabase.storage.from('reports').upload(zipPath, zipBuffer, {
    contentType: 'application/zip',
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  console.log(`   ✅ Upload complete`);

  // 7. Update job status to complete
  await supabase.rpc('update_zip_job_status', {
    p_job_id: job.job_id,
    p_status: 'complete',
    p_zip_path: zipPath,
    p_zip_size_bytes: zipBuffer.length,
    p_pdf_count: pdfCount,
  });

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   ✅ Job completed in ${elapsedSeconds}s`);
}

/**
 * Extract relative path from full storage path
 * Input: jobId/REGION/DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
 * Output: DEPARTAMENTO/MUNICIPIO/80107-tallas.pdf
 */
function getRelativePath(fullPath: string, region: string): string {
  const pathParts = fullPath.split('/');
  const regionIndex = pathParts.findIndex(part => part.toUpperCase() === region);

  if (regionIndex >= 0) {
    return pathParts.slice(regionIndex + 1).join('/');
  }

  // Fallback: just return filename
  return pathParts[pathParts.length - 1];
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Shutting down gracefully...');
  process.exit(0);
});

// Start worker
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
