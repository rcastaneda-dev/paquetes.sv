# Architecture Overview

## System Design

This application follows a **serverless architecture** pattern with:
- **Frontend**: Next.js App Router (Server + Client Components)
- **Backend**: Supabase (PostgreSQL + Storage + RPC)
- **Workers**: Async task processing via Vercel Cron or Supabase Edge Functions

## Data Flow Diagrams

### Ad-hoc Query Flow

```
User Input → FiltersPanel (Client)
    ↓
API Route: /api/students/query
    ↓
Supabase RPC: query_students()
    ↓
PostgreSQL Query (with pagination)
    ↓
Return: StudentQueryRow[]
    ↓
StudentsGrid (Client) renders table
```

### Bulk Report Generation Flow

```
User clicks "Generate All PDFs"
    ↓
POST /api/bulk/jobs
    ↓
1. RPC: get_school_grade_combinations()
2. INSERT INTO report_jobs
3. INSERT INTO report_tasks (N rows)
    ↓
Return jobId to user
    ↓
[Cron triggers every minute]
    ↓
POST /api/worker/process-tasks
    ↓
1. RPC: claim_pending_tasks(5)  [SKIP LOCKED]
2. For each task:
   - RPC: report_students_by_school_grade()
   - generateStudentReportPDF()
   - Upload to Storage: reports/{jobId}/{school}-{grade}.pdf
   - RPC: update_task_status('complete')
    ↓
[When all tasks complete]
    ↓
[Cron triggers every 5 minutes]
    ↓
POST /api/worker/create-zip
    ↓
1. Find completed jobs without ZIP
2. For each job:
   - Download all PDFs from Storage
   - createZipArchive()
   - Upload to Storage: reports/{jobId}/bundle.zip
   - UPDATE report_jobs SET zip_path
    ↓
User clicks "Download ZIP"
    ↓
GET /api/bulk/jobs/[jobId]/download
    ↓
Generate signed URL (1 hour expiry)
    ↓
Redirect user to Storage URL
```

## Database Schema

### Core Tables (Pre-existing)

```sql
public.schools
├── codigo_ce (PK, text)
├── nombre_ce
├── departamento
├── municipio
└── ... (location data)

public.students
├── nie (PK, text)
├── school_codigo_ce (FK → schools)
├── nombre_estudiante
├── sexo
├── edad
├── grado
└── grado_ok

public.uniform_sizes
├── nie (PK, FK → students)
├── camisa
├── pantalon_falda
└── zapato
```

### Reporting Tables (New)

```sql
public.report_jobs
├── id (PK, uuid)
├── status (queued|running|complete|failed)
├── created_at
├── zip_path
├── error
└── job_params (jsonb)

public.report_tasks
├── id (PK, uuid)
├── job_id (FK → report_jobs)
├── school_codigo_ce (FK → schools)
├── grado
├── status (pending|running|complete|failed)
├── attempt_count
├── pdf_path
├── error
└── UNIQUE(job_id, school_codigo_ce, grado)
```

## Key Design Decisions

### 1. Why Async Task Processing?

**Problem**: Generating 100+ PDFs synchronously would exceed serverless timeouts (10-60s).

**Solution**:
- Break work into small tasks (one per school+grade)
- Process in batches via cron (5 tasks/minute)
- Store state in database for resumability

**Benefits**:
- No timeouts
- Retryable on failure
- Progress tracking
- Scalable to thousands of reports

### 2. Why Separate ZIP Creation?

**Problem**: Creating ZIP while generating PDFs blocks workers and risks timeout.

**Solution**:
- Generate all PDFs first
- Create ZIP in a separate pass
- Only when all PDFs complete

**Benefits**:
- Simpler error handling
- Better resource utilization
- ZIP creation can retry independently

### 3. Why RPC Functions?

**Problem**: Complex joins and business logic duplicated between API routes.

**Solution**:
- Encapsulate queries in PostgreSQL functions
- Single source of truth
- Easy to optimize (indexes, query plans)
- Security via SECURITY DEFINER

