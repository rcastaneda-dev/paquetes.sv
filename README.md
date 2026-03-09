## paquetes.sv

Sistema para **consultar estudiantes** (por escuela/grado/fecha) y **generar reportes** (PDF, Word, Excel) a escala usando **Next.js 14 + Supabase**.

---

### Arquitectura

```
Frontend (Next.js App Router)
    ↕ API Routes
    ↕ Supabase (Postgres + Storage)
    ↕
Workers
  ├─ Server-side (Next.js): drenan colas de tareas, generan PDFs en lotes
  └─ ZIP worker (Node.js): polling de `zip_jobs`, arma ZIPs grandes sin timeouts
```

- **Supabase Postgres** — fuente de verdad (jobs, tasks, escuelas, estudiantes, demand)
- **Supabase Storage** — bucket `reports` para PDFs, ZIPs y Excel generados
- **RPCs** — operaciones atómicas con `FOR UPDATE SKIP LOCKED` (claims, progreso, retry)

---

### Pipelines de datos

#### 1. Pipeline de estudiantes (student-level)

Datos completos de estudiantes → cálculo de tallas y vacíos (5% buffer).

| Etapa | Descripción |
| --- | --- |
| Upload CSV | `/staging` → `/api/staging` (truncate + insert) |
| Consulta | `/consulta` → `/api/students/query` (filtros por escuela/grado/depto/zona) |
| PDFs ad-hoc | Tallas, etiquetas, acuerdos — streaming directo |
| Bulk jobs | Job → tasks por escuela → worker genera PDFs → ZIP worker empaqueta |

#### 2. Pipeline de demanda (demand)

Cantidades pre-calculadas (9 columnas: NRO, CODIGO, NOMBRE, TAMAÑO, MATRICULA, ITEM, TIPO, CATEGORIA, CANTIDAD). Los datos pasan directo — sin `computeFinalCount`, sin buffer.

| Etapa | Descripción |
| --- | --- |
| Upload CSV | `/staging/demand` → `/api/staging/demand` (truncate + insert + migrate) |
| Reportes | `/reports/demand` — descarga de 16 reportes (PDF, Word, Excel) |

---

### Tipos de reportes generados

#### Reportes de estudiantes (ad-hoc, landscape)

| Tipo | Contenido |
| --- | --- |
| **Tallas** | NO, NOMBRE, SEXO, EDAD, CAMISA, PANTALÓN, ZAPATO |
| **Etiquetas** | NO, CÓDIGO CE, ESCUELA, NOMBRE (etiquetas para empaque) |

#### Reportes de acuerdos (landscape/portrait)

| Tipo | Categoría | Descripción |
| --- | --- | --- |
| **Cajas** | `estudiantes` | Distribución de cajas por grado/género |
| **Camisas** | `camisa` | Distribución por tipo y talla (T4–T2X) |
| **Pantalones** | `prenda_inferior` | Distribución por tipo y talla (T4–T2X) |
| **Zapatos** | `zapatos` | Distribución por género y talla (23–45) |
| **Ficha Uniformes** | `ficha_uniformes` | Ficha por escuela (portrait) |
| **Ficha Zapatos** | `ficha_zapatos` | Ficha por escuela (portrait) |

#### Actas de recepción (portrait, por escuela)

| Tipo | Contenido |
| --- | --- |
| **Acta Recepción Uniformes** | TIPO/TALLA, CANTIDAD, COMENTARIOS + datos transporte |
| **Acta Recepción Zapatos** | TALLA, CANTIDAD, COMENTARIOS + datos transporte |

#### Reportes de demanda (desde pipeline normalizado)

| Tipo | Formatos | Descripción |
| --- | --- | --- |
| **Comanda de Cajas** | PDF, Word | Comanda de distribución de cajas |
| **Comanda de Uniformes** | PDF, Word | Comanda de distribución de uniformes |
| **Comanda de Zapatos** | PDF, Word | Comanda de distribución de zapatos |
| **Acta Recepción Cajas** | PDF, Word | Acta de recepción de cajas |
| **Acta Recepción Uniformes** | PDF, Word | Acta de recepción de uniformes |
| **Acta Recepción Zapatos** | PDF, Word | Acta de recepción de zapatos |
| **Consolidado** | Excel | Consolidado por escuela |
| **Consolidado Prendas+Cajas** | Excel | Prendas y cajas consolidado (v2) |
| **Prendas Acumulado Editable** | Excel | Prendas con edición (v2) |
| **Cajas Acumulado Editable** | Excel | Cajas con edición |

#### Reportes Excel bulk (por job, desde datos de estudiantes)

