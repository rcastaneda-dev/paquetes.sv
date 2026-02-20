# E2E Automation Roadmap

> Priority spec files to automate, ordered by business impact.
> Reference: [TEST_CASES.md](./TEST_CASES.md) for full test case details.

---

## Status

- [ ] **Spec 1** -- Student Search Flow
- [ ] **Spec 2** -- Ad-Hoc PDF Report Generation
- [ ] **Spec 3** -- CSV Upload & Data Migration
- [ ] **Spec 4** -- Bulk Job Lifecycle (Create -> ZIP -> Download)
- [ ] **Spec 5** -- Worker Auth & Task Processing
- [ ] **Spec 6** -- Normalized Demand Pipeline (Upload -> Reports)
- [ ] **Spec 7** -- Bulk Job Excel & Consolidated Reports
- [ ] **Spec 8** -- Regional & Category ZIP Lifecycle

---

## Spec 1 -- Student Search Flow

**Categories**: 1 (Student Search) + 2 (Students Grid) + 3 (Pagination)

**What it covers**: The primary user entry point. Search school via autocomplete -> select -> grades load -> fetch students -> verify grid -> paginate.

**Key test cases**: HP-S01, HP-S04, HP-S05, HP-S07, HP-S08, HP-G01, HP-G03, HP-P01, HP-P02

**Existing coverage**: `buscar-students.spec.ts` already covers the basics. Extend with edge cases (no results, search replacement, pagination reset).

---

## Spec 2 -- Ad-Hoc PDF Report Generation

**Category**: 4 (Ad-Hoc PDF Reports)

**What it covers**: The core deliverable. After searching students, generate each report type (Cajas, Camisas, Pantalones, Zapatos, Acta de Recepcion Zapatos, Acta de Recepcion Uniformes, Tallas, Etiquetas) and validate the PDF response.

**Key test cases**: HP-R01 through HP-R10, API-RC01, API-RCM01, API-RP01, API-RZ01, API-AR01, API-ARU01

**Approach**: UI click -> intercept network response -> assert `content-type: application/pdf` and non-empty body. Optionally parse PDF content for key fields.

---

## Spec 3 -- CSV Upload & Data Migration

**Category**: 5 (Staging Page) + 18 (API - Staging)

**What it covers**: The only data ingestion path for student data. Upload CSV -> chunked insert into `staging_cajas_raw` (500-row batches) -> migrate to main tables (schools, students, uniform_sizes).

**Key test cases**: ST-01 through ST-10, API-ST01 through API-ST10

**Approach**: Full UI flow on `/staging` page (file select -> upload -> verify success counts). Separate API-level tests for truncate/insert/migrate actions and validation errors. Test both insert forms: CSV text (`csvChunk` + `header`) and pre-parsed rows (`rows`).

---

## Spec 4 -- Bulk Job Lifecycle

**Categories**: 6 (Bulk Page) + 7 (Job Detail) + 19 (Bulk Jobs CRUD) + 21 (Bulk Job Lifecycle) + 22 (Downloads)

**What it covers**: The high-volume production workflow. Create category job (with `fecha_inicio`) -> verify tasks generated (6 categories per school) -> monitor progress -> download PDFs -> download Excel reports -> download school bundle ZIP.

**Key test cases**: BK-01 through BK-08, BD-01 through BD-12, API-BJ01 through API-BJ11, API-BC01 through API-BC04, API-BL01 through API-BL06, API-BD01 through API-BD03

**Approach**:
1. UI flow on `/bulk` (create category job -> navigate to detail -> verify task list and progress bar).
2. API-level tests for CRUD operations. Note: `DELETE /api/bulk/jobs?scope=past` requires the `scope` query param.
3. Job detail page verifies all download sections: consolidated PDFs, Excel reports, school bundle ZIP.

---

## Spec 5 -- Worker Auth & Task Processing

**Categories**: 23 (Worker Endpoints) + 36 (Worker Health Checks)

**What it covers**: The engine behind bulk jobs. Worker authentication (Bearer + x-worker-secret), task claiming (atomic, no double processing), PDF generation, stale task recovery, health check endpoints.

**Key test cases**: API-WK01 through API-WK12, API-WH01 through API-WH03

**Approach**: API-only tests.
1. **Auth**: Validate 401 for missing/invalid auth. Test both `Authorization: Bearer` and `x-worker-secret` header auth.
2. **Task processing**: With valid auth, verify tasks transition from pending -> running -> complete. Test all 6 category types: estudiantes, camisa, prenda_inferior, zapatos, ficha_uniformes, ficha_zapatos.
3. **School bundle ZIP**: Test `process-school-bundle-zip` with body `{ zipJobId, reportJobId }`. Validate missing body returns 400.
4. **Stale recovery**: Simulate stuck tasks > 15 min, verify requeue.
5. **Health checks**: GET on each of 3 worker endpoints returns 200 with status message.
6. **Config**: Test WORKER_BATCH_SIZE and WORKER_MAX_RUNTIME constraints.

