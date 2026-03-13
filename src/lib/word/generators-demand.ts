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
  TableLayoutType,
} from 'docx';
import type { DemandRow, ItemType, SchoolDemandGroup } from '@/types/database';
import { groupAndSortDemandBySchool } from '@/lib/reports/demand-aggregation';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert YYYY-MM-DD to DD-MM-YYYY for display */
function formatDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return isoDate;
}

/** Get the referencia code for a school+item and return a left-aligned paragraph (or null) */
function createReferenciaParagraph(
  school: SchoolDemandGroup,
  itemType: ItemType
): Paragraph | null {
  const row = school.rows.find(r => r.item === itemType && r.referencia);
  const code = row?.referencia;
  if (!code) return null;
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 0 },
    children: [
      new TextRun({
        text: code,
        bold: true,
        size: 16, // 8pt in half-points
        font: 'Arial',
      }),
    ],
  });
}

const buildInternalRefCode = (school: SchoolDemandGroup): string => {
  const items = new Set(school.rows.map(r => r.item));
  const parts: string[] = [];
  if (items.has('CAJAS')) parts.push('C');
  if (items.has('UNIFORMES')) parts.push('U');
  if (items.has('ZAPATOS')) parts.push('Z');
  return parts.join('-');
};

export const getInternalRefCodes = (schools: SchoolDemandGroup[]): string[] =>
  schools.map(buildInternalRefCode);

const createInternalRefParagraph = (school: SchoolDemandGroup): Paragraph => {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [
      new TextRun({ text: buildInternalRefCode(school), bold: true, size: 16, font: 'Arial' }),
    ],
  });
};

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
    children: [new TextRun({ text: title, bold: true, size: 24, font: 'Arial' })],
  });
}

/** School header font size: 8pt (2pt smaller than default 10pt) */
const SCHOOL_HEADER_SIZE = 16; // 8pt in half-points