| Tipo | Endpoint |
| --- | --- |
| Consolidado Estudiantes | `consolidado-excel` |
| Consolidado Pivot Uniformes | `consolidado-pivot-excel` |
| Consolidado Prendas Final (v2) | `consolidado-pivot-excel-v2` |
| Zapatos Acumulado Editable | `zapatos-pivot-excel` |
| Cajas Acumulado Editable | `cajas-pivot-excel` |
| Consolidado Prendas + Cajas | `consolidado-prendas-cajas-excel` |

---

### Flujos principales

#### Consultas ad-hoc

La UI filtra y consulta datos; los endpoints generan documentos bajo demanda (streaming).

- **Tallas/Etiquetas**: `/api/students/print`, `/api/students/print-labels`
- **Acuerdos**: `/api/reports/cajas`, `/api/reports/camisas`, `/api/reports/pantalones`, `/api/reports/zapatos`
- **Actas**: `/api/reports/acta-recepcion-uniformes`, `/api/reports/acta-recepcion-zapatos`
- **Demand**: 16 endpoints bajo `/api/reports/demand/*`

#### Bulk jobs (regiones)

1. Se crea un `report_job` + `report_tasks` (con soporte de shards para jobs grandes)
2. `/api/worker/process-tasks` reclama tareas vía RPC, genera 2 PDFs por escuela (tallas + etiquetas) y los sube a Storage
3. El ZIP worker procesa `zip_jobs` de tipo `region` y publica el ZIP final
4. Reportes Excel consolidados disponibles por job

#### Bulk jobs (categorías por `fecha_inicio`)

1. Se crean `report_category_tasks` con 6 categorías
2. `/api/worker/process-category-tasks` genera y sube PDFs por categoría
3. ZIP worker procesa `zip_jobs` de tipo `category` (ZIP por categoría)
4. PDF consolidado disponible por sección (streaming)
5. `school_bundle` (ZIP con Cajas + Ficha Uniformes + Ficha Zapatos por escuela) delegado a `/api/worker/process-school-bundle-zip`

---

### API routes

#### Bulk jobs (`/api/bulk/`)

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `jobs` | POST | Crear bulk job |
| `jobs` | GET | Listar jobs (paginado) |
| `jobs` | DELETE | Borrar jobs antiguos (`?scope=past`) |
| `jobs/category` | POST | Crear job de categorías (por `fecha_inicio`) |
| `jobs/[jobId]` | GET | Detalle + progreso del job |
| `jobs/[jobId]` | DELETE | Borrar job específico |
| `jobs/[jobId]/cancel` | POST | Cancelar job en ejecución |
| `jobs/[jobId]/retry-failed` | POST | Reintentar tareas fallidas |
| `jobs/[jobId]/download` | GET | Descargar bundle de región (signed URL) |
| `jobs/[jobId]/consolidated-pdf` | GET | PDF consolidado por sección (streaming) |
| `jobs/[jobId]/create-zip-job` | POST | Encolar ZIP de región |
| `jobs/[jobId]/zip-job-status` | GET | Estado del ZIP de región |
| `jobs/[jobId]/create-category-zip-job` | POST | Encolar ZIP de categoría |
| `jobs/[jobId]/category-zip-status` | GET | Estado del ZIP de categoría |
| `jobs/[jobId]/create-school-bundle-zip-job` | POST | Encolar ZIP de school bundle |
| `jobs/[jobId]/school-bundle-zip-status` | GET | Estado del ZIP de school bundle |

##### Excel bulk (por job)

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `jobs/[jobId]/consolidado-excel` | GET | Consolidado de estudiantes |
| `jobs/[jobId]/consolidado-pivot-excel` | GET | Pivot uniformes |
| `jobs/[jobId]/consolidado-pivot-excel-v2` | GET | Prendas final (v2) |
| `jobs/[jobId]/zapatos-pivot-excel` | GET | Zapatos acumulado editable |
| `jobs/[jobId]/cajas-pivot-excel` | GET | Cajas acumulado editable |
| `jobs/[jobId]/consolidado-prendas-cajas-excel` | GET | Prendas + cajas consolidado |

#### Estudiantes y reportes ad-hoc

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `/api/students/query` | GET | Consultar estudiantes (escuela/grado/depto/paginación) |
| `/api/students/print` | GET | PDF de tallas (streaming) |
| `/api/students/print-labels` | GET | PDF de etiquetas (streaming) |
| `/api/reports/cajas` | GET | PDF de Cajas |
| `/api/reports/camisas` | GET | PDF de Camisas |
| `/api/reports/pantalones` | GET | PDF de Pantalones |
| `/api/reports/zapatos` | GET | PDF de Zapatos |
| `/api/reports/acta-recepcion-uniformes` | GET | Acta de Recepción (Uniformes) |
| `/api/reports/acta-recepcion-zapatos` | GET | Acta de Recepción (Zapatos) |
| `/api/schools/search` | GET | Autocompletado de escuelas |
| `/api/grades` | GET | Grados disponibles |

#### Demand pipeline

