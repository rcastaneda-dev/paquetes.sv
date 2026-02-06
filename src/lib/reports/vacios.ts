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

/**
 * Fill interior gaps in a size distribution.
 *
 * After computing final counts (base + vacíos), scan left→right.
 * Once at least one non-zero size has been seen, if the current size
 * has a final count of 0 and the NEXT size has a positive original count y,
 * assign ceilToEven(y / 2) as a buffer.
 *
 * This ensures there are spare units for sizes that fall between
 * populated sizes in the distribution.
 *
 * @param orderedSizes - Array of size strings in display order (e.g. ['T4', 'T6', ..., 'T2X'])
 * @param originalCounts - Map from size to original student count
 * @param finalCounts - Map from size to final count (after applying vacíos formula)
 * @returns Updated final counts with gaps filled
 *
 * @example
 * const sizes = ['T4', 'T6', 'T8'];
 * const original = { 'T4': 0, 'T6': 10, 'T8': 0 };
 * const final = { 'T4': 0, 'T6': 24, 'T8': 0 };
 * const filled = fillSizeGaps(sizes, original, final);
 * // => { 'T4': 0, 'T6': 24, 'T8': 0 }
 * // T4 is not filled (before first non-zero)
 * // T8 is not filled (next original is 0)
 */
export function fillSizeGaps(
  orderedSizes: string[],
  originalCounts: Record<string, number>,
  finalCounts: Record<string, number>
): Record<string, number> {
  const result = { ...finalCounts };
  let seenNonZero = false;

  for (let n = 0; n < orderedSizes.length - 1; n++) {
    const size = orderedSizes[n];
    const currentFinal = result[size] || 0;

    if (currentFinal > 0) {
      seenNonZero = true;
      continue;
    }

    const nextSize = orderedSizes[n + 1];
    const nextOriginal = originalCounts[nextSize] || 0;

    if (seenNonZero && nextOriginal > 0) {
      result[size] = ceilToEven(nextOriginal / 2);
    }
  }

  return result;
}
