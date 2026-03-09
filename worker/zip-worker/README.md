# ZIP Worker

Background Node.js service that processes ZIP generation jobs, using TUS resumable uploads for large files (>6 MB).

---

## How it works

1. Polls `zip_jobs` table via `claim_next_zip_job()` RPC (`FOR UPDATE SKIP LOCKED`)
2. Routes to handler by `job_kind`: `region`, `category`, or `school_bundle`
3. Downloads PDFs from Supabase Storage (or generates them internally for school bundles)
4. Creates ZIP archive in memory using Archiver (no temp files)
5. Uploads to Supabase Storage (TUS protocol for files >6 MB)
6. Updates job status + progress for frontend polling
7. Graceful shutdown on `SIGINT`/`SIGTERM`

```
Frontend (Vercel)
    ↓ Creates ZIP job in database (job_kind: region|category|school_bundle)
    ↓ Polls job status

Worker (Railway) ←── Polls claim_next_zip_job() RPC continuously
    ↓ Routes to handler by job_kind
    ↓
    ├─ region/category: Downloads PDFs from Storage → Streams into ZIP
    └─ school_bundle:   Generates 3-section PDFs per school internally
    ↓
    ↓ Uploads to Supabase Storage (TUS for >6MB)
    ↓ Updates job status → Frontend downloads via signed URL
```

---

## Job types

| `job_kind` | Source | Output path | Description |
| --- | --- | --- | --- |
| `region` | `report_tasks` (tallas + etiquetas) | `bundles/{jobId}-{region}.zip` | All school PDFs for a geographic region |
| `category` | `report_category_tasks` | `bundles/{jobId}/{fecha}/{category}.zip` | All school PDFs for one category type |
| `school_bundle` | Student data (generates PDFs internally) | `bundles/{jobId}/{fecha}/school_bundle.zip` | 3-section merged PDF per school |

### School bundle details

The school bundle is unique: it **generates its own PDFs** instead of downloading pre-built ones. The self-contained generator (`school-bundle-processor.ts`) produces a 3-section PDF per school:

1. **Cajas** (landscape) — box distribution by grade/gender
2. **Ficha Uniformes** (portrait) — school uniform card
3. **Ficha Zapatos** (portrait) — school shoe card

Includes the "vacíos" buffer calculation (5% extra) and garment-type size restrictions.

---

## Source files

| File | Purpose |
| --- | --- |
| `index.ts` | Main polling loop + region/category job handlers |
| `school-bundle-processor.ts` | Self-contained PDF generator for school bundles |
| `assets/goes_logo_2.png` | GOES logo embedded in school bundle PDFs |

---

## Requirements

- Node.js 18+
- Supabase project with:
  - `zip_jobs` table (see migration 024)
  - `reports` storage bucket
  - Service role key

---

## Local development

### Install and run

```bash
cd worker/zip-worker
npm install

# Development (with auto-reload via tsx)
npm run dev

# Production
npm run build && npm start
```

### Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Optional (with defaults):

```bash
POLL_INTERVAL_MS=5000       # Polling frequency
DOWNLOAD_BATCH_SIZE=50      # Parallel PDF downloads
COMPRESSION_LEVEL=6         # ZIP compression (0-9)
```

### Test manually

Create a test ZIP job via API:

```bash
curl -X POST "http://localhost:3000/api/bulk/jobs/YOUR_JOB_ID/create-zip-job?region=oriental"
```

---

## Deployment

### Railway (recommended)

```bash
cd worker/zip-worker
npm install -g @railway/cli
railway login
railway init

# Set env vars
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Deploy
railway up
```