---

## Spec 6 -- Normalized Demand Pipeline

**Categories**: 26 (Demand Staging Page) + 27 (API - Demand Staging) + 28-30 (Demand Reports) + 31 (Download Page) + 37-38 (Demand Comanda Reports)

**What it covers**: The parallel data ingestion path for pre-computed demand data. Upload a 9-column normalized CSV (ITEM/TIPO/CATEGORIA/CANTIDAD) -> staging -> migration -> generate PDF/Word/Excel reports and comanda documents. Unlike the student-level pipeline, quantities pass through as-is with no vacios calculations. Comanda documents use the comanda layout (no transport footer, no COMENTARIOS column) while Acta documents use the acta layout (with signatures and observation columns).

**Key test cases**: DS-01 through DS-08, API-DS01 through API-DS07, API-DC01 through API-DC08, API-DW01 through API-DW05, API-DE01 through API-DE05, DR-01 through DR-16, API-CC01 through API-CC08, API-CW01 through API-CW05

**Approach**:
1. **Staging API tests** (API-only): Test truncate/insert/migrate actions against `/api/staging/demand`. Validate column requirements (CODIGO, ITEM, TIPO, CATEGORIA, CANTIDAD). Verify quantities pass through without modification.
2. **Report generation tests** (API-only): Hit all 13 report endpoints — 6 acta endpoints (`acta-cajas`, `acta-uniformes`, `acta-zapatos` for PDF/Word), 6 comanda endpoints (`comanda-cajas`, `comanda-uniformes`, `comanda-zapatos` for PDF/Word), and `consolidado-excel`. Assert correct content-type headers and non-empty response bodies. Test with and without `school_codigo_ce` filter. Verify comanda PDFs use comanda layout (ZONA/TRANSPORTE in header, no transport footer) and acta PDFs use acta layout (COMENTARIOS column, signature fields).
3. **UI flow tests** (E2E): Full upload flow on `/staging/demand` (file select -> upload -> verify success). Download flow on `/reports/demand` (click each of 13 buttons -> verify file downloads). Navigation between student-level and demand staging pages.

**Key difference from Spec 3**: Demand pipeline uses a simpler 9-column CSV (vs 21 columns), targets different tables (`staging_demand_raw` -> `school_demand` instead of `staging_cajas_raw` -> `schools`/`students`/`uniform_sizes`), and produces reports without vacios buffer calculations.

---

## Spec 7 -- Bulk Job Excel & Consolidated Reports

**Categories**: 32 (Bulk Job Excel Reports) + 33 (Consolidated PDF Streaming)

**What it covers**: The 4 Excel endpoints and 5 consolidated PDF streaming endpoints available on category jobs. These are the primary output artifacts used for distribution planning.

**Key test cases**: API-EX01 through API-EX14, API-CP01 through API-CP08

**Approach**: API-only tests. All require a completed category job (with `fecha_inicio` in job_params).

1. **Excel endpoints** (4 total):
   - `consolidado-excel` -- Schools x totals (uniformes, zapatos, cajas)
   - `consolidado-pivot-excel` -- Uniformes pivot with size columns T4-T2X
   - `consolidado-pivot-excel-v2` -- Flat rows (CORRELATIVO, CODIGO_CE, NOMBRE_CE, TIPO_PRENDA, TALLA, CANTIDAD)
   - `zapatos-pivot-excel` -- Zapatos pivot with shoe size columns 23-45
   - Validate: Content-Type is xlsx, Content-Disposition has correct filename, Cache-Control: no-store, response is non-empty. Parse .xlsx with ExcelJS: verify header row, column count, sort order.

2. **Consolidated PDF streaming** (5 types):
   - `cajas`, `ficha_uniformes`, `ficha_zapatos`, `acta_recepcion_zapatos`, `acta_recepcion_uniformes`
   - Validate: Content-Type is pdf, Content-Disposition has correct filename, non-empty body.
   - Test validation: missing type (400), invalid type (400), non-category job (400).

**Prerequisite**: Create a category job and wait for completion, or use a known completed job ID from a test fixture.

---

## Spec 8 -- Regional & Category ZIP Lifecycle

**Categories**: 34 (Regional & Category ZIP Lifecycle) + 35 (Batch Progress)

