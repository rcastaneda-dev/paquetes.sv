# Deploy the Create Bundle ZIP Edge Function

## The 401 Error Explained

The 401 "Unauthorized" error you're seeing happens because **the Edge Function hasn't been deployed yet**. When you call a non-existent Edge Function URL, Supabase returns 401.

## Quick Deploy Steps

### 1. Install Supabase CLI (if not installed)

```bash
# macOS (via Homebrew)
brew install supabase/tap/supabase

# Or via npm
npm install -g supabase
```

### 2. Login to Supabase

```bash
supabase login
```

This will open your browser to authenticate.

### 3. Link Your Project

```bash
cd /Users/rickcastaneda/Github/paquetes.sv
supabase link --project-ref <your-project-ref>
```

To find your project ref:
- Go to Supabase Dashboard
- Settings → General → Reference ID

### 4. Deploy the Edge Function

```bash
supabase functions deploy create-bundle-zip
```

Expected output:
```
Deploying function create-bundle-zip...
Bundled create-bundle-zip in XX ms
Deployed function create-bundle-zip to <your-project-url>
```

### 5. Verify Deployment

```bash
# List all functions
supabase functions list

# Should show:
# - create-bundle-zip
# - report-worker
```

### 6. Check Environment Variables

The function needs these environment variables (should already be set):

```bash
supabase secrets list
```

Should show:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, set them:
```bash
supabase secrets set SUPABASE_URL=<your-url>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

### 7. Test the Function

After deployment, try clicking "Generate ZIP" again in your app.

Or test directly:
```bash
curl "https://<your-project>.supabase.co/functions/v1/create-bundle-zip?jobId=<job-id>" \
  -H "Authorization: Bearer <your-anon-key>"
```

## Alternative: Deploy via Supabase Dashboard

If you prefer using the UI:

1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions**
3. Click **New Function**
4. Name it: `create-bundle-zip`
5. Copy the contents of `supabase/functions/create-bundle-zip/index.ts`
6. Paste into the editor
7. Click **Deploy**

## Troubleshooting

### Still getting 401?

1. **Check the function is deployed:**
   ```bash
   supabase functions list
   ```

2. **Check the URL is correct:**
   - Should be: `https://<project>.supabase.co/functions/v1/create-bundle-zip`
   - Not: `https://<project>.supabase.co/functions/create-bundle-zip`

3. **Check your environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL` in your `.env.local`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` in your `.env.local`

4. **Check browser console:**
   - Look for the exact URL being called
   - Check if the Authorization header is being sent

### Function deploys but errors?

Check the logs:
```bash
supabase functions logs create-bundle-zip --tail
```

### Environment variables not set?

Get them from your Supabase Dashboard:
- Settings → API → Project URL (SUPABASE_URL)
- Settings → API → service_role key (SUPABASE_SERVICE_ROLE_KEY)

## After Successful Deployment

Once deployed, the flow should work:

1. Navigate to a completed job
2. Click "Generate ZIP" button
3. Edge Function creates the bundle (may take 30s - 2min depending on size)
4. ZIP downloads automatically
5. Button changes to "Download ZIP" for future downloads

## Notes

- First-time deployment might take longer
- Large jobs (1000+ PDFs) might take 1-2 minutes
- Check Edge Function logs if issues persist
- The function has no timeout limits unlike Vercel
