/**
 * Demand-based Word (.docx) generators for Acta de Recepción reports.
 *
 * Replicates the same visual layout as the PDF generators but outputs
 * .docx format using the 'docx' npm package. Quantities from school_demand
 * are used as-is — no vacíos calculations.
 */
import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  ImageRun,
  PageOrientation,
  SectionType,
  HeadingLevel,
  TableLayoutType,
} from 'docx';
import type { DemandRow, SchoolDemandGroup } from '@/types/database';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function groupDemandBySchool(rows: DemandRow[]): SchoolDemandGroup[] {
  const map = new Map<string, SchoolDemandGroup>();

  for (const row of rows) {
    if (!map.has(row.school_codigo_ce)) {
      map.set(row.school_codigo_ce, {
        codigo_ce: row.school_codigo_ce,
        nombre_ce: row.nombre_ce,
        departamento: row.departamento,
        distrito: row.distrito,
        zona: row.zona,
        transporte: row.transporte,
        rows: [],
      });
    }
    map.get(row.school_codigo_ce)!.rows.push(row);
  }

  return Array.from(map.values()).sort((a, b) => {
    const districtCompare = a.distrito.localeCompare(b.distrito, 'es');
    if (districtCompare !== 0) return districtCompare;
    const totalA = a.rows.reduce((s, r) => s + r.cantidad, 0);
    const totalB = b.rows.reduce((s, r) => s + r.cantidad, 0);
    return totalB - totalA;
  });
}

function getLogoImageRun(): ImageRun | null {
  const logoPath = path.join(process.cwd(), 'public', 'goes_logo_2.png');
  if (!fs.existsSync(logoPath)) return null;
  const data = fs.readFileSync(logoPath);
  return new ImageRun({ data, transformation: { width: 50, height: 50 }, type: 'png' });
}

function createTitleParagraph(title: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: title, bold: true, size: 26, font: 'Arial' })],
  });
}

