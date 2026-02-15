import { NextRequest, NextResponse } from 'next/server';
import { querySchoolDemand } from '@/lib/supabase/demand-queries';
import { generateActaRecepcionCajasWord } from '@/lib/word/generators-demand';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const schoolCodigoCe = request.nextUrl.searchParams.get('school_codigo_ce') || undefined;
    const demandRows = await querySchoolDemand({ schoolCodigoCe });

    if (demandRows.length === 0) {
      return NextResponse.json({ error: 'No demand data found' }, { status: 404 });
    }

    const buffer = await generateActaRecepcionCajasWord(demandRows);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="acta-recepcion-cajas-demand.docx"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error generating demand Acta Cajas Word:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
