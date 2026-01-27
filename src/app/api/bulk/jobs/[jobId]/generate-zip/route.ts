import { NextRequest, NextResponse } from 'next/server';

/**
 * Manual ZIP generation endpoint.
 *
 * Flow:
 * 1. User clicks "Generate ZIP" button → This endpoint is called
 * 2. This endpoint calls Supabase Edge Function create-bundle-zip
 * 3. Edge Function creates the ZIP bundle
 * 4. Returns signed download URL to user
 *
 * This is a manual trigger - ZIP is only created when user explicitly requests it.
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const jobId = params.jobId;

    // Call Supabase Edge Function to create bundle
    // Note: API routes run server-side, so we can use either NEXT_PUBLIC_ or regular env vars
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase env vars:', { supabaseUrl: !!supabaseUrl, supabaseAnonKey: !!supabaseAnonKey });
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/create-bundle-zip?jobId=${jobId}`;

    console.log(`Manually triggering ZIP creation for job ${jobId}`);
    console.log(`Edge Function URL: ${edgeFunctionUrl}`);
    console.log(`Using anon key (first 20 chars): ${supabaseAnonKey.substring(0, 20)}...`);

    const response = await fetch(edgeFunctionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey, // Supabase also needs the apikey header
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Edge Function error:', data);
      return NextResponse.json(
        { error: data.error || 'Failed to create ZIP bundle' },
        { status: response.status }
      );
    }

    // Return the download URL from the Edge Function
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
