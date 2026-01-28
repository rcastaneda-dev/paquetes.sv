import { z } from 'zod';
import { NextResponse } from 'next/server';

/**
 * Error handling utilities for API routes
 */

/**
 * Format Zod validation errors into user-friendly API response
 *
 * @example
 * catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return createValidationErrorResponse(error);
 *   }
 * }
 */
export function createValidationErrorResponse(error: z.ZodError): NextResponse {
  return NextResponse.json(
    {
      error: 'Validation failed',
      details: error.issues.map(issue => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      })),
    },
    { status: 400 }
  );
}

/**
 * Create standardized 401 Unauthorized response
 */
export function createUnauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Create standardized 404 Not Found response
 */
export function createNotFoundResponse(resource = 'Resource'): NextResponse {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

/**
 * Create standardized 500 Internal Server Error response
 */
export function createInternalErrorResponse(message = 'Internal server error'): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 });
}
