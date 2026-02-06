# PDF Generation Requirements

**Context:** Update the PDF generation module to generate 5 distinct reports with strict pagination and specific S3 storage paths.

## 1. Global Constraints & Styling

**These rules apply to ALL PDF reports:**

### Pagination Logic (STRICT)

- **Rule:** **ONE School per Page.**
- **Implementation:**
  1.  Iterate through unique schools (`codigo_ce`).
  2.  Render the School Header and Data Table.
  3.  **Mandatory Action:** Trigger a **Hard Page Break** immediately after the school's summary row/footer.
  4.  _Note:_ Never group multiple schools on the same page. Even if the table is 2 rows long, the next school starts on a new page.

### Typography & Layout

- **Font Family:** Helvetica (or Arial equivalent).
- **Table Headings:** Uppercase, Bold, Clear Borders.
- **School Header Block:** Standardized layout (see below) placed immediately after the Subtitle.
- **Summaries:** Every school table must end with a **Subtotal/Total** row.

---

## 2. Report Specifications

### PDF 1: Box Distribution (Cajas)

- **Folder Category:** `estudiantes`
- **Title:** `DETALLE DE PROGRAMACIÓN DE CAJAS`
- **Subtitle:** `FECHA: [DD-MM-YYYY]`
- **Grouping:** By `codigo_ce`, then by `grado_ok`.

**Data Logic (Uplift Calculation):**

- **Formula:** `boxes = ceil(student_count * 1.15)`
- **Scope:** Apply 15% uplift and rounding to **Col 7**, **Col 8**, **Col 9**, and **Row Subtotals**.

**Header Layout (Per School):**
_Font: Helvetica 12pt_

> Line 1: `NOMBRE_CE: {name} (CODIGO: {code})`
> Line 2: `DEPARTAMENTO: {depto}  DISTRITO: {dist}`

**Table Columns:**

1.  **No** (Index)
2.  **Departamento**
3.  **Distrito**
4.  **Codigo_ce**
5.  **Nombre_ce**
6.  **Grado_ok**
7.  **Número de Cajas Hombres** (Count `Hombre` \* 1.15, rounded up)
8.  **Número de Cajas Mujeres** (Count `Mujer` \* 1.15, rounded up)
9.  **Cajas Totales** (Sum of Col 7 + Col 8)

---

### PDF 2: Shirts Distribution (Camisas)

- **Folder Category:** `camisa`
- **Title:** `DETALLE DE PROGRAMACIÓN DE CAMISAS`
- **Subtitle:** `FECHA: [DD-MM-YYYY]`
- **Grouping:** By `codigo_ce`, then by `tipo_camisa` (e.g., Diario, Deportivo).

**Header Layout (Per School):**
_Font: Helvetica 12pt_

> Line 1: `NOMBRE_CE: {name} (CODIGO: {code})`
> Line 2: `DEPARTAMENTO: {depto}  DISTRITO: {dist}`

**Table Columns:**

1.  **Tipo de Camisa**
2.  **Sizes (Dynamic):** T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
3.  **Total** (Row Sum)

**Typography:** Table Header: 11pt (Bold) | Body: 9pt

---

### PDF 3: Bottoms Distribution (Pantalón/Falda/Short)

- **Folder Category:** `prenda_inferior`
- **Title:** `DETALLE DE PROGRAMACIÓN DE PANTALÓN/FALDA/SHORT`
- **Subtitle:** `FECHA: [DD-MM-YYYY]`
- **Grouping:** By `codigo_ce`, then by `tipo_prenda`.

**Header Layout (Per School):**
_Font: Helvetica 12pt_

> Line 1: `{name} (CODIGO: {code})`
> Line 2: `DEPARTAMENTO: {depto}  DISTRITO: {dist}`

**Data Source:**

- `tipo_prenda`: from `t_pantalon_falda_short` (Pantalón, Falda, Short)
- `size`: from `pantalon_falda`

**Table Columns:**

1.  **Tipo de Prenda**
2.  **Sizes (Dynamic):** T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
3.  **Total** (Row Sum)

**Typography:** Table Header: 11pt (Bold) | Body: 9pt

---

### PDF 4: Shoes Distribution (Zapatos)

- **Folder Category:** `zapatos`
- **Title:** `DETALLE DE PROGRAMACIÓN DE ZAPATOS`
- **Subtitle:** `FECHA: [DD-MM-YYYY]`
- **Grouping:** By `codigo_ce`, then by `sexo`.

**Header Layout (Per School):**
_Font: Helvetica 12pt_

> Line 1: `{name} (CODIGO: {code})`
> Line 2: `DEPARTAMENTO: {depto}  DISTRITO: {dist}`

**Table Columns:**

1.  **Sexo**
2.  **Sizes (Dynamic):** 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45
3.  **Total** (Row Sum)

**Typography:** Table Header: 10pt (Bold) | Body: 8pt

---

### PDF 5: School Distribution Card (Ficha de uniformes)

- **Folder Category:** `distribucion_por_escuela`
- **Title:** `FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)`
- **Subtitle:**
  - Line 1: `{nombre_ce} [CODIGO: {codigo_ce}]`
  - Line 2: `DEPARTAMENTO: {schools.departamento} - DISTRITO: {schools.distrito}`
  - Line 3: `ZONA: {schools.zona}`
- **Grouping:** Single list per `codigo_ce`.
- **Filter:** Only include rows where `Count > 0`.

**Header Layout:**
_Font: Helvetica 12pt_

> Line 1: `Detalle por tipo y talla (solo cantidades > 0)`

**Data Logic (Aggregation):**
This report consolidates data from Shirts and Bottoms into a single vertical list.

