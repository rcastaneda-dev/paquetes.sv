## paquetes.sv

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

### Tipos de PDFs generados

#### Reportes de estudiantes (formato tabla, landscape)

| Tipo          | Descripción                                                |
| ------------- | ---------------------------------------------------------- |
| **Tallas**    | Tabla con NO, NOMBRE, SEXO, EDAD, CAMISA, PANTALÓN, ZAPATO |
| **Etiquetas** | Etiquetas para empaque: NO, CÓDIGO CE, ESCUELA, NOMBRE     |

#### Reportes de acuerdos (planificación de distribución, landscape/portrait)

| Tipo                | Categoría         | Descripción                             |
| ------------------- | ----------------- | --------------------------------------- |
| **Cajas**           | `estudiantes`     | Distribución de cajas por grado/género  |
| **Camisas**         | `camisa`          | Distribución por tipo y talla (T4-T2X)  |
| **Pantalones**      | `prenda_inferior` | Distribución por tipo y talla (T4-T2X)  |
| **Zapatos**         | `zapatos`         | Distribución por género y talla (23-45) |
| **Ficha Uniformes** | `ficha_uniformes` | Ficha por escuela (portrait)            |
| **Ficha Zapatos**   | `ficha_zapatos`   | Ficha por escuela (portrait)            |

#### Actas de recepción (portrait, por escuela)

| Tipo                         | Descripción                                          |
| ---------------------------- | ---------------------------------------------------- |
| **Acta Recepción Uniformes** | TIPO/TALLA, CANTIDAD, COMENTARIOS + datos transporte |
| **Acta Recepción Zapatos**   | TALLA, CANTIDAD, COMENTARIOS + datos transporte      |

Todos los PDFs de acuerdos incluyen una línea de registro manual: `HORA DE INICIO: ___ HORA DE FINALIZACION: ___`.

### Flujos principales

- **Consultas ad-hoc**
  - UI filtra y consulta datos
  - Endpoints generan PDFs bajo demanda (streaming): `/api/students/print`, `/api/students/print-labels`
  - Reportes de acuerdos ad-hoc: `/api/reports/cajas`, `/api/reports/camisas`, `/api/reports/pantalones`, `/api/reports/zapatos`
  - Actas de recepción ad-hoc: `/api/reports/acta-recepcion-uniformes`, `/api/reports/acta-recepcion-zapatos`

- **Bulk jobs (regiones)**
  - Se crea un `report_job` + `report_tasks` (con soporte de **shards** para jobs grandes)
  - `/api/worker/process-tasks` reclama tareas vía RPC, genera **2 PDFs por escuela** (tallas + etiquetas) y los sube a Storage
  - El ZIP worker procesa `zip_jobs` de tipo `region` y publica el ZIP final; la UI descarga con **signed URLs**

- **Demand pipeline (datos normalizados)**
  - Upload alternativo para CSVs con cantidades pre-calculadas (9 columnas: NRO, CODIGO, NOMBRE, TAMAÑO, MATRICULA, ITEM, TIPO, CATEGORIA, CANTIDAD)
  - Datos pasan directo sin cálculos de vacíos (no `computeFinalCount`, no buffer)
  - Tablas: `staging_demand_raw` → `school_demand`
  - UI: `/staging/demand` (upload), `/reports/demand` (descarga de 7 reportes: 3 PDF, 3 Word, 1 Excel)

- **Bulk jobs (categorías por `fecha_inicio`)**
  - Se crean `report_category_tasks` con 6 categorías: `estudiantes`, `camisa`, `prenda_inferior`, `zapatos`, `ficha_uniformes`, `ficha_zapatos`
  - `/api/worker/process-category-tasks` genera y sube PDFs por categoría
  - El ZIP worker procesa `zip_jobs` de tipo `category` (ZIP por categoría)
  - `/api/bulk/jobs/[jobId]/consolidated-pdf` arma un **PDF consolidado** (streaming) por sección
  - `school_bundle` (ZIP "1 PDF por escuela" con Cajas + Ficha Uniformes + Ficha Zapatos) se **delega** desde el ZIP worker a `/api/worker/process-school-bundle-zip`

### Patrones utilizados

- **Job/task orchestration**: tablas `report_jobs`, `report_tasks`, `report_category_tasks`, `zip_jobs` + estados (`queued|running|complete|failed|cancelled`)
- **Multi-discriminador en `zip_jobs`**: columna `job_kind` soporta 3 tipos (`region`, `category`, `school_bundle`) con CHECK constraints a nivel DB
- **RPC-first para consistencia**: claims atómicos con `FOR UPDATE SKIP LOCKED` (`claim_*`), progreso (`get_*_progress`), updates (`update_*_status`)
- **Streaming + buffers controlados**:
  - PDFKit para PDFs
  - Archiver para ZIPs
  - Concurrency limitada para evitar picos de memoria
