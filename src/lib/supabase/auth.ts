/**
 * Supabase Auth utilities - ready for future implementation
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Sign in with email/password
 * Uncomment and use when implementing auth
 */
/*
export async function signIn(email: string, password: string) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    throw error;
  }
  
  return data;
}
*/

/**
 * Sign in with magic link
 * Uncomment and use when implementing auth
 */
/*
export async function signInWithMagicLink(email: string) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  
  if (error) {
    throw error;
  }
  
  return data;
}
*/

/**
 * Sign out
 * Uncomment and use when implementing auth
 */
/*
export async function signOut() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { error } = await supabase.auth.signOut();
  
  if (error) {
    throw error;
  }
}
*/

/**
 * Get current session
 * Uncomment and use when implementing auth
 */
/*
export async function getSession() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
*/

/**
 * Listen to auth state changes
 * Uncomment and use when implementing auth
 */
/*
export function onAuthStateChange(callback: (session: Session | null) => void) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session);
  });
  
  return subscription;
}
*/

// Export a placeholder for now
export const auth = {
  // Functions will be added here when implementing auth
};
