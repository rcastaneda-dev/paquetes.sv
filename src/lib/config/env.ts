import { z } from 'zod';

/**
 * Environment variable validation and type-safe access
 * Validates all environment variables at module load time
 */

const envSchema = z.object({
  // Supabase configuration (required)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Supabase service role key is required'),

  // Auth secrets (optional - used for cron/worker auth)
  SUPABASE_FUNCTION_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  // Worker configuration (optional with defaults)
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  WORKER_MAX_RUNTIME: z.coerce.number().int().min(1000).max(60000).default(9000),
});

/**
 * Validated and typed environment variables
 * Import this instead of process.env for type safety
 *
 * @example
 * import { env } from '@/lib/config/env';
 * const url = env.NEXT_PUBLIC_SUPABASE_URL; // Type-safe!
 */
export const env = envSchema.parse(process.env);

// Type export for use in other files
export type Env = z.infer<typeof envSchema>;
