import { z } from 'zod';

/**
 * Validation schemas for API routes
 * Centralized source of truth for all input validation
 */

// ============================================================================
// Query Parameter Schemas
// ============================================================================

/**
 * Pagination with coercion and defaults
 * Used by: /api/bulk/jobs, /api/students/query
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

/**
 * Limit parameter for job queries
 * Used by: /api/bulk/jobs/[jobId]
 */
export const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

/**
 * School code (required)
 * Used by: /api/students/print, /api/students/print-labels, /api/grades
 */
export const schoolCodeSchema = z.object({
  school_codigo_ce: z.string().min(1, 'School code is required'),
});

/**
 * Region enum (4 valid values, case-insensitive)
 * Used by: /api/bulk/jobs/[jobId]/create-zip-job, /api/bulk/jobs/[jobId]/zip-job-status
 */
export const regionSchema = z
  .enum(['oriental', 'occidental', 'paracentral', 'central'])
  .transform(val => val.toLowerCase() as 'oriental' | 'occidental' | 'paracentral' | 'central');

/**
 * Search query (min 2 chars)
 * Used by: /api/schools/search
 */
export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
});

/**
 * Student filters (all optional)
 * Used by: /api/students/query
 */
export const studentFilterSchema = z
  .object({
    school_codigo_ce: z.string().optional(),
    grado: z.string().optional(),
    departamento: z.string().optional(),
  })
  .merge(paginationSchema);

// ============================================================================
// Request Body Schemas
// ============================================================================

/**
 * Create job with shards (1-200 range)
 * Used by: POST /api/bulk/jobs
 */
export const createJobSchema = z.object({
  shards: z.number().int().min(1).max(200).optional().default(1),
  params: z.record(z.any()).optional().nullable(),
});

/**
 * Cancel job with optional reason
 * Used by: POST /api/bulk/jobs/[jobId]/cancel
 */
export const cancelJobSchema = z.object({
  reason: z.string().optional(),
});

// ============================================================================
// Environment Variable Schemas
// ============================================================================

/**
 * Worker configuration
 * Used by: /api/worker/process-tasks
 */
export const workerConfigSchema = z.object({
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  WORKER_MAX_RUNTIME: z.coerce.number().int().min(1000).max(60000).default(9000),
});

/**
 * Auth secrets configuration
 * Used by: /api/worker/process-tasks
 */
export const authConfigSchema = z.object({
  SUPABASE_FUNCTION_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type PaginationParams = z.infer<typeof paginationSchema>;
export type StudentFilterParams = z.infer<typeof studentFilterSchema>;
export type CreateJobBody = z.infer<typeof createJobSchema>;
export type CancelJobBody = z.infer<typeof cancelJobSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
