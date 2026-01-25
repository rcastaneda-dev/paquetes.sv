# Deployment Checklist

Use this checklist when deploying to production.

## Pre-Deployment

### Database Setup
- [ ] Supabase project created
- [ ] `paquetes_schema.sql` executed
- [ ] `fix_foreign_keys.sql` executed
- [ ] `supabase/migrations/001_add_reporting_tables.sql` executed
- [ ] Verification script shows all ✓ PASS
- [ ] Sample data loaded (if applicable)

### Storage Setup
- [ ] `reports` bucket created
- [ ] `supabase/setup-storage.sql` executed
- [ ] Storage policies verified

### Environment Variables
- [ ] `NEXT_PUBLIC_SUPABASE_URL` set
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (keep secret!)
- [ ] `SUPABASE_FUNCTION_SECRET` generated and set
- [ ] `CRON_SECRET` generated and set

### Code Quality
- [ ] `npm run lint` passes
- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds
- [ ] No console errors in dev mode

## Deployment (Vercel)

### Initial Deploy
- [ ] Code pushed to GitHub
- [ ] Vercel project created and linked
- [ ] Environment variables added in Vercel dashboard
- [ ] First deploy successful

### Post-Deploy Verification
- [ ] Home page loads
- [ ] Can search for schools (autocomplete works)
- [ ] Can view students in table
- [ ] Can navigate to `/bulk` page
- [ ] Can create a bulk job

### Cron Jobs
- [ ] Verify `vercel.json` is in repo
- [ ] Check Vercel Dashboard → Settings → Cron Jobs
- [ ] Should see:
  - `/api/worker/process-tasks` - Every 1 minute
  - `/api/worker/create-zip` - Every 5 minutes

## Testing in Production

### Smoke Test 1: Query Flow
1. [ ] Navigate to home page
2. [ ] Search for a school
3. [ ] Select a grade
4. [ ] Click "Search"
5. [ ] Verify students load in table
6. [ ] Test pagination (if > 50 results)

### Smoke Test 2: Bulk Job Flow
1. [ ] Navigate to `/bulk`
2. [ ] Click "Generate All PDFs"
3. [ ] Job created (shows in list with status "En Cola")
4. [ ] Wait 1-2 minutes
5. [ ] Refresh page → Status should change to "En Proceso"
6. [ ] Click on job → View progress
7. [ ] Wait for completion (depends on data size)
8. [ ] Status becomes "Completo"
9. [ ] Click "Descargar ZIP"
10. [ ] ZIP file downloads successfully
11. [ ] Open ZIP → Verify PDFs are present and readable

### Smoke Test 3: Worker Health
```bash
# Check worker endpoints
curl https://your-app.vercel.app/api/worker/process-tasks
# Should return: {"status":"Worker is running"}

curl https://your-app.vercel.app/api/worker/create-zip
# Should return: {"status":"ZIP worker is running"}
```

## Monitoring Setup

### Vercel
- [ ] Enable error notifications in Vercel
- [ ] Check Logs tab regularly
- [ ] Set up custom domain (optional)

### Supabase
- [ ] Review Database → Logs
- [ ] Review Storage → Usage
- [ ] Set up alerts for storage quota

### Custom Monitoring (Optional)
- [ ] Integrate Sentry for error tracking
- [ ] Set up uptime monitoring (UptimeRobot, etc.)
- [ ] Configure log aggregation

## Security Checklist

### Secrets
- [ ] Service role key never exposed client-side
- [ ] Worker secrets are random and strong
- [ ] `.env` not committed to git
- [ ] Vercel env vars marked as sensitive

### Access Control
- [ ] Storage policies are correct (no public write)
- [ ] Worker endpoints require authorization header
- [ ] CORS configured if needed

### Future: Auth Implementation
- [ ] Plan authentication strategy
- [ ] Enable RLS when auth is ready
- [ ] Update storage policies for authenticated users

## Performance Validation

### Load Times
- [ ] Home page loads < 2s
- [ ] API responses < 500ms
- [ ] PDF generation completes in reasonable time

### Resource Usage
- [ ] Check Supabase Database usage
- [ ] Check Storage usage
- [ ] Monitor Vercel function execution time

## Rollback Plan

If something goes wrong:

1. **Vercel Rollback**:
   - Dashboard → Deployments
   - Find previous working deployment
   - Click "..." → Promote to Production

2. **Database Rollback**:
   - If migrations broke something, restore from backup
   - Supabase has automatic backups

3. **Emergency Fix**:
   ```bash
   # Quick patch and redeploy
   git revert HEAD
   git push
   ```

## Post-Launch Tasks

### Week 1
- [ ] Monitor error logs daily
- [ ] Check job completion rate
- [ ] Verify storage usage trends
- [ ] Collect user feedback

### Week 2-4
- [ ] Optimize slow queries (if any)
- [ ] Implement cleanup cron for old reports
- [ ] Add monitoring dashboards
- [ ] Document common issues

## Future Enhancements Priority

### Phase 1 (High Priority)
- [ ] Implement authentication
- [ ] Add automated cleanup (delete reports > 30 days)
- [ ] Email notifications on job completion
- [ ] Excel export feature

### Phase 2 (Medium Priority)
- [ ] Advanced filters (size ranges)
- [ ] Bulk edit functionality
- [ ] Dashboard with statistics
- [ ] Custom PDF templates

### Phase 3 (Low Priority)
- [ ] Real-time updates (WebSockets)
- [ ] Multi-tenancy
- [ ] API webhooks
- [ ] White-label support

## Sign-Off

- [ ] All smoke tests passed
- [ ] No critical errors in logs
- [ ] Performance acceptable
- [ ] Documentation updated
- [ ] Team trained on system

**Deployed By**: ___________________  
**Date**: ___________________  
**Environment**: Production  
**Version**: ___________________  

---

**Note**: Keep this checklist for future deployments and update as needed.