function createSchoolHeader(school: SchoolDemandGroup): Paragraph[] {
  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: school.nombre_ce.toUpperCase(),
          bold: true,
          size: 22,
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `CODIGO: ${school.codigo_ce.toUpperCase()}`,
          bold: true,
          size: 22,
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`,
          bold: true,
          size: 22,
          font: 'Arial',
        }),
      ],
    }),
  ];
}

function createPreTableFields(): Paragraph[] {
  const fieldStyle = { size: 18, font: 'Arial' };
  return [
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'DATOS DE LOS PRODUCTOS', bold: true, size: 22, font: 'Arial' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: 'Fecha: ________________________________', ...fieldStyle })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: 'Hora: ________________________________', ...fieldStyle })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: 'Bodega: ________________________________', ...fieldStyle })],
    }),
  ];
}

function createTransportFooter(): Paragraph[] {
  const fieldStyle = { size: 18, font: 'Arial' };
  return [
    new Paragraph({
      spacing: { before: 400, after: 100 },
      children: [
        new TextRun({ text: 'DATOS DEL TRANSPORTE', bold: true, size: 22, font: 'Arial' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Nombre del conductor: ________________________________',
          ...fieldStyle,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: 'Número de placa: ________________________________', ...fieldStyle }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Número de contacto: ________________________________',
          ...fieldStyle,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Firma del conductor: ________________________________',
          ...fieldStyle,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Firma y Nombre del Encargado del Despacho: ________________________________',
          ...fieldStyle,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Firma y Nombre del Encargado del Centro Educativo: ________________________________',
          ...fieldStyle,
        }),
      ],
    }),
  ];
}

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1 },
  bottom: { style: BorderStyle.SINGLE, size: 1 },
  left: { style: BorderStyle.SINGLE, size: 1 },
  right: { style: BorderStyle.SINGLE, size: 1 },
};

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, size: 20, font: 'Arial' })],
      }),
    ],
  });
}

function dataCell(text: string, width: number, bold = false): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold, size: 18, font: 'Arial' })],
      }),
    ],
  });
}

function emptyCell(width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [new Paragraph({})],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cajas Word
// ─────────────────────────────────────────────────────────────────────────────

function buildCajasSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  const totalCantidad = cajasRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 5000;
  const COL2 = 2000;
  const COL3 = 4160;

  const tableRows = [
    new TableRow({
      children: [
        headerCell('GRADO', COL1),
        headerCell('CANTIDAD', COL2),
        headerCell('COMENTARIOS/OBSERVACIONES', COL3),
      ],
    }),
    ...cajasRows.map(
      row =>
        new TableRow({
          children: [
            dataCell(row.categoria, COL1),
            dataCell(row.cantidad.toString(), COL2),
            emptyCell(COL3),
          ],
        })
    ),
    new TableRow({
      children: [
        dataCell('TOTAL', COL1, true),
        dataCell(totalCantidad.toString(), COL2, true),
        emptyCell(COL3),
      ],
    }),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (CAJAS) FALTANTES'),
    ...createSchoolHeader(school),
    ...createPreTableFields(),
    table,
    ...createTransportFooter()
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniformes Word
// ─────────────────────────────────────────────────────────────────────────────

function buildUniformesSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const uniformeRows = school.rows
    .filter(r => r.item === 'UNIFORMES')
    .sort((a, b) => {
      const tipoCompare = a.tipo.localeCompare(b.tipo);
      if (tipoCompare !== 0) return tipoCompare;
      return a.categoria.localeCompare(b.categoria);
    });

  const totalCantidad = uniformeRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 5000;
  const COL2 = 2000;
  const COL3 = 4160;

  const tableRows = [
    new TableRow({
      children: [
        headerCell('TIPO/TALLA', COL1),
        headerCell('CANTIDAD', COL2),
        headerCell('COMENTARIOS/OBSERVACIONES', COL3),
      ],
    }),
    ...uniformeRows.map(
      row =>
        new TableRow({
          children: [
            dataCell(`${row.tipo} - ${row.categoria}`, COL1),
            dataCell(row.cantidad.toString(), COL2),
            emptyCell(COL3),
          ],
        })
    ),
    new TableRow({
      children: [
        dataCell('TOTAL', COL1, true),
        dataCell(totalCantidad.toString(), COL2, true),
        emptyCell(COL3),
      ],
    }),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (UNIFORMES) FALTANTES'),
    ...createSchoolHeader(school),
    ...createPreTableFields(),
    table,
    ...createTransportFooter()
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zapatos Word
// ─────────────────────────────────────────────────────────────────────────────

function buildZapatosSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const zapatosRows = school.rows
    .filter(r => r.item === 'ZAPATOS')
    .sort((a, b) => {
      const numA = parseInt(a.categoria, 10) || 0;
      const numB = parseInt(b.categoria, 10) || 0;
      return numA - numB;
    });

  const totalCantidad = zapatosRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 1500;
  const COL2 = 2000;
  const COL3 = 7660;

  const tableRows = [
    new TableRow({
      children: [
        headerCell('TALLA', COL1),
        headerCell('CANTIDAD', COL2),
        headerCell('COMENTARIOS/OBSERVACIONES', COL3),
      ],
    }),
    ...zapatosRows.map(
      row =>
        new TableRow({
          children: [
            dataCell(row.categoria, COL1),
            dataCell(row.cantidad.toString(), COL2),
            emptyCell(COL3),
          ],
        })
    ),
    new TableRow({
      children: [
        dataCell('TOTAL', COL1, true),
        dataCell(totalCantidad.toString(), COL2, true),
        emptyCell(COL3),
      ],
    }),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (ZAPATOS) FALTANTES'),
    ...createSchoolHeader(school),
    ...createPreTableFields(),
    table,
    ...createTransportFooter()
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public generator functions
// ─────────────────────────────────────────────────────────────────────────────

type SectionBuilder = (school: SchoolDemandGroup) => (Paragraph | Table)[];

async function buildDemandWord(
  demandRows: DemandRow[],
  sectionBuilder: SectionBuilder,
  itemType: string
): Promise<Buffer> {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === itemType).reduce((sum, r) => sum + r.cantidad, 0) > 0
  );

  const sections = schools.map((school, idx) => ({
    properties: {
      type: idx === 0 ? undefined : SectionType.NEXT_PAGE,
      page: {
        size: { orientation: PageOrientation.PORTRAIT },
        margin: { top: 720, bottom: 720, left: 540, right: 540 },
      },
    },
    children: sectionBuilder(school),
  }));

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Generate Acta de Recepción de Cajas Word document from demand data */
export async function generateActaRecepcionCajasWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildDemandWord(demandRows, buildCajasSection, 'CAJAS');
}

/** Generate Acta de Recepción de Uniformes Word document from demand data */
export async function generateActaRecepcionUniformesWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildDemandWord(demandRows, buildUniformesSection, 'UNIFORMES');
}

/** Generate Acta de Recepción de Zapatos Word document from demand data */
export async function generateActaRecepcionZapatosWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildDemandWord(demandRows, buildZapatosSection, 'ZAPATOS');
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda helpers
// ─────────────────────────────────────────────────────────────────────────────

function createComandaSchoolHeader(school: SchoolDemandGroup): Paragraph[] {
  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  const zona = (school.zona || 'N/A').toUpperCase();
  const transporte = (school.transporte || 'N/A').toUpperCase();
  const headerStyle = { bold: true, size: 22, font: 'Arial' } as const;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: school.nombre_ce.toUpperCase(), ...headerStyle })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `CODIGO: ${school.codigo_ce.toUpperCase()}`, ...headerStyle }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`,
          ...headerStyle,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `ZONA: ${zona} - TIPO DE VEHICULO: ${transporte}`, ...headerStyle }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'HORA DE INICIO:  ___________________ HORA DE FINALIZACION: ___________________',
          size: 22,
          font: 'Arial',
        }),
      ],
    }),
  ];
}

