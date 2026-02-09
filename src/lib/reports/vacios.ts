/**
 * Vacíos (Empty/Buffer) Size Distribution Calculator
 *
 * This module computes the final size frequencies for agreement reports.
 * The transformation follows these rules:
 * 1. Base count = original × multiplier (2 for clothing, 1 for shoes)
 * 2. Gap filling on base: If size has 0 base but next size has base > 0, fill with ceilToEven(nextBase / 2)
 * 3. Extra (vacíos) = ceilToEven(base × 0.15)
 * 4. Final count = base + extra
 *
 * All calculations are non-destructive and deterministic.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Size range restrictions
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical size order for clothing (shirts, bottoms). */
export const CLOTHING_SIZE_ORDER = [
  'T4',
  'T6',
  'T8',
  'T10',
  'T12',
  'T14',
  'T16',
  'T18',
  'T20',
  'T22',
  'T1X',
  'T2X',
] as const;

export type SizeRestrictionCategory = 'tipo_de_camisa' | 't_pantalon_falda_short';

interface SizeRange {
  min: string;
  max: string;
}

/**
 * Valid size ranges per garment type within each category.
 * Keys are normalized to UPPERCASE.
 */
export const SIZE_RESTRICTIONS: Record<SizeRestrictionCategory, Record<string, SizeRange>> = {
  tipo_de_camisa: {
    CELESTE: { min: 'T4', max: 'T12' },
    BLANCA: { min: 'T6', max: 'T2X' },
  },
  t_pantalon_falda_short: {
    'FALDA AZUL': { min: 'T6', max: 'T2X' },
    'FALDA AZUL CON TIRANTE': { min: 'T4', max: 'T12' },
    'FALDA BEIGE': { min: 'T16', max: 'T2X' },
    'SHORT AZUL': { min: 'T4', max: 'T12' },
    'PANTALON BEIGE': { min: 'T16', max: 'T2X' },
    'PANTALON AZUL': { min: 'T6', max: 'T2X' },
  },
};

/**
 * Return the subset of `orderedSizes` that falls within the configured
 * min/max range for the given category + garment type.
 *
 * Normalization: garmentType is uppercased/trimmed. For `tipo_de_camisa`,
 * a leading "CAMISA " prefix is stripped so both "CELESTE" and
 * "CAMISA CELESTE" resolve to the same entry.
 *
 * If no restriction is found, returns `orderedSizes` unchanged.
 */
export function getRestrictedSizeOrder(
  category: SizeRestrictionCategory,
  garmentType: string,
  orderedSizes: readonly string[]
): string[] {
  let normalized = garmentType.toUpperCase().trim();

  if (category === 'tipo_de_camisa') {
    normalized = normalized.replace(/^CAMISA\s+/, '');
  }

  const range = SIZE_RESTRICTIONS[category]?.[normalized];
  if (!range) return [...orderedSizes];

  const minIdx = orderedSizes.indexOf(range.min);
  const maxIdx = orderedSizes.indexOf(range.max);

  if (minIdx === -1 || maxIdx === -1) return [...orderedSizes];

  return orderedSizes.slice(minIdx, maxIdx + 1);
}

