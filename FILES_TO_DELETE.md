# Files to Delete - Quick Checklist

## Summary

After deploying the new background worker architecture, you can safely delete these files and folders from your codebase and Supabase.

---

## ❌ Files to Delete from Codebase

### 1. Old Synchronous ZIP Route

```bash
src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
```

**Why:** This route caused 413 errors by trying to upload large ZIPs through Vercel. Replaced by `create-zip-job` and `zip-job-status` routes.

**Delete command:**
```bash
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
```

---

### 2. Empty Edge Function Folders

```bash
supabase/functions/zip-part-worker/
supabase/functions/zip-rollup-worker/
```

**Why:** These folders are empty (already cleaned up). The new architecture uses Railway worker instead of Supabase Edge Functions.

**Delete command:**
```bash
cd supabase/functions
rm -rf zip-part-worker zip-rollup-worker
```

---

## ✅ Files to Keep (DO NOT DELETE)

### API Routes
```
✅ src/app/api/bulk/jobs/[jobId]/create-zip-job/route.ts       (NEW - creates jobs)
✅ src/app/api/bulk/jobs/[jobId]/zip-job-status/route.ts      (NEW - polls status)
✅ src/app/api/bulk/jobs/[jobId]/download/route.ts            (existing - downloads)
✅ src/app/api/bulk/jobs/[jobId]/route.ts                     (existing - job details)
```

### Worker
```
✅ worker/zip-worker/                                          (NEW - entire folder)
   ├── index.ts                                               (worker logic)
   ├── package.json                                           (dependencies)
   ├── tsconfig.json                                          (TypeScript config)
   ├── Dockerfile                                             (container build)
   ├── .dockerignore                                          (Docker ignore)
   ├── .env.example                                           (env template)
   ├── railway.json                                           (Railway config)
   └── README.md                                              (documentation)
```

### Frontend
```
✅ src/app/bulk/[jobId]/page.tsx                              (updated for new flow)
```

### Database
```
✅ supabase/migrations/024_add_zip_jobs_queue.sql             (NEW - zip_jobs table)
✅ All other migrations                                        (keep all)
```

---

## 🗄️ Supabase Dashboard - What to Delete

### Edge Functions to Delete

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Check if these functions exist:
   - `zip-part-worker` ❌ Delete if exists
   - `zip-rollup-worker` ❌ Delete if exists

**How to delete:**
- Click the function name
- Click "Delete" (trash icon)
- Confirm deletion

**Keep these functions:**
- ✅ `pdf-worker` (if exists)
- ✅ `report-worker` (if exists)
- ✅ `scheduler` (if exists)

---

### Database Tables

**DO NOT DELETE any tables.** All tables are still needed:

```
✅ Keep: public.report_jobs
✅ Keep: public.report_tasks
✅ Keep: public.zip_jobs (NEW)
✅ Keep: public.schools
✅ Keep: public.students
✅ Keep: public.uniform_sizes
```

**Already removed** (in migration 022):
```
❌ public.report_zip_parts (already deleted, no action needed)
```

---

### Database Functions

**DO NOT DELETE any functions.** Already cleaned up in migration 022:

```
❌ claim_pending_zip_parts() (already deleted)
❌ update_zip_part_status() (already deleted)
❌ ensure_zip_parts() (already deleted)
```

**Keep these functions:**
```
✅ Keep: claim_next_zip_job()           (NEW)
✅ Keep: update_zip_job_status()        (NEW)
✅ Keep: retry_zip_job()                (NEW)
✅ Keep: cleanup_old_zip_jobs()         (NEW)
✅ Keep: All other existing functions
```

---

### Storage Buckets

**DO NOT DELETE any buckets or folders:**

```
✅ Keep: reports/ bucket (contains all PDFs and ZIPs)
   ├── {jobId}/                    (job PDFs organized by region)
   │   ├── ORIENTAL/
   │   ├── OCCIDENTAL/
   │   ├── PARACENTRAL/
   │   └── CENTRAL/
   └── bundles/                    (regional ZIPs)
       ├── {jobId}-oriental.zip
       ├── {jobId}-occidental.zip
       ├── {jobId}-paracentral.zip
       └── {jobId}-central.zip
```

---

## 📋 Complete Cleanup Commands

Copy and paste these commands to clean up everything:

