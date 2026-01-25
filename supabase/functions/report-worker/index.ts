import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async req => {
  try {
    // Simple authentication
    const authHeader = req.headers.get('authorization');
    const expectedSecret = Deno.env.get('FUNCTION_SECRET');

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const nextjsUrl = Deno.env.get('NEXTJS_URL');
    if (!nextjsUrl) {
      return new Response(JSON.stringify({ error: 'Missing NEXTJS_URL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mode selection (so we can schedule this function with different payloads)
    // - "process": triggers PDF task processing
    // - "zip": triggers ZIP part creation
    let mode: 'process' | 'zip' = 'process';
    if (req.method !== 'GET') {
      try {
        const body = await req.json();
        if (body?.mode === 'zip') mode = 'zip';
      } catch {
        // ignore body parse errors; default mode applies
      }
    }

    const path = mode === 'zip' ? '/api/worker/create-zip' : '/api/worker/process-tasks';
    const res = await fetch(`${nextjsUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: expectedSecret ? `Bearer ${expectedSecret}` : '',
      },
    });

    const text = await res.text();

    return new Response(
      JSON.stringify(
        {
          mode,
          upstreamStatus: res.status,
          upstreamBody: text,
        },
        null,
        2
      ),
      { status: res.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