/** Context for restricting which sizes get the vacíos transformation. */
export interface SizeRestriction {
  category: SizeRestrictionCategory;
  garmentType: string;
  orderedSizes: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core vacíos calculations
// ─────────────────────────────────────────────────────────────────────────────

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
 * When a `restriction` is provided, only sizes within the configured
 * min/max range for the garment type are transformed. Out-of-range sizes
 * keep their raw (original) count.
 *
 * @param sizeCounts - Map from size string to original count
 * @param multiplier - 2 for clothing, 1 for shoes
 * @param restriction - Optional garment-type context to limit which sizes are transformed
 * @returns Map from size string to final count
 *
 * @example
 * const originalCounts = { 'T12': 10, 'T14': 15 };
 * const finalCounts = transformSizeCounts(originalCounts, 2);
 * // => { 'T12': 24, 'T14': 36 }
 */
export function transformSizeCounts(
  sizeCounts: Record<string, number>,
  multiplier: 1 | 2,
  restriction?: SizeRestriction
): Record<string, number> {
  const allowedSizes = restriction
    ? new Set(
        getRestrictedSizeOrder(
          restriction.category,
          restriction.garmentType,
          restriction.orderedSizes
        )
      )
    : null;

  const result: Record<string, number> = {};

  for (const [size, original] of Object.entries(sizeCounts)) {
    if (allowedSizes && !allowedSizes.has(size)) {
      result[size] = original;
      continue;
    }

    const { final } = computeFinalCount(original, multiplier);
    result[size] = final;
  }

  return result;
}

/**
 * Fill gaps in BASE counts (before applying vacíos formula).
 *
 * Scan left→right through the size order. If the current size has a base count
 * of 0 and the NEXT size has a positive base count, assign ceilToEven(nextBase / 2).
 *
 * This ensures buffer inventory exists for sizes adjacent to populated sizes,
 * and those buffers will then receive their own 15% vacíos in the next step.
 *
 * @param orderedSizes - Array of size strings in display order (e.g. ['T4', 'T6', ..., 'T2X'])
 * @param baseCounts - Map from size to base count (original × multiplier)
 * @returns Updated base counts with gaps filled
 *
 * @example
 * const sizes = ['T4', 'T6', 'T8'];
 * const base = { 'T4': 0, 'T6': 20, 'T8': 0 };  // 10 students × 2
 * const filled = fillBaseGaps(sizes, base);
 * // => { 'T4': 10, 'T6': 20, 'T8': 0 }
 * // T4 gets filled with ceilToEven(20/2) = 10
 * // T8 is not filled (next base is 0)
 */
export function fillBaseGaps(
  orderedSizes: string[],
  baseCounts: Record<string, number>
): Record<string, number> {
  const result = { ...baseCounts };

  for (let n = 0; n < orderedSizes.length - 1; n++) {
    const size = orderedSizes[n];
    const currentBase = result[size] || 0;

    // Skip if current already has a value
    if (currentBase > 0) {
      continue;
    }

    const nextSize = orderedSizes[n + 1];
    const nextBase = result[nextSize] || 0;

    // Fill gap if next size has base count
    if (nextBase > 0) {
      result[size] = ceilToEven(nextBase / 2);
    }
  }

  return result;
}

/**
 * Fill gaps in a size distribution (LEGACY - kept for backward compatibility).
 *
 * @deprecated Use fillBaseGaps instead - gap filling should happen BEFORE vacíos calculation
 *
 * After computing final counts (base + vacíos), scan left→right.
 * If the current size has a final count of 0 and the NEXT size has a
 * positive base count (original × multiplier), assign ceilToEven(base / 2) as a buffer.
 *
 * This ensures there are spare units for sizes adjacent to populated sizes,
 * including leading gaps before the first populated size.
 *
 * @param orderedSizes - Array of size strings in display order (e.g. ['T4', 'T6', ..., 'T2X'])
 * @param baseCounts - Map from size to base count (original × multiplier)
 * @param finalCounts - Map from size to final count (after applying vacíos formula)
 * @returns Updated final counts with gaps filled
 *
 * @example
 * const sizes = ['T4', 'T6', 'T8'];
 * const base = { 'T4': 0, 'T6': 20, 'T8': 0 };  // 10 students × 2
 * const final = { 'T4': 0, 'T6': 24, 'T8': 0 };
 * const filled = fillSizeGaps(sizes, base, final);
 * // => { 'T4': 10, 'T6': 24, 'T8': 0 }
 * // T4 gets filled with ceilToEven(20/2) = 10
 * // T8 is not filled (next base is 0)
 */
export function fillSizeGaps(
  orderedSizes: string[],
  baseCounts: Record<string, number>,
  finalCounts: Record<string, number>
): Record<string, number> {
  const result = { ...finalCounts };

  for (let n = 0; n < orderedSizes.length - 1; n++) {
    const size = orderedSizes[n];
    const currentFinal = result[size] || 0;

    // Skip if current already has a value
    if (currentFinal > 0) {
      continue;
    }

    const nextSize = orderedSizes[n + 1];
    const nextBase = baseCounts[nextSize] || 0;

    // Fill gap if next size has base count
    if (nextBase > 0) {
      result[size] = ceilToEven(nextBase / 2);
    }
  }

  return result;
}
