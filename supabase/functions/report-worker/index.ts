import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
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

    const batchSize = 5;

    // Claim pending tasks
    const { data: tasks, error: claimError } = await supabase
      .rpc('claim_pending_tasks', { p_limit: batchSize });

    if (claimError) {
      throw claimError;
    }

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: 'No pending tasks', processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${tasks.length} tasks`);

    // Process each task
    // Note: In Edge Functions, you would call your Next.js API endpoint
    // or implement the PDF generation logic here
    const results = await Promise.allSettled(
      tasks.map((task: any) => 
        fetch(`${Deno.env.get('NEXTJS_URL')}/api/worker/process-task`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${expectedSecret}`,
          },
          body: JSON.stringify({ task }),
        })
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return new Response(JSON.stringify({
      message: 'Batch processed',
      processed: tasks.length,
      successful,
      failed,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
