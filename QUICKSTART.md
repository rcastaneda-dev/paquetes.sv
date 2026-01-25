# Quick Start Guide (5 Minutes)

Get the app running in 5 minutes. Detailed setup in [SETUP.md](./SETUP.md).

## Prerequisites
- Node.js 18+ installed
- Supabase account (free at supabase.com)

## Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Supabase Project
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Fill in details, wait ~2 minutes

### 3. Get Credentials
In Supabase Dashboard → Settings → API:
- Copy `Project URL`
- Copy `anon/public key`
- Copy `service_role key`

### 4. Configure Environment
```bash
cp .env.example .env
# Edit .env and paste your Supabase credentials
```

### 5. Run Database Migrations

In Supabase SQL Editor, run these 3 scripts in order:

**Script 1** - Core Schema:
```sql
-- Paste contents of paquetes_schema.sql
```

**Script 2** - Fix Foreign Keys:
```sql
-- Paste contents of fix_foreign_keys.sql
```

**Script 3** - Reporting Infrastructure:
```sql
-- Paste contents of supabase/migrations/001_add_reporting_tables.sql
```

### 6. Create Storage Bucket

1. Supabase Dashboard → Storage → New Bucket
2. Name: `reports`
3. SQL Editor → Run:
```sql
-- Paste contents of supabase/setup-storage.sql
```

### 7. Start Development Server
```bash
npm run dev
```

Open http://localhost:3000

## ✅ Verify Setup

Run this in Supabase SQL Editor:
```sql
-- Paste contents of scripts/verify-setup.sql
```

All checks should show "✓ PASS"

## 🎉 Test the App

### Test 1: Query Students
1. Home page → Search for a school
2. Select a grade
3. Click "Search"
4. ✅ Should see paginated table of students

### Test 2: Bulk Reports (Manual Trigger)
**Note**: Cron workers don't run locally.

1. Navigate to `/bulk`
2. Click "Generate All PDFs"
3. Note the Job ID
4. In terminal:
```bash
# Trigger worker manually
curl -X POST http://localhost:3000/api/worker/process-tasks \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Check job status
curl http://localhost:3000/api/bulk/jobs/YOUR_JOB_ID
```

## 🚀 Deploy to Production

**Vercel (Easiest)**:
```bash
# Push to GitHub first
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_REPO_URL
git push -u origin main

# Then:
# 1. Go to vercel.com
# 2. Import your GitHub repo
# 3. Add environment variables
# 4. Deploy!
```

Crons will work automatically in production.

## 📚 Next Steps

- Read [README.md](./README.md) for full documentation
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
- Read [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) for implementation overview

## ❓ Issues?

### "Missing Supabase environment variables"
→ Check `.env` file exists and has all 3 variables

### "Failed to fetch schools"
→ Did you run all 3 SQL migrations?

### No students in table
→ Run the seed data:
```sql
-- You may need to create sample data first
INSERT INTO public.schools ...
```

### Worker not processing
→ Workers only run in production with Vercel Cron, or manually via curl locally

---

**Still stuck?** See [SETUP.md](./SETUP.md) for detailed troubleshooting.
