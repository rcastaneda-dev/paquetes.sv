# Cleanup Guide - Removing Old ZIP Infrastructure

This guide documents what to delete from Supabase and your codebase after deploying the new background worker architecture.

## Overview

**What changed:**
- ❌ **Old:** Synchronous ZIP generation in Vercel API routes (caused 413 errors)
- ✅ **New:** Async background worker with TUS uploads (solves 413 errors)

## Supabase Cleanup

### 1. Edge Functions to Delete

The following Edge Functions are **no longer needed** and can be safely deleted:

```bash
# From supabase/functions/ directory:
supabase/functions/zip-part-worker/     # Delete entire folder
supabase/functions/zip-rollup-worker/   # Delete entire folder
```

These folders are currently **empty** (already cleaned up), but you should verify and remove them:

```bash
cd supabase/functions
rm -rf zip-part-worker
rm -rf zip-rollup-worker
```

**Why:** The new architecture uses a standalone Railway worker instead of Supabase Edge Functions.

### 2. Database Tables to Keep

**DO NOT DELETE** these tables (they're still used):

```sql
-- Still needed
public.report_jobs          ✅ Keep
public.report_tasks         ✅ Keep
public.zip_jobs             ✅ Keep (NEW - added in migration 024)
```

### 3. Database Tables Already Removed

These were removed in migration `022_remove_zip_parts.sql`:

```sql
-- Already removed (no action needed)
public.report_zip_parts     ❌ Already deleted
```

### 4. Database Functions Already Removed

These were removed in migration `022_remove_zip_parts.sql`:

```sql
-- Already removed (no action needed)
public.claim_pending_zip_parts()        ❌ Already deleted
public.update_zip_part_status()         ❌ Already deleted
public.ensure_zip_parts()               ❌ Already deleted
```

### 5. Storage Buckets to Keep

**DO NOT DELETE** these buckets:

```
reports/                    ✅ Keep (contains all PDFs and ZIPs)
└── bundles/               ✅ Keep (contains regional ZIPs)
```

### 6. Verify No Orphaned Edge Functions

Check Supabase Dashboard → Edge Functions and ensure these are **not deployed**:

- `zip-part-worker` ❌ Should not exist
- `zip-rollup-worker` ❌ Should not exist

If they exist, delete them via:

```bash
supabase functions delete zip-part-worker
supabase functions delete zip-rollup-worker
```

## Codebase Cleanup

### 1. Files to Delete

Delete the old synchronous ZIP generation route:

```bash
# Old synchronous route (replaced by create-zip-job)
src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
```

**Why:** This route caused 413 errors by trying to upload large ZIPs through Vercel.

**Replaced by:**
- `src/app/api/bulk/jobs/[jobId]/create-zip-job/route.ts` (creates job)
- `src/app/api/bulk/jobs/[jobId]/zip-job-status/route.ts` (polls status)

### 2. Files to Keep

**DO NOT DELETE** these files:

```
✅ src/app/api/bulk/jobs/[jobId]/create-zip-job/route.ts      (NEW)
✅ src/app/api/bulk/jobs/[jobId]/zip-job-status/route.ts     (NEW)
✅ src/app/api/bulk/jobs/[jobId]/download/route.ts           (existing - for bundle.zip)
✅ src/app/bulk/[jobId]/page.tsx                             (updated for new flow)
✅ worker/zip-worker/                                         (NEW - Railway worker)
```

### 3. Dependencies to Keep

```json
// package.json - Keep these
{
  "dependencies": {
    "archiver": "^6.0.1",           ✅ Keep (used by worker)
    "@supabase/supabase-js": "...", ✅ Keep
    // ... other deps
  }
}
```

**Already removed** (migration 022):
```json
// These were removed earlier
{
  "dependencies": {
    "jszip": "..."  ❌ Already removed
  }
}
```

### 4. Documentation Files

These markdown files document the evolution but can be archived:

```bash
# Optional: Move to /docs/archive/ for reference
REGIONAL_ZIP_IMPLEMENTATION.md     # Old simple implementation
ZIP_MIGRATION_SUMMARY.md           # Historical migration docs
ZIP_REENGINEERING_SUMMARY.md       # Historical docs
DEPLOY_EDGE_FUNCTION.md            # No longer relevant

# Keep these
CLEANUP_GUIDE.md                   # This file
worker/zip-worker/README.md        # Worker documentation
```

## Step-by-Step Cleanup Process

### Step 1: Run Database Migration

Ensure migration 024 is applied:

```bash
# Check current migration status
supabase migration list

# If 024 not applied, run it
supabase db push
```

### Step 2: Delete Old Vercel Route

```bash
cd /Users/rickcastaneda/Github/paquetes.sv
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
```

### Step 3: Clean Up Supabase Functions

```bash
cd supabase/functions
rm -rf zip-part-worker zip-rollup-worker

# If deployed to Supabase, delete them
supabase functions delete zip-part-worker
supabase functions delete zip-rollup-worker
```

### Step 4: Verify Frontend Changes

Ensure `src/app/bulk/[jobId]/page.tsx` uses the new flow:

```typescript
// Should call these endpoints:
POST /api/bulk/jobs/{jobId}/create-zip-job?region=...  ✅
GET  /api/bulk/jobs/{jobId}/zip-job-status?zipJobId=... ✅

// Should NOT call this:
GET /api/bulk/jobs/{jobId}/zip-region?region=...        ❌ Old route
```

### Step 5: Deploy Worker to Railway

```bash
cd worker/zip-worker
railway login
railway init
railway variables set NEXT_PUBLIC_SUPABASE_URL=...
railway variables set SUPABASE_SERVICE_ROLE_KEY=...
railway up
```

### Step 6: Test End-to-End

1. Complete a report job
2. Click "Download Oriental" in frontend
3. Verify:
   - Job created in `zip_jobs` table (status: queued)
   - Worker picks up job (status: processing)
   - ZIP uploaded to storage (status: complete)
   - Download URL returned to frontend
   - File downloads successfully

### Step 7: Clean Up Old ZIPs (Optional)

If you have old ZIPs in storage from the previous implementation:

```sql
-- Check for old ZIPs
SELECT name, created_at, metadata->>'size' as size_bytes
FROM storage.objects
WHERE bucket_id = 'reports'
  AND name LIKE 'bundles/%'
ORDER BY created_at DESC;

-- Delete old ZIPs if needed (manually via Supabase Dashboard)
-- Or keep them if they're still valid
```

## Verification Checklist

After cleanup, verify:

- [ ] Migration 024 applied (`zip_jobs` table exists)
- [ ] Old route deleted (`zip-region/route.ts`)
- [ ] New routes exist (`create-zip-job/route.ts`, `zip-job-status/route.ts`)
- [ ] Worker deployed to Railway (check `railway logs`)
- [ ] Frontend updated (polls for job status)
- [ ] Edge functions removed from Supabase Dashboard
- [ ] Test: Create ZIP job and verify it completes
- [ ] Test: Download URL works and file is valid
- [ ] No 413 errors in Vercel or Supabase logs

## Rollback Plan

If something goes wrong, you can rollback:

### Rollback Database

```bash
# Revert to migration 023
supabase db reset

# Or manually drop the table
DROP TABLE IF EXISTS public.zip_jobs CASCADE;
```

### Restore Old Route

```bash
# Restore from git
git checkout HEAD~1 -- src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
```

### Stop Worker

```bash
# Railway
railway down

# Or delete the service via Railway dashboard
```

## Common Issues After Cleanup

### Issue: Frontend shows "Error creating ZIP job"

**Solution:** Ensure migration 024 is applied and `zip_jobs` table exists.

### Issue: Jobs stuck in "queued" forever

**Solution:** Verify worker is running and connected to database:

```bash
railway logs
# Should see: "🚀 ZIP Worker starting..."
```

### Issue: 413 errors still occurring

**Solution:** Verify you're using the new routes (not old `zip-region` route).

## Summary of Changes

| Component | Old | New | Action |
|-----------|-----|-----|--------|
| ZIP generation | Sync in Vercel | Async in Railway | Deploy worker |
| Upload method | Standard (fails >6MB) | TUS (works to 50GB) | Automatic |
| API route | `zip-region` | `create-zip-job` | Delete old |
| Status check | N/A | `zip-job-status` | Add new |
| Edge Functions | zip-part-worker, zip-rollup-worker | None | Delete |
| Database table | `report_zip_parts` | `zip_jobs` | Already migrated |

## Cost Impact

**Before:**
- Vercel Free: $0
- Supabase Pro: $25/mo
- **Total: $25/mo**

**After:**
- Vercel Free: $0
- Supabase Pro: $25/mo
- Railway Hobby: $5/mo
- **Total: $30/mo**

**Additional cost:** +$5/mo for reliable large file handling

## Support

If you encounter issues during cleanup:

1. Check worker logs: `railway logs`
2. Check Vercel logs for frontend errors
3. Query `zip_jobs` table for stuck jobs
4. Verify environment variables in Railway

---

**Cleanup Date:** 2026-01-27
**Migration Version:** 024
**Worker Version:** 1.0.0
