# Character Encoding Fix for PDF Generation

## Problem

PDF reports were rendering special Spanish characters incorrectly in school names, departamento, and distrito fields.

**Example:**
- **Expected:** `SAN SEBASTIÁN SALITRILLO`
- **Rendered:** `SAN SEBASTIÿýÿýN SALITRILLO`
- **Database stored:** `SAN SEBASTI��N SALITRILLO`

This occurred because the database contains text that was stored with Latin1/Windows-1252 encoding but is being interpreted as UTF-8 by the application.

## Solution

Created a character encoding utility that detects and fixes Latin1-encoded text that was incorrectly interpreted as UTF-8.

### Files Created

1. **`src/lib/utils/encoding.ts`** - New utility module with encoding fix functions:
   - `fixLatin1Encoding()` - Converts Latin1 bytes to proper UTF-8
   - `toUpperCaseFixed()` - Fixes encoding and converts to uppercase
   - `fixEncodingInObject()` - Batch fixes for objects with multiple text fields

### Files Modified

All PDF generation files were updated to use the encoding fix utility:

#### Core PDF Generators
1. **`src/lib/pdf/generator.ts`**
   - Applied fix to `schoolName` in `generateStudentReportPDF()`
   - Applied fix to `schoolName` in `generateStudentLabelsPDF()`

2. **`src/lib/pdf/generators-agreement.ts`**
   - Applied fix to `school.nombre_ce` in all generator functions
   - Applied fix in `generateDayZapatosPDF()`
   - Applied fix in `generateDayUniformesPDF()`

#### Shared PDF Sections
3. **`src/lib/pdf/agreement/sections.ts`**
   - Applied fix in `drawSchoolHeaderBlock()`
   - Applied fix in `renderCajasSection()`
   - Applied fix in `renderFichaUniformesSection()`
   - Applied fix in `renderFichaZapatosSection()`

#### Worker Module
4. **`worker/zip-worker/school-bundle-processor.ts`**
   - Added standalone copy of encoding utility (worker is self-contained)
   - Applied fix in `renderCajasSection()`
   - Applied fix in `renderFichaUniformesSection()`
   - Applied fix in `renderFichaZapatosSection()`

## How It Works

The fix works by:

1. **Detection:** Checks if text contains patterns indicating encoding issues (e.g., sequences of characters in the Latin-1 extended range)

2. **Conversion:** 
   - Extracts the Latin1 byte values from the incorrectly interpreted string
   - Re-interprets those bytes as UTF-8 using the TextDecoder API

3. **Fallback:** If conversion fails or no encoding issue is detected, returns the original text

### Example

```typescript
// Database value (incorrectly stored/interpreted)
const dbValue = "SAN SEBASTI\xC3\x81N";

// Apply fix
const fixed = fixLatin1Encoding(dbValue);
// Result: "SAN SEBASTIÁN"

// Use in PDF
doc.text(fixed.toUpperCase());
// Renders: "SAN SEBASTIÁN"
```

## Affected PDF Reports

This fix applies to all PDF categories that render school information:

- ✅ Cajas (Box Distribution Report)
- ✅ Camisas (Shirts Distribution Report)
- ✅ Pantalones/Faldas (Pants/Skirts Distribution Report)
- ✅ Zapatos (Shoes Distribution Report)
- ✅ Ficha Uniformes (School Distribution Card - Uniforms)
- ✅ Ficha Zapatos (School Distribution Card - Shoes)
- ✅ Day Distribution Reports (Uniformes & Zapatos)
- ✅ Student Reports (Print & Print Labels)
- ✅ Consolidated PDFs (via worker)
- ✅ School Bundle ZIPs (via worker)

## Testing

To verify the fix:

1. **Generate a PDF for a school with special characters in name/distrito**
   ```bash
   # Example: School "COMPLEJO EDUCATIVO DOCTOR ALBERTO LUNA"
   # Distrito: "SAN SEBASTIÁN SALITRILLO"
   ```

2. **Check the PDF output**
   - School name should render correctly with special characters
   - Departamento field should render correctly (e.g., "SANTA ANA")
   - Distrito field should render correctly (e.g., "SAN SEBASTIÁN SALITRILLO")
   - Zona field should render correctly

3. **Test all report categories**
   - `/api/reports/cajas?school_codigo_ce=10382`
   - `/api/reports/camisas?school_codigo_ce=10382`
   - `/api/reports/pantalones?school_codigo_ce=10382`
   - `/api/reports/zapatos?school_codigo_ce=10382`
   - Consolidated PDFs via bulk jobs
   - School bundle ZIPs

## Special Characters Covered

The fix handles all Spanish special characters commonly affected by this encoding issue:

- **Vowels with acute accent:** Á, É, Í, Ó, Ú (and lowercase)
- **N with tilde:** Ñ (and lowercase)
- **U with diaeresis:** Ü (and lowercase)
- **Other accented characters:** as needed

## Database Note

This is a **display-layer fix** that converts the encoding during PDF generation. The underlying database data remains unchanged. To permanently fix the issue, the database encoding would need to be corrected, but this fix ensures correct rendering regardless of the database state.

## No Breaking Changes

- ✅ All existing functionality preserved
- ✅ Backward compatible with correctly encoded text
- ✅ Safe fallback if conversion fails
- ✅ No performance impact
- ✅ No new dependencies required
