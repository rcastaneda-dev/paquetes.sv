import PDFDocument from 'pdfkit';
import type { StudentReportRow } from '@/types/database';

export interface PDFGeneratorOptions {
  schoolName: string;
  grado: string;
  students: StudentReportRow[];
}

export type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

/**
 * Generates a PDF with a table of students and their uniform sizes.
 * Returns a readable stream for efficient memory usage.
 */
export function generateStudentReportPDF(options: PDFGeneratorOptions): PDFDocumentInstance {
  const { schoolName, grado, students } = options;

  const doc = new PDFDocument({
    size: 'LETTER',
    layout: 'landscape',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
  });

  // Title
  doc.fontSize(18).text(`${schoolName} - ${grado}`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generado: ${new Date().toLocaleString('es-SV')}`, { align: 'center' });
  doc.moveDown(2);

  // Table configuration
  const tableTop = doc.y;
  const columnWidths = {
    name: 180,
    sex: 60,
    age: 50,
    shirt: 80,
    pants: 80,
    shoe: 80,
  };
  const rowHeight = 25;

  let currentY = tableTop;

  // Helper to draw table header
  const drawHeader = (y: number) => {
    doc.fontSize(10).font('Helvetica-Bold');

    let x = 50;

    // Name
    doc.rect(x, y, columnWidths.name, rowHeight).stroke();
    doc.text('Nombre Estudiante', x + 5, y + 8, { width: columnWidths.name - 10 });
    x += columnWidths.name;

    // Sex
    doc.rect(x, y, columnWidths.sex, rowHeight).stroke();
    doc.text('Sexo', x + 5, y + 8, { width: columnWidths.sex - 10, align: 'center' });
    x += columnWidths.sex;

    // Age
    doc.rect(x, y, columnWidths.age, rowHeight).stroke();
    doc.text('Edad', x + 5, y + 8, { width: columnWidths.age - 10, align: 'center' });
    x += columnWidths.age;

    // Shirt
    doc.rect(x, y, columnWidths.shirt, rowHeight).stroke();
    doc.text('Camisa', x + 5, y + 8, { width: columnWidths.shirt - 10, align: 'center' });
    x += columnWidths.shirt;

    // Pants/Skirt
    doc.rect(x, y, columnWidths.pants, rowHeight).stroke();
    doc.text('Pantalón/Falda', x + 5, y + 8, { width: columnWidths.pants - 10, align: 'center' });
    x += columnWidths.pants;

    // Shoes
    doc.rect(x, y, columnWidths.shoe, rowHeight).stroke();
    doc.text('Zapato', x + 5, y + 8, { width: columnWidths.shoe - 10, align: 'center' });

    return y + rowHeight;
  };

  // Draw initial header
  currentY = drawHeader(currentY);

  // Draw rows
  doc.font('Helvetica');
  for (const student of students) {
    // Check if we need a new page
    if (currentY + rowHeight > doc.page.height - 50) {
      doc.addPage();
      currentY = 50;
      currentY = drawHeader(currentY);
    }

    let x = 50;

    // Name
    doc.rect(x, currentY, columnWidths.name, rowHeight).stroke();
    doc.text(student.nombre_estudiante || '', x + 5, currentY + 8, {
      width: columnWidths.name - 10,
      height: rowHeight - 4,
      ellipsis: true
    });
    x += columnWidths.name;

    // Sex
    doc.rect(x, currentY, columnWidths.sex, rowHeight).stroke();
    doc.text(student.sexo || '', x + 5, currentY + 8, { width: columnWidths.sex - 10, align: 'center' });
    x += columnWidths.sex;

    // Age
    doc.rect(x, currentY, columnWidths.age, rowHeight).stroke();
    doc.text(student.edad?.toString() || 'N/A', x + 5, currentY + 8, { width: columnWidths.age - 10, align: 'center' });
    x += columnWidths.age;

    // Shirt
    doc.rect(x, currentY, columnWidths.shirt, rowHeight).stroke();
    doc.text(student.camisa || 'N/A', x + 5, currentY + 8, { width: columnWidths.shirt - 10, align: 'center' });
    x += columnWidths.shirt;

    // Pants/Skirt
    doc.rect(x, currentY, columnWidths.pants, rowHeight).stroke();
    doc.text(student.pantalon_falda || 'N/A', x + 5, currentY + 8, { width: columnWidths.pants - 10, align: 'center' });
    x += columnWidths.pants;

    // Shoes
    doc.rect(x, currentY, columnWidths.shoe, rowHeight).stroke();
    doc.text(student.zapato || 'N/A', x + 5, currentY + 8, { width: columnWidths.shoe - 10, align: 'center' });

    currentY += rowHeight;
  }

  // Footer
  doc.fontSize(8).text(
    `Total estudiantes: ${students.length}`,
    50,
    doc.page.height - 40,
    { align: 'right' }
  );

  // Finalize PDF
  doc.end();

  return doc;
}