Or via the [Railway dashboard](https://railway.app): create project → deploy from GitHub → set root directory to `worker/zip-worker` → add env vars.

### Other platforms

| Platform | Build command | Start command |
| --- | --- | --- |
| Render | `npm install && npm run build` | `npm start` |
| Fly.io | `fly launch && fly deploy` | — |
| AWS Lambda | Docker image → ECR → Lambda (15 min timeout, 2048 MB) | EventBridge trigger |

> Lambda requires different polling logic (not continuous loop).

---

## Configuration tuning

| Goal | `DOWNLOAD_BATCH_SIZE` | `COMPRESSION_LEVEL` | Memory |
| --- | --- | --- | --- |
| Faster processing | 100 | 3 | 1 GB+ |
| Lower memory | 20 | 6 | 512 MB |
| Large regions (>5,000 PDFs) | 30 | 4 | 2 GB+ |

---

## Resource allocation

| Volume | Plan | Memory | Replicas |
| --- | --- | --- | --- |
| Low (20 ZIPs/week) | Hobby ($5/mo) | 512 MB–1 GB | 1 |
| Medium (100 ZIPs/week) | Developer ($20/mo) | 2–8 GB | 1 |
| High (500+ ZIPs/week) | Pro ($50/mo) | 2–8 GB | 2 |

---

## Performance benchmarks

| Job type | PDFs | ZIP size | Time | Memory |
| --- | --- | --- | --- | --- |
| Region (~1,500 schools) | ~3,000 | ~500 MB | 60–120s | ~1 GB |
| Category | varies | 200–400 MB | 30–90s | 512 MB–1 GB |
| School Bundle | 1/school | varies | varies | ~2 GB |

All regions combined: 4–8 minutes (parallelizable with multiple workers).

---

## Database RPCs used

| Function | Purpose |
| --- | --- |
| `claim_next_zip_job()` | Atomic claim with `SKIP LOCKED` (returns `job_id`, `report_job_id`, `job_kind`, `region`, `category`) |
| `update_zip_job_status(...)` | Update status, zip path, size, PDF count, error, progress |
| `retry_zip_job(p_job_id)` | Requeue a failed job |
| `cleanup_old_zip_jobs(p_days_old)` | Delete completed jobs older than N days |

---

## Monitoring

### Expected log output

```
🚀 ZIP Worker starting...
📊 Config: Poll interval=5000ms, Batch size=50, Compression=6

📦 Processing ZIP job: abc-123
   Report: def-456, Region: ORIENTAL
   🔍 Fetching PDFs for region ORIENTAL...
   ✅ Found 1500 schools (will generate ~3000 PDFs: tallas + etiquetas)
   📥 Downloading batch: 50/1500 schools
   ...
   🗜️  Finalizing ZIP archive...
   ✅ ZIP created: 487.23 MB, 3000 PDFs
   ⬆️  Uploading to storage: bundles/def-456-oriental.zip...
   ✅ Job completed in 89.2s
```

### Database queries

```sql
-- Queued jobs
SELECT * FROM zip_jobs WHERE status = 'queued' ORDER BY created_at;

-- Failed jobs
SELECT * FROM zip_jobs WHERE status = 'failed';

-- Average processing time
SELECT region,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds
FROM zip_jobs WHERE status = 'complete'
GROUP BY region;
```

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| Worker not picking up jobs | Check logs, verify env vars, confirm `SELECT * FROM zip_jobs WHERE status = 'queued'` returns rows |
| Upload fails with 413 | TUS is automatic for >6 MB. Check Supabase Storage bucket file size limits |
| OOM crash | Reduce `DOWNLOAD_BATCH_SIZE`, increase worker memory, or lower `COMPRESSION_LEVEL` |
| Jobs stuck in "processing" | Reset: `UPDATE zip_jobs SET status = 'queued', started_at = NULL WHERE status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes'` |

---

## Maintenance

```sql
-- Clean up completed jobs older than 30 days
SELECT cleanup_old_zip_jobs(30);

-- Retry a specific failed job
SELECT retry_zip_job('job-id');

-- Retry all failed jobs
UPDATE zip_jobs SET status = 'queued', error = NULL, failed_at = NULL
WHERE status = 'failed';
```

---

## Notable patterns

- **Atomic job claiming** — `FOR UPDATE SKIP LOCKED` prevents race conditions between multiple worker instances
- **Dual PDF download** — Region jobs download both `-tallas.pdf` and `-etiquetas.pdf` per school in parallel, with graceful failure if one is missing
- **In-memory streaming** — ZIP built entirely in memory using Archiver (no intermediate temp files)
- **PostgREST pagination** — Student data fetched in 1,000-row batches with a 200,000-row safety limit
- **Safe filenames** — School codes sanitized (`/[^a-zA-Z0-9_-]/g` → `_`) for ZIP entries
- **Logo fallback** — Searches `/app/assets/`, `{cwd}/assets/`, `{cwd}/public/` for `goes_logo_2.png`, silently skips if missing
