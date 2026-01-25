/**
 * Authorization middleware utilities
 * Future-ready for Supabase Auth integration
 */

import { NextRequest } from 'next/server';

export interface AuthContext {
  userId: string | null;
  isAuthenticated: boolean;
  roles: string[];
}

/**
 * Placeholder auth context - returns unauthenticated for now.
 * When implementing auth, replace this with actual session checking.
 */
export function getAuthContext(request: NextRequest): AuthContext {
  // TODO: When implementing auth, extract user from:
  // 1. Supabase session cookie
  // 2. JWT token in Authorization header
  // 3. Or other auth mechanism
  
  return {
    userId: null,
    isAuthenticated: false,
    roles: [],
  };
}

/**
 * Server-side auth context (for Server Components and API routes)
 */
export async function getServerAuthContext(): Promise<AuthContext> {
  // TODO: When implementing auth:
  // const { cookies } = await import('next/headers');
  // const cookieStore = cookies();
  // const supabase = createServerClient(cookieStore);
  // const { data: { session } } = await supabase.auth.getSession();
  // 
  // if (session) {
  //   return {
  //     userId: session.user.id,
  //     isAuthenticated: true,
  //     roles: session.user.user_metadata?.roles || [],
  //   };
  // }
  
  return {
    userId: null,
    isAuthenticated: false,
    roles: [],
  };
}

/**
 * Check if user has required role(s)
 */
export function hasRole(context: AuthContext, requiredRole: string | string[]): boolean {
  if (!context.isAuthenticated) {
    return false;
  }

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  return roles.some(role => context.roles.includes(role));
}

/**
 * Require authentication (throws if not authenticated)
 */
export function requireAuth(context: AuthContext): void {
  if (!context.isAuthenticated) {
    throw new Error('Authentication required');
  }
}

/**
 * Require specific role (throws if user doesn't have role)
 */
export function requireRole(context: AuthContext, requiredRole: string | string[]): void {
  requireAuth(context);
  
  if (!hasRole(context, requiredRole)) {
    throw new Error('Insufficient permissions');
  }
}
