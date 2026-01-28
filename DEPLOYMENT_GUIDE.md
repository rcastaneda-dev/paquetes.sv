# Deployment Guide - New Background Worker Architecture

This guide walks you through deploying the new ZIP generation architecture that solves the Supabase Storage 413 error using TUS resumable uploads.

## Quick Overview

**What we built:**

1. Database migration for ZIP job queue
2. Two new Vercel API routes (create job, poll status)
3. Standalone background worker (Railway)
4. Updated frontend with polling

**Time to deploy:** 15-20 minutes

## Prerequisites

- [ ] Supabase Pro plan (for service role key)
- [ ] Railway account (free tier OK for testing, $5/mo Hobby for production)
- [ ] Git repository connected to Vercel
- [ ] Node.js 18+ installed locally

## Step 1: Apply Database Migration (5 minutes)

### Option A: Using Supabase CLI (Recommended)

```bash
cd /Users/rickcastaneda/Github/paquetes.sv

# Check migration status
supabase migration list

# Apply migration 024
supabase db push
```

### Option B: Using Supabase Dashboard

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/024_add_zip_jobs_queue.sql`
3. Paste and run
4. Verify table created:

```sql
SELECT * FROM zip_jobs LIMIT 1;
```

## Step 2: Deploy to Vercel (Auto-deploy, 2 minutes)

The Vercel deployment happens automatically via GitHub:

```bash
# Commit new code
git add .
git commit -m "Add background worker architecture for ZIP generation"
git push origin main
```

Vercel will auto-deploy:

- ✅ New routes: `create-zip-job`, `zip-job-status`
- ✅ Updated frontend: `bulk/[jobId]/page.tsx`

**Verify deployment:**

1. Check Vercel dashboard for successful deploy
2. Visit your app → complete a report job
3. See regional download buttons (don't click yet - worker not deployed)

## Step 3: Deploy Worker to Railway (10 minutes)

> 📖 **Detailed UI Guide:** For step-by-step screenshots and visual walkthrough, see [RAILWAY_UI_DEPLOYMENT.md](./RAILWAY_UI_DEPLOYMENT.md)

### Method A: Using Railway Dashboard (Recommended - No CLI needed)

#### 3a. Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Click **"Start a New Project"**
3. Sign up with GitHub
4. Authorize Railway to access your GitHub account

#### 3b. Create New Project from GitHub Repo

1. Click **"Deploy from GitHub repo"**
2. Select your repository: `paquetes.sv`
3. Railway will ask for specific directory - we'll configure this in a moment

#### 3c. Configure Build Settings

1. After selecting the repo, Railway creates a new project
2. Click on the service that was created
3. Go to **Settings** tab
4. Configure the following:

**Root Directory:**

```
worker/zip-worker
```

**Build Configuration:**

- Build Method: `Dockerfile` (Railway auto-detects the Dockerfile)
- Dockerfile Path: `Dockerfile` (default)

**Deploy Configuration:**

- Start Command: (leave empty - uses Dockerfile CMD)

#### 3d. Set Environment Variables

1. In your Railway service, go to **Variables** tab
2. Click **"New Variable"** and add each of these:

**Required Variables:**

| Variable Name               | Value                              | Where to Get It                                                  |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`  | `https://your-project.supabase.co` | Supabase Dashboard → Settings → API → Project URL                |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...`                           | Supabase Dashboard → Settings → API → Service Role Key (secret!) |

**Optional Variables (for tuning):**

| Variable Name         | Default | Description                                    |
| --------------------- | ------- | ---------------------------------------------- |
| `POLL_INTERVAL_MS`    | `5000`  | How often worker polls for jobs (milliseconds) |
| `DOWNLOAD_BATCH_SIZE` | `50`    | PDFs downloaded in parallel per batch          |
| `COMPRESSION_LEVEL`   | `6`     | ZIP compression (1-9, lower=faster)            |

**Example:**

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
POLL_INTERVAL_MS=5000
DOWNLOAD_BATCH_SIZE=50
COMPRESSION_LEVEL=6
```

#### 3e. Deploy

