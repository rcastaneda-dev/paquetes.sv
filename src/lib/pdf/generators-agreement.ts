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
 * PDF 1: Cajas Distribution Report
 * Grouping: By codigo_ce, then by grado_ok
 * Columns: No, Departamento, Distrito, Codigo_ce, Nombre_ce, Grado_ok, Cajas_Hombres, Cajas_Mujeres, Cajas_Totales
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

  let schoolsOnPage = 0;
  const maxSchoolsPerPage = 5;

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

    // Check if we need a new page (after 5 schools or overflow)
    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
      schoolsOnPage = 0;
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
        counts.hombres.toString(),
        counts.mujeres.toString(),
        total.toString(),
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
      schoolTotalH.toString(),
      schoolTotalM.toString(),
      schoolTotal.toString(),
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
    schoolsOnPage++;
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

  let rowIndex = 1;

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

    const estimatedHeight = 30 + tipoRows * 20 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

    // Draw table header
    doc.fontSize(7).font('Helvetica-Bold');
    const fixedColWidths = [20, 60, 50, 50, 180, 60];
    const fixedHeaders = ['NO', 'DEPARTAMENTO', 'DISTRITO', 'CODIGO_CE', 'NOMBRE_CE', 'TIPO'];
    const sizeColWidth = 25;
    const headerHeight = 20;

    let x = 20;
    for (let i = 0; i < fixedHeaders.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], headerHeight).stroke();
      doc.text(fixedHeaders[i], x + 1, currentY + 5, {
        width: fixedColWidths[i] - 2,
        align: 'center',
      });
      x += fixedColWidths[i];
    }

    // Size columns
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 1, currentY + 5, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }

    // Total column
    doc.rect(x, currentY, 30, headerHeight).stroke();
    doc.text('TOTAL', x + 1, currentY + 5, {
      width: 28,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw tipo rows
    doc.font('Helvetica').fontSize(6);
    for (const tipo of tipos) {
      const sizeCounts = tipoMap.get(tipo)!;
      let rowTotal = 0;

      // Calculate dynamic row height based on school name
      const nameHeight = doc.heightOfString(school.nombre_ce, {
        width: fixedColWidths[4] - 2,
      });
      const dynamicRowHeight = Math.max(14, nameHeight + 6);

      x = 20;
      const fixedData = [
        rowIndex.toString(),
        school.departamento || '',
        school.distrito || '',
        school.codigo_ce,
        school.nombre_ce,
        tipo,
      ];

      for (let i = 0; i < fixedData.length; i++) {
        doc.rect(x, currentY, fixedColWidths[i], dynamicRowHeight).stroke();
        doc.text(fixedData[i], x + 1, currentY + 2, {
          width: fixedColWidths[i] - 2,
          align: i === 4 ? 'left' : 'center',
        });
        x += fixedColWidths[i];
      }

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 1, currentY + 2, {
          width: sizeColWidth - 2,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, 30, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 1, currentY + 2, {
        width: 28,
        align: 'center',
      });

      currentY += dynamicRowHeight;
      rowIndex++;
    }

    // School summary row
    doc.font('Helvetica-Bold').fontSize(6);
    const summaryRowHeight = 14;
    x = 20;
    const subtotalLabel = ['', '', '', '', 'SUBTOTAL', ''];
    for (let i = 0; i < subtotalLabel.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], summaryRowHeight).stroke();
      doc.text(subtotalLabel[i], x + 1, currentY + 2, {
        width: fixedColWidths[i] - 2,
        align: i === 4 ? 'left' : 'center',
      });
      x += fixedColWidths[i];
    }

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const sizeCounts = tipoMap.get(tipo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 1, currentY + 2, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, 30, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 1, currentY + 2, {
      width: 28,
      align: 'center',
    });

    currentY += summaryRowHeight;
    currentY += 10;
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

  let rowIndex = 1;

  for (let s = 0; s < schools.length; s++) {
    const school = schools[s];

    // Group by tipo_prend and aggregate sizes
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

    const estimatedHeight = 30 + tipoRows * 20 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

    // Draw table header
    doc.fontSize(7).font('Helvetica-Bold');
    const fixedColWidths = [20, 60, 50, 50, 180, 70];
    const fixedHeaders = [
      'NO',
      'DEPARTAMENTO',
      'DISTRITO',
      'CODIGO_CE',
      'NOMBRE_CE',
      'TIPO PRENDA',
    ];
    const sizeColWidth = 25;
    const headerHeight = 20;

    let x = 20;
    for (let i = 0; i < fixedHeaders.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], headerHeight).stroke();
      doc.text(fixedHeaders[i], x + 1, currentY + 5, {
        width: fixedColWidths[i] - 2,
        align: 'center',
      });
      x += fixedColWidths[i];
    }

    // Size columns
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.text(size, x + 1, currentY + 5, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }

    // Total column
    doc.rect(x, currentY, 30, headerHeight).stroke();
    doc.text('TOTAL', x + 1, currentY + 5, {
      width: 28,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw tipo rows
    doc.font('Helvetica').fontSize(6);
    for (const tipo of tipos) {
      const sizeCounts = tipoPrendMap.get(tipo)!;
      let rowTotal = 0;

      // Calculate dynamic row height based on school name
      const nameHeight = doc.heightOfString(school.nombre_ce, {
        width: fixedColWidths[4] - 2,
      });
      const dynamicRowHeight = Math.max(14, nameHeight + 6);

      x = 20;
      const fixedData = [
        rowIndex.toString(),
        school.departamento || '',
        school.distrito || '',
        school.codigo_ce,
        school.nombre_ce,
        tipo,
      ];

      for (let i = 0; i < fixedData.length; i++) {
        doc.rect(x, currentY, fixedColWidths[i], dynamicRowHeight).stroke();
        doc.text(fixedData[i], x + 1, currentY + 2, {
          width: fixedColWidths[i] - 2,
          align: i === 4 ? 'left' : 'center',
        });
        x += fixedColWidths[i];
      }

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 1, currentY + 2, {
          width: sizeColWidth - 2,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, 30, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 1, currentY + 2, {
        width: 28,
        align: 'center',
      });

      currentY += dynamicRowHeight;
      rowIndex++;
    }

    // School summary row
    doc.font('Helvetica-Bold').fontSize(6);
    const summaryRowHeight = 14;
    x = 20;
    const subtotalLabel = ['', '', '', '', 'SUBTOTAL', ''];
    for (let i = 0; i < subtotalLabel.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], summaryRowHeight).stroke();
      doc.text(subtotalLabel[i], x + 1, currentY + 2, {
        width: fixedColWidths[i] - 2,
        align: i === 4 ? 'left' : 'center',
      });
      x += fixedColWidths[i];
    }

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const tipo of tipos) {
        const sizeCounts = tipoPrendMap.get(tipo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 1, currentY + 2, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, 30, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 1, currentY + 2, {
      width: 28,
      align: 'center',
    });

    currentY += summaryRowHeight;
    currentY += 10;
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

  let rowIndex = 1;

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

    const estimatedHeight = 30 + sexoRows * 20 + 20 + 20;

    if (schoolsOnPage >= maxSchoolsPerPage || currentY + estimatedHeight > maxY) {
      doc.addPage();
      addLogoToPage(doc, doc.page.width);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(1);
      currentY = doc.y;
      schoolsOnPage = 0;
    }

    // Draw table header
    doc.fontSize(6).font('Helvetica-Bold');
    const fixedColWidths = [18, 50, 40, 40, 180, 40];
    const fixedHeaders = ['NO', 'DEPTO', 'DIST', 'COD', 'NOMBRE_CE', 'SEXO'];
    const sizeColWidth = 18;
    const headerHeight = 20;

    let x = 15;
    for (let i = 0; i < fixedHeaders.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], headerHeight).stroke();
      doc.text(fixedHeaders[i], x + 1, currentY + 5, {
        width: fixedColWidths[i] - 2,
        align: 'center',
      });
      x += fixedColWidths[i];
    }

    // Size columns (23-45)
    for (const size of sizes) {
      doc.rect(x, currentY, sizeColWidth, headerHeight).stroke();
      doc.fontSize(5).text(size, x + 1, currentY + 5, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }
    doc.fontSize(6); // Reset to header font size

    // Total column
    doc.rect(x, currentY, 25, headerHeight).stroke();
    doc.text('TOT', x + 1, currentY + 5, {
      width: 23,
      align: 'center',
    });

    currentY += headerHeight;

    // Draw sexo rows
    doc.font('Helvetica').fontSize(5);
    for (const sexo of sexos) {
      const sizeCounts = sexoMap.get(sexo)!;
      let rowTotal = 0;

      // Calculate dynamic row height based on school name
      const nameHeight = doc.heightOfString(school.nombre_ce, {
        width: fixedColWidths[4] - 2,
      });
      const dynamicRowHeight = Math.max(12, nameHeight + 5);

      x = 15;
      const fixedData = [
        rowIndex.toString(),
        school.departamento || '',
        school.distrito || '',
        school.codigo_ce,
        school.nombre_ce,
        sexo,
      ];

      for (let i = 0; i < fixedData.length; i++) {
        doc.rect(x, currentY, fixedColWidths[i], dynamicRowHeight).stroke();
        doc.text(fixedData[i], x + 1, currentY + 2, {
          width: fixedColWidths[i] - 2,
          align: i === 4 ? 'left' : 'center',
        });
        x += fixedColWidths[i];
      }

      // Size counts
      for (const size of sizes) {
        const count = sizeCounts[size] || 0;
        rowTotal += count;
        doc.rect(x, currentY, sizeColWidth, dynamicRowHeight).stroke();
        doc.text(count > 0 ? count.toString() : '', x + 1, currentY + 2, {
          width: sizeColWidth - 2,
          align: 'center',
        });
        x += sizeColWidth;
      }

      // Total
      doc.rect(x, currentY, 25, dynamicRowHeight).stroke();
      doc.text(rowTotal.toString(), x + 1, currentY + 2, {
        width: 23,
        align: 'center',
      });

      currentY += dynamicRowHeight;
      rowIndex++;
    }

    // School summary row
    doc.font('Helvetica-Bold').fontSize(5);
    const summaryRowHeight = 12;
    x = 15;
    const subtotalLabel = ['', '', '', '', 'SUBTOTAL', ''];
    for (let i = 0; i < subtotalLabel.length; i++) {
      doc.rect(x, currentY, fixedColWidths[i], summaryRowHeight).stroke();
      doc.text(subtotalLabel[i], x + 1, currentY + 2, {
        width: fixedColWidths[i] - 2,
        align: i === 4 ? 'left' : 'center',
      });
      x += fixedColWidths[i];
    }

    let grandTotal = 0;
    for (const size of sizes) {
      let sizeTotal = 0;
      for (const sexo of sexos) {
        const sizeCounts = sexoMap.get(sexo)!;
        sizeTotal += sizeCounts[size] || 0;
      }
      grandTotal += sizeTotal;

      doc.rect(x, currentY, sizeColWidth, summaryRowHeight).stroke();
      doc.text(sizeTotal > 0 ? sizeTotal.toString() : '', x + 1, currentY + 2, {
        width: sizeColWidth - 2,
        align: 'center',
      });
      x += sizeColWidth;
    }

    doc.rect(x, currentY, 25, summaryRowHeight).stroke();
    doc.text(grandTotal.toString(), x + 1, currentY + 2, {
      width: 23,
      align: 'center',
    });

    currentY += summaryRowHeight;
    currentY += 10;
    schoolsOnPage++;
  }

  doc.end();
  return doc;
}
