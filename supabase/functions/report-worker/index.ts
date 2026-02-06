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

    // Trigger both regular and category PDF task processing on Vercel
    const headers = {
      'x-worker-secret': expectedSecret || '',
    };

    // Process regular tasks (school reports)
    const regularRes = await fetch(`${nextjsUrl}/api/worker/process-tasks`, {
      method: 'POST',
      headers,
    });

    const regularText = await regularRes.text();

    // Process category tasks (agreement reports)
    const categoryRes = await fetch(`${nextjsUrl}/api/worker/process-category-tasks`, {
      method: 'POST',
      headers,
    });

    const categoryText = await categoryRes.text();

    return new Response(
      JSON.stringify(
        {
          regular: {
            status: regularRes.status,
            body: regularText,
          },
          category: {
            status: categoryRes.status,
            body: categoryText,
          },
        },
        null,
        2
      ),
      {
        status: regularRes.ok && categoryRes.ok ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
