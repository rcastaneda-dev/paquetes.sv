import PDFDocument from 'pdfkit';
import type { StudentReportRow } from '@/types/database';
import fs from 'fs';
import path from 'path';
import { addPageNumbers } from './page-numbers';

// Export agreement report generators
export {
  generateCajasPDF,
  generateCamisasPDF,
  generatePantalonesPDF,
  generateZapatosPDF,
  generateFichaUniformesPDF,
  generateFichaZapatosPDF,
  generateDayZapatosPDF,
  generateDayUniformesPDF,
  generateActaRecepcionZapatosPDF,
  generateActaRecepcionUniformesPDF,
} from './generators-agreement';

/**
 * Helper: Add GOES logo to the top-right corner of the current page
 * Preserves the current Y position so it doesn't affect document flow
 */
function addLogoToPage(doc: PDFDocumentInstance, pageWidth: number) {
  const logoPath = path.join(process.cwd(), 'public', 'goes_logo_2.png');

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

export interface PDFGeneratorOptions {
  schoolName: string;
  codigo_ce: string;
  grado: string;
  students: StudentReportRow[];
}

export type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

/**
 * Generates a PDF with a table of students and their uniform sizes.
 * Returns a readable stream for efficient memory usage.
 */
export function generateStudentReportPDF(options: PDFGeneratorOptions): PDFDocumentInstance {
  const { schoolName, codigo_ce, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
  });

  const generatedAtLabel = new Date().toLocaleString('es-SV');

  const drawDocumentHeader = () => {
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(18).text(`Escuela: ${schoolName}`, { align: 'left' });
    doc.fontSize(18).text(`Código: ${codigo_ce}`, { align: 'left' });
    doc.moveDown(2);
  };

  const addPageWithHeader = () => {
    doc.addPage();
    drawDocumentHeader();
    currentY = doc.y;
  };

  // Page 1 header
  drawDocumentHeader();

  // Table configuration
  const tableTop = doc.y;
  const columnWidths = {
    // NOTE: Sizes are tuned to exactly fill a LETTER landscape page with 50pt margins.
    no: 40,
    name: 307,
    sex: 50,
    age: 45,
    shirt: 60,
    pants: 110,
    shoe: 80,
  };
  const rowHeight = 25;

  let currentY = tableTop;

  // Helper to draw table header
  const drawHeader = (y: number) => {
    doc.fontSize(9).font('Helvetica-Bold');

    let x = 50;

    // No. (Correlative)
    doc.rect(x, y, columnWidths.no, rowHeight).stroke();
    doc.text('NO.', x + 5, y + 8, { width: columnWidths.no - 10, align: 'center' });
    x += columnWidths.no;

    // Name
    doc.rect(x, y, columnWidths.name, rowHeight).stroke();
    doc.text('NOMBRE ESTUDIANTE', x + 5, y + 8, { width: columnWidths.name });
    x += columnWidths.name;

    // Sex
    doc.rect(x, y, columnWidths.sex, rowHeight).stroke();
    doc.text('SEXO', x + 5, y + 8, { width: columnWidths.sex - 10, align: 'center' });
    x += columnWidths.sex;

    // Age
    doc.rect(x, y, columnWidths.age, rowHeight).stroke();
    doc.text('EDAD', x + 5, y + 8, { width: columnWidths.age - 10, align: 'center' });
    x += columnWidths.age;

    // Shirt
    doc.rect(x, y, columnWidths.shirt, rowHeight).stroke();
    doc.text('CAMISA', x + 5, y + 8, { width: columnWidths.shirt - 10, align: 'center' });
    x += columnWidths.shirt;

    // Pants/Skirt
    doc.rect(x, y, columnWidths.pants, rowHeight).stroke();
    doc.text('PANTALÓN/FALDA', x + 5, y + 8, { width: columnWidths.pants - 5, align: 'center' });
    x += columnWidths.pants;

    // Shoes
    doc.rect(x, y, columnWidths.shoe, rowHeight).stroke();
    doc.text('ZAPATO', x + 5, y + 8, { width: columnWidths.shoe - 10, align: 'center' });

    return y + rowHeight;
  };

  const bottomLimitY = doc.page.height - 50;

  const ensureSpace = (minHeight: number) => {
    if (currentY + minHeight <= bottomLimitY) return;
    addPageWithHeader();
  };

  const getGradeKey = (value: string | null | undefined) => {
    const normalized = (value || '').trim();
    return normalized.length > 0 ? normalized : 'N/A';
  };

  // Group by grado (each grade renders as its own table in the same PDF)
  const studentsByGrade = new Map<string, StudentReportRow[]>();
  for (const s of students) {
    const gradeKey = getGradeKey(s.grado);
    const list = studentsByGrade.get(gradeKey);
    if (list) list.push(s);
    else studentsByGrade.set(gradeKey, [s]);
  }

  const gradeKeys = Array.from(studentsByGrade.keys()).sort((a, b) =>
    a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
  );

  const drawGradeTitle = (grade: string) => {
    doc.font('Helvetica-Bold').fontSize(16);

    doc.text(`Grado: ${grade}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 2;
  };

  const calculateTextHeight = (text: string, width: number, fontSize: number): number => {
    // PDFKit's heightOfString calculates the height text will occupy
    doc.fontSize(fontSize);
    return doc.heightOfString(text, { width });
  };

  const drawStudentRow = (student: StudentReportRow, displayIndex: number) => {
    // Calculate required height for this row based on longest text
    doc.font('Helvetica').fontSize(8);
    const nameHeight = calculateTextHeight(
      student.nombre_estudiante || '',
      columnWidths.name - 10,
      8
    );
    const pantsHeight = calculateTextHeight(
      student.pantalon_falda || 'N/A',
      columnWidths.pants - 10,
      8
    );

    // Use maximum height needed, with minimum of 25 and padding
    const contentHeight = Math.max(nameHeight, pantsHeight);
    const dynamicRowHeight = Math.max(rowHeight, contentHeight + 12);

    let x = 50;

    // No. (Correlative)
    doc.rect(x, currentY, columnWidths.no, dynamicRowHeight).stroke();
    doc.text(displayIndex.toString(), x + 5, currentY + 8, {
      width: columnWidths.no - 10,
      align: 'center',
    });
    x += columnWidths.no;

    // Name
    doc.rect(x, currentY, columnWidths.name, dynamicRowHeight).stroke();
    doc.text(student.nombre_estudiante || '', x + 5, currentY + 6, {
      width: columnWidths.name - 10,
    });
    x += columnWidths.name;

    // Sex
    doc.rect(x, currentY, columnWidths.sex, dynamicRowHeight).stroke();
    doc.text(student.sexo || '', x + 5, currentY + 8, {
      width: columnWidths.sex - 10,
      align: 'center',
    });
    x += columnWidths.sex;

    // Age
    doc.rect(x, currentY, columnWidths.age, dynamicRowHeight).stroke();
    doc.text(student.edad?.toString() || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.age - 10,
      align: 'center',
    });
    x += columnWidths.age;

    // Shirt
    doc.rect(x, currentY, columnWidths.shirt, dynamicRowHeight).stroke();
    doc.text(student.camisa || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.shirt - 10,
      align: 'center',
    });
    x += columnWidths.shirt;

    // Pants/Skirt
    doc.rect(x, currentY, columnWidths.pants, dynamicRowHeight).stroke();
    doc.text(student.pantalon_falda || 'N/A', x + 5, currentY + 6, {
      width: columnWidths.pants - 10,
      align: 'center',
    });
    x += columnWidths.pants;

    // Shoes
    doc.rect(x, currentY, columnWidths.shoe, dynamicRowHeight).stroke();
    doc.text(student.zapato || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.shoe - 10,
      align: 'center',
    });

    currentY += dynamicRowHeight;
  };

  doc.font('Helvetica').fontSize(8);

  for (let g = 0; g < gradeKeys.length; g++) {
    const grade = gradeKeys[g];
    const gradeStudents = studentsByGrade.get(grade) ?? [];

    // Each grade starts on a new page (except the first one which continues after the main title)
    if (g > 0) {
      addPageWithHeader();
    }

    // Ensure there's room for: title + header + at least 1 row
    ensureSpace(48 + rowHeight + rowHeight);

    drawGradeTitle(grade);
    currentY = drawHeader(currentY);
    doc.font('Helvetica').fontSize(8);

    for (let i = 0; i < gradeStudents.length; i++) {
      // Pre-calculate row height to check if we need a new page
      const student = gradeStudents[i];
      doc.font('Helvetica').fontSize(8);
      const nameHeight = doc.heightOfString(student.nombre_estudiante || '', {
        width: columnWidths.name - 10,
      });
      const pantsHeight = doc.heightOfString(student.pantalon_falda || 'N/A', {
        width: columnWidths.pants - 10,
      });
      const contentHeight = Math.max(nameHeight, pantsHeight);
      const estimatedRowHeight = Math.max(rowHeight, contentHeight + 12);

      if (currentY + estimatedRowHeight > bottomLimitY) {
        addPageWithHeader();
        ensureSpace(48 + rowHeight);
        drawGradeTitle(grade);
        currentY = drawHeader(currentY);
        doc.font('Helvetica').fontSize(8);
      }

      drawStudentRow(student, i + 1);
    }
  }

  // Final summary (rendered once, at the end of the file)
  currentY += 18;
  ensureSpace(70);
  doc.font('Helvetica-Bold').fontSize(12).text('Resumen', 50, currentY, { align: 'left' });
  currentY = doc.y + 6;
  doc.font('Helvetica').fontSize(14);
  doc.text(`Grados: ${gradeKeys.length}`, 50, currentY, { align: 'left' });
  currentY = doc.y + 2;
  doc.text(`Estudiantes: ${students.length}`, 50, currentY, { align: 'left' });
  currentY = doc.y + 2;
  doc.text(`Generado: ${generatedAtLabel}`, 50, currentY, { align: 'left' });

  // Finalize PDF
  addPageNumbers(doc);
  doc.end();

  return doc;
}

/**
 * Generates a PDF with student labels (simplified table with basic identification).
 * Returns a readable stream for efficient memory usage.
 */
export function generateStudentLabelsPDF(options: PDFGeneratorOptions): PDFDocumentInstance {
  const { schoolName, codigo_ce, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
  });

  const generatedAtLabel = new Date().toLocaleString('es-SV');

  const drawDocumentHeader = () => {
    addLogoToPage(doc, doc.page.width);
    doc.fontSize(18).text(`Escuela: ${schoolName}`, { align: 'left' });
    doc.fontSize(18).text(`Código: ${codigo_ce}`, { align: 'left' });
    doc.moveDown(2);
  };

  const addPageWithHeader = () => {
    doc.addPage();
    drawDocumentHeader();
    currentY = doc.y;
  };

  // Page 1 header
  drawDocumentHeader();

  // Table configuration for labels
  const tableTop = doc.y;
  const columnWidths = {
    // NOTE: Sizes are tuned to exactly fill a LETTER landscape page with 50pt margins (692pt total).
    no: 40,
    codigo_ce: 90,
    escuela: 250,
    nombre: 312,
  };
  const rowHeight = 25;

  let currentY = tableTop;

  // Helper to draw table header for labels
  const drawHeader = (y: number) => {
    doc.fontSize(9).font('Helvetica-Bold');

    let x = 50;

    // No. (Correlative)
    doc.rect(x, y, columnWidths.no, rowHeight).stroke();
    doc.text('NO.', x + 5, y + 8, { width: columnWidths.no - 10, align: 'center' });
    x += columnWidths.no;

    // Código CE
    doc.rect(x, y, columnWidths.codigo_ce, rowHeight).stroke();
    doc.text('CÓDIGO CE', x + 5, y + 8, { width: columnWidths.codigo_ce - 10, align: 'center' });
    x += columnWidths.codigo_ce;

    // Escuela
    doc.rect(x, y, columnWidths.escuela, rowHeight).stroke();
    doc.text('ESCUELA', x + 5, y + 8, { width: columnWidths.escuela - 10, align: 'center' });
    x += columnWidths.escuela;

    // Nombre Estudiante
    doc.rect(x, y, columnWidths.nombre, rowHeight).stroke();
    doc.text('NOMBRE ESTUDIANTE', x + 5, y + 8, {
      width: columnWidths.nombre - 10,
      align: 'center',
    });

    return y + rowHeight;
  };

  const bottomLimitY = doc.page.height - 50;

  const ensureSpace = (minHeight: number) => {
    if (currentY + minHeight <= bottomLimitY) return;
    addPageWithHeader();
  };

  const getGradeKey = (value: string | null | undefined) => {
    const normalized = (value || '').trim();
    return normalized.length > 0 ? normalized : 'N/A';
  };

  // Group by grado (each grade renders as its own table in the same PDF)
  const studentsByGrade = new Map<string, StudentReportRow[]>();
  for (const s of students) {
    const gradeKey = getGradeKey(s.grado);
    const list = studentsByGrade.get(gradeKey);
    if (list) list.push(s);
    else studentsByGrade.set(gradeKey, [s]);
  }

  const gradeKeys = Array.from(studentsByGrade.keys()).sort((a, b) =>
    a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
  );

  const drawGradeTitle = (grade: string) => {
    doc.font('Helvetica-Bold').fontSize(16);

    doc.text(`Grado: ${grade}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 2;
  };

  const calculateTextHeight = (text: string, width: number, fontSize: number): number => {
    doc.fontSize(fontSize);
    return doc.heightOfString(text, { width });
  };

  const drawStudentRow = (student: StudentReportRow, displayIndex: number) => {
    // Calculate required height for this row based on longest text
    doc.font('Helvetica').fontSize(8);
    const schoolNameHeight = calculateTextHeight(schoolName, columnWidths.escuela - 10, 8);
    const studentNameHeight = calculateTextHeight(
      student.nombre_estudiante || '',
      columnWidths.nombre - 10,
      8
    );

    // Use maximum height needed, with minimum of 25 and padding
    const contentHeight = Math.max(schoolNameHeight, studentNameHeight);
    const dynamicRowHeight = Math.max(rowHeight, contentHeight + 12);

    let x = 50;

    // No. (Correlative)
    doc.rect(x, currentY, columnWidths.no, dynamicRowHeight).stroke();
    doc.text(displayIndex.toString(), x + 5, currentY + 8, {
      width: columnWidths.no - 10,
      align: 'center',
    });
    x += columnWidths.no;

    // Código CE
    doc.rect(x, currentY, columnWidths.codigo_ce, dynamicRowHeight).stroke();
    doc.text(codigo_ce, x + 5, currentY + 8, {
      width: columnWidths.codigo_ce - 10,
      align: 'center',
    });
    x += columnWidths.codigo_ce;

    // Escuela
    doc.rect(x, currentY, columnWidths.escuela, dynamicRowHeight).stroke();
    doc.text(schoolName, x + 5, currentY + 6, {
      width: columnWidths.escuela - 10,
    });
    x += columnWidths.escuela;

    // Nombre Estudiante
    doc.rect(x, currentY, columnWidths.nombre, dynamicRowHeight).stroke();
    doc.text(student.nombre_estudiante || '', x + 5, currentY + 6, {
      width: columnWidths.nombre - 10,
    });

    currentY += dynamicRowHeight;
  };

  doc.font('Helvetica').fontSize(8);

  const labelHeight = rowHeight + rowHeight; // Header + data row
  const labelSpacing = rowHeight; // One blank line between labels

  for (let g = 0; g < gradeKeys.length; g++) {
    const grade = gradeKeys[g];
    const gradeStudents = studentsByGrade.get(grade) ?? [];

    // Each grade starts on a new page (except the first one which continues after the main title)
    if (g > 0) {
      addPageWithHeader();
    }

    // Ensure there's room for: title + one label (header + row + spacing)
    ensureSpace(48 + labelHeight + labelSpacing);

    drawGradeTitle(grade);

    for (let i = 0; i < gradeStudents.length; i++) {
      // Pre-calculate row height to check if we have space
      const student = gradeStudents[i];
      doc.font('Helvetica').fontSize(8);
      const schoolNameHeight = doc.heightOfString(schoolName, {
        width: columnWidths.escuela - 10,
      });
      const studentNameHeight = doc.heightOfString(student.nombre_estudiante || '', {
        width: columnWidths.nombre - 10,
      });
      const contentHeight = Math.max(schoolNameHeight, studentNameHeight);
      const estimatedRowHeight = Math.max(rowHeight, contentHeight + 12);
      const estimatedLabelHeight = rowHeight + estimatedRowHeight; // Header + data row

      // Check if we have space for header + row + spacing
      if (currentY + estimatedLabelHeight + labelSpacing > bottomLimitY) {
        addPageWithHeader();
        ensureSpace(48);
        drawGradeTitle(grade);
      }

      // Draw header for this label
      currentY = drawHeader(currentY);
      doc.font('Helvetica').fontSize(8);

      // Draw student row
      drawStudentRow(student, i + 1);

      // Add blank line spacing after each label
      currentY += labelSpacing;
    }
  }

  // Final summary (rendered once, at the end of the file)
  currentY += 18;
  ensureSpace(70);
  doc.font('Helvetica-Bold').fontSize(12).text('Resumen', 50, currentY, { align: 'left' });
  currentY = doc.y + 6;
  doc.font('Helvetica').fontSize(14);
  doc.text(`Grados: ${gradeKeys.length}`, 50, currentY, { align: 'left' });
  currentY = doc.y + 2;
  doc.text(`Estudiantes: ${students.length}`, 50, currentY, { align: 'left' });
  currentY = doc.y + 2;
  doc.text(`Generado: ${generatedAtLabel}`, 50, currentY, { align: 'left' });

  // Finalize PDF
  addPageNumbers(doc);
  doc.end();

  return doc;
}
