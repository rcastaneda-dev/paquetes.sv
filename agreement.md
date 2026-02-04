# PDF Generation Requirements
**Context:** Update existing PDF generation module to accommodate new reporting requirements and a specific storage hierarchy.

## Global Constraints & Styling
These rules apply to all 4 PDF reports:

1.  **Pagination logic:**
    * Group data by School (`codigo_ce`).
    * **Constraint:** A single page generally accommodates up to **5 distinct schools**.
    * **Action:** Insert a hard page break after the 5th school is rendered, or if the content overflows the page physically.
2.  **Table Styling:**
    * Table Headings must be **Uppercase** and **Bold**.
    * Borders should be clear and consistent.
3.  **Summaries:**
    * At the end of each school's section (group), include a **School Summary** row (e.g., Subtotal for that specific school).

---

## Report Specifications

### PDF 1: Box Distribution (Cajas)
**Folder Category:** `estudiantes`
**Goal:** Calculate the number of boxes required per school, broken down by grade and sex.
**Title Format:** `DETALLE DE PROGRAMACIÓN DE CAJAS PARA FECHA [DD-MM-YYYY]`
**Grouping:** By `codigo_ce`, then by `grado_ok`.

**Columns:**
1.  **No** (Row index)
2.  **Departamento**
3.  **Distrito**
4.  **Codigo_ce**
5.  **Nombre_ce**
6.  **Grado_ok**
7.  **Número de Cajas Hombres** (Count of students where sex = 'Hombre')
8.  **Número de Cajas Mujeres** (Count of students where sex = 'Mujer')
9.  **Cajas Totales** (Sum of Col 7 + Col 8)

---

### PDF 2: Shirts Distribution (Camisas)
**Folder Category:** `camisa`
**Goal:** Inventory required for shirts, grouped by shirt type.
**Title Format:** `DETALLE DE PROGRAMACIÓN DE CAMISAS PARA FECHA [DD-MM-YYYY]`
**Grouping:** By `codigo_ce`, then by `tipo_camisa` (e.g., Diario vs. Deportivo).

**Columns:**
1.  **No**
2.  **Departamento**
3.  **Distrito**
4.  **Codigo_ce**
5.  **Nombre_ce**
6.  **Tipo de Camisa**
7.  **Sizes (Dynamic Columns):** T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
    * *Logic:* Count items per size from DB.
8.  **Total** (Sum of all sizes for this row)

---

### PDF 3: Bottoms Distribution (Pantalón/Falda/Short)
**Folder Category:** `prenda_inferior`
**Goal:** Inventory required for bottoms (pants, skirts, shorts).
**Title Format:** `DETALLE DE PROGRAMACIÓN DE PANTALÓN/FALDA/SHORT PARA FECHA [DD-MM-YYYY]`
**Grouping:** By `codigo_ce`, then by `tipo_prenda` (Pantalón, Falda, or Short).

**Database Fields:**
* **Tipo de Prenda:** Sourced from `t_pantalon_falda_short` field (contains: Pantalón, Falda, or Short)
* **Sizes:** Sourced from `pantalon_falda` field (contains size values: T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X)

**Columns:**
1.  **No**
2.  **Departamento**
3.  **Distrito**
4.  **Codigo_ce**
5.  **Nombre_ce**
6.  **Tipo de Prenda** (Distinct values from `t_pantalon_falda_short`: Pantalón, Falda, or Short)
7.  **Sizes (Dynamic Columns):** T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
    * *Logic:* Count students per size from `pantalon_falda` field, grouped by tipo_prenda.
8.  **Total** (Sum of all sizes for this row)

---

### PDF 4: Shoes Distribution (Zapatos)
**Folder Category:** `zapatos`
**Goal:** Inventory required for shoes.
**Title Format:** `DETALLE DE PROGRAMACIÓN DE ZAPATOS PARA FECHA [DD-MM-YYYY]`
**Grouping:** By `codigo_ce`, then by `sexo`.

**Columns:**
1.  **No**
2.  **Departamento**
3.  **Distrito**
4.  **Codigo_ce**
5.  **Nombre_ce**
6.  **Sexo**
7.  **Sizes (Dynamic Columns):** 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45
    * *Logic:* Count items per size from DB.
8.  **Total** (Sum of all sizes for this row)

---

## Storage & Output Structure

The application must upload or save the generated PDFs using the following bucket directory hierarchy:

**Root Structure:**
`{job_id}/{fecha_inicio}/{category_folder}/`

**Path Definitions:**
1.  **{job_id}**: The unique identifier for the current processing job.
2.  **{fecha_inicio}**: The start date of the process (Format: YYYY-MM-DD or as provided in input).
3.  **{category_folder}**: The specific sub-folder for the PDF type.

**Category Mapping:**
* **PDF 1** (Cajas) &rarr; save into folder: `/estudiantes`
* **PDF 2** (Camisas) &rarr; save into folder: `/camisa`
* **PDF 3** (Pantalón/Falda) &rarr; save into folder: `/prenda_inferior`
* **PDF 4** (Zapatos) &rarr; save into folder: `/zapatos`

**Example Path:**
`12345/2023-10-25/zapatos/detalle_zapatos.pdf`
