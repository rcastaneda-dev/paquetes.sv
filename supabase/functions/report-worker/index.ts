import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async req => {
  try {
    /**
     * Auth note:
     * Supabase Edge Functions uses the `Authorization` header for Supabase JWT/API key auth.
     * We must NOT overload `Authorization` for our own shared secret, otherwise scheduled/cron
     * invocations that send a Supabase JWT will be rejected.
     *
     * Use `x-worker-secret: <FUNCTION_SECRET>` instead.
     */
    const expectedSecret = Deno.env.get('FUNCTION_SECRET');
    const providedSecret = req.headers.get('x-worker-secret');

    if (expectedSecret && providedSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized (missing/invalid x-worker-secret)' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const nextjsUrl = Deno.env.get('NEXTJS_URL');
    if (!nextjsUrl) {
      return new Response(JSON.stringify({ error: 'Missing NEXTJS_URL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Trigger PDF task processing on Vercel
    const path = '/api/worker/process-tasks';
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
