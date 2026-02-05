/**
 * PDF generators for the 4 agreement reports (Cajas, Camisas, Pantalones, Zapatos)
 * These reports group by school (codigo_ce) with pagination every 5 schools.
 */
import PDFDocument from 'pdfkit';
import type { StudentQueryRow } from '@/types/database';
import fs from 'fs';
import path from 'path';

export type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

interface AgreementReportOptions {
  fechaInicio: string; // YYYY-MM-DD format
  students: StudentQueryRow[];
}

/**
 * Helper: Add GOES logo to the top-right corner of the current page
 * Preserves the current Y position so it doesn't affect document flow
 */
function addLogoToPage(doc: PDFDocumentInstance, pageWidth: number) {
  const logoPath = path.join(process.cwd(), 'public', 'goes_logo.png');

  // Check if logo exists
  if (fs.existsSync(logoPath)) {
    // Save current Y position to restore after adding logo
    const savedY = doc.y;

    const logoWidth = 50;
    const logoHeight = 50;
    const rightMargin = 40;
    const topMargin = 20;
    const logoX = pageWidth - logoWidth - rightMargin;
    const logoY = topMargin;

    doc.image(logoPath, logoX, logoY, {
      width: logoWidth,
      height: logoHeight,
      fit: [logoWidth, logoHeight],
      align: 'center',
      valign: 'center',
    });

    // Restore Y position so logo doesn't affect subsequent content
    doc.y = savedY;
  }
}

/**
 * Helper: Format date from YYYY-MM-DD to DD-MM-YYYY for titles
 */