1.  **Source 1:** Camisas (`tipo_camisa` + `camisa_size`)
    1.1. **Sort by:** alphabetic by tipo_camisa
    1.2. **Style:** Capitalized
2.  **Source 2:** Pantalones/Faldas (`t_pantalon_falda_short` + `pantalon_falda_size`)
    2.1. **Sort by:** alphabetic by t_pantalon_falda_short
    2.2. **Style:** Capitalized

**Table Columns:**

1.  **TIPO/TALLA** (String Concatenation)
    - _Example format:_ "CAMISA CELESTE - T12" or "FALDA CON TIRANTES - T14"
2.  **CANTIDAD** (Integer Count)

**Footer:**

- **TOTAL PIEZAS:** (Sum of Quantity Column)

---

### PDF 6: School Distribution Card (Ficha de zapatos)

- **Folder Category:** `distribucion_por_escuela`
- **Title:** `FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)`
- **Subtitle:**
  - Line 1: `{nombre_ce} [CODIGO: {codigo_ce}]`
  - Line 2: `DEPARTAMENTO: {schools.departamento} - DISTRITO: {schools.distrito}`
  - Line 3: `ZONA: {schools.zona}`
- **Grouping:** Single list per `codigo_ce`.
- **Filter:** Only include rows where `Count > 0`.

**Header Layout:**
_Font: Helvetica 12pt_

> Line 1: `Detalle por tipo y talla (solo cantidades > 0)`

**Data Logic (Aggregation):**
This report consolidates data from Shoes into a single vertical list.

1.  **Source 1:** Zapatos (`sexo` + `zapato_size`)
    1.1. **Sort by:** alphabetic by sexo
    1.2. **Style:** Capitalized

**Table Columns:**

1.  **TIPO/TALLA** (String Concatenation)
    - _Example format:_ "HOMBRE - 38"
2.  **CANTIDAD** (Integer Count)

**Footer:**

- **TOTAL PIEZAS:** (Sum of Quantity Column)

---

### PDF 7: Day Distribution Card (Ficha de zapatos)

- **Folder Category:** `distribucion_por_dia`
- **Title:** `FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)`
- **Subtitle:**
  - Line 1: `{nombre_ce}`
  - Line 2: `CODIGO: {codigo_ce}`
  - Line 3: `FECHA: {schools.fecha_inicio}`
- **Grouping:** combined grouping by: `type and size`.
- **Filter:** Only include rows where `Count > 0`.

**Header Layout:**
_Font: Helvetica 12pt_

> Line 1: `Detalle por tipo y talla (solo cantidades > 0)`

**Data Logic (Aggregation):**
This report consolidates data from Shoes for a given day based considering all schools on schools.fecha_inicio into a single vertical list.

1.  **Source 1:** Zapatos (`sexo` + `zapato_size`)
    1.1. **Sort by:** alphabetic by sexo
    1.2. **Style:** Capitalized

**Table Columns:**

1.  **TIPO/TALLA** (String Concatenation)
    - _Example format:_ "HOMBRE - 38"
2.  **CANTIDAD** (Integer Count)

**Footer:**

- **TOTAL PIEZAS:** (Sum of Quantity Column)

---

### PDF 8: Day Distribution Card (Ficha de uniformes)

- **Folder Category:** `distribucion_por_dia`
- **Title:** `FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)`
- **Subtitle:**
  - Line 1: `{nombre_ce}`
  - Line 2: `CODIGO: {codigo_ce}`
  - Line 3: `FECHA: {schools.fecha_inicio}`
- **Grouping:** combined grouping by: `type and size`.
- **Filter:** Only include rows where `Count > 0`.

**Header Layout:**
_Font: Helvetica 12pt_

> Line 1: `Detalle por tipo y talla (solo cantidades > 0)`

**Data Logic (Aggregation):**
This report consolidates data from Shirts and Bottoms for a given day considering all schools based on schools.fecha_inicio into a single vertical list.

1.  **Source 1:** Zapatos (`sexo` + `zapato_size`)
    1.1. **Sort by:** alphabetic by sexo
    1.2. **Style:** Capitalized

**Table Columns:**

1.  **TIPO/TALLA** (String Concatenation)
    - _Example format:_ "CAMISA CELESTE - T10"
2.  **CANTIDAD** (Integer Count)

**Footer:**

- **TOTAL PIEZAS:** (Sum of Quantity Column)

---

Implementation Note for AI:
When generating the "TIPO/TALLA" string, ensure a clean hyphen separator: TYPE + " - " + SIZE. For PDF 7 and 8, ensure the aggregation logic correctly sums quantities across different codigo_ce values that share the same date.

## 3. Storage & Output Structure

Save generated PDFs to S3/Storage using this hierarchy:

**Pattern:**
`{job_id}/{fecha_inicio}/{category_folder}/{filename}.pdf`

**Variables:**

1.  `{job_id}`: Unique process ID.
2.  `{fecha_inicio}`: Process start date (YYYY-MM-DD).
3.  `{category_folder}`:
    - PDF 1: `/estudiantes`
    - PDF 2: `/camisa`
    - PDF 3: `/prenda_inferior`
    - PDF 4: `/zapatos`
    - PDF 5: `/distribucion_por_escuela`

1 carpeta por dia
todos los pdfs de los centros escolares
1 consolidado solo de uniformes de todos los centros
1 consolidad solo de zapatos de todos los centros

2 pdfs mas 1 es consolidado de uniformes por centro, 1 consolidad de zapatos por centro
2 pdfs consolidando todos los uniformes en un dia y todos los zapatos en un dia
