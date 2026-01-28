# Railway UI Deployment Guide - Visual Step-by-Step

Complete guide for deploying the ZIP worker using Railway's web dashboard (no CLI required).

---

## Prerequisites

- ✅ GitHub account
- ✅ Your repo pushed to GitHub
- ✅ Supabase project (for service role key)

---

## Step 1: Create Railway Account

### 1.1 Sign Up

1. Go to **[railway.app](https://railway.app)**
2. Click **"Login"** (top right)
3. Select **"Login with GitHub"**
4. Authorize Railway to access your GitHub account

**What you'll see:**

- GitHub OAuth authorization page
- Permission request for Railway

**Click:** "Authorize Railway"

---

## Step 2: Create New Project

### 2.1 Start New Project

1. After login, you'll see the Railway dashboard
2. Click **"+ New Project"** (center of screen)

**What you'll see:**

- Modal with deployment options:
  - Deploy from GitHub repo
  - Deploy from Template
  - Empty Project
  - Deploy from Docker Image

### 2.2 Select GitHub Deployment

1. Click **"Deploy from GitHub repo"**
2. Railway will show a list of your GitHub repositories

**If you don't see your repo:**

- Click "Configure GitHub App" (bottom of list)
- Grant Railway access to specific repos
- Select `paquetes.sv` repository
- Save

### 2.3 Select Repository

1. Find `paquetes.sv` in the list (or search)
2. Click on it

**What happens:**

- Railway creates a new project
- Automatically detects this is a monorepo
- May start building from root (we'll fix this)

---

## Step 3: Configure Service Settings

### 3.1 Open Service Settings

1. Railway creates a service (may be called "paquetes-sv" or similar)
2. Click on the service card

**What you'll see:**

- Service overview page with tabs:
  - Deployments
  - Metrics
  - Variables
  - Settings
  - Logs

### 3.2 Configure Root Directory

1. Click **"Settings"** tab (top navigation)
2. Scroll to **"Build"** section
3. Find **"Root Directory"** field

**Enter:**

```
worker/zip-worker
```

**Important:** This tells Railway to build only the worker code, not the entire Next.js app.

### 3.3 Verify Dockerfile Detection

Still in Settings → Build section:

**Check these settings:**

| Setting         | Value        | Notes                     |
| --------------- | ------------ | ------------------------- |
| Builder         | `DOCKERFILE` | Should auto-detect        |
| Dockerfile Path | `Dockerfile` | Default, correct          |
| Build Command   | (empty)      | Not needed for Dockerfile |

**If Builder shows "NIXPACKS":**

- Click the dropdown
- Select **"DOCKERFILE"**
- Railway will use your Dockerfile instead

### 3.4 Save Settings

1. Settings auto-save (no button needed)
2. You'll see a toast notification: "Settings updated"

---

## Step 4: Set Environment Variables

### 4.1 Open Variables Tab

1. Click **"Variables"** tab (top navigation)
2. You'll see an empty list (or default Railway variables)

### 4.2 Get Supabase Credentials

**Open Supabase Dashboard in another tab:**

1. Go to your Supabase project
2. Click **Settings** (left sidebar, gear icon)
3. Click **API** (in settings menu)

**You'll need:**

| Variable         | Location in Supabase                             |
| ---------------- | ------------------------------------------------ |
| Project URL      | API → Project URL → Copy                         |
| Service Role Key | API → Service role → Copy (click "Reveal" first) |

⚠️ **Warning:** The Service Role key is **secret**. Never commit it to git or share publicly.

### 4.3 Add Required Variables

Back in Railway, click **"+ New Variable"**

**Add these variables one by one:**

#### Variable 1: Supabase URL

```
Variable Name:  NEXT_PUBLIC_SUPABASE_URL
Variable Value: https://your-project.supabase.co
```

**Example:**

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijk.supabase.co
```

Click **"Add"**

#### Variable 2: Service Role Key

```
Variable Name:  SUPABASE_SERVICE_ROLE_KEY
Variable Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ...
```

**Example:**

```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY0NTAwMDAwMCwiZXhwIjoxOTYwMDAwMDAwfQ.abc123...
```

Click **"Add"**

### 4.4 Add Optional Performance Variables

These are optional but recommended:

```
Variable Name:  POLL_INTERVAL_MS
Variable Value: 5000
```

```
Variable Name:  DOWNLOAD_BATCH_SIZE
Variable Value: 50
```

```
Variable Name:  COMPRESSION_LEVEL
Variable Value: 6
```

**What they do:**

- `POLL_INTERVAL_MS`: How often worker checks for jobs (5000 = every 5 seconds)
- `DOWNLOAD_BATCH_SIZE`: PDFs downloaded in parallel (50 = good balance)
- `COMPRESSION_LEVEL`: ZIP compression (1-9, higher = smaller but slower)

### 4.5 Verify Variables

After adding all variables, you should see:

**Required (2):**

- ✅ `NEXT_PUBLIC_SUPABASE_URL`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`

**Optional (3):**

- ✅ `POLL_INTERVAL_MS` (if added)
- ✅ `DOWNLOAD_BATCH_SIZE` (if added)
- ✅ `COMPRESSION_LEVEL` (if added)

---

## Step 5: Deploy the Worker

### 5.1 Trigger Deployment

**Two ways to deploy:**

#### Method A: Automatic (Recommended)

Railway auto-deploys when you change settings or variables.

1. After setting variables, Railway should automatically start deploying
2. Look for a toast notification: "Deployment triggered"

#### Method B: Manual

If auto-deploy didn't trigger:

1. Click **"Deployments"** tab
2. Click **"Deploy"** button (top right)
3. Confirm deployment

### 5.2 Monitor Deployment Progress

1. Stay on **"Deployments"** tab
2. You'll see the latest deployment with status:
   - 🟡 **Building** - Docker image being built
   - 🟡 **Deploying** - Container starting
   - 🟢 **Active** - Worker is running

**Build typically takes:** 2-5 minutes (first time)

**What Railway is doing:**

```
1. Cloning your GitHub repo
2. Navigating to worker/zip-worker
3. Building Dockerfile
4. Installing dependencies (npm ci)
5. Compiling TypeScript
6. Creating container image
7. Starting container
8. Running: node dist/index.js
```

### 5.3 Watch Build Logs

1. Click on the deployment (the one marked "Building")
2. Click **"View Logs"** tab
3. You'll see build output in real-time

**Expected log output during build:**

```
Building...
#1 [internal] load build definition from Dockerfile
#2 [internal] load .dockerignore
...
#8 [stage-1] npm ci --only=production
...
Successfully built abc123def456
Successfully tagged railway/...
```

---

## Step 6: Verify Worker is Running

### 6.1 Check Deployment Status

1. Once deployment shows **🟢 Active**, click on it
2. Go to **"Logs"** tab

**Expected logs (worker is running):**

```
🚀 ZIP Worker starting...
📊 Config: Poll interval=5000ms, Batch size=50, Compression=6
```

**If you see this, success!** ✅

### 6.2 Test Worker Response

The worker is now polling your database every 5 seconds for queued ZIP jobs.

**To test:**

1. Go to your frontend app
2. Complete a report job
3. Click a regional download button (e.g., "Download Oriental")
4. Switch back to Railway logs

**You should see:**

```
📦 Processing ZIP job: abc-123
   Report: def-456, Region: ORIENTAL
   🔍 Fetching PDFs for region ORIENTAL...
   ✅ Found 1500 schools (will generate ~3000 PDFs)
   📥 Downloading batch: 50/1500 schools
   📥 Downloading batch: 100/1500 schools
   ...
   ✅ Job completed in 89.2s
```

---

## Step 7: Enable Auto-Deploy (Optional)

### 7.1 Configure GitHub Integration

1. Go to **"Settings"** tab
2. Scroll to **"Source"** section
3. Find **"Auto-Deploy"** toggle

**Enable:** Turn it ON (should be blue)

**What this does:**

- Every `git push` to your main branch
- Automatically redeploys the worker
- No manual deployment needed

**Recommended:** ✅ Enable for continuous deployment

### 7.2 Select Branch (if needed)

1. In **"Source"** section, find **"Production Branch"**
2. Should be set to `main` (or your default branch)
3. Change if your branch is named differently (e.g., `master`)

---

## Step 8: Configure Resources (Optional)

### 8.1 Check Resource Allocation

1. Go to **"Settings"** tab
2. Scroll to **"Resources"** section

**Default allocation (Hobby Plan - $5/mo):**

- Memory: Up to 8GB (shared)
- CPU: Shared
- vCPU: 0.5-1

**This is sufficient for:**

- 20-50 ZIP jobs per week
- Regional ZIPs (~500MB each)
- Processing time: 60-120 seconds per job

### 8.2 Upgrade if Needed (Optional)

**If you need more power:**

1. Click your profile (top right)
2. Go to **"Account Settings"**
3. Go to **"Plans"**
4. Upgrade to Developer ($20/mo) for:
   - Dedicated CPU
   - Higher memory limit
   - Faster processing

**Not needed for most use cases.**

---

## Step 9: Set Up Monitoring (Optional)

### 9.1 View Metrics

1. Go to **"Metrics"** tab
2. See graphs for:
   - CPU usage
   - Memory usage
   - Network I/O

**Normal values:**

- CPU: 10-40% (spikes to 80% during ZIP generation)
- Memory: 200-800MB (spikes to 1-1.5GB during processing)
- Network: Spikes during PDF downloads and ZIP uploads

### 9.2 Set Up Alerts (Optional)

Railway doesn't have built-in alerts, but you can:

1. **Check logs regularly** for errors
2. **Monitor database** for stuck jobs:

```sql
-- Run this query periodically
SELECT status, COUNT(*)
FROM zip_jobs
GROUP BY status;
```

3. **Set up external monitoring** (e.g., UptimeRobot) to ping a health endpoint

---

## Step 10: Verify End-to-End

### 10.1 Full Test Flow

1. **Frontend:** Go to your app → Bulk Reports
2. **Create job:** Complete a report job (or use existing)
3. **Download:** Click "Download Oriental"
4. **Observe:**
   - Frontend shows: "Waiting in queue..."
   - Railway logs show: "📦 Processing ZIP job..."
   - Frontend updates: "Generating ZIP (1-3 minutes)..."
   - Railway logs show: "✅ Job completed in Xs"
   - Frontend shows: "Complete!" and download starts

### 10.2 Check Database

```sql
-- Verify job was created and completed
SELECT * FROM zip_jobs
WHERE region = 'oriental'
ORDER BY created_at DESC
LIMIT 1;

-- Should show:
-- status: complete
-- zip_path: bundles/xxx-oriental.zip
-- pdf_count: ~3000
-- zip_size_bytes: ~500000000
```

### 10.3 Check Supabase Storage

1. Supabase Dashboard → Storage → reports bucket
2. Navigate to `bundles/` folder
3. Verify ZIP exists: `{jobId}-oriental.zip`
4. Check size: ~500MB

---

## Troubleshooting

### Issue: "Build failed"

**Possible causes:**

1. **Wrong root directory**
   - Fix: Settings → Root Directory → `worker/zip-worker`
   - Redeploy

2. **Missing package.json or Dockerfile**
   - Fix: Verify files exist in `worker/zip-worker/`
   - Check git: `git ls-files worker/zip-worker/`

3. **TypeScript compilation errors**
   - Fix: Run locally first: `cd worker/zip-worker && npm run build`
   - Fix errors, commit, push

### Issue: "Deployment crashed" or worker stops

**Check logs for errors:**

1. Go to **"Logs"** tab
2. Look for error messages

**Common errors:**

```
Error: Missing required environment variables
```

**Fix:** Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Variables tab

```
Error: connect ECONNREFUSED
```

**Fix:** Check Supabase URL is correct (should start with `https://`)

```
Out of memory
```

**Fix:** Reduce `DOWNLOAD_BATCH_SIZE` to `30` or upgrade Railway plan

### Issue: Worker running but not processing jobs

**Check:**

1. **Database connection**
   - Logs should not show connection errors
   - Verify `NEXT_PUBLIC_SUPABASE_URL` is correct

2. **Service role key**
   - Verify `SUPABASE_SERVICE_ROLE_KEY` is correct
   - Should start with `eyJ...`

3. **Jobs in queue**

   ```sql
   SELECT * FROM zip_jobs WHERE status = 'queued';
   ```

   - If empty, create a job via frontend

4. **Migration applied**
   ```sql
   SELECT * FROM zip_jobs LIMIT 1;
   ```

   - If error, run: `supabase db push`

### Issue: Can't find my repository

**Fix:**

1. Click "Configure GitHub App" at bottom of repo list
2. Grant Railway access to your repo
3. Select `paquetes.sv`
4. Save
5. Go back to Railway and refresh

---

## Summary Checklist

After following this guide, verify:

- ✅ Railway account created
- ✅ Project created from GitHub repo
- ✅ Root directory set to `worker/zip-worker`
- ✅ Dockerfile detected as builder
- ✅ Environment variables added (2 required, 3 optional)
- ✅ Deployment successful (status: Active)
- ✅ Logs show: "🚀 ZIP Worker starting..."
- ✅ Test ZIP generation works end-to-end
- ✅ Auto-deploy enabled (optional)

---

## Next Steps

1. ✅ Worker deployed and running
2. ✅ Test all 4 regions (Oriental, Occidental, Paracentral, Central)
3. ✅ Monitor logs for first 24 hours
4. ✅ Clean up old code (see [CLEANUP_GUIDE.md](./CLEANUP_GUIDE.md))
5. ✅ Document any custom configurations

---

## Cost

**Railway Hobby Plan:** $5/month

- Includes: 500 hours of usage
- Sufficient for: Unlimited ZIP generations
- Worker runs 24/7

**No credit card required for trial** (with GitHub account)

---

## Resources

- **Railway Docs:** [docs.railway.app](https://docs.railway.app)
- **Railway Discord:** [Community support](https://discord.gg/railway)
- **Worker README:** [worker/zip-worker/README.md](./worker/zip-worker/README.md)
- **Deployment Guide:** [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

**Questions?** Check the troubleshooting section above or [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for more details.
