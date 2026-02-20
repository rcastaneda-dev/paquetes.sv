import { NextRequest, NextResponse } from 'next/server';
import { querySchoolDemand } from '@/lib/supabase/demand-queries';
import { generateComandaCajasPDFFromDemand } from '@/lib/pdf/generators-demand';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const schoolCodigoCe = request.nextUrl.searchParams.get('school_codigo_ce') || undefined;
    const faltantes = request.nextUrl.searchParams.get('faltantes') !== '0';
    const demandRows = await querySchoolDemand({ schoolCodigoCe });

    if (demandRows.length === 0) {
      return NextResponse.json({ error: 'No demand data found' }, { status: 404 });
    }

    const pdfStream = generateComandaCajasPDFFromDemand(demandRows, { faltantes });

    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);
    const suffix = faltantes ? '-faltantes' : '';

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="comanda-cajas${suffix}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error generating demand Comanda Cajas PDF:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
