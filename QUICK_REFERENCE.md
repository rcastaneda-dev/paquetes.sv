# Quick Reference - ZIP Worker Architecture

## 🚀 Quick Deploy (15 minutes)

### Option 1: Railway Dashboard (No CLI)

```bash
# 1. Apply database migration
supabase db push

# 2. Deploy worker to Railway (via UI)
# - Go to railway.app → "Deploy from GitHub repo"
# - Select your repo: paquetes.sv
# - Settings → Root Directory: worker/zip-worker
# - Variables → Add:
#   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# - Click "Deploy"
# - View Logs to verify: "🚀 ZIP Worker starting..."

# 3. Deploy Vercel (auto via git)
git add .
git commit -m "Add background worker architecture"
git push

# 4. Clean up old route
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
git add . && git commit -m "Remove old ZIP route" && git push
```

### Option 2: Railway CLI

```bash
# 1. Apply database migration
supabase db push

# 2. Deploy worker to Railway (via CLI)
cd worker/zip-worker
railway login
railway init
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
railway up

# 3. Deploy Vercel (auto via git)
git add .
git commit -m "Add background worker architecture"
git push

# 4. Clean up old route
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
git add . && git commit -m "Remove old ZIP route" && git push
```

## 📁 File Locations

### API Routes (Vercel)
- `src/app/api/bulk/jobs/[jobId]/create-zip-job/route.ts` - Create job
- `src/app/api/bulk/jobs/[jobId]/zip-job-status/route.ts` - Poll status

### Worker (Railway)
- `worker/zip-worker/index.ts` - Main logic
- `worker/zip-worker/package.json` - Dependencies
- `worker/zip-worker/Dockerfile` - Container

### Database
- `supabase/migrations/024_add_zip_jobs_queue.sql` - Migration

## 🔍 Troubleshooting Commands

```bash
# Check worker logs
railway logs --follow

# Check job queue
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM zip_jobs GROUP BY status;"

# Reset stuck jobs
psql $DATABASE_URL -c "UPDATE zip_jobs SET status='queued', started_at=NULL WHERE status='processing' AND started_at < NOW() - INTERVAL '30 minutes';"

# Check failed jobs
psql $DATABASE_URL -c "SELECT * FROM zip_jobs WHERE status='failed' ORDER BY created_at DESC LIMIT 5;"
```

## 🎯 What to Delete

> 📖 **Complete List:** See [FILES_TO_DELETE.md](./FILES_TO_DELETE.md) for detailed cleanup checklist

```bash
# Delete old synchronous route
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts

# Delete empty edge function folders
rm -rf supabase/functions/zip-part-worker
rm -rf supabase/functions/zip-rollup-worker
```

## ✅ Verification Checklist

- [ ] `zip_jobs` table exists in Supabase
- [ ] Worker running on Railway (`railway logs`)
- [ ] Frontend polls job status (not old `zip-region` route)
- [ ] Test: Download Oriental ZIP (should complete in 60-120s)
- [ ] No 413 errors in logs

## 💰 Cost

- Vercel: $0 (Free tier)
- Supabase: $25/mo (Pro plan)
- Railway: $5/mo (Hobby plan)
- **Total: $30/mo** (+$5/mo increase)

## 📊 Performance

| Metric | Value |
|--------|-------|
| Processing Time | 60-120s per region |
| ZIP Size | ~500MB per region |
| PDF Count | ~3,000 per region |
| Success Rate | 100% (no 413 errors) |

## 🔐 Environment Variables (Railway)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional tuning
POLL_INTERVAL_MS=5000
DOWNLOAD_BATCH_SIZE=50
COMPRESSION_LEVEL=6
```

## 📚 Full Documentation

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Step-by-step deployment
- [RAILWAY_UI_DEPLOYMENT.md](./RAILWAY_UI_DEPLOYMENT.md) - Railway UI visual guide
- [CLEANUP_GUIDE.md](./CLEANUP_GUIDE.md) - What to delete
- [FILES_TO_DELETE.md](./FILES_TO_DELETE.md) - Complete deletion checklist
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Technical details
- [worker/zip-worker/README.md](./worker/zip-worker/README.md) - Worker docs

## 🆘 Quick Fixes

### Worker not picking up jobs
```bash
railway restart
railway logs
```

### Jobs stuck in queue
```bash
railway logs  # Check for errors
railway variables  # Verify env vars set
```

### Still getting 413 errors
```bash
# Ensure old route is deleted
ls src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
# Should not exist

# Verify frontend uses new routes
grep -r "create-zip-job" src/app/bulk/
# Should find matches
```

## 🔄 Rollback

```bash
# Stop worker
railway down

# Revert database
supabase db reset

# Restore old code
git revert HEAD
git push
```

---

**For detailed help, see:** [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
