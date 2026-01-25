import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase server environment variables');
}

// Server-side Supabase client with service role (bypasses RLS)
export const supabaseServer = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Future-ready: for authenticated user sessions
// import { cookies } from 'next/headers';
// import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
//
// export function createServerClient(cookieStore: ReadonlyRequestCookies) {
//   return createClient(supabaseUrl, supabaseAnonKey, {
//     cookies: {
//       get(name: string) {
//         return cookieStore.get(name)?.value;
//       },
//     },
//   });
// }