function createFechaDespachoLine(): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [
      new TextRun({
        text: 'Fecha de despacho: ___________________  Fecha entrega C.E.: ___________________',
        size: 22,
        font: 'Arial',
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Cajas Word (landscape)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaCajasSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  const totalCantidad = cajasRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 1600; // NO
  const COL2 = 9560; // GRADO
  const COL3 = 3600; // CANTIDAD

  const tableRows = [
    new TableRow({
      children: [headerCell('NO', COL1), headerCell('GRADO', COL2), headerCell('CANTIDAD', COL3)],
    }),
    ...cajasRows.map(
      (row, idx) =>
        new TableRow({
          children: [
            dataCell((idx + 1).toString(), COL1),
            dataCell(row.categoria, COL2),
            dataCell(row.cantidad.toString(), COL3),
          ],
        })
    ),
    new TableRow({
      children: [
        dataCell('', COL1, true),
        dataCell('SUBTOTAL', COL2, true),
        dataCell(totalCantidad.toString(), COL3, true),
      ],
    }),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('DETALLE DE PROGRAMACIÓN DE CAJAS FALTANTES'),
    createFechaDespachoLine(),
    ...createComandaSchoolHeader(school),
    table
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Uniformes Word (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaUniformesSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const uniformeRows = school.rows
    .filter(r => r.item === 'UNIFORMES')
    .sort((a, b) => {
      const tipoCompare = a.tipo.localeCompare(b.tipo);
      if (tipoCompare !== 0) return tipoCompare;
      return a.categoria.localeCompare(b.categoria);
    });

  const totalPiezas = uniformeRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 7440; // TIPO/TALLA
  const COL2 = 3720; // CANTIDAD

  const tableRows = [
    new TableRow({
      children: [headerCell('TIPO/TALLA', COL1), headerCell('CANTIDAD', COL2)],
    }),
    ...uniformeRows.map(
      row =>
        new TableRow({
          children: [
            dataCell(`${row.tipo} - ${row.categoria}`, COL1),
            dataCell(row.cantidad.toString(), COL2),
          ],
        })
    ),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES) FALTANTES'),
    createFechaDespachoLine(),
    ...createComandaSchoolHeader(school),
    table,
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: `TOTAL PIEZAS: ${totalPiezas}`, bold: true, size: 22, font: 'Arial' }),
      ],
    })
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Zapatos Word (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaZapatosSection(school: SchoolDemandGroup): (Paragraph | Table)[] {
  const zapatosRows = school.rows
    .filter(r => r.item === 'ZAPATOS')
    .sort((a, b) => {
      const numA = parseInt(a.categoria, 10) || 0;
      const numB = parseInt(b.categoria, 10) || 0;
      return numA - numB;
    });

  const totalPiezas = zapatosRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 7440; // TALLA
  const COL2 = 3720; // CANTIDAD

  const tableRows = [
    new TableRow({
      children: [headerCell('TALLA', COL1), headerCell('CANTIDAD', COL2)],
    }),
    ...zapatosRows.map(
      row =>
        new TableRow({
          children: [dataCell(row.categoria, COL1), dataCell(row.cantidad.toString(), COL2)],
        })
    ),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  const logo = getLogoImageRun();
  const elements: (Paragraph | Table)[] = [];

  if (logo) {
    elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  }

  elements.push(
    createTitleParagraph('FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS) FALTANTES'),
    createFechaDespachoLine(),
    ...createComandaSchoolHeader(school),
    table,
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: `TOTAL PIEZAS: ${totalPiezas}`, bold: true, size: 22, font: 'Arial' }),
      ],
    })
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public comanda generator functions
// ─────────────────────────────────────────────────────────────────────────────

async function buildComandaWord(
  demandRows: DemandRow[],
  sectionBuilder: SectionBuilder,
  itemType: string,
  landscape: boolean
): Promise<Buffer> {
  const schools = groupDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === itemType).reduce((sum, r) => sum + r.cantidad, 0) > 0
  );

  const orientation = landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT;

  const sections = schools.map((school, idx) => ({
    properties: {
      type: idx === 0 ? undefined : SectionType.NEXT_PAGE,
      page: {
        size: { orientation },
        margin: { top: 720, bottom: 720, left: 540, right: 540 },
      },
    },
    children: sectionBuilder(school),
  }));

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Generate Comanda de Cajas Word document from demand data (landscape) */
export async function generateComandaCajasWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildComandaWord(demandRows, buildComandaCajasSection, 'CAJAS', true);
}

/** Generate Comanda de Uniformes Word document from demand data (portrait) */
export async function generateComandaUniformesWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildComandaWord(demandRows, buildComandaUniformesSection, 'UNIFORMES', false);
}

/** Generate Comanda de Zapatos Word document from demand data (portrait) */
export async function generateComandaZapatosWord(demandRows: DemandRow[]): Promise<Buffer> {
  return buildComandaWord(demandRows, buildComandaZapatosSection, 'ZAPATOS', false);
}
