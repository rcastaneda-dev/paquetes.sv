# ZIP Bundle Generation Migration Summary

## Overview

The ZIP bundle generation functionality has been rearchitected from Vercel Edge Routes to Supabase Edge Functions.

## Previous Architecture (Vercel)

```
User clicks download
    ↓
Frontend → /api/bulk/jobs/[jobId]/download (Vercel)
    ↓
Checks for existing bundle OR zip_parts status
    ↓
Returns download URL or "still generating" message

Separate cron job:
    ↓
/api/worker/create-zip (Vercel Edge, 300s timeout)
    ↓
Processes jobs in background
    ↓
Creates bundle.zip asynchronously
```

**Issues:**
- 300s timeout limit on Vercel (even Enterprise)
- Complex drain-loop logic to work around timeouts
- Delayed availability (user has to wait for cron)
- Two-step process (check status, wait, retry)

## New Architecture (Supabase)

```
User completes job
    ↓
[Optional] User clicks "Retry Failed Tasks" if needed
    ↓
User clicks "Generate ZIP" button
    ↓
Frontend → /api/bulk/jobs/[jobId]/generate-zip (Next.js API)
    ↓
Calls Supabase Edge Function
    ↓
Supabase Edge Function: create-bundle-zip
    ├─ Check if bundle exists → Return signed URL (cached)
    └─ If not exists:
        ├─ Fetch PDFs from storage
        ├─ Generate ZIP in-memory
        ├─ Upload to storage
        ├─ Update job record
        └─ Return signed URL
    ↓
User gets download immediately
    ↓
[Later] User clicks "Download ZIP" → Returns existing bundle
    ↓
Frontend → /api/bulk/jobs/[jobId]/download (Next.js API)
    ↓
Returns signed URL for existing bundle (no regeneration)
```

**Benefits:**
- **Manual trigger** - User controls when to generate ZIP
- **Retry workflow** - Users can retry failed tasks before bundling
- No timeout limits (Edge Functions handle large jobs)
- Cached bundles for subsequent downloads
- Runs on same platform as storage (faster)
- Reduces storage costs (only creates ZIPs when requested)

## Files Changed

### Created
- `supabase/functions/create-bundle-zip/index.ts` - New Edge Function
- `supabase/functions/create-bundle-zip/README.md` - Documentation

### Modified
- `src/app/api/bulk/jobs/[jobId]/download/route.ts` - Now calls Edge Function
- `supabase/functions/report-worker/index.ts` - Removed ZIP mode

### Deleted
- `src/app/api/worker/create-zip/route.ts` - Old Vercel worker

## Deployment Steps

1. Deploy the new Edge Function:
   ```bash
   supabase functions deploy create-bundle-zip
   ```

2. Verify environment variables are set:
   ```bash
   # These should already be configured
   supabase secrets list
   ```

3. Test the flow:
   - Complete a report job
   - Click download button
   - Edge Function should create and return bundle

4. Optional: Remove old cron job that called `/api/worker/create-zip`
   - Check your Supabase Dashboard → Edge Functions → Cron Jobs
   - Remove any schedules calling the old endpoint

## Technical Implementation

### ZIP Creation in Deno

Since Deno doesn't have `archiver` (Node.js library), the Edge Function implements a custom ZIP creator:

- Follows ZIP file format specification (PKZip)
- Uses "store" method (no compression) for speed
- Implements CRC32 checksums for integrity
- Creates valid ZIP archives compatible with all extractors

### Performance Optimizations

- Downloads PDFs in parallel batches of 20
- Streams data to minimize memory usage
- Logs progress every 100 PDFs
- Handles partial failures gracefully

### Error Handling

- Returns appropriate HTTP status codes
- Detailed error messages in logs
- Continues processing even if some PDFs fail
- Validates job status before processing

## Frontend Impact

No changes needed! The frontend still calls the same endpoint:
```typescript
const response = await fetch(`/api/bulk/jobs/${jobId}/download`);
```

The only difference is the response is now faster and more reliable.

## Monitoring

Check Edge Function logs:
```bash
supabase functions logs create-bundle-zip
```

Look for:
- "Creating bundle.zip for job {jobId}"
- "Progress: X/Y PDFs added to ZIP"
- "Bundle created with X PDFs, size: Y bytes"
- "Bundle finalized for job {jobId}"

## Rollback Plan

If issues arise, you can temporarily revert:

1. Restore `src/app/api/worker/create-zip/route.ts` from git
2. Restore old `download/route.ts` logic
3. Re-enable cron job for ZIP creation

However, the new approach should be more reliable and faster.

## Next Steps

1. Deploy the Edge Function
2. Monitor first few downloads
3. Remove old Vercel route after confirming stability
4. Optional: Clean up any `report_zip_parts` table references (deprecated)

## Questions?

The Edge Function is fully documented in:
`supabase/functions/create-bundle-zip/README.md`