| Endpoint | Método | Formato | Descripción |
| --- | --- | --- | --- |
| `/api/staging/demand` | POST | — | Upload CSV normalizado (truncate/insert/migrate) |
| `demand/comanda-cajas` | GET | PDF | Comanda de Cajas |
| `demand/comanda-cajas-word` | GET | Word | Comanda de Cajas |
| `demand/comanda-uniformes` | GET | PDF | Comanda de Uniformes |
| `demand/comanda-uniformes-word` | GET | Word | Comanda de Uniformes |
| `demand/comanda-zapatos` | GET | PDF | Comanda de Zapatos |
| `demand/comanda-zapatos-word` | GET | Word | Comanda de Zapatos |
| `demand/acta-cajas` | GET | PDF | Acta Recepción Cajas |
| `demand/acta-cajas-word` | GET | Word | Acta Recepción Cajas |
| `demand/acta-uniformes` | GET | PDF | Acta Recepción Uniformes |
| `demand/acta-uniformes-word` | GET | Word | Acta Recepción Uniformes |
| `demand/acta-zapatos` | GET | PDF | Acta Recepción Zapatos |
| `demand/acta-zapatos-word` | GET | Word | Acta Recepción Zapatos |
| `demand/consolidado-excel` | GET | Excel | Consolidado por escuela |
| `demand/consolidado-excel-v2` | GET | Excel | Consolidado Prendas+Cajas |
| `demand/prendas-excel-v2` | GET | Excel | Prendas acumulado editable |
| `demand/cajas-excel` | GET | Excel | Cajas acumulado editable |

> Todos los endpoints demand bajo `/api/reports/demand/`.

#### Worker endpoints (requieren Bearer auth)

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `/api/worker/process-tasks` | POST | Reclamar y procesar tareas de región |
| `/api/worker/process-category-tasks` | POST | Reclamar y procesar tareas de categoría |
| `/api/worker/process-school-bundle-zip` | POST | Generar ZIPs de school bundle |

---

### Patrones y convenciones

- **Job/task orchestration** — tablas `report_jobs`, `report_tasks`, `report_category_tasks`, `zip_jobs` + estados (`queued|running|complete|failed|cancelled`)
- **Multi-discriminador en `zip_jobs`** — columna `job_kind` soporta 3 tipos (`region`, `category`, `school_bundle`) con CHECK constraints a nivel DB
- **RPC-first** — claims atómicos con `FOR UPDATE SKIP LOCKED`, RPCs para progreso y updates
- **Streaming** — PDFKit para PDFs, Archiver para ZIPs, `docx` para Word, ExcelJS para Excel
- **Concurrency controlada** — límites de paralelismo para evitar picos de memoria
- **Recuperación de tareas atascadas** — RPCs `requeue_stale_running_tasks()` y `requeue_stale_running_category_tasks()`
- **Protección de cancelación** — tareas canceladas no pueden ser actualizadas (previene race conditions)
- **Paginación PostgREST** — fetch en lotes de 1,000 filas con límite de seguridad de 200,000
- **Normalización de paths** — `toSafePathSegment()` convierte caracteres a ASCII-safe (é → e)
- **Vacíos (buffer de seguridad)** — 5% extra por tipo de prenda (`ceilToEven` para uniformes, `Math.ceil` para zapatos/cajas)
- **Códigos de referencia** — 3 códigos por escuela (`ref_kits`, `ref_uniformes`, `ref_zapatos`) mostrados en PDFs
- **Validación** — Zod (`src/lib/validation/*`) para env + auth de workers (Bearer / `x-worker-secret`)
- **Demand aggregation** — lógica compartida en `src/lib/reports/demand-aggregation.ts`

---

### Estructura del proyecto

