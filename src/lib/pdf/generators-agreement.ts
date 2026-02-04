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
 *   Line 1: NOMBRE_CE: xxxxxx (COD XXXX)
 *   Line 2: DEPTO: xxxxxx  DIST: xxxxxx
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

  // Line 1: NOMBRE_CE: [school name] (COD [school code])
  doc.font('Helvetica-Bold').fontSize(fontSize);
  doc.text('NOMBRE: ', xStart, currentY, { continued: true });

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

  // Line 2: DEPTO: [department]  DIST: [district]
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
 * NOTE: Cajas does NOT enforce the 5-schools-per-page limit (only overflow).
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

  // Add logo to first page
  addLogoToPage(doc, doc.page.width);

  // Title on first page
  doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
  doc.moveDown(2);

  const schools = groupBySchool(students);

  let currentY = doc.y;
  const pageHeight = doc.page.height;
  const bottomMargin = 40;
  const maxY = pageHeight - bottomMargin;

  let rowIndex = 1;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Group students by grado_ok
    const gradeMap = new Map<string, { hombres: number; mujeres: number }>();
    for (const student of school.students) {
      const grade = student.grado || 'N/A';
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
    const gradeRows = grades.length;

    // Estimate space needed (header + rows + summary + spacing)
    const estimatedHeight = 30 + gradeRows * 20 + 20 + 20;

    // Check if we need a new page (only on overflow, NOT 5-schools limit for Cajas)
    if (currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
    }

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
    currentY += 10; // spacing between schools
  }

  doc.end();
  return doc;
}

/**
 * PDF 2: Camisas Distribution Report
 * Grouping: By codigo_ce, then by tipo_camisa
 * Dynamic size columns: T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
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

  // Add logo to first page
  addLogoToPage(doc, doc.page.width);

  doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
  doc.moveDown(2);

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  let currentY = doc.y;
  const pageHeight = doc.page.height;
  const bottomMargin = 40;
  const maxY = pageHeight - bottomMargin;

  let schoolsOnPage = 0;
  const maxSchoolsPerPage = 5;

  // Layout constants (larger fonts and widths)
  const xStart = 20;
  const availableWidth = doc.page.width - 40; // 752pt
  const headerFontSize = 11; // increased from 7, then from 10
  const bodyFontSize = 9; // increased from 6, then from 8
  const schoolHeaderFontSize = 9;

  // New table structure: TIPO + 12 sizes + TOTAL
  const tipoColWidth = 100; // increased from 60
  const sizeColWidth = 35; // increased from 25
  const totalColWidth = 50; // increased from 30
  const headerHeight = 28; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

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
    const tipoRows = tipos.length;

    // Updated height estimation (school header + table header + rows + summary + spacing)
    const schoolHeaderHeight = 50; // approximate
    const estimatedHeight = schoolHeaderHeight + headerHeight + tipoRows * 24 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.fontSize(14).font('Helvetica').text(subtitle, { align: 'center' });
      doc.moveDown(2);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

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
    currentY += 15; // increased spacing between schools
    schoolsOnPage++;
  }

  doc.end();
  return doc;
}

/**
 * PDF 3: Pantalones/Falda/Short Distribution Report
 * Grouping: By codigo_ce, then by tipo_prenda (from t_pantalon_falda_short field)
 * Sizes: from pantalon_falda field
 * Dynamic size columns: T4, T6, T8, T10, T12, T14, T16, T18, T20, T22, T1X, T2X
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

  // Add logo to first page
  addLogoToPage(doc, doc.page.width);

  doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
  doc.moveDown(2);

  const schools = groupBySchool(students);

  const sizes = ['T4', 'T6', 'T8', 'T10', 'T12', 'T14', 'T16', 'T18', 'T20', 'T22', 'T1X', 'T2X'];

  let currentY = doc.y;
  const pageHeight = doc.page.height;
  const bottomMargin = 40;
  const maxY = pageHeight - bottomMargin;

  let schoolsOnPage = 0;
  const maxSchoolsPerPage = 5;

  // Layout constants (larger fonts and widths)
  const xStart = 20;
  const availableWidth = doc.page.width - 40; // 752pt
  const headerFontSize = 11; // increased from 7, then from 10
  const bodyFontSize = 9; // increased from 6, then from 8
  const schoolHeaderFontSize = 9;

  // New table structure: TIPO PRENDA + 12 sizes + TOTAL
  const tipoPrendaColWidth = 120; // increased from 70, slightly wider than TIPO for "TIPO PRENDA"
  const sizeColWidth = 35; // increased from 25
  const totalColWidth = 50; // increased from 30
  const headerHeight = 28; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

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
    const tipoRows = tipos.length;

    // Updated height estimation (school header + table header + rows + summary + spacing)
    const schoolHeaderHeight = 50; // approximate
    const estimatedHeight = schoolHeaderHeight + headerHeight + tipoRows * 24 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.fontSize(14).font('Helvetica').text(subtitle, { align: 'center' });
      doc.moveDown(2);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

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
    currentY += 15; // increased spacing between schools
    schoolsOnPage++;
  }

  doc.end();
  return doc;
}

/**
 * PDF 4: Zapatos Distribution Report
 * Grouping: By codigo_ce, then by sexo
 * Dynamic size columns: 23-45
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

  // Add logo to first page
  addLogoToPage(doc, doc.page.width);

  doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(subtitle, { align: 'center' });
  doc.moveDown(2);

  const schools = groupBySchool(students);

  // Shoe sizes: 23-45
  const sizes: string[] = [];
  for (let i = 23; i <= 45; i++) {
    sizes.push(i.toString());
  }

  let currentY = doc.y;
  const pageHeight = doc.page.height;
  const bottomMargin = 40;
  const maxY = pageHeight - bottomMargin;

  let schoolsOnPage = 0;
  const maxSchoolsPerPage = 5;

  // Layout constants (larger fonts and widths)
  const xStart = 15;
  const availableWidth = doc.page.width - 30; // 762pt
  const headerFontSize = 10; // increased from 6, then from 9
  const bodyFontSize = 8; // increased from 5, then from 7
  const schoolHeaderFontSize = 9;

  // New table structure: SEXO + 23 sizes + TOTAL
  const sexoColWidth = 80; // increased from 40
  const sizeColWidth = 25; // increased from 18
  const totalColWidth = 40; // increased from 25
  const headerHeight = 26; // increased from 20

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

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
    const sexoRows = sexos.length;

    // Updated height estimation (school header + table header + rows + summary + spacing)
    const schoolHeaderHeight = 50; // approximate
    const estimatedHeight = schoolHeaderHeight + headerHeight + sexoRows * 24 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.fontSize(14).font('Helvetica').text(subtitle, { align: 'center' });
      doc.moveDown(2);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

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
    currentY += 15; // increased spacing between schools
    schoolsOnPage++;
  }

  doc.end();
  return doc;
}
