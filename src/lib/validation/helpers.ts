import { z } from 'zod';
import { type NextRequest } from 'next/server';

/**
 * Validation helper functions for API routes
 */

/**
 * Parse and validate URL search params with Zod schema
 *
 * @example
 * const params = validateQueryParams(request, paginationSchema);
 * // params.page and params.pageSize are now validated and typed
 *
 * @throws {z.ZodError} if validation fails
 */
export function validateQueryParams<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T
): z.infer<T> {
  const searchParams = request.nextUrl.searchParams;
  const params = Object.fromEntries(searchParams.entries());
  return schema.parse(params);
}

/**
 * Parse and validate JSON request body with Zod schema
 * Handles empty bodies gracefully by using schema defaults
 *
 * @example
 * const body = await validateBody(request, createJobSchema);
 * // body.shards defaults to 1 if not provided
 *
 * @throws {z.ZodError} if validation fails (not thrown for empty body with defaults)
 */
export async function validateBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T
): Promise<z.infer<T>> {
  try {
    const body = await request.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Empty or invalid JSON - use schema defaults
      return schema.parse({});
    }
    throw error;
  }
}

/**
 * Parse and validate environment variables with Zod schema
 *
 * @example
 * const config = validateEnv(workerConfigSchema);
 * // config.WORKER_BATCH_SIZE is validated and has default value
 */
export function validateEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  return schema.parse(process.env);
}