```
src/
├── app/                              # Next.js App Router
│   ├── api/
│   │   ├── bulk/                     # Job management, downloads, Excel bulk
│   │   │   ├── jobs/                 # CRUD + ZIP/category/school-bundle endpoints
│   │   │   ├── batches/[batchId]/    # Batch details
│   │   │   └── tasks/[taskId]/       # Task download
│   │   ├── students/                 # Queries + ad-hoc PDFs (tallas, etiquetas)
│   │   ├── reports/                  # Ad-hoc reports
│   │   │   ├── cajas|camisas|…       # Agreement PDFs
│   │   │   ├── acta-recepcion-*/     # Actas de recepción
│   │   │   └── demand/              # 16 endpoints (PDF, Word, Excel)
│   │   ├── schools/search/           # Autocompletado
│   │   ├── grades/                   # Grados
│   │   ├── staging/                  # CSV upload (demand)
│   │   └── worker/                   # Worker endpoints (auth required)
│   ├── bulk/                         # UI: lista y detalle de bulk jobs
│   ├── consulta/                     # UI: consulta de estudiantes
│   ├── staging/                      # UI: upload CSVs
│   │   ├── page.tsx                  # Upload student-level CSV
│   │   └── demand/page.tsx           # Upload demand CSV
│   └── reports/demand/page.tsx       # UI: descarga de reportes demand
│
├── components/
│   ├── ui/                           # Primitivos: Button, Card, Input, Select,
│   │   │                             #   DatePicker, FlowStepper, UploadZone
│   ├── FiltersPanel.tsx              # Panel de filtros (escuela/grado/depto)
│   ├── Footer.tsx                    # Footer con datos de transporte
│   ├── JobProgress.tsx               # Barra de progreso de jobs
│   └── StudentsGrid.tsx              # Tabla de estudiantes (TanStack Table)
│
├── lib/
│   ├── config/env.ts                 # Validación de entorno
│   ├── pdf/
│   │   ├── generator.ts              # Tallas + Etiquetas
│   │   ├── generators-agreement.ts   # Cajas, Camisas, Pantalones, Zapatos
│   │   ├── generators-demand.ts      # Actas y comandas desde demand
│   │   ├── agreement/                # Fichas, consolidated builder, sections, types
│   │   ├── page-numbers.ts           # Utilidades de paginación
│   │   └── streams.ts               # Node ↔ Web stream converters
│   ├── word/
│   │   └── generators-demand.ts      # Actas y comandas Word desde demand
│   ├── excel/
│   │   ├── generators.ts             # Excel bulk (pivot, consolidado, prendas+cajas)
│   │   └── generators-demand.ts      # Excel demand (consolidado, prendas, cajas)
│   ├── reports/
│   │   ├── vacios.ts                 # Buffer 5% (ceilToEven, size restrictions)
│   │   ├── demand-aggregation.ts     # Lógica compartida de agregación demand
│   │   ├── editable-v2.ts            # Flat rows para reportes editables
│   │   └── job-school-codes.ts       # Códigos de escuela por job
│   ├── storage/keys.ts              # Storage path builders + normalización
│   ├── supabase/
│   │   ├── client.ts                 # Browser client
│   │   ├── server.ts                 # Server client
│   │   └── demand-queries.ts         # Queries para demand data
│   └── validation/                   # Zod schemas, helpers, error builders
│
└── types/database.ts                 # TypeScript types para DB schema

worker/
└── zip-worker/                       # Worker Node.js para ZIPs (ver worker/zip-worker/README.md)

supabase/
└── migrations/                       # 60 migrations (schema + RPCs)

tests/
├── unit/                             # Vitest unit tests
└── *.spec.ts                         # Playwright E2E tests
```

---

### Tech stack

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 14 (App Router) |
| Base de datos | Supabase (Postgres + Storage) |
| UI | React 18, Tailwind CSS, TanStack Table |
| PDFs | PDFKit |
| Word | docx |
| Excel | ExcelJS |
| ZIPs | Archiver |
| CSV parsing | csv-parse |
| Validación | Zod |
| Tests | Playwright (E2E), Vitest (unit) |

---

### Desarrollo local

```bash
npm install
npm run dev
```

ZIP worker local:

```bash
cd worker/zip-worker
npm install
npm run dev
```

Scripts disponibles:

| Script | Descripción |
| --- | --- |
| `dev` | Next.js dev server |
| `build` | Build de producción |
| `lint` / `lint:fix` | ESLint |
| `format` / `format:check` | Prettier |
| `type-check` | TypeScript (`tsc --noEmit`) |
| `test` | Playwright (todos) |
| `test:e2e` / `test:smoke` / `test:ui` | Playwright por categoría |

---

### Variables de entorno

#### Requeridas

| Variable | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Solo UI (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo server/worker (bypassa RLS) |
| `SUPABASE_FUNCTION_SECRET` o `CRON_SECRET` | Auth de endpoints `/api/worker/*` |

#### Workers (Next.js)

| Variable | Default | Descripción |
| --- | --- | --- |
| `WORKER_BATCH_SIZE` | 25 | Tareas por llamada RPC (1–100) |
| `WORKER_CONCURRENCY` | 3 | PDFs generados en paralelo (1–10) |
| `WORKER_MAX_RUNTIME` | 9000 | Tiempo máximo de ejecución en ms (1000–60000) |
| `WORKER_STALE_TASK_SECONDS` | 900 | Umbral para tareas atascadas (15 min) |
| `WORKER_STALE_TASK_LIMIT` | 5000 | Máximo de tareas a reencolar por ejecución |

#### ZIP Worker

| Variable | Default | Descripción |
| --- | --- | --- |
| `POLL_INTERVAL_MS` | 5000 | Frecuencia de polling |
| `DOWNLOAD_BATCH_SIZE` | 50 | PDFs descargados en paralelo |
| `COMPRESSION_LEVEL` | 6 | Nivel de compresión ZIP (0–9) |