**What it covers**: The full ZIP creation/polling/download lifecycle for all 3 ZIP types (regional, category, school bundle). Also covers batch progress for sharded jobs.

**Key test cases**: API-ZP01 through API-ZP12, API-BP01 through API-BP03

**Approach**: API-only tests.

1. **Regional ZIP** (4 valid regions: `oriental`, `occidental`, `paracentral`, `central`):
   - Create ZIP job via `POST .../create-zip-job?region=X`
   - Poll status via `GET .../zip-job-status?zipJobId=X`
   - Test: missing region (400), invalid region (400), idempotent creation
2. **Category ZIP** (6 valid categories: `estudiantes`, `camisa`, `prenda_inferior`, `zapatos`, `ficha_uniformes`, `ficha_zapatos`):
   - Create via `POST .../create-category-zip-job?category=X`
   - Poll via `GET .../category-zip-status`
   - Test: non-category job (400)
3. **School bundle ZIP**:
   - Create via `POST .../create-school-bundle-zip-job`
   - Poll via `GET .../school-bundle-zip-status?zipJobId=X`
   - Test: non-category job (400)
4. **Batch progress**:
   - `GET /api/bulk/batches/[batchId]` -- verify `{ batch, jobs[], progress }` shape
   - Test: non-existent batch (404)

---

## Phase 2 -- Visual PDF Testing (Playwright Snapshots)

> **Not part of initial automation sprint.** Complete Specs 1-8 first, then evaluate.

Before investing in visual PDF testing:
1. Complete all 8 specs above (functional coverage)
2. Have at least 50+ API tests running green in CI
3. Evaluate: is there an actual regression signal from PDF layout changes?

If yes, start with **Approach B** (pdf-to-img) for the 2 most complex reports:
- **Cajas** (dynamic row heights, grade/gender matrix)
- **Uniformes pivot** (multi-type, multi-size table)

Skip the remaining VIS items until those 2 prove the ROI.

### How it works

1. Use a library like `pdf-to-img` or `pdf2pic` to convert each PDF page to PNG
2. `expect(Buffer.from(pngData)).toMatchSnapshot('cajas-page1.png')` with a pixel threshold (~0.5%)
3. Compare page-by-page (important for multi-page reports like Cajas with dynamic row heights)

### What it catches that functional tests can't

| Risk                                             | Current coverage | Visual testing adds                     |
| ------------------------------------------------ | ---------------- | --------------------------------------- |
| Table columns misaligned                         | None             | Pixel-level layout validation           |
| Dynamic row height regression (Cajas)            | None             | Catches when calculateRowHeight breaks  |
| GOES logo missing or misplaced                   | None             | Visible immediately in diff             |
| Buffer (vacios) rows rendering wrong             | None             | Row count and spacing validated visually |
| Diacritics garbled in PDF text                   | None             | Character rendering verified            |
| Page overflow / content cut off                  | None             | Full-page comparison catches overflow   |
| Signature/time fields ("HORA DE INICIO") missing | None             | Layout completeness validated           |

### Candidate visual test items (prioritize top 2 first)

- [ ] **VIS-01** -- Set up PDF-to-image conversion pipeline (`pdf-to-img` or `pdf2pic`)
- [ ] **VIS-02** -- Cajas report baseline (dynamic row height, grade/gender table layout)
- [ ] **VIS-03** -- Uniformes pivot baseline (multi-type, multi-size table)
- [ ] **VIS-04** -- Camisas report baseline (shirt type columns T4-2XG)
- [ ] **VIS-05** -- Pantalones report baseline (type/size layout, gender split)
- [ ] **VIS-06** -- Zapatos report baseline (shoe sizes 23-45, 5% buffer, no gap-filling)
- [ ] **VIS-07** -- Acta de Recepcion baseline (delivery receipt, signature fields)
- [ ] **VIS-08** -- Tallas student table baseline (10-column table format)
- [ ] **VIS-09** -- Etiquetas labels baseline (label grid with NIE, school code, name)
- [ ] **VIS-10** -- GOES logo presence and placement check

---

## Deprioritized (not blocked, just lower ROI)

| Category                        | Reason                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| Cross-browser (removed)         | Chromium-only covers 90%+ of value; 3-browser support is a CI config toggle, not a separate test category |
| Accessibility (removed)         | Compliance concern, not operational impact                    |
| Performance (trimmed to 3)      | 3 meaningful API timing tests kept; formal load testing with k6/Artillery is recommended once bulk jobs process >500 schools/run |
| Visual PDF Testing (Phase 2)    | Requires functional coverage first; start with 2 reports      |
| Debug random endpoint           | Internal-only; test only in smoke suite if needed             |
