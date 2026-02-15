/**
 * Unit tests for increment percentage rules and vacíos calculations.
 *
 * Two categories:
 * 1. Cajas (Boxes): 15% if count ≤ 15, 6% if count > 15 (per gender) — sections.ts, builders.ts, school-bundle-processor.ts
 * 2. Non-boxes (Garments, shoes): Always 6% on base via ceilToEven(base * 0.06) — vacios.ts → computeFinalCount
 */

import { describe, it, expect } from 'vitest';
import { ceilToEven, computeFinalCount, transformSizeCounts } from '@/lib/reports/vacios';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: replicate the Cajas increment logic from sections.ts / builders.ts
// This is the pure calculation extracted from renderCajasSection & calculateCajasTotales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate cajas for a single gender count using the increment rule.
 * Rule: 15% if count ≤ 15, 6% if count > 15
 */
function calculateCajasForGender(count: number): number {
  if (count === 0) return 0;
  const increment = count > 15 ? 1.06 : 1.15;
  return Math.ceil(count * increment);
}

// ─────────────────────────────────────────────────────────────────────────────
// ceilToEven
// ─────────────────────────────────────────────────────────────────────────────

describe('ceilToEven', () => {
  it('should return 0 for zero or negative numbers', () => {
    expect(ceilToEven(0)).toBe(0);
    expect(ceilToEven(-1)).toBe(0);
    expect(ceilToEven(-5.5)).toBe(0);
  });

  it('should round up to nearest even number', () => {
    expect(ceilToEven(0.1)).toBe(2);
    expect(ceilToEven(0.5)).toBe(2);
    expect(ceilToEven(1)).toBe(2);
    expect(ceilToEven(1.5)).toBe(2);
    expect(ceilToEven(2)).toBe(2);
    expect(ceilToEven(2.1)).toBe(4);
    expect(ceilToEven(3)).toBe(4);
    expect(ceilToEven(3.6)).toBe(4);
    expect(ceilToEven(4)).toBe(4);
    expect(ceilToEven(5)).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Cajas increment logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Cajas (Boxes) increment rules', () => {
  describe('count ≤ 15 → 15% increment (multiply by 1.15)', () => {
    it('should apply 15% for count = 1', () => {
      // 1 * 1.15 = 1.15 → ceil = 2
      expect(calculateCajasForGender(1)).toBe(2);
    });

    it('should apply 15% for count = 5', () => {
      // 5 * 1.15 = 5.75 → ceil = 6
      expect(calculateCajasForGender(5)).toBe(6);
    });

    it('should apply 15% for count = 10', () => {
      // 10 * 1.15 = 11.5 → ceil = 12
      expect(calculateCajasForGender(10)).toBe(12);
    });

    it('should apply 15% for count = 15 (boundary)', () => {
      // 15 * 1.15 = 17.25 → ceil = 18
      expect(calculateCajasForGender(15)).toBe(18);
    });

    it('should return 0 for count = 0', () => {
      expect(calculateCajasForGender(0)).toBe(0);
    });
  });

  describe('count > 15 → 6% increment (multiply by 1.06)', () => {
    it('should apply 6% for count = 16 (boundary)', () => {
      // 16 * 1.06 = 16.96 → ceil = 17
      expect(calculateCajasForGender(16)).toBe(17);
    });

    it('should apply 6% for count = 20', () => {
      // 20 * 1.06 = 21.2 → ceil = 22
      expect(calculateCajasForGender(20)).toBe(22);
    });

    it('should apply 6% for count = 30', () => {
      // 30 * 1.06 = 31.8 → ceil = 32
      expect(calculateCajasForGender(30)).toBe(32);
    });

    it('should apply 6% for count = 50', () => {
      // 50 * 1.06 = 53 → ceil = 53
      expect(calculateCajasForGender(50)).toBe(53);
    });

    it('should apply 6% for count = 100', () => {
      // 100 * 1.06 = 106 → ceil = 106
      expect(calculateCajasForGender(100)).toBe(106);
    });
  });

  describe('combined grade totals', () => {
    it('should calculate total boxes for a grade with both genders ≤ 15', () => {
      const hombres = 10;
      const mujeres = 12;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 10*1.15=11.5→12, 12*1.15=13.8→14, total=26
      expect(total).toBe(26);
    });

    it('should calculate total boxes for a grade with both genders > 15', () => {
      const hombres = 20;
      const mujeres = 25;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 20*1.06=21.2→22, 25*1.06=26.5→27, total=49
      expect(total).toBe(49);
    });

    it('should calculate total boxes for a grade with mixed thresholds', () => {
      const hombres = 10; // ≤ 15 → 1.15
      const mujeres = 20; // > 15 → 1.06
      const totalH = calculateCajasForGender(hombres);
      const totalM = calculateCajasForGender(mujeres);
      // 10*1.15=11.5→12, 20*1.06=21.2→22, total=34
      expect(totalH).toBe(12);
      expect(totalM).toBe(22);
      expect(totalH + totalM).toBe(34);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Non-boxes (garments, shoes) increment logic via computeFinalCount
// ─────────────────────────────────────────────────────────────────────────────

describe('computeFinalCount', () => {
  describe('Clothing (multiplier=2)', () => {
    it('should handle original=12', () => {
      // original=12 → base=24 → extra=ceilToEven(24*0.06)=ceilToEven(1.44)=2 → final=26
      const result = computeFinalCount(12, 2);
      expect(result).toEqual({ base: 24, extra: 2, final: 26 });
    });

    it('should handle original=10', () => {
      // original=10 → base=20 → extra=ceilToEven(20*0.06)=ceilToEven(1.2)=2 → final=22
      const result = computeFinalCount(10, 2);
      expect(result).toEqual({ base: 20, extra: 2, final: 22 });
    });

    it('should handle original=2', () => {
      // original=2 → base=4 → extra=ceilToEven(4*0.06)=ceilToEven(0.24)=2 → final=6
      const result = computeFinalCount(2, 2);
      expect(result).toEqual({ base: 4, extra: 2, final: 6 });
    });

    it('should handle original=3', () => {
      // original=3 → base=6 → extra=ceilToEven(6*0.06)=ceilToEven(0.36)=2 → final=8
      const result = computeFinalCount(3, 2);
      expect(result).toEqual({ base: 6, extra: 2, final: 8 });
    });

    it('should handle zero count', () => {
      const result = computeFinalCount(0, 2);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });

  describe('Shoes (multiplier=1) — uses Math.ceil (not ceilToEven)', () => {
    it('should handle original=8', () => {
      // original=8 → base=8 → extra=ceil(8*0.06)=ceil(0.48)=1 → final=9
      const result = computeFinalCount(8, 1);
      expect(result).toEqual({ base: 8, extra: 1, final: 9 });
    });

    it('should handle original=12', () => {
      // original=12 → base=12 → extra=ceil(12*0.06)=ceil(0.72)=1 → final=13
      const result = computeFinalCount(12, 1);
      expect(result).toEqual({ base: 12, extra: 1, final: 13 });
    });

    it('should handle original=20', () => {
      // original=20 → base=20 → extra=ceil(20*0.06)=ceil(1.2)=2 → final=22
      const result = computeFinalCount(20, 1);
      expect(result).toEqual({ base: 20, extra: 2, final: 22 });
    });

    it('should handle original=4', () => {
      // original=4 → base=4 → extra=ceil(4*0.06)=ceil(0.24)=1 → final=5
      const result = computeFinalCount(4, 1);
      expect(result).toEqual({ base: 4, extra: 1, final: 5 });
    });

    it('should handle zero count', () => {
      const result = computeFinalCount(0, 1);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transformSizeCounts
// ─────────────────────────────────────────────────────────────────────────────

describe('transformSizeCounts', () => {
  it('should transform all sizes with clothing multiplier', () => {
    const originalCounts = {
      T12: 10,
      T14: 15,
      T16: 5,
    };

    const result = transformSizeCounts(originalCounts, 2);

    // T12: 10 → base=20 → extra=2 → final=22
    // T14: 15 → base=30 → extra=2 → final=32
    // T16: 5 → base=10 → extra=2 → final=12
    expect(result).toEqual({
      T12: 22,
      T14: 32,
      T16: 12,
    });
  });

  it('should transform all sizes with shoes multiplier', () => {
    const originalCounts = {
      '25': 12,
      '26': 10,
      '27': 0,
      '28': 2,
    };

    const result = transformSizeCounts(originalCounts, 1);

    // 25: 12 → base=12 → extra=ceil(0.72)=1 → final=13
    // 26: 10 → base=10 → extra=ceil(0.6)=1 → final=11
    // 27: 0 → base=0 → extra=0 → final=0
    // 28: 2 → base=2 → extra=ceil(0.12)=1 → final=3
    expect(result).toEqual({
      '25': 13,
      '26': 11,
      '27': 0,
      '28': 3,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline 0.06 usage in sections/builders (same formula)
// ─────────────────────────────────────────────────────────────────────────────

describe('inline ceilToEven(base * 0.06) formula', () => {
  it('should match inline formula for base=20', () => {
    const base = 20;
    const extra = ceilToEven(base * 0.06);
    // 20*0.06=1.2 → ceilToEven(1.2)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(22);
  });

  it('should match inline formula for base=6', () => {
    const base = 6;
    const extra = ceilToEven(base * 0.06);
    // 6*0.06=0.36 → ceilToEven(0.36)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(8);
  });

  it('should match inline formula for base=30', () => {
    const base = 30;
    const extra = ceilToEven(base * 0.06);
    // 30*0.06=1.8 → ceilToEven(1.8)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases and real-world scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases and real-world scenarios', () => {
  it('should handle large counts correctly', () => {
    // Large clothing count
    const clothingResult = computeFinalCount(100, 2);
    // base=200, extra=ceilToEven(200*0.06)=ceilToEven(12)=12, final=212
    expect(clothingResult).toEqual({ base: 200, extra: 12, final: 212 });

    // Large shoe count
    const shoeResult = computeFinalCount(100, 1);
    // base=100, extra=ceil(100*0.06)=ceil(6)=6, final=106
    expect(shoeResult).toEqual({ base: 100, extra: 6, final: 106 });
  });

  it('should handle single-digit counts', () => {
    // Clothing: original=1
    const clothing1 = computeFinalCount(1, 2);
    // base=2, extra=ceilToEven(2*0.06)=ceilToEven(0.12)=2, final=4
    expect(clothing1).toEqual({ base: 2, extra: 2, final: 4 });

    // Shoes: original=1
    const shoe1 = computeFinalCount(1, 1);
    // base=1, extra=ceil(1*0.06)=ceil(0.06)=1, final=2
    expect(shoe1).toEqual({ base: 1, extra: 1, final: 2 });
  });

  it('should maintain consistency across multiple transformations', () => {
    const original = 15;
    const result1 = computeFinalCount(original, 2);
    const result2 = computeFinalCount(original, 2);
    expect(result1).toEqual(result2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Acta Recepción Uniformes calculation pattern
// Uses the same multiplier=2 as ficha_uniformes (camisas + pantalones)
// ─────────────────────────────────────────────────────────────────────────────

describe('Acta Recepcion Uniformes calculation pattern', () => {
  describe('computeFinalCount with multiplier=2 for uniform items', () => {
    it('should compute for small group (5 students same camisa size)', () => {
      // orig=5, base=5*2=10, extra=ceilToEven(10*0.06)=ceilToEven(0.6)=2, final=12
      const result = computeFinalCount(5, 2);
      expect(result).toEqual({ base: 10, extra: 2, final: 12 });
    });

    it('should compute for medium group (15 students same pantalon size)', () => {
      // orig=15, base=15*2=30, extra=ceilToEven(30*0.06)=ceilToEven(1.8)=2, final=32
      const result = computeFinalCount(15, 2);
      expect(result).toEqual({ base: 30, extra: 2, final: 32 });
    });

    it('should compute for larger group (25 students)', () => {
      // orig=25, base=25*2=50, extra=ceilToEven(50*0.06)=ceilToEven(3)=4, final=54
      const result = computeFinalCount(25, 2);
      expect(result).toEqual({ base: 50, extra: 4, final: 54 });
    });

    it('should compute for large group (50 students)', () => {
      // orig=50, base=50*2=100, extra=ceilToEven(100*0.06)=ceilToEven(6)=6, final=106
      const result = computeFinalCount(50, 2);
      expect(result).toEqual({ base: 100, extra: 6, final: 106 });
    });

    it('should return zeros for empty count', () => {
      const result = computeFinalCount(0, 2);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });

  describe('inline ceilToEven(base * 0.06) for uniform-specific bases', () => {
    it('should compute extra for base=10 (5 students × 2)', () => {
      // 10*0.06=0.6 → ceilToEven(0.6)=2
      expect(ceilToEven(10 * 0.06)).toBe(2);
    });

    it('should compute extra for base=50 (25 students × 2)', () => {
      // 50*0.06=3 → ceilToEven(3)=4
      expect(ceilToEven(50 * 0.06)).toBe(4);
    });

    it('should compute extra for base=100 (50 students × 2)', () => {
      // 100*0.06=6 → ceilToEven(6)=6
      expect(ceilToEven(100 * 0.06)).toBe(6);
    });

    it('should compute extra for base=4 (2 students × 2)', () => {
      // 4*0.06=0.24 → ceilToEven(0.24)=2
      expect(ceilToEven(4 * 0.06)).toBe(2);
    });
  });
});
