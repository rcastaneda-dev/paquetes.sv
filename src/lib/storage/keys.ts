/**
 * Utilities for generating safe, collision-free Supabase Storage object keys.
 *
 * Supabase Storage (backed by S3) rejects keys with certain characters
 * and can fail when keys contain spaces or non-ASCII characters.
 * These helpers ensure all generated keys are:
 * - ASCII-safe (diacritics stripped)
 * - URL-safe (no spaces, special chars replaced)
 * - Collision-proof (include unique IDs where needed)
 * - Deterministic (same input → same output)
 */

/**
 * Strip diacritics from a string (e.g., "Séptimo" → "Septimo")
 * Uses Unicode normalization to decompose characters, then removes combining marks.
 */
function stripDiacritics(input: string): string {
  return input
    .normalize('NFD') // Decompose accented chars into base + combining mark
    .replace(/[\u0300-\u036f]/g, ''); // Remove combining diacritical marks
}

/**
 * Convert a string into a safe path segment for Storage keys.
 * - Strips diacritics (é → e)
 * - Replaces unsafe characters with hyphens
 * - Collapses repeated hyphens
 * - Trims leading/trailing hyphens
 * - Bounds length to maxLength
 *
 * @example
 * toSafePathSegment("Séptimo Grado") → "Septimo-Grado"
 * toSafePathSegment("72006-Séptimo Grado") → "72006-Septimo-Grado"
 */
export function toSafePathSegment(input: string, maxLength = 200): string {
  return stripDiacritics(input)
    .replace(/[^a-zA-Z0-9._-]+/g, '-') // Replace unsafe chars with hyphen
    .replace(/-{2,}/g, '-') // Collapse repeated hyphens
    .replace(/^-+|-+$/g, '') // Trim leading/trailing hyphens
    .slice(0, maxLength);
}

/**
 * Build the Storage object key for a report PDF.
 * Format: `{jobId}/{schoolCodigoCe}-{safeGrado}-{taskId}.pdf`
 *
 * Including taskId ensures collision-free keys even if duplicate tasks
 * somehow exist in the DB (e.g., from race conditions or retries).
 *
 * @example
 * buildReportPdfStorageKey({
 *   jobId: "abc-123",
 *   schoolCodigoCe: "72006",
 *   grado: "Séptimo Grado",
 *   taskId: "def-456"
 * })
 * → "abc-123/72006-Septimo-Grado-def-456.pdf"
 */
export function buildReportPdfStorageKey(args: {
  jobId: string;
  schoolCodigoCe: string;
  grado: string;
  taskId: string;
}): string {
  const { jobId, schoolCodigoCe, grado, taskId } = args;
  const safeSchool = toSafePathSegment(schoolCodigoCe, 50);
  const safeGrado = toSafePathSegment(grado, 80);
  const safeTaskId = toSafePathSegment(taskId, 50);
  return `${jobId}/${safeSchool}-${safeGrado}-${safeTaskId}.pdf`;
}

/**
 * Build a safe filename for a PDF entry inside a ZIP archive.
 * Format: `{schoolCodigoCe}-{safeGrado}.pdf`
 *
 * This ensures ZIP entries are ASCII-safe and compatible with all
 * extraction tools (Windows, macOS, Linux).
 *
 * @example
 * buildZipPdfEntryName({
 *   schoolCodigoCe: "72006",
 *   grado: "Séptimo Grado"
 * })
 * → "72006-Septimo-Grado.pdf"
 */
export function buildZipPdfEntryName(args: { schoolCodigoCe: string; grado: string }): string {
  const { schoolCodigoCe, grado } = args;
  const safeSchool = toSafePathSegment(schoolCodigoCe, 50);
  const safeGrado = toSafePathSegment(grado, 80);
  return `${safeSchool}-${safeGrado}.pdf`;
}
