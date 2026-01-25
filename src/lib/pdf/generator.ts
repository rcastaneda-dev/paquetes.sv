import PDFDocument from 'pdfkit';
import type { StudentReportRow } from '@/types/database';

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

  const summarizeBodega = (rows: StudentReportRow[]) => {
    const values = Array.from(
      new Set(rows.map(s => (s.bodega_produccion || '').trim()).filter(v => v.length > 0))
    );

    if (values.length === 0) return 'N/A';
    if (values.length === 1) return values[0];
    if (values.length <= 3) return values.join(', ');
    return `${values.slice(0, 3).join(', ')} (+${values.length - 3} más)`;
  };

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  const generatedAtLabel = new Date().toLocaleString('es-SV');

  const drawDocumentHeader = () => {
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
    doc.fontSize(10).font('Helvetica-Bold');

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

  const drawGradeTitle = (grade: string, bodegaLabel: string) => {
    doc.font('Helvetica-Bold').fontSize(16);

    doc.text(`Bodega producción: ${bodegaLabel}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 8;

    doc.text(`Grado: ${grade}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 2;
  };

  const drawStudentRow = (student: StudentReportRow, displayIndex: number) => {
    let x = 50;

    // No. (Correlative)
    doc.rect(x, currentY, columnWidths.no, rowHeight).stroke();
    doc.text(displayIndex.toString(), x + 5, currentY + 8, {
      width: columnWidths.no - 10,
      align: 'center',
    });
    x += columnWidths.no;

    // Name
    doc.rect(x, currentY, columnWidths.name, rowHeight).stroke();
    doc.text(student.nombre_estudiante || '', x + 5, currentY + 8, {
      width: columnWidths.name - 10,
      height: rowHeight - 4,
      ellipsis: true,
    });
    x += columnWidths.name;

    // Sex
    doc.rect(x, currentY, columnWidths.sex, rowHeight).stroke();
    doc.text(student.sexo || '', x + 5, currentY + 8, {
      width: columnWidths.sex - 10,
      align: 'center',
    });
    x += columnWidths.sex;

    // Age
    doc.rect(x, currentY, columnWidths.age, rowHeight).stroke();
    doc.text(student.edad?.toString() || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.age - 10,
      align: 'center',
    });
    x += columnWidths.age;

    // Shirt
    doc.rect(x, currentY, columnWidths.shirt, rowHeight).stroke();
    doc.text(student.camisa || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.shirt - 10,
      align: 'center',
    });
    x += columnWidths.shirt;

    // Pants/Skirt
    doc.rect(x, currentY, columnWidths.pants, rowHeight).stroke();
    doc.text(student.pantalon_falda || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.pants - 10,
      align: 'center',
    });
    x += columnWidths.pants;

    // Shoes
    doc.rect(x, currentY, columnWidths.shoe, rowHeight).stroke();
    doc.text(student.zapato || 'N/A', x + 5, currentY + 8, {
      width: columnWidths.shoe - 10,
      align: 'center',
    });

    currentY += rowHeight;
  };

  doc.font('Helvetica').fontSize(10);

  for (let g = 0; g < gradeKeys.length; g++) {
    const grade = gradeKeys[g];
    const gradeStudents = studentsByGrade.get(grade) ?? [];
    const bodegaLabel = summarizeBodega(gradeStudents);

    // Each grade starts on a new page (except the first one which continues after the main title)
    if (g > 0) {
      addPageWithHeader();
    }

    // Ensure there's room for: title + header + at least 1 row
    ensureSpace(48 + rowHeight + rowHeight);

    drawGradeTitle(grade, bodegaLabel);
    currentY = drawHeader(currentY);
    doc.font('Helvetica').fontSize(10);

    for (let i = 0; i < gradeStudents.length; i++) {
      if (currentY + rowHeight > bottomLimitY) {
        addPageWithHeader();
        ensureSpace(48 + rowHeight);
        drawGradeTitle(grade, bodegaLabel);
        currentY = drawHeader(currentY);
        doc.font('Helvetica').fontSize(10);
      }

      drawStudentRow(gradeStudents[i], i + 1);
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
  doc.end();

  return doc;
}

/**
 * Generates a PDF with student labels (simplified table with basic identification).
 * Returns a readable stream for efficient memory usage.
 */
export function generateStudentLabelsPDF(options: PDFGeneratorOptions): PDFDocumentInstance {
  const { schoolName, codigo_ce, students } = options;

  const summarizeBodega = (rows: StudentReportRow[]) => {
    const values = Array.from(
      new Set(rows.map(s => (s.bodega_produccion || '').trim()).filter(v => v.length > 0))
    );

    if (values.length === 0) return 'N/A';
    if (values.length === 1) return values[0];
    if (values.length <= 3) return values.join(', ');
    return `${values.slice(0, 3).join(', ')} (+${values.length - 3} más)`;
  };

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  const generatedAtLabel = new Date().toLocaleString('es-SV');

  const drawDocumentHeader = () => {
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
    doc.fontSize(10).font('Helvetica-Bold');

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

  const drawGradeTitle = (grade: string, bodegaLabel: string) => {
    doc.font('Helvetica-Bold').fontSize(16);

    doc.text(`Bodega producción: ${bodegaLabel}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 8;

    doc.text(`Grado: ${grade}`, 50, currentY, { align: 'left' });
    currentY = doc.y + 2;
  };

  const drawStudentRow = (student: StudentReportRow, displayIndex: number) => {
    let x = 50;

    // No. (Correlative)
    doc.rect(x, currentY, columnWidths.no, rowHeight).stroke();
    doc.text(displayIndex.toString(), x + 5, currentY + 8, {
      width: columnWidths.no - 10,
      align: 'center',
    });
    x += columnWidths.no;

    // Código CE
    doc.rect(x, currentY, columnWidths.codigo_ce, rowHeight).stroke();
    doc.text(codigo_ce, x + 5, currentY + 8, {
      width: columnWidths.codigo_ce - 10,
      align: 'center',
    });
    x += columnWidths.codigo_ce;

    // Escuela
    doc.rect(x, currentY, columnWidths.escuela, rowHeight).stroke();
    doc.text(schoolName, x + 5, currentY + 8, {
      width: columnWidths.escuela - 10,
      height: rowHeight - 4,
      ellipsis: true,
    });
    x += columnWidths.escuela;

    // Nombre Estudiante
    doc.rect(x, currentY, columnWidths.nombre, rowHeight).stroke();
    doc.text(student.nombre_estudiante || '', x + 5, currentY + 8, {
      width: columnWidths.nombre - 10,
      height: rowHeight - 4,
      ellipsis: true,
    });

    currentY += rowHeight;
  };

  doc.font('Helvetica').fontSize(10);

  const labelHeight = rowHeight + rowHeight; // Header + data row
  const labelSpacing = rowHeight; // One blank line between labels

  for (let g = 0; g < gradeKeys.length; g++) {
    const grade = gradeKeys[g];
    const gradeStudents = studentsByGrade.get(grade) ?? [];
    const bodegaLabel = summarizeBodega(gradeStudents);

    // Each grade starts on a new page (except the first one which continues after the main title)
    if (g > 0) {
      addPageWithHeader();
    }

    // Ensure there's room for: title + one label (header + row + spacing)
    ensureSpace(48 + labelHeight + labelSpacing);

    drawGradeTitle(grade, bodegaLabel);

    for (let i = 0; i < gradeStudents.length; i++) {
      // Check if we have space for header + row + spacing
      if (currentY + labelHeight + labelSpacing > bottomLimitY) {
        addPageWithHeader();
        ensureSpace(48);
        drawGradeTitle(grade, bodegaLabel);
      }

      // Draw header for this label
      currentY = drawHeader(currentY);
      doc.font('Helvetica').fontSize(10);

      // Draw student row
      drawStudentRow(gradeStudents[i], i + 1);

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
  doc.end();

  return doc;
}