function formatDateForTitle(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

/**
 * Helper: Group students by school (codigo_ce)
 */
interface SchoolGroup {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  students: StudentQueryRow[];
}

function groupBySchool(students: StudentQueryRow[]): SchoolGroup[] {
  const schoolMap = new Map<string, SchoolGroup>();

  for (const student of students) {
    const key = student.school_codigo_ce;
    if (!schoolMap.has(key)) {
      schoolMap.set(key, {
        codigo_ce: student.school_codigo_ce,
        nombre_ce: student.nombre_ce,
        departamento: student.departamento,
        distrito: student.distrito,
        students: [],
      });
    }
    schoolMap.get(key)!.students.push(student);
  }

  return Array.from(schoolMap.values()).sort((a, b) => a.codigo_ce.localeCompare(b.codigo_ce));
}

/**
 * Helper: Draw a per-school header block with DEPTO, DIST, COD, NOMBRE_CE as plain text
 * Format:
 *   Line 1: NOMBRE_CE: xxxxxx (CODIGO: XXXX)
 *   Line 2: DEPARTAMENTO: xxxxxx  DISTRITO: xxxxxx
 * Labels are bold, values are capitalized but not bold
 * Returns the new Y position after the block
 */
interface SchoolHeaderBlockOptions {
  doc: PDFDocumentInstance;
  xStart: number;
  yStart: number;
  availableWidth: number;
  school: SchoolGroup;
  fontSize: number;
}

function drawSchoolHeaderBlock(options: SchoolHeaderBlockOptions): number {
  const { doc, xStart, yStart, school, fontSize } = options;

  let currentY = yStart;

  // Line 1: NOMBRE_CE: [school name] (CODIGO: [school code])
  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text('NOMBRE_CE: ', xStart, currentY, { continued: true });

  doc.font('Helvetica').fontSize(fontSize);
  const schoolName = school.nombre_ce.toUpperCase();
  doc.text(schoolName, { continued: true });

  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text(' (CODIGO: ', { continued: true });

  doc.font('Helvetica').fontSize(fontSize);
  const schoolCode = school.codigo_ce.toUpperCase();
  doc.text(schoolCode, { continued: true });

  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text(')');

  currentY = doc.y + 2;

  // Line 2: DEPARTAMENTO: [department]  DISTRITO: [district]
  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text('DEPARTAMENTO: ', xStart, currentY, { continued: true });

  doc.font('Helvetica').fontSize(fontSize);
  const department = (school.departamento || 'N/A').toUpperCase();
  doc.text(department, { continued: true });

  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text('  DISTRITO: ', { continued: true });

  doc.font('Helvetica').fontSize(fontSize);
  const district = (school.distrito || 'N/A').toUpperCase();
  doc.text(district);

  currentY = doc.y + 8; // Add spacing after header block

  return currentY;
}

/**
 * PDF 1: Cajas Distribution Report
 * Grouping: By codigo_ce, then by grado_ok
 * Columns: No, Departamento, Distrito, Codigo_ce, Nombre_ce, Grado_ok, Cajas_Hombres, Cajas_Mujeres, Cajas_Totales
 *
 * NOTE: STRICT PAGINATION - ONE SCHOOL PER PAGE (hard page break after each school)
 */
export function generateCajasPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 30, right: 30 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE CAJAS`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  let rowIndex = 1;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Start each school on a new page
    if (s > 0) {
      doc.addPage();
    }

    // Add logo and title to page
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(14).font('Helvetica-Bold').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    // Group students by grado_ok
    const gradeMap = new Map<string, { hombres: number; mujeres: number }>();
    for (const student of school.students) {
      const grade = student.grado_ok || student.grado || 'N/A';
      if (!gradeMap.has(grade)) {
        gradeMap.set(grade, { hombres: 0, mujeres: 0 });
      }
      const counts = gradeMap.get(grade)!;
      if (student.sexo === 'Hombre') {
        counts.hombres++;
      } else if (student.sexo === 'Mujer') {
        counts.mujeres++;
      }
    }

    const grades = Array.from(gradeMap.keys()).sort();

    // Draw table header
    doc.fontSize(9).font('Helvetica-Bold');
    const colWidths = [30, 90, 90, 60, 230, 80, 50, 50, 50];
    const colHeaders = [
      'NO',
      'DEPARTAMENTO',
      'DISTRITO',
      'CODIGO_CE',
      'NOMBRE_CE',
      'GRADO',
      'CAJAS HOMBRES',
      'CAJAS MUJERES',
      'CAJAS TOTALES',
    ];

    let x = 30;
    const headerHeight = 25;
    for (let i = 0; i < colHeaders.length; i++) {
      doc.rect(x, currentY, colWidths[i], headerHeight).stroke();
      doc.text(colHeaders[i], x + 2, currentY + 4, {
        width: colWidths[i] - 4,
        align: 'center',
      });
      x += colWidths[i];
    }
    currentY += headerHeight;

    // Draw grade rows
    doc.font('Helvetica').fontSize(8);
    for (const grade of grades) {
      const counts = gradeMap.get(grade)!;
      const total = counts.hombres + counts.mujeres;

      // Calculate dynamic row height based on school name
      const nameHeight = doc.heightOfString(school.nombre_ce, {
        width: colWidths[4] - 4,
      });
      const dynamicRowHeight = Math.max(25, nameHeight + 8);

      x = 30;
      const rowData = [
        rowIndex.toString(),
        school.departamento || '',
        school.distrito || '',
        school.codigo_ce,
        school.nombre_ce,
        grade,
        Math.ceil(counts.hombres * 1.15).toString(),
        Math.ceil(counts.mujeres * 1.15).toString(),
        Math.ceil(total * 1.15).toString(),
      ];

      for (let i = 0; i < rowData.length; i++) {
        doc.rect(x, currentY, colWidths[i], dynamicRowHeight).stroke();
        doc.text(rowData[i], x + 2, currentY + 3, {
          width: colWidths[i] - 4,
          align: i === 4 ? 'left' : 'center',
        });
        x += colWidths[i];
      }
      currentY += dynamicRowHeight;
      rowIndex++;
    }

    // School summary row
    doc.font('Helvetica-Bold').fontSize(8);
    const schoolTotalH = Array.from(gradeMap.values()).reduce((sum, c) => sum + c.hombres, 0);
    const schoolTotalM = Array.from(gradeMap.values()).reduce((sum, c) => sum + c.mujeres, 0);
    const schoolTotal = schoolTotalH + schoolTotalM;

    const summaryRowHeight = 16;
    x = 30;
    const summaryData = [
      '',
      '',
      '',
      '',
      'SUBTOTAL',
      '',
      Math.ceil(schoolTotalH * 1.15).toString(),
      Math.ceil(schoolTotalM * 1.15).toString(),
      Math.ceil(schoolTotal * 1.15).toString(),
    ];

    for (let i = 0; i < summaryData.length; i++) {
      doc.rect(x, currentY, colWidths[i], summaryRowHeight).stroke();
      doc.text(summaryData[i], x + 2, currentY + 3, {
        width: colWidths[i] - 4,
        align: i === 4 ? 'left' : 'center',
      });
      x += colWidths[i];
    }
    currentY += summaryRowHeight;
    // No spacing needed - each school gets its own page
  }

  doc.end();
  return doc;
}

/**
 * PDF 2: Camisas Distribution Report
 * Grouping: By codigo_ce, then by tipo_camisa
 * Dynamic size columns: T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
 *
 * NOTE: STRICT PAGINATION - ONE SCHOOL PER PAGE (hard page break after each school)
 */
export function generateCamisasPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 20, right: 20 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE CAMISAS`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  // Layout constants (larger fonts and widths)
  const xStart = 20;
  const availableWidth = doc.page.width - 40; // 752pt
  const headerFontSize = 11; // Table header font size
  const bodyFontSize = 9; // Table body font size
  const schoolHeaderFontSize = 12; // School header font size (per spec)

  // New table structure: TIPO + 12 sizes + TOTAL
  const tipoColWidth = 100; // increased from 60
  const sizeColWidth = 35; // increased from 25
  const totalColWidth = 50; // increased from 30
  const headerHeight = 28; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Start each school on a new page
    if (s > 0) {
      doc.addPage();
    }

    // Add logo and title to page
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    // Group by tipo_de_camisa and aggregate sizes
    const tipoMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const tipo = student.tipo_de_camisa || 'N/A';
      const size = student.camisa || 'N/A';

      if (!tipoMap.has(tipo)) {
        tipoMap.set(tipo, {});
      }
      const sizeCounts = tipoMap.get(tipo)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const tipos = Array.from(tipoMap.keys()).sort();

    // Draw per-school header block
    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    // Draw table header (TIPO + sizes + TOTAL)
    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    // TIPO column
    doc.rect(x, currentY, tipoColWidth, headerHeight).stroke();
    doc.text('TIPO', x + 2, currentY + 8, {
      width: tipoColWidth - 4,
      align: 'center',
    });
    x += tipoColWidth;

    // Size columns
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    // Total column
    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw tipo rows
    doc.font('Helvetica').fontSize(bodyFontSize);
    for (const tipo of tipos) {
      const sizeCounts = tipoMap.get(tipo)!;
      let rowTotal = 0;

      // Calculate dynamic row height
      const tipoHeight = doc.heightOfString(tipo, {
        width: tipoColWidth - 4,
      });
      const dynamicRowHeight = Math.max(20, tipoHeight + 8); // increased from 14

      x = xStart;

      // TIPO column
      doc.rect(x, currentY, tipoColWidth, dynamicRowHeight).stroke();
      doc.text(tipo, x + 2, currentY + 4, {
        width: tipoColWidth - 4,
        align: 'center',
      });
      x += tipoColWidth;

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    // School summary row (SUBTOTAL in TIPO column)
    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 20; // increased from 14
    x = xStart;

    doc.rect(x, currentY, tipoColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: tipoColWidth - 4,
      align: 'center',
    });
    x += tipoColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const sizeCounts = tipoMap.get(tipo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
    // No spacing needed - each school gets its own page
  }

  doc.end();
  return doc;
}

