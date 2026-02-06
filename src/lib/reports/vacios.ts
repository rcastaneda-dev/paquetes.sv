/**
 * Vacíos (Empty/Buffer) Size Distribution Calculator
 *
 * This module computes the final size frequencies for agreement reports.
 * The transformation follows these rules:
 * 1. Base count = original × multiplier (2 for clothing, 1 for shoes)
 * 2. Extra (vacíos) = ceilToEven(base × 0.15)
 * 3. Final count = base + extra
 *
 * All calculations are non-destructive and deterministic.
 */

/**
 * Round a number up to the nearest even integer.
 * Examples:
 *   ceilToEven(0)    => 0
 *   ceilToEven(0.5)  => 2
 *   ceilToEven(1)    => 2
 *   ceilToEven(1.5)  => 2
 *   ceilToEven(2)    => 2
 *   ceilToEven(3)    => 4
 *   ceilToEven(3.6)  => 4
 */
export function ceilToEven(n: number): number {
  if (n <= 0) return 0;
  const ceiled = Math.ceil(n);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

/**
 * Compute the final count for a size cell using the vacíos formula.
 *
 * @param original - The raw count from the database (number of students with this size)
 * @param multiplier - 2 for clothing (camisas, prenda_inferior), 1 for shoes
 * @returns Object with base, extra (vacíos), and final counts
 *
 * @example
 * // Clothing: original=12
 * computeFinalCount(12, 2)
 * // => { base: 24, extra: 4, final: 28 }
 *
 * @example
 * // Shoes: original=8
 * computeFinalCount(8, 1)
 * // => { base: 8, extra: 2, final: 10 }
 */
export function computeFinalCount(
  original: number,
  multiplier: 1 | 2
): { base: number; extra: number; final: number } {
  const base = original * multiplier;
  const extra = ceilToEven(base * 0.15);
  const final = base + extra;

  return { base, extra, final };
}

/**
 * Apply the vacíos transformation to a map of size counts.
 * This is a convenience function for transforming entire size distributions.
 *
 * @param sizeCounts - Map from size string to original count
 * @param multiplier - 2 for clothing, 1 for shoes
 * @returns Map from size string to final count
 *
 * @example
 * const originalCounts = { 'T12': 10, 'T14': 15 };
 * const finalCounts = transformSizeCounts(originalCounts, 2);
 * // => { 'T12': 24, 'T14': 36 }
 */
export function transformSizeCounts(
  sizeCounts: Record<string, number>,
  multiplier: 1 | 2
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [size, original] of Object.entries(sizeCounts)) {
    const { final } = computeFinalCount(original, multiplier);
    result[size] = final;
  }

  return result;
}