- **Recuperación de tareas atascadas**: RPCs `requeue_stale_running_tasks()` y `requeue_stale_running_category_tasks()` para recuperar de crashes/timeouts
- **Protección de cancelación**: tareas canceladas no pueden ser actualizadas (previene race conditions)
- **Paginación de PostgREST**: fetch en lotes de 1,000 filas con límite de seguridad de 200,000 filas
- **Normalización de paths**: `toSafePathSegment()` convierte caracteres a ASCII-safe (é → e) para paths de Storage
- **Vacíos (buffer de seguridad)**: cálculo de 5% extra por tipo de prenda (ceilToEven para uniformes, Math.ceil para zapatos/cajas)
- **Validación y configuración**: Zod (`src/lib/validation/*`) para env + auth de workers (Bearer / `x-worker-secret`)

### API routes

#### Bulk jobs (`/api/bulk/`)

| Endpoint                                              | Método | Descripción                                  |
| ----------------------------------------------------- | ------ | -------------------------------------------- |
| `/api/bulk/jobs`                                      | POST   | Crear bulk job                               |
| `/api/bulk/jobs`                                      | GET    | Listar jobs (paginado)                       |
| `/api/bulk/jobs`                                      | DELETE | Borrar jobs antiguos (`?scope=past`)         |
| `/api/bulk/jobs/category`                             | POST   | Crear job de categorías (por `fecha_inicio`) |
| `/api/bulk/jobs/[jobId]`                              | GET    | Detalle + progreso del job                   |
| `/api/bulk/jobs/[jobId]`                              | DELETE | Borrar job específico                        |
| `/api/bulk/jobs/[jobId]/cancel`                       | POST   | Cancelar job en ejecución                    |
| `/api/bulk/jobs/[jobId]/retry-failed`                 | POST   | Reintentar tareas fallidas                   |
| `/api/bulk/jobs/[jobId]/download`                     | GET    | Descargar bundle de región (signed URL)      |
| `/api/bulk/jobs/[jobId]/consolidated-pdf`             | GET    | PDF consolidado por sección (streaming)      |
| `/api/bulk/jobs/[jobId]/create-zip-job`               | POST   | Encolar ZIP de región                        |
| `/api/bulk/jobs/[jobId]/zip-job-status`               | GET    | Estado del ZIP de región                     |
| `/api/bulk/jobs/[jobId]/create-category-zip-job`      | POST   | Encolar ZIP de categoría                     |
| `/api/bulk/jobs/[jobId]/category-zip-status`          | GET    | Estado del ZIP de categoría                  |
| `/api/bulk/jobs/[jobId]/create-school-bundle-zip-job` | POST   | Encolar ZIP de school bundle                 |
| `/api/bulk/jobs/[jobId]/school-bundle-zip-status`     | GET    | Estado del ZIP de school bundle              |

#### Estudiantes y reportes

| Endpoint                                | Método | Descripción                                            |
| --------------------------------------- | ------ | ------------------------------------------------------ |
| `/api/students/query`                   | GET    | Consultar estudiantes (escuela/grado/depto/paginación) |
| `/api/students/print`                   | GET    | Generar PDF de tallas (on-demand)                      |
| `/api/students/print-labels`            | GET    | Generar PDF de etiquetas (on-demand)                   |
| `/api/reports/cajas`                    | GET    | PDF de Cajas                                           |
| `/api/reports/camisas`                  | GET    | PDF de Camisas                                         |
| `/api/reports/pantalones`               | GET    | PDF de Pantalones                                      |
| `/api/reports/zapatos`                  | GET    | PDF de Zapatos                                         |
| `/api/reports/acta-recepcion-uniformes` | GET    | Acta de Recepción (Uniformes)                          |
| `/api/reports/acta-recepcion-zapatos`   | GET    | Acta de Recepción (Zapatos)                            |
| `/api/schools/search`                   | GET    | Autocompletado de escuelas                             |
| `/api/grades`                           | GET    | Grados disponibles                                     |

#### Worker endpoints (requieren Bearer auth)

| Endpoint                                | Método | Descripción                             |
| --------------------------------------- | ------ | --------------------------------------- |
| `/api/worker/process-tasks`             | POST   | Reclamar y procesar tareas de región    |
| `/api/worker/process-category-tasks`    | POST   | Reclamar y procesar tareas de categoría |
| `/api/worker/process-school-bundle-zip` | POST   | Generar ZIPs de school bundle           |

#### Demand pipeline (datos normalizados)