1. After setting variables, click **"Deploy"** (top right)
2. Railway will:
   - Clone your repo
   - Build the Docker image
   - Deploy the worker
   - Start polling for ZIP jobs

#### 3f. Verify Worker is Running

1. Go to **Deployments** tab
2. Click on the latest deployment (should show "Active")
3. Click **"View Logs"**

**Expected log output:**

```
🚀 ZIP Worker starting...
📊 Config: Poll interval=5000ms, Batch size=50, Compression=6
```

**If you see errors:**

- Check **Variables** tab to ensure all env vars are set correctly
- Click **"Redeploy"** to restart with new variables

#### 3g. Enable Auto-Deploy (Optional but Recommended)

1. Go to **Settings** tab
2. Under **Source**, enable **"Auto-Deploy"**
3. Now every git push will redeploy the worker automatically

---

### Method B: Using Railway CLI (Alternative)

If you prefer command-line deployment:

#### 3b. Install Railway CLI

```bash
# Install globally
npm install -g @railway/cli

# Login
railway login
```

#### 3c. Initialize Railway Project

```bash
cd worker/zip-worker

# Create new Railway project
railway init

# Follow prompts:
# - Project name: paquetes-zip-worker
# - Environment: production
```

#### 3d. Set Environment Variables

```bash
# Get these from Supabase Dashboard → Settings → API
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Optional performance tuning
railway variables set POLL_INTERVAL_MS=5000
railway variables set DOWNLOAD_BATCH_SIZE=50
railway variables set COMPRESSION_LEVEL=6
```

**Security Note:** Never commit your service role key to git!

#### 3e. Deploy Worker

```bash
# Deploy using Dockerfile
railway up

# Or link to GitHub for auto-deploy (recommended)
railway link
```

#### 3f. Verify Worker is Running

```bash
# Check logs
railway logs --follow
```

**Expected output:**

```
🚀 ZIP Worker starting...
📊 Config: Poll interval=5000ms, Batch size=50, Compression=6
```

If you see errors, check environment variables:

```bash
railway variables
```

## Step 4: Test End-to-End (5 minutes)

### 4a. Create Test Report Job

1. Go to your app → Bulk Reports
2. Create a new report job (or use existing completed job)
3. Wait for job to complete

### 4b. Test Regional ZIP Download

1. Click "Download Oriental" button
2. Frontend should show: "Waiting in queue..."
3. Worker picks up job (check `railway logs`)
4. Status updates to: "Generating ZIP (this may take 1-3 minutes)..."
5. ZIP completes, download starts automatically

**Expected timeline:**

- Job created: instant
- Worker picks up: 0-5 seconds
- ZIP generation: 60-120 seconds
- Download starts: automatic

### 4c. Verify in Database

```sql
-- Check ZIP job was created
SELECT * FROM zip_jobs ORDER BY created_at DESC LIMIT 5;

-- Should see:
-- - status: complete
-- - zip_path: bundles/{jobId}-oriental.zip
-- - zip_size_bytes: ~500MB
-- - pdf_count: ~3000
```

### 4d. Verify in Supabase Storage

1. Supabase Dashboard → Storage → reports bucket
2. Navigate to `bundles/` folder
3. Should see: `{jobId}-oriental.zip` (~500MB)

## Step 5: Test All Regions (5 minutes)

Test each region to ensure worker handles multiple jobs:

```bash
# Click each button in frontend:
- Download Oriental     ✅ Test
- Download Occidental   ✅ Test
- Download Paracentral  ✅ Test
- Download Central      ✅ Test
```

**Expected:** All should complete successfully without 413 errors.

## Step 6: Monitor Worker Performance (Ongoing)

### Check Worker Health

```bash
# Live logs
railway logs --follow

# Recent logs
railway logs --tail 100
```

### Check Job Queue

```sql
-- Current queue status
SELECT status, COUNT(*)
FROM zip_jobs
GROUP BY status;

-- Queued jobs (should be 0 when idle)
SELECT * FROM zip_jobs WHERE status = 'queued';

-- Failed jobs (investigate if any)
SELECT * FROM zip_jobs WHERE status = 'failed';
```