function createSchoolHeader(school: SchoolDemandGroup): Paragraph[] {
  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  const schoolHeaderStyle = { bold: true, size: SCHOOL_HEADER_SIZE, font: 'Arial' } as const;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: school.nombre_ce.toUpperCase(),
          ...schoolHeaderStyle,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `CODIGO: ${school.codigo_ce.toUpperCase()}`,
          ...schoolHeaderStyle,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`,
          ...schoolHeaderStyle,
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
        new TextRun({ text: 'DATOS DE LOS PRODUCTOS', bold: true, size: 20, font: 'Arial' }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'Fecha: __________________________________  Hora: __________________________________  Bodega: __________________________________',
          ...fieldStyle,
        }),
      ],
    }),
  ];
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 },
  right: { style: BorderStyle.NONE, size: 0 },
};

function createTransportFooter(): (Paragraph | Table)[] {
  const fieldStyle = { size: 16, font: 'Arial' } as const;
  const COL_LEFT = 5580;
  const COL_RIGHT = 5580;

  const rows: [string, string][] = [
    ['Motorista: ____________________________', 'Encargado del Despacho: _______________'],
    ['Placa: ________________________________', 'Firma del Encargado: __________________'],
    ['Telefono: _____________________________', 'Encargado del C.E.: ___________________'],
    ['Firma Motorista: ______________________', 'Firma: ________________________________'],
  ];

  const tableRows = rows.map(
    ([left, right]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: COL_LEFT, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: [
              new Paragraph({
                spacing: { after: 350 },
                children: [new TextRun({ text: left, ...fieldStyle })],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_RIGHT, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: [
              new Paragraph({
                spacing: { after: 350 },
                children: [new TextRun({ text: right, ...fieldStyle })],
              }),
            ],
          }),
        ],
      })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  });

  return [
    new Paragraph({
      spacing: { before: 400, after: 100 },
      children: [
        new TextRun({ text: 'DATOS DEL TRANSPORTE', bold: true, size: 20, font: 'Arial' }),
      ],
    }),
    table,
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
        spacing: { before: 20, after: 20 },
        children: [new TextRun({ text, bold: true, size: 18, font: 'Arial' })],
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
        spacing: { before: 10, after: 10 },
        children: [new TextRun({ text, bold, size: 16, font: 'Arial' })],
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

function buildCajasSection(school: SchoolDemandGroup, faltantes: boolean): (Paragraph | Table)[] {
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

  const refParagraph = createReferenciaParagraph(school, 'CAJAS');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (CAJAS)' + (faltantes ? ' FALTANTES' : '')),
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

function buildUniformesSection(
  school: SchoolDemandGroup,
  faltantes: boolean
): (Paragraph | Table)[] {
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

  const refParagraph = createReferenciaParagraph(school, 'UNIFORMES');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (UNIFORMES)' + (faltantes ? ' FALTANTES' : '')),
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

function buildZapatosSection(school: SchoolDemandGroup, faltantes: boolean): (Paragraph | Table)[] {
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

  const refParagraph = createReferenciaParagraph(school, 'ZAPATOS');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph('ACTA DE RECEPCIÓN (ZAPATOS)' + (faltantes ? ' FALTANTES' : '')),
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

type SectionBuilder = (school: SchoolDemandGroup, faltantes: boolean) => (Paragraph | Table)[];

async function buildDemandWord(
  demandRows: DemandRow[],
  sectionBuilder: SectionBuilder,
  itemType: ItemType,
  faltantes: boolean
): Promise<Buffer> {
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === itemType).reduce((sum, r) => sum + r.cantidad, 0) > 0
  );

  const sections = schools.map((school, idx) => ({
    properties: {
      type: idx === 0 ? undefined : SectionType.NEXT_PAGE,
      page: {
        size: { orientation: PageOrientation.PORTRAIT },
        margin: { top: 720, bottom: 600, left: 540, right: 540 },
      },
    },
    children: sectionBuilder(school, faltantes),
  }));

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Generate Acta de Recepción de Cajas Word document from demand data */
export async function generateActaRecepcionCajasWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildDemandWord(demandRows, buildCajasSection, 'CAJAS', options?.faltantes ?? true);
}

/** Generate Acta de Recepción de Uniformes Word document from demand data */
export async function generateActaRecepcionUniformesWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildDemandWord(
    demandRows,
    buildUniformesSection,
    'UNIFORMES',
    options?.faltantes ?? true
  );
}

/** Generate Acta de Recepción de Zapatos Word document from demand data */
export async function generateActaRecepcionZapatosWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildDemandWord(demandRows, buildZapatosSection, 'ZAPATOS', options?.faltantes ?? true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda helpers
// ─────────────────────────────────────────────────────────────────────────────

function createComandaSchoolHeader(school: SchoolDemandGroup): Paragraph[] {
  const departamento = (school.departamento || 'N/A').toUpperCase();
  const distrito = (school.distrito || 'N/A').toUpperCase();
  const zona = (school.zona || 'N/A').toUpperCase();
  const transporte = (school.transporte || 'N/A').toUpperCase();
  const schoolHeaderStyle = { bold: true, size: SCHOOL_HEADER_SIZE, font: 'Arial' } as const;
  const zonaStyle = { bold: true, size: 20, font: 'Arial' } as const;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: school.nombre_ce.toUpperCase(), ...schoolHeaderStyle })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `CODIGO: ${school.codigo_ce.toUpperCase()}`, ...schoolHeaderStyle }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `DEPARTAMENTO: ${departamento} - DISTRITO: ${distrito}`,
          ...schoolHeaderStyle,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `ZONA: ${zona} - TIPO DE VEHICULO: ${transporte}`, ...zonaStyle }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'HORA DE INICIO:  ___________________ HORA DE FINALIZACION: ___________________',
          size: 20,
          font: 'Arial',
        }),
      ],
    }),
  ];
}

function createFechaDespachoLine(formattedDate: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [
      new TextRun({
        text: 'Fecha de despacho: ___________________  Fecha entrega C.E.: ',
        size: 20,
        font: 'Arial',
      }),
      new TextRun({
        text: ` ${formattedDate}`,
        bold: true,
        underline: {},
        size: 20,
        font: 'Arial',
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Cajas Word (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaCajasSection(
  school: SchoolDemandGroup,
  faltantes: boolean
): (Paragraph | Table)[] {
  const cajasRows = school.rows
    .filter(r => r.item === 'CAJAS')
    .sort((a, b) => a.categoria.localeCompare(b.categoria));

  const totalCantidad = cajasRows.reduce((sum, r) => sum + r.cantidad, 0);

  const COL1 = 1200; // NO
  const COL2 = 7160; // GRADO
  const COL3 = 2800; // CANTIDAD

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

  const refParagraph = createReferenciaParagraph(school, 'CAJAS');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph('DETALLE DE PROGRAMACIÓN DE CAJAS' + (faltantes ? ' FALTANTES' : '')),
    createFechaDespachoLine(formatDate(school.fecha_inicio)),
    ...createComandaSchoolHeader(school),
    table
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Uniformes Word (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaUniformesSection(
  school: SchoolDemandGroup,
  faltantes: boolean
): (Paragraph | Table)[] {
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

  const refParagraph = createReferenciaParagraph(school, 'UNIFORMES');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph(
      'FICHA DE DISTRIBUCION POR ESCUELA (UNIFORMES)' + (faltantes ? ' FALTANTES' : '')
    ),
    createFechaDespachoLine(formatDate(school.fecha_inicio)),
    ...createComandaSchoolHeader(school),
    table,
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: `TOTAL PIEZAS: ${totalPiezas}`, bold: true, size: 20, font: 'Arial' }),
      ],
    })
  );

  return elements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comanda Zapatos Word (portrait)
// ─────────────────────────────────────────────────────────────────────────────

function buildComandaZapatosSection(
  school: SchoolDemandGroup,
  faltantes: boolean
): (Paragraph | Table)[] {
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

  const refParagraph = createReferenciaParagraph(school, 'ZAPATOS');
  if (refParagraph) elements.push(refParagraph);

  const internalRefParagraph = createInternalRefParagraph(school);
  if (internalRefParagraph) elements.push(internalRefParagraph);

  if (logo) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [logo],
      })
    );
  }

  elements.push(
    createTitleParagraph(
      'FICHA DE DISTRIBUCION POR ESCUELA (ZAPATOS)' + (faltantes ? ' FALTANTES' : '')
    ),
    createFechaDespachoLine(formatDate(school.fecha_inicio)),
    ...createComandaSchoolHeader(school),
    table,
    new Paragraph({
      spacing: { before: 200 },
      children: [
        new TextRun({ text: `TOTAL PIEZAS: ${totalPiezas}`, bold: true, size: 20, font: 'Arial' }),
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
  itemType: ItemType,
  landscape: boolean,
  faltantes: boolean
): Promise<Buffer> {
  const schools = groupAndSortDemandBySchool(demandRows).filter(
    s => s.rows.filter(r => r.item === itemType).reduce((sum, r) => sum + r.cantidad, 0) > 0
  );

  const orientation = landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT;

  const sections = schools.map((school, idx) => ({
    properties: {
      type: idx === 0 ? undefined : SectionType.NEXT_PAGE,
      page: {
        size: { orientation },
        margin: { top: 720, bottom: 600, left: 540, right: 540 },
      },
    },
    children: sectionBuilder(school, faltantes),
  }));

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Generate Comanda de Cajas Word document from demand data (portrait) */
export async function generateComandaCajasWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildComandaWord(
    demandRows,
    buildComandaCajasSection,
    'CAJAS',
    false,
    options?.faltantes ?? true
  );
}

/** Generate Comanda de Uniformes Word document from demand data (portrait) */
export async function generateComandaUniformesWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildComandaWord(
    demandRows,
    buildComandaUniformesSection,
    'UNIFORMES',
    false,
    options?.faltantes ?? true
  );
}

/** Generate Comanda de Zapatos Word document from demand data (portrait) */
export async function generateComandaZapatosWord(
  demandRows: DemandRow[],
  options?: { faltantes?: boolean }
): Promise<Buffer> {
  return buildComandaWord(
    demandRows,
    buildComandaZapatosSection,
    'ZAPATOS',
    false,
    options?.faltantes ?? true
  );
}