**Benefits**:
- DRY (Don't Repeat Yourself)
- Performance (server-side execution)
- Type safety via TypeScript interfaces

### 4. Why SKIP LOCKED?

**Problem**: Multiple worker instances could claim the same tasks.

**Solution**:
```sql
SELECT ... FOR UPDATE SKIP LOCKED
```

**Benefits**:
- Lock-free concurrency
- Workers don't block each other
- Safe for horizontal scaling

### 5. Why Streaming PDFs?

**Problem**: Large tables could blow memory limits (256MB-1GB on serverless).

**Solution**:
- PDFKit generates stream (not full buffer)
- Stream directly to Storage
- Garbage collected incrementally

**Benefits**:
- Constant memory usage
- Handles tables with 1000+ rows
- Faster time-to-first-byte

## Component Architecture

### Server Components (RSC)

Used for:
- Initial data fetching
- SEO-critical content
- Reduce client bundle size

Currently **not** used heavily because:
- Most pages need interactivity (filters, pagination)
- Future enhancement: static school/grade lists

### Client Components

Used for:
- Interactive forms (FiltersPanel)
- Data tables (StudentsGrid)
- Real-time updates (JobProgress polling)

**State Management**: React useState/useEffect (sufficient for this app)

### API Routes (Route Handlers)

Pattern:
```typescript
export async function GET(request: NextRequest) {
  // 1. Parse query params
  // 2. Call Supabase RPC
  // 3. Return JSON
}
```

All follow RESTful conventions:
- GET: Read operations
- POST: Create operations
- No DELETE (soft deletes via status)

## Storage Strategy

### Bucket: `reports`

Structure:
```
reports/
├── {jobId}/
│   ├── {schoolCode}-{grade}.pdf
│   ├── {schoolCode}-{grade}.pdf
│   └── bundle.zip
```

**Retention**: Implement cleanup cron to delete old jobs (e.g., > 30 days).

**Access**:
- PDFs: Private (only via signed URLs)
- ZIPs: Private (only via signed URLs)
- Signed URLs: 1 hour expiry

## Security Layers

### Current (No Auth)

- API routes are public
- Storage requires signed URLs
- Worker endpoints protected by secret header

### Future (With Auth)

```
┌─────────────────────────────────────┐
│ Middleware (src/middleware.ts)      │
│ - Check session cookie              │
│ - Redirect to /login if needed      │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ API Routes                          │
│ - getServerAuthContext()            │
│ - requireRole(['admin'])            │
└─────────────────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ Supabase (RLS enabled)              │
│ - Row-level security policies       │
│ - Filter by auth.uid()              │
└─────────────────────────────────────┘
```

## Performance Considerations

### Database

- **Indexes**: All foreign keys and filter columns indexed
- **Pagination**: LIMIT/OFFSET on server side
- **Connection pooling**: Supabase handles automatically

### Frontend

- **Code splitting**: Automatic via Next.js
- **Data fetching**: Only fetch what's visible (pagination)
- **Real-time updates**: Polling (not WebSockets) for simplicity

### Workers

- **Batch size**: 5 tasks/minute (adjustable)
- **Concurrency**: Run multiple workers if needed
- **Retries**: Built into task status (attempt_count)

## Monitoring & Observability

### Logs

- **Supabase Dashboard**: Database logs, function logs
- **Vercel Dashboard**: Edge function logs, cron logs
- **Browser DevTools**: Client-side errors

### Metrics to Track

- Jobs created per day
- Average job completion time
- Task failure rate
- Storage usage

**Future**: Integrate with monitoring service (Sentry, LogRocket, etc.)

## Scalability Limits

### Current Setup

- **Students**: Unlimited (paginated queries)
- **Concurrent jobs**: ~10-20 (Vercel cron single-threaded)
- **PDF size**: Up to ~1000 rows/PDF (streaming handles it)
- **ZIP size**: Up to ~500 PDFs/ZIP (~50MB typical)

### How to Scale Further

1. **Horizontal workers**: Deploy multiple Supabase Edge Functions
2. **Queue system**: Replace cron with BullMQ/Redis
3. **CDN**: Cache static ZIPs in Cloudflare/Vercel Edge
4. **Sharding**: Split by region/department if data grows to millions

## Technology Choices Rationale

| Technology | Why? | Alternatives Considered |
|-----------|------|------------------------|
| Next.js 14 | App Router, RSC, API routes in one | Remix, SvelteKit |
| TypeScript | Type safety, great DX | JavaScript (too risky) |
| Supabase | PostgreSQL + Storage + Auth + RPC | Firebase (less SQL flexibility), AWS (too complex) |
| PDFKit | Streaming, lightweight | Puppeteer (heavy), @react-pdf/renderer (slower) |
| TanStack Table | Best React table lib | AG Grid (overkill), custom (too much work) |
| Vercel Cron | Built-in, zero config | AWS Lambda + EventBridge (complex), custom server (ops burden) |

## Future Architectural Improvements

### Phase 1: Auth (Already Prepared)

- Uncomment auth code
- Enable RLS on tables
- Add login page

### Phase 2: Real-time Updates

- Replace polling with WebSockets (Supabase Realtime)
- Live job progress without refresh

### Phase 3: Advanced Queuing

- Replace cron with BullMQ + Redis
- Better retry logic
- Priority queues

### Phase 4: Multi-tenancy

- Add `organization_id` to all tables
- RLS policies by organization
- White-label support

## Development Workflow

```bash
# Local development
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build

# Run production build locally
npm start
```

## Deployment Checklist

- [ ] Environment variables set
- [ ] Database migrations run
- [ ] Storage bucket created
- [ ] Cron jobs configured
- [ ] Smoke test: Create job, wait 5 min, check ZIP
- [ ] Monitor logs for errors
