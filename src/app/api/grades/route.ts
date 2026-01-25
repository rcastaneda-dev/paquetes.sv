import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET() {
  try {
    const { data, error } = await supabaseServer.rpc('get_grades');

    if (error) {
      console.error('Error fetching grades:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const grades = data?.map((row: { grado: string }) => row.grado) || [];
    return NextResponse.json({ grades });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
