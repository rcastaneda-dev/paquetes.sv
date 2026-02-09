## Paquetes.sv

Sistema para **consultar estudiantes** (por escuela/grado/fecha) y **generar PDFs/ZIPs** de reportes a escala usando **Next.js 14 + Supabase**.

### Arquitectura (alto nivel)

- **Next.js App (UI + API)**: `src/app` y `src/app/api`
- **Supabase**:
  - **Postgres** como fuente de verdad (jobs, tasks, progreso)
  - **Storage** (bucket `reports`) para PDFs y ZIPs
  - **RPCs** para operaciones atómicas (claim/retry/progreso)
- **Workers**
  - **Server-side worker routes** (Next.js): drenan colas de tareas y generan PDFs en lotes
  - **ZIP worker (proceso persistente)**: `worker/zip-worker` (Node) hace polling de `zip_jobs` y arma ZIPs grandes sin timeouts

### Flujos principales

- **Consultas ad-hoc**
  - UI filtra y consulta datos
  - Endpoints generan PDFs bajo demanda (streaming)

- **Bulk jobs (regiones)**
  - Se crea un `report_job` + `report_tasks`
  - `/api/worker/process-tasks` reclama tareas vía RPC, genera **2 PDFs por escuela** (tallas + etiquetas) y los sube a Storage
  - El ZIP worker procesa `zip_jobs` de tipo `region` y publica el ZIP final; la UI descarga con **signed URLs**

- **Bulk jobs (categorías por `fecha_inicio`)**
  - Se crean `report_category_tasks` (p. ej. `camisa`, `zapatos`, `ficha_uniformes`, etc.)
  - `/api/worker/process-category-tasks` genera y sube PDFs por categoría
  - El ZIP worker también procesa `zip_jobs` de tipo `category` (ZIP por categoría)
  - `/api/bulk/jobs/[jobId]/consolidated-pdf` arma un **PDF consolidado** (streaming) por sección
  - `school_bundle` (ZIP “1 PDF por escuela”) se **delega** desde el ZIP worker a `/api/worker/process-school-bundle-zip` (porque ahí vive la lógica de PDF)

### Patrones utilizados

- **Job/task orchestration**: tablas `report_jobs`, `report_tasks`, `report_category_tasks`, `zip_jobs` + estados (`queued|running|complete|failed|cancelled`)
- **RPC-first para consistencia**: claims atómicos (`claim_*`), progreso (`get_*_progress`), updates (`update_*_status`)
- **Streaming + buffers controlados**:
  - PDFKit para PDFs
  - Archiver para ZIPs
  - Concurrency limitada para evitar picos de memoria
- **Validación y configuración**: Zod (`src/lib/validation/*`) para env + auth de workers (Bearer / `x-worker-secret`)

### Estructura (rápida)

- `src/app/*`: UI (App Router)
- `src/app/api/*`: API routes (bulk, students, worker endpoints)
- `src/lib/*`: Supabase clients, generación de PDFs, keys de Storage, validación
- `worker/zip-worker/*`: worker Node para ZIPs (ver `worker/zip-worker/README.md`)
- `supabase/migrations/*`: schema y funciones RPC

### Desarrollo local

```bash
npm install
npm run dev
```

Para correr el ZIP worker local:

```bash
cd worker/zip-worker
npm install
npm run dev
```

### Variables de entorno (mínimas)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (solo UI)
- `SUPABASE_SERVICE_ROLE_KEY` (solo server/worker)
- `SUPABASE_FUNCTION_SECRET` o `CRON_SECRET` (autenticación de endpoints `/api/worker/*`)
