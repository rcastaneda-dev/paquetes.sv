# ZIP Worker - Background ZIP Generation Service

A standalone Node.js worker that processes ZIP generation jobs in the background, solving the Supabase Storage 413 error by using TUS resumable uploads for large files.

## Overview

This worker:

- Polls the `zip_jobs` table for queued jobs via `claim_next_zip_job()` RPC (`FOR UPDATE SKIP LOCKED`)
- Handles **3 job types** via `job_kind` discriminator: `region`, `category`, `school_bundle`
- Downloads PDFs from Supabase Storage in configurable batches
- Creates ZIP archives with streaming compression (in-memory, no temp files)
- Uploads ZIPs using TUS protocol (automatic for files >6MB)
- Updates job status + progress for frontend polling
- Graceful shutdown on `SIGINT`/`SIGTERM`

## Architecture

```
Frontend (Vercel)
    ↓
    Creates ZIP job in database (job_kind: region|category|school_bundle)
    ↓
    Polls job status
    ↓
Worker (Railway) ←── Polls claim_next_zip_job() RPC continuously
    ↓
    Routes to handler by job_kind
    ↓
    region/category: Downloads PDFs from Supabase Storage → Streams into ZIP
    school_bundle:   Generates 3-section PDFs per school (Cajas + Ficha Uniformes + Ficha Zapatos)
    ↓
    Uploads to Supabase Storage (TUS for >6MB)
    ↓
    Updates job status → Frontend downloads via signed URL
```

## Job Types

| `job_kind`      | Source                                   | Output Path                                 | Description                             |
| --------------- | ---------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `region`        | `report_tasks` (tallas + etiquetas PDFs) | `bundles/{jobId}-{region}.zip`              | All school PDFs for a geographic region |
| `category`      | `report_category_tasks`                  | `bundles/{jobId}/{fecha}/{category}.zip`    | All school PDFs for one category type   |
| `school_bundle` | Student data (generates PDFs internally) | `bundles/{jobId}/{fecha}/school_bundle.zip` | 3-section merged PDF per school         |

### School Bundle (hybrid delegation)

The school bundle is unique because the ZIP worker **generates its own PDFs** instead of downloading pre-built ones. It contains a self-contained PDF generator (`school-bundle-processor.ts`, ~1,076 lines) that produces a 3-section PDF per school:

1. **Cajas** (landscape) - Box distribution by grade/gender
2. **Ficha Uniformes** (portrait) - School uniform card
3. **Ficha Zapatos** (portrait) - School shoe card

This includes the "vacíos" buffer calculation (5% extra) and garment-type size restrictions.

## Source Files

| File                         | Lines  | Purpose                                          |
| ---------------------------- | ------ | ------------------------------------------------ |
| `index.ts`                   | ~479   | Main polling loop + region/category job handlers |
| `school-bundle-processor.ts` | ~1,032 | Self-contained PDF generator for school bundles  |
| `assets/goes_logo_2.png`     | -      | GOES logo embedded in school bundle PDFs         |

## Requirements

- Node.js 18+
- Supabase project with:
  - `zip_jobs` table (see migration 024)
  - `reports` storage bucket
  - Service role key

## Local Development

### 1. Install Dependencies

```bash
cd worker/zip-worker
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: tune performance
POLL_INTERVAL_MS=5000
DOWNLOAD_BATCH_SIZE=50
COMPRESSION_LEVEL=6
```

### 3. Run Locally

```bash
# Development (with auto-reload)
npm run dev

# Production build
npm run build
npm start
```

### 4. Test

Create a test ZIP job via API:

```bash
curl -X POST "http://localhost:3000/api/bulk/jobs/YOUR_JOB_ID/create-zip-job?region=oriental"
```

Watch worker logs to see it process the job.

## Deployment to Railway

### Option 1: Railway CLI (Recommended)

1. **Install Railway CLI**

```bash
npm install -g @railway/cli
railway login
```

2. **Create Railway Project**

```bash
cd worker/zip-worker
railway init
```

3. **Set Environment Variables**