### Performance Metrics

```sql
-- Average processing time per region
SELECT
  region,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_seconds
FROM zip_jobs
WHERE status = 'complete'
GROUP BY region;
```

## Step 7: Clean Up Old Infrastructure (5 minutes)

Follow the [CLEANUP_GUIDE.md](./CLEANUP_GUIDE.md) to remove old code:

```bash
# Delete old synchronous route
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts

# Delete empty edge function folders
rm -rf supabase/functions/zip-part-worker
rm -rf supabase/functions/zip-rollup-worker

# Commit cleanup
git add .
git commit -m "Remove old ZIP infrastructure"
git push
```

## Troubleshooting

### Issue: Worker not picking up jobs

**Check:**

```bash
# Verify worker is running
railway logs

# Check environment variables
railway variables

# Test database connection
railway run node -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

### Issue: 413 errors still occurring

**Cause:** Old route still being called

**Fix:**

```bash
# Ensure old route is deleted
ls src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
# Should return: No such file or directory

# Verify frontend uses new route
grep -r "zip-region" src/app/bulk/
# Should return: nothing
```

### Issue: Jobs stuck in "processing"

**Recovery:**

```sql
-- Reset jobs stuck for >30 minutes
UPDATE zip_jobs
SET status = 'queued', started_at = NULL
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes';
```

**Prevention:** Increase worker memory in Railway if OOM crashes.

### Issue: Worker crashes with OOM

**Solution:**

```bash
# Reduce batch size
railway variables set DOWNLOAD_BATCH_SIZE=30

# Or increase memory in Railway dashboard
# Settings → Resources → Memory: 1GB → 2GB
```

## Monitoring Checklist

Set up monitoring for:

- [ ] Railway worker uptime (Railway dashboard)
- [ ] Failed ZIP jobs (SQL query daily)
- [ ] Average processing time (should be 60-120s)
- [ ] Storage usage (Supabase dashboard)
- [ ] Worker memory usage (Railway dashboard)

## Cost Breakdown

**Monthly costs:**

| Service   | Plan  | Cost       |
| --------- | ----- | ---------- |
| Vercel    | Free  | $0         |
| Supabase  | Pro   | $25        |
| Railway   | Hobby | $5         |
| **Total** |       | **$30/mo** |

**Cost increase:** +$5/mo for reliable large file uploads

## Next Steps

After successful deployment:

1. ✅ Monitor first 10 ZIP generations
2. ✅ Tune worker settings if needed (batch size, compression)
3. ✅ Set up alerts for failed jobs (optional)
4. ✅ Document any custom configurations
5. ✅ Archive old documentation files

## Rollback Plan

If something goes wrong:

```bash
# 1. Stop Railway worker
railway down

# 2. Revert database migration
supabase db reset

# 3. Restore old route from git
git checkout HEAD~1 -- src/app/api/bulk/jobs/[jobId]/zip-region/route.ts

# 4. Deploy to Vercel
git add .
git commit -m "Rollback to synchronous ZIP generation"
git push
```

**Note:** This brings back the 413 error but restores functionality.

## Success Criteria

Deployment is successful when:

- ✅ Migration 024 applied (`zip_jobs` table exists)
- ✅ Worker running on Railway (logs show "ZIP Worker starting")
- ✅ Frontend creates jobs and polls status
- ✅ ZIP generation completes in 60-120 seconds
- ✅ Download URLs work and files are valid
- ✅ No 413 errors in logs
- ✅ All 4 regions downloadable

## Support

For issues:

1. Check [worker/zip-worker/README.md](./worker/zip-worker/README.md) for detailed troubleshooting
2. Review Railway logs: `railway logs`
3. Check database: `SELECT * FROM zip_jobs WHERE status = 'failed'`
4. Verify Supabase Storage bucket settings

---

**Deployment Date:** 2026-01-27
**Architecture:** Background worker with TUS uploads
**Estimated Time:** 15-20 minutes
**Risk Level:** Low (can rollback easily)