/**
 * PDF 3: Pantalones/Falda/Short Distribution Report
 * Grouping: By codigo_ce, then by tipo_prenda (from t_pantalon_falda_short field)
 * Sizes: from pantalon_falda field
 * Dynamic size columns: T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
 *
 * NOTE: STRICT PAGINATION - ONE SCHOOL PER PAGE (hard page break after each school)
 */
export function generatePantalonesPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 20, right: 20 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE PANTALÓN/FALDA/SHORT`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  // Layout constants (larger fonts and widths)
  const xStart = 20;
  const availableWidth = doc.page.width - 40; // 752pt
  const headerFontSize = 11; // Table header font size
  const bodyFontSize = 9; // Table body font size
  const schoolHeaderFontSize = 12; // School header font size (per spec)

  // New table structure: TIPO PRENDA + 12 sizes + TOTAL
  const tipoPrendaColWidth = 120; // increased from 70, slightly wider than TIPO for "TIPO PRENDA"
  const sizeColWidth = 35; // increased from 25
  const totalColWidth = 50; // increased from 30
  const headerHeight = 28; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Start each school on a new page
    if (s > 0) {
      doc.addPage();
    }

    // Add logo and title to page
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    // Group by tipo_prenda and aggregate sizes
    const tipoPrendMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const tipoPrenda = student.t_pantalon_falda_short || 'N/A';
      const size = student.pantalon_falda || 'N/A';

      if (!tipoPrendMap.has(tipoPrenda)) {
        tipoPrendMap.set(tipoPrenda, {});
      }
      const sizeCounts = tipoPrendMap.get(tipoPrenda)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const tipos = Array.from(tipoPrendMap.keys()).sort();

    // Draw per-school header block
    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    // Draw table header (TIPO PRENDA + sizes + TOTAL)
    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    // TIPO PRENDA column
    doc.rect(x, currentY, tipoPrendaColWidth, headerHeight).stroke();
    doc.text('TIPO PRENDA', x + 2, currentY + 8, {
      width: tipoPrendaColWidth - 4,
      align: 'center',
    });
    x += tipoPrendaColWidth;

    // Size columns
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    // Total column
    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw tipo rows
    doc.font('Helvetica').fontSize(bodyFontSize);
    for (const tipo of tipos) {
      const sizeCounts = tipoPrendMap.get(tipo)!;
      let rowTotal = 0;

      // Calculate dynamic row height
      const tipoHeight = doc.heightOfString(tipo, {
        width: tipoPrendaColWidth - 4,
      });
      const dynamicRowHeight = Math.max(20, tipoHeight + 8); // increased from 14

      x = xStart;

      // TIPO PRENDA column
      doc.rect(x, currentY, tipoPrendaColWidth, dynamicRowHeight).stroke();
      doc.text(tipo, x + 2, currentY + 4, {
        width: tipoPrendaColWidth - 4,
        align: 'center',
      });
      x += tipoPrendaColWidth;

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    // School summary row (SUBTOTAL in TIPO PRENDA column)
    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 20; // increased from 14
    x = xStart;

    doc.rect(x, currentY, tipoPrendaColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: tipoPrendaColWidth - 4,
      align: 'center',
    });
    x += tipoPrendaColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const sizeCounts = tipoPrendMap.get(tipo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
    // No spacing needed - each school gets its own page
  }

  doc.end();
  return doc;
}

/**
 * PDF 4: Zapatos Distribution Report
 * Grouping: By codigo_ce, then by sexo
 * Dynamic size columns: 23-45
 *
 * NOTE: STRICT PAGINATION - ONE SCHOOL PER PAGE (hard page break after each school)
 */
export function generateZapatosPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { fechaInicio, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 15, right: 15 },
  });

  const formattedDate = formatDateForTitle(fechaInicio);
  const title = `DETALLE DE PROGRAMACIÓN DE ZAPATOS`;
  const subtitle = `Fecha: ${formattedDate}`;

  const schools = groupBySchool(students);

  // Shoe sizes: 23-45
  const sizes: string[] = [];
  for (let i = 23; i <= 45; i++) {
    sizes.push(i.toString());
  }

  // Layout constants (larger fonts and widths)
  const xStart = 15;
  const availableWidth = doc.page.width - 30; // 762pt
  const headerFontSize = 10; // Table header font size
  const bodyFontSize = 8; // Table body font size
  const schoolHeaderFontSize = 12; // School header font size (per spec)

  // New table structure: SEXO + 23 sizes + TOTAL
  const sexoColWidth = 80; // increased from 40
  const sizeColWidth = 25; // increased from 18
  const totalColWidth = 40; // increased from 25
  const headerHeight = 26; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Start each school on a new page
    if (s > 0) {
      doc.addPage();
    }

    // Add logo and title to page
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
    doc.moveDown(2);

    let currentY = doc.y;

    // Group by sexo and aggregate shoe sizes
    const sexoMap = new Map<string, { [size: string]: number }>();

    for (const student of school.students) {
      const sexo = student.sexo || 'N/A';
      const size = student.zapato || 'N/A';

      if (!sexoMap.has(sexo)) {
        sexoMap.set(sexo, {});
      }
      const sizeCounts = sexoMap.get(sexo)!;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    }

    const sexos = Array.from(sexoMap.keys()).sort();

    // Draw per-school header block
    currentY = drawSchoolHeaderBlock({
      doc,
      xStart,
      yStart: currentY,
      availableWidth,
      school,
      fontSize: schoolHeaderFontSize,
    });

    // Draw table header (SEXO + sizes + TOTAL)
    doc.fontSize(headerFontSize).font('Helvetica-Bold');
    let x = xStart;

    // SEXO column
    doc.rect(x, currentY, sexoColWidth, headerHeight).stroke();
    doc.text('SEXO', x + 2, currentY + 8, {
      width: sexoColWidth - 4,
      align: 'center',
    });
    x += sexoColWidth;

    // Size columns (23-45)
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 2, currentY + 8, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    // Total column
    doc.rect(x, currentY, totalColWidth, headerHeight).stroke();
    doc.text('TOTAL', x + 2, currentY + 8, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw sexo rows
    doc.font('Helvetica').fontSize(bodyFontSize);
    for (const sexo of sexos) {
      const sizeCounts = sexoMap.get(sexo)!;
      let rowTotal = 0;

      // Calculate dynamic row height
      const sexoHeight = doc.heightOfString(sexo, {
        width: sexoColWidth - 4,
      });
      const dynamicRowHeight = Math.max(18, sexoHeight + 8); // increased from 12

      x = xStart;

      // SEXO column
      doc.rect(x, currentY, sexoColWidth, dynamicRowHeight).stroke();
      doc.text(sexo.toUpperCase(), x + 2, currentY + 4, {
        width: sexoColWidth - 4,
        align: 'center',
      });
      x += sexoColWidth;

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 2, currentY + 4, {
          width: sizeColWidth - 4,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, totalColWidth, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 2, currentY + 4, {
        width: totalColWidth - 4,
        align: 'center',
      });

      currentY += dynamicRowHeight;
    }

    // School summary row (SUBTOTAL in SEXO column)
    doc.font('Helvetica-Bold').fontSize(bodyFontSize);
    const summaryRowHeight = 18; // increased from 12
    x = xStart;

    doc.rect(x, currentY, sexoColWidth, summaryRowHeight).stroke();
    doc.text('SUBTOTAL', x + 2, currentY + 4, {
      width: sexoColWidth - 4,
      align: 'center',
    });
    x += sexoColWidth;

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const sexo of sexos) {
        const sizeCounts = sexoMap.get(sexo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 2, currentY + 4, {
        width: sizeColWidth - 4,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, totalColWidth, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 2, currentY + 4, {
      width: totalColWidth - 4,
      align: 'center',
    });

    currentY += summaryRowHeight;
    // No spacing needed - each school gets its own page
  }

  doc.end();
  return doc;
}

/**
 * PDF 5: School Distribution Card (Ficha de Distribución por Escuela)
 * Aggregates data from Camisas, Pantalones, and Zapatos into a vertical list
 * One school per page, only showing items with count > 0
 *
 * NOTE: STRICT PAGINATION - ONE SCHOOL PER PAGE
 */
export function generateFichaPDF(options: AgreementReportOptions): PDFDocumentInstance {
  const { students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'portrait',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  const title = `FICHA DE DISTRIBUCION POR ESCUELA`;

  const schools = groupBySchool(students);

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Start each school on a new page
    if (s > 0) {
      doc.addPage();
    }

    // Add logo to page
    addLogoToPage(doc, doc.page.width);

    // Title
    doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(1);

    // Subtitle: School info
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`ESCUELA: ${school.nombre_ce.toUpperCase()}`, { align: 'center' });
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
    doc.moveDown(1);

    // Header text
    doc
      .fontSize(12)
      .font('Helvetica')
      .text('Detalle por tipo y talla (solo cantidades > 0)', { align: 'left' });
    doc.moveDown(1);

    let currentY = doc.y;

    // Aggregate data from all sources
    interface ItemCount {
      tipo_talla: string;
      cantidad: number;
    }

    const itemCounts: ItemCount[] = [];

    // Source 1: Camisas (tipo_camisa + camisa)
    const camisaMap = new Map<string, number>();
    for (const student of school.students) {
      const tipo = student.tipo_de_camisa;
      const size = student.camisa;
      if (tipo && size) {
        const key = `Camisa ${tipo} - ${size}`;
        camisaMap.set(key, (camisaMap.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of camisaMap.entries()) {
      if (count > 0) {
        itemCounts.push({ tipo_talla: key, cantidad: count });
      }
    }

    // Source 2: Pantalones/Faldas (t_pantalon_falda_short + pantalon_falda)
    const pantalonMap = new Map<string, number>();
    for (const student of school.students) {
      const tipo = student.t_pantalon_falda_short;
      const size = student.pantalon_falda;
      if (tipo && size) {
        const key = `${tipo} - ${size}`;
        pantalonMap.set(key, (pantalonMap.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of pantalonMap.entries()) {
      if (count > 0) {
        itemCounts.push({ tipo_talla: key, cantidad: count });
      }
    }

    // Source 3: Zapatos (sexo + zapato)
    const zapatoMap = new Map<string, number>();
    for (const student of school.students) {
      const sexo = student.sexo;
      const size = student.zapato;
      if (sexo && size) {
        const key = `${sexo} - ${size}`;
        zapatoMap.set(key, (zapatoMap.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of zapatoMap.entries()) {
      if (count > 0) {
        itemCounts.push({ tipo_talla: key, cantidad: count });
      }
    }

    // Table layout
    const xStart = 40;
    const tipoTallaColWidth = 350;
    const cantidadColWidth = 100;
    const headerHeight = 25;
    const rowHeight = 20;

    // Draw table header
    doc.fontSize(11).font('Helvetica-Bold');
    let x = xStart;

    doc.rect(x, currentY, tipoTallaColWidth, headerHeight).stroke();
    doc.text('TIPO/TALLA', x + 5, currentY + 7, {
      width: tipoTallaColWidth - 10,
      align: 'left',
    });
    x += tipoTallaColWidth;

    doc.rect(x, currentY, cantidadColWidth, headerHeight).stroke();
    doc.text('CANTIDAD', x + 5, currentY + 7, {
      width: cantidadColWidth - 10,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw data rows
    doc.font('Helvetica').fontSize(10);
    let totalPiezas = 0;

    for (const item of itemCounts) {
      x = xStart;

      doc.rect(x, currentY, tipoTallaColWidth, rowHeight).stroke();
      doc.text(item.tipo_talla, x + 5, currentY + 5, {
        width: tipoTallaColWidth - 10,
        align: 'left',
      });
      x += tipoTallaColWidth;

      doc.rect(x, currentY, cantidadColWidth, rowHeight).stroke();
      doc.text(item.cantidad.toString(), x + 5, currentY + 5, {
        width: cantidadColWidth - 10,
        align: 'center',
      });

      currentY += rowHeight;
      totalPiezas += item.cantidad;

      // Check if we need a new page
      if (currentY > doc.page.height - 100) {
        doc.addPage();
        addLogoToPage(doc, doc.page.width);
        doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
        doc.moveDown(1);
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`ESCUELA: ${school.nombre_ce.toUpperCase()}`, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`CODIGO: ${school.codigo_ce.toUpperCase()}`, { align: 'center' });
        doc.moveDown(1);
        currentY = doc.y;
        doc.font('Helvetica').fontSize(10);
      }
    }

    // Footer with total
    currentY += 10;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`TOTAL PIEZAS: ${totalPiezas}`, xStart, currentY, { align: 'left' });
  }

  doc.end();
  return doc;
}