```bash
# Navigate to project root
cd /Users/rickcastaneda/Github/paquetes.sv

# 1. Delete old synchronous route
rm src/app/api/bulk/jobs/[jobId]/zip-region/route.ts

# 2. Delete empty edge function folders
rm -rf supabase/functions/zip-part-worker
rm -rf supabase/functions/zip-rollup-worker

# 3. Verify deletions
echo "Checking deleted files..."
ls src/app/api/bulk/jobs/[jobId]/zip-region/route.ts 2>&1 | grep "No such file"
ls supabase/functions/zip-part-worker 2>&1 | grep "No such file"
ls supabase/functions/zip-rollup-worker 2>&1 | grep "No such file"

# 4. Commit cleanup
git add .
git commit -m "Clean up old ZIP infrastructure"
git push origin main

echo "✅ Cleanup complete!"
```

---

## ✅ Verification Checklist

After cleanup, verify:

- [ ] Old route deleted: `src/app/api/bulk/jobs/[jobId]/zip-region/route.ts`
- [ ] Edge function folders deleted from codebase
- [ ] Edge functions deleted from Supabase Dashboard (if they existed)
- [ ] New routes exist: `create-zip-job/route.ts`, `zip-job-status/route.ts`
- [ ] Worker folder exists: `worker/zip-worker/`
- [ ] Migration 024 applied: `zip_jobs` table exists
- [ ] Worker deployed to Railway and running
- [ ] Test: Regional ZIP download works without 413 errors

---

## 🔄 Rollback (if needed)

If you need to rollback changes:

```bash
# Restore old route from git history
git checkout HEAD~1 -- src/app/api/bulk/jobs/[jobId]/zip-region/route.ts

# Restore edge function folders (if needed)
git checkout HEAD~1 -- supabase/functions/zip-part-worker
git checkout HEAD~1 -- supabase/functions/zip-rollup-worker

# Commit rollback
git add .
git commit -m "Rollback ZIP infrastructure changes"
git push origin main
```

**Note:** This brings back the 413 error, but restores previous functionality.

---

## 📊 What Changed - Summary Table

| Component | Before | After | Action |
|-----------|--------|-------|--------|
| **API Route** | `zip-region` (sync) | `create-zip-job` + `zip-job-status` | Delete old |
| **Generation** | Vercel function | Railway worker | Deploy worker |
| **Upload Method** | Standard (fails >6MB) | TUS (works to 50GB) | Automatic |
| **Edge Functions** | zip-part-worker, zip-rollup-worker | None | Delete folders |
| **Database Table** | report_zip_parts | zip_jobs | Already migrated |
| **Frontend Flow** | Synchronous wait | Async polling | Already updated |

---

## 📝 Files Created vs. Deleted

### Created (15 new files)
```
✅ supabase/migrations/024_add_zip_jobs_queue.sql
✅ src/app/api/bulk/jobs/[jobId]/create-zip-job/route.ts
✅ src/app/api/bulk/jobs/[jobId]/zip-job-status/route.ts
✅ worker/zip-worker/index.ts
✅ worker/zip-worker/package.json
✅ worker/zip-worker/tsconfig.json
✅ worker/zip-worker/Dockerfile
✅ worker/zip-worker/.dockerignore
✅ worker/zip-worker/.env.example
✅ worker/zip-worker/railway.json
✅ worker/zip-worker/README.md
✅ DEPLOYMENT_GUIDE.md
✅ CLEANUP_GUIDE.md
✅ IMPLEMENTATION_SUMMARY.md
✅ QUICK_REFERENCE.md
✅ RAILWAY_UI_DEPLOYMENT.md
✅ FILES_TO_DELETE.md (this file)
```

### Deleted (3 files/folders)
```
❌ src/app/api/bulk/jobs/[jobId]/zip-region/route.ts
❌ supabase/functions/zip-part-worker/
❌ supabase/functions/zip-rollup-worker/
```

### Net Change
```
+15 files created
-3 files/folders deleted
= +12 files (mostly documentation)
```

---

## 💡 Why This Cleanup is Safe

1. **Old route replaced:** `zip-region` → `create-zip-job` + `zip-job-status`
2. **Edge functions unused:** Empty folders, already migrated to Railway worker
3. **Database cleaned:** Old `report_zip_parts` table already removed in migration 022
4. **Storage intact:** All PDFs and ZIPs remain in storage
5. **Can rollback:** All changes in git history

---

## 🆘 Need Help?

If something goes wrong during cleanup:

1. **Check git status:** `git status`
2. **Review deleted files:** `git diff HEAD~1`
3. **Rollback if needed:** See rollback section above
4. **Contact support:** Refer to [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

**Cleanup Date:** 2026-01-27
**Safe to execute:** ✅ Yes
**Can rollback:** ✅ Yes
**Data loss risk:** ❌ None