```bash
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

4. **Deploy**

```bash
railway up
```

### Option 2: Railway Dashboard

1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub repo
3. Select this repo
4. Set root directory: `worker/zip-worker`
5. Add environment variables in Railway dashboard
6. Deploy

### Environment Variables (Railway)

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `POLL_INTERVAL_MS` (default: 5000)
- `DOWNLOAD_BATCH_SIZE` (default: 50)
- `COMPRESSION_LEVEL` (default: 6)

### Resource Allocation

**Recommended Railway Plan:** Hobby ($5/mo)

- Memory: 512MB - 1GB
- CPU: Shared
- Replicas: 1 (more not needed for low volume)

**For high volume (100+ ZIPs/day):** Developer Plan ($20/mo)

- Memory: 2GB - 8GB
- CPU: Shared/Dedicated
- Replicas: 1-2

## Deployment to Other Platforms

### Render

1. Create new Web Service
2. Connect GitHub repo
3. Set root directory: `worker/zip-worker`
4. Build command: `npm install && npm run build`
5. Start command: `npm start`
6. Add environment variables

### Fly.io

```bash
cd worker/zip-worker
fly launch
fly secrets set NEXT_PUBLIC_SUPABASE_URL=...
fly secrets set SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```

### AWS Lambda (with Docker)

1. Build Docker image
2. Push to ECR
3. Create Lambda function from container
4. Set timeout: 15 minutes
5. Set memory: 2048 MB
6. Trigger: EventBridge (every 1 minute)

**Note:** Lambda requires different polling logic (not continuous loop).

## Configuration Tuning

### For Faster Processing

```bash
DOWNLOAD_BATCH_SIZE=100  # More parallel downloads
COMPRESSION_LEVEL=3      # Faster compression (larger files)
```

### For Lower Memory Usage

```bash
DOWNLOAD_BATCH_SIZE=20   # Fewer parallel downloads
COMPRESSION_LEVEL=6      # Default balanced compression
```

### For Large Regions (>5,000 PDFs)

```bash
DOWNLOAD_BATCH_SIZE=30
COMPRESSION_LEVEL=4
```

Ensure worker has 2GB+ memory.

## Monitoring

### Check Worker Logs

**Railway:**

```bash
railway logs
```

**Docker:**

```bash
docker logs -f <container-id>
```

### Expected Log Output

```
🚀 ZIP Worker starting...
📊 Config: Poll interval=5000ms, Batch size=50, Compression=6

📦 Processing ZIP job: abc-123
   Report: def-456, Region: ORIENTAL
   🔍 Fetching PDFs for region ORIENTAL...
   ✅ Found 1500 schools (will generate ~3000 PDFs: tallas + etiquetas)
   📥 Downloading batch: 50/1500 schools
   📥 Downloading batch: 100/1500 schools
   ...
   📊 Progress: 3000 PDFs added to archive
   🗜️  Finalizing ZIP archive...
   ✅ ZIP created: 487.23 MB, 3000 PDFs
   ⬆️  Uploading to storage: bundles/def-456-oriental.zip...
   ✅ Upload complete
   ✅ Job completed in 89.2s
```

### Database Monitoring

Check ZIP job queue:

```sql
-- Queued jobs
SELECT * FROM zip_jobs WHERE status = 'queued' ORDER BY created_at;

-- Processing jobs
SELECT * FROM zip_jobs WHERE status = 'processing';

-- Failed jobs
SELECT * FROM zip_jobs WHERE status = 'failed';

-- Average processing time
SELECT
  region,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds
FROM zip_jobs
WHERE status = 'complete'
GROUP BY region;
```

## Troubleshooting

### Worker Not Picking Up Jobs

**Check:**

1. Worker is running: `railway logs` or `docker ps`
2. Database connection: Verify `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. Jobs exist: `SELECT * FROM zip_jobs WHERE status = 'queued'`

### Upload Fails with 413 Error

**Solution:** This worker automatically uses TUS for files >6MB. If still failing:

1. Check Supabase Storage bucket settings
2. Verify file size limits (default 50GB for TUS)
3. Check worker has enough memory for large ZIPs

### Worker Crashes with OOM (Out of Memory)

**Solutions:**

