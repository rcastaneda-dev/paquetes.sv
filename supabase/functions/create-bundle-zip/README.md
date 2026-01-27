# Create Bundle ZIP Edge Function

This Supabase Edge Function generates ZIP bundles of PDFs on-demand when users request downloads.

## Architecture

Previously, ZIP generation was handled by a Vercel worker endpoint with timeout constraints. This has been rearchitected to run on Supabase Edge Functions for better scalability and resource limits.

### Flow (Manual Trigger)

**IMPORTANT:** ZIP bundles are created ONLY when the user explicitly requests them.

1. User completes a job (or has failed tasks)
2. User can optionally "Retry Failed Tasks" if needed
3. **User clicks "Generate ZIP" button** in the UI
4. Frontend calls `/api/bulk/jobs/[jobId]/generate-zip`
5. That endpoint calls this Supabase Edge Function
6. Edge Function:
   - Checks if bundle already exists (returns signed URL if so)
   - Fetches all completed PDFs from Supabase Storage
   - Generates ZIP file in-memory
   - Uploads ZIP to Supabase Storage
   - Updates job record with `zip_path`
   - Returns signed download URL
7. User receives download URL and file downloads automatically
8. Subsequently, user can click "Download ZIP" to re-download the existing bundle

### Why Manual?

- Allows users to retry failed tasks before creating the bundle
- Gives users control over when to generate the potentially large file
- Avoids unnecessary storage costs for jobs that may never be downloaded
- Users can ensure all tasks are complete before bundling

## Deployment

Deploy this function to Supabase:

```bash
# Deploy the function
supabase functions deploy create-bundle-zip

# Set required environment variables (if not already set)
supabase secrets set SUPABASE_URL=your-project-url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Environment Variables

Required:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for storage access

## Usage

Call the function with a job ID:

```
GET https://your-project.supabase.co/functions/v1/create-bundle-zip?jobId=xxx-xxx-xxx
Authorization: Bearer <anon-key>
```

### Response

Success (200):
```json
{
  "downloadUrl": "https://...",
  "bundlePath": "job-id/bundle.zip",
  "expiresIn": 3600,
  "filesIncluded": 150,
  "cached": false
}
```

If bundle already exists:
```json
{
  "downloadUrl": "https://...",
  "bundlePath": "job-id/bundle.zip",
  "expiresIn": 3600,
  "cached": true
}
```

Error (400/404/500):
```json
{
  "error": "Error message"
}
```

## Performance

- Downloads PDFs in batches of 20 in parallel
- Uses uncompressed ZIP format (store method) for speed
- Processes up to 6,000 PDFs efficiently
- No timeout constraints (Edge Functions have generous limits)

## Implementation Details

### ZIP Creation

Since Deno doesn't have a native `archiver` library like Node.js, this function implements a simple ZIP creator that:
- Creates valid ZIP archives per the ZIP file format specification
- Uses store method (no compression) for maximum speed
- Implements CRC32 checksums for data integrity
- Generates proper local and central directory headers

### Error Handling

- Returns 404 if job not found
- Returns 400 if job not complete/failed
- Continues processing even if some PDFs fail to download
- Logs detailed progress for debugging

## Migration Notes

This replaces the previous Vercel-based approach:
- Old: `/api/worker/create-zip` (Vercel Edge, 300s timeout limit)
- New: Supabase Edge Function (no practical timeout limit)

Benefits:
- No timeout constraints
- Runs closer to storage (faster downloads)
- Consistent serverless platform (all on Supabase)
- Better resource limits for large jobs
