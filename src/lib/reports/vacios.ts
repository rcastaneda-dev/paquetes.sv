/**
 * Vacíos (Empty/Buffer) Size Distribution Calculator
 *
 * This module computes the final size frequencies for agreement reports.
 * The transformation follows these rules:
 * 1. Base count = original × multiplier (2 for clothing, 1 for shoes)
 * 2. Extra (vacíos): clothing = ceilToEven(base × 0.05) when original≥10, shoes = Math.round(base × 0.05)
 * 3. Final count = base + extra
 * 4. Zero demand stays zero — no gap filling
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
 * Compute the 5% clothing extra (vacíos) for a given base count.
 * Only applies when the original student count is >= 10 (i.e. base >= 20).
 * Below that threshold, no extra is added.
 *
 * @param base - The base count (original × 2 for clothing)
 * @returns The extra count to add, or 0 if below threshold
 */
export function computeClothingExtra(base: number): number {
  if (base < 20) return 0;
  return ceilToEven(base * 0.05);
}

/**
 * Compute the final count for a size cell using the vacíos formula.
 *
 * For clothing (multiplier=2): extra is only applied when original >= 10.
 * For shoes (multiplier=1): extra is always applied when base > 0.
 *
 * @param original - The raw count from the database (number of students with this size)
 * @param multiplier - 2 for clothing (camisas, prenda_inferior), 1 for shoes
 * @returns Object with base, extra (vacíos), and final counts
 */
export function computeFinalCount(
  original: number,
  multiplier: 1 | 2
): { base: number; extra: number; final: number } {
  const base = original * multiplier;
  // Shoes (multiplier=1): round to nearest integer (only rounds up if fractional >= 0.5)
  // Clothing (multiplier=2): round up to nearest even number, only if original >= 10
  const extra = multiplier === 1
    ? (base > 0 ? Math.round(base * 0.05) : 0)
    : computeClothingExtra(base);
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

