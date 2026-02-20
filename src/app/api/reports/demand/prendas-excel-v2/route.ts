import { NextRequest, NextResponse } from 'next/server';
import { querySchoolDemand } from '@/lib/supabase/demand-queries';
import { generatePrendasDemandExcelV2 } from '@/lib/excel/generators-demand';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const schoolCodigoCe = request.nextUrl.searchParams.get('school_codigo_ce') || undefined;
    const faltantes = request.nextUrl.searchParams.get('faltantes') !== '0';
    const demandRows = await querySchoolDemand({ schoolCodigoCe });

    if (demandRows.length === 0) {
      return NextResponse.json({ error: 'No demand data found' }, { status: 404 });
    }

    const buffer = await generatePrendasDemandExcelV2(demandRows);
    const suffix = faltantes ? '-faltantes' : '';

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="prendas-acumulado${suffix}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error generating demand Prendas Excel V2:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