1. Reduce batch size: `DOWNLOAD_BATCH_SIZE=20`
2. Increase worker memory in Railway/Render
3. Lower compression: `COMPRESSION_LEVEL=3`

### Jobs Stuck in "processing"

**Recovery:**

```sql
-- Reset stuck jobs (older than 30 minutes)
UPDATE zip_jobs
SET status = 'queued',
    started_at = NULL,
    attempt_count = attempt_count + 1
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes';
```

## Database RPCs Used

| Function                                         | Purpose                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `claim_next_zip_job()`                           | Atomic claim with `SKIP LOCKED` (returns `job_id`, `report_job_id`, `job_kind`, `region`, `category`) |
| `update_zip_job_status(p_job_id, p_status, ...)` | Update status, zip path, size, PDF count, error, progress                                             |
| `retry_zip_job(p_job_id)`                        | Requeue a failed job                                                                                  |
| `cleanup_old_zip_jobs(p_days_old)`               | Delete completed jobs older than N days                                                               |

## Notable Patterns

- **Atomic job claiming**: `FOR UPDATE SKIP LOCKED` prevents race conditions between multiple worker instances
- **Dual PDF download**: Region jobs download both `-tallas.pdf` and `-etiquetas.pdf` per school in parallel, with graceful failure if one is missing
- **In-memory streaming**: ZIP built entirely in memory using Archiver (no intermediate temp files)
- **PostgREST pagination**: Student data fetched in 1,000-row batches with a 200,000-row safety limit
- **Safe filenames**: School codes sanitized (`/[^a-zA-Z0-9_-]/g` → `_`) for ZIP entries
- **Logo fallback**: Searches `/app/assets/`, `{cwd}/assets/`, `{cwd}/public/` for `goes_logo_2.png`, silently skips if missing

## Performance Benchmarks

| Job Type                | PDFs     | ZIP Size  | Time    | Memory    |
| ----------------------- | -------- | --------- | ------- | --------- |
| Region (~1,500 schools) | ~3,000   | ~500MB    | 60-120s | ~1GB      |
| Category                | varies   | 200-400MB | 30-90s  | 512MB-1GB |
| School Bundle           | 1/school | varies    | varies  | ~2GB      |

**Total for all regions:** 4-8 minutes (can run in parallel with multiple workers)

## Scaling

### For Higher Volume

1. **Increase replicas** (Railway/Render)
   - 2-3 workers can process multiple regions in parallel
   - Each worker claims jobs independently (SKIP LOCKED)

2. **Use dedicated CPU**
   - Faster compression and upload
   - Railway Developer plan or Render Plus

3. **Optimize batch size**
   - Larger batches = faster but more memory
   - Test optimal value for your data

### Cost Estimates

**Low volume (20 ZIPs/week):**

- Railway Hobby: $5/mo
- Total: $5/mo

**Medium volume (100 ZIPs/week):**

- Railway Developer: $20/mo
- Total: $20/mo

**High volume (500+ ZIPs/week):**

- Railway Pro: $50/mo (2 workers)
- Total: $50/mo

## Maintenance

### Clean Up Old Completed Jobs

Run periodically (or add cron):

```sql
SELECT cleanup_old_zip_jobs(30); -- Delete jobs older than 30 days
```

### Retry Failed Jobs

```sql
-- Retry specific job
SELECT retry_zip_job('job-id');

-- Retry all failed jobs
UPDATE zip_jobs
SET status = 'queued',
    error = NULL,
    failed_at = NULL
WHERE status = 'failed';
```

## Security

- Worker uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Keep service key secret (never commit to git)
- Use environment variables in Railway/Render
- Worker has full access to storage (read/write)

## Next Steps

After deploying:

1. ✅ Run migration `024_add_zip_jobs_queue.sql`
2. ✅ Deploy worker to Railway
3. ✅ Test with frontend by clicking "Download Region"
4. ✅ Monitor logs for first successful job
5. ✅ Set up alerts for failed jobs (optional)

## Support

For issues:

1. Check logs first
2. Verify environment variables
3. Test database connection
4. Check Supabase Storage bucket configuration

---

**Built for:** paquetes.sv
**Version:** 1.0.0
**Last Updated:** 2026-02-14