| Endpoint                                  | Método | Descripción                                      |
| ----------------------------------------- | ------ | ------------------------------------------------ |
| `/api/staging/demand`                     | POST   | Upload CSV normalizado (truncate/insert/migrate) |
| `/api/reports/demand/acta-cajas`          | GET    | Acta de Recepción Cajas (PDF) desde demand       |
| `/api/reports/demand/acta-uniformes`      | GET    | Acta de Recepción Uniformes (PDF) desde demand   |
| `/api/reports/demand/acta-zapatos`        | GET    | Acta de Recepción Zapatos (PDF) desde demand     |
| `/api/reports/demand/acta-cajas-word`     | GET    | Acta de Recepción Cajas (Word) desde demand      |
| `/api/reports/demand/acta-uniformes-word` | GET    | Acta de Recepción Uniformes (Word) desde demand  |
| `/api/reports/demand/acta-zapatos-word`   | GET    | Acta de Recepción Zapatos (Word) desde demand    |
| `/api/reports/demand/consolidado-excel`   | GET    | Consolidado por escuela (Excel) desde demand     |

### Estructura

```
src/
├── app/                          # UI (App Router) + API routes
│   ├── api/
│   │   ├── bulk/                  # Job management & downloads
│   │   ├── students/              # Queries & ad-hoc PDFs
│   │   ├── reports/               # Agreement PDFs ad-hoc
│   │   │   ├── cajas|camisas|…    # Student-level reports
│   │   │   ├── acta-recepcion-*/  # Actas de recepción (uniformes, zapatos)
│   │   │   └── demand/            # Demand-based reports (PDF, Word, Excel)
│   │   ├── schools/               # School search
│   │   ├── grades/                # Grade lookup
│   │   ├── staging/               # CSV upload (student-level + demand)
│   │   └── worker/                # Worker endpoints (auth required)
│   ├── staging/                   # Upload pages
│   │   ├── page.tsx               # Student-level CSV upload
│   │   └── demand/page.tsx        # Normalized demand CSV upload
│   └── reports/
│       └── demand/page.tsx        # Demand report downloads
├── lib/
│   ├── supabase/                  # Clients (browser + server)
│   ├── pdf/
│   │   ├── generator.ts           # Tallas + Etiquetas
│   │   ├── generators-agreement.ts # Cajas, Camisas, Pantalones, Zapatos
│   │   ├── generators-demand.ts   # Actas de Recepción desde demand (sin vacíos)
│   │   ├── agreement/             # Fichas, consolidated builder, sections, types
│   │   └── streams.ts             # Stream converters
│   ├── word/
│   │   └── generators-demand.ts   # Actas de Recepción Word desde demand
│   ├── excel/
│   │   └── generators-demand.ts   # Consolidado Excel desde demand
│   ├── reports/
│   │   └── vacios.ts              # Buffer calculation (5% extra, no gap-filling)
│   ├── storage/
│   │   └── keys.ts                # Storage path builders + normalization
│   ├── config/
│   │   └── env.ts                 # Environment validation
│   └── validation/                # Zod schemas, helpers, error builders
worker/
└── zip-worker/                    # Worker Node.js para ZIPs (ver worker/zip-worker/README.md)
supabase/
└── migrations/                    # Schema y funciones RPC
```

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

### Variables de entorno

#### Requeridas

| Variable                                   | Uso                               |
| ------------------------------------------ | --------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                 | URL del proyecto Supabase         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`            | Solo UI (RLS enforced)            |
| `SUPABASE_SERVICE_ROLE_KEY`                | Solo server/worker (bypassa RLS)  |
| `SUPABASE_FUNCTION_SECRET` o `CRON_SECRET` | Auth de endpoints `/api/worker/*` |

#### Workers (Next.js)

| Variable                    | Default | Descripción                                   |
| --------------------------- | ------- | --------------------------------------------- |
| `WORKER_BATCH_SIZE`         | 25      | Tareas por llamada RPC (1-100)                |
| `WORKER_CONCURRENCY`        | 3       | PDFs generados en paralelo (1-10)             |
| `WORKER_MAX_RUNTIME`        | 9000    | Tiempo máximo de ejecución en ms (1000-60000) |
| `WORKER_STALE_TASK_SECONDS` | 900     | Umbral para tareas atascadas (15 min)         |
| `WORKER_STALE_TASK_LIMIT`   | 5000    | Máximo de tareas a reencolar por ejecución    |

#### ZIP Worker

| Variable              | Default | Descripción                   |
| --------------------- | ------- | ----------------------------- |
| `POLL_INTERVAL_MS`    | 5000    | Frecuencia de polling         |
| `DOWNLOAD_BATCH_SIZE` | 50      | PDFs descargados en paralelo  |
| `COMPRESSION_LEVEL`   | 6       | Nivel de compresión ZIP (0-9) |
