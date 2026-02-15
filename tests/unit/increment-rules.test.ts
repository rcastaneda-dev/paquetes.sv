/**
 * Unit tests for increment percentage rules and vacíos calculations.
 *
 * All types use a flat 5% increment:
 * 1. Cajas (Boxes): Math.ceil(count * 1.05) per gender, no threshold
 * 2. Garments (clothing): ceilToEven(base * 0.05), multiplier=2 — vacios.ts → computeFinalCount
 * 3. Shoes: Math.ceil(base * 0.05), multiplier=1, no gap filling — vacios.ts → computeFinalCount
 */

import { describe, it, expect } from 'vitest';
import { ceilToEven, computeFinalCount, transformSizeCounts } from '@/lib/reports/vacios';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: replicate the Cajas increment logic from sections.ts / builders.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate cajas for a single gender count using the flat 5% increment rule.
 */
function calculateCajasForGender(count: number): number {
  if (count === 0) return 0;
  return Math.ceil(count * 1.05);
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
// Tests for Cajas increment logic — flat 5%
// ─────────────────────────────────────────────────────────────────────────────

describe('Cajas (Boxes) increment rules — flat 5%', () => {
  it('should return 0 for count = 0', () => {
    expect(calculateCajasForGender(0)).toBe(0);
  });

  it('should apply 5% for count = 1', () => {
    // 1 * 1.05 = 1.05 → ceil = 2
    expect(calculateCajasForGender(1)).toBe(2);
  });

  it('should apply 5% for count = 5', () => {
    // 5 * 1.05 = 5.25 → ceil = 6
    expect(calculateCajasForGender(5)).toBe(6);
  });

  it('should apply 5% for count = 10', () => {
    // 10 * 1.05 = 10.5 → ceil = 11
    expect(calculateCajasForGender(10)).toBe(11);
  });

  it('should apply 5% for count = 15', () => {
    // 15 * 1.05 = 15.75 → ceil = 16
    expect(calculateCajasForGender(15)).toBe(16);
  });

  it('should apply 5% for count = 16', () => {
    // 16 * 1.05 = 16.8 → ceil = 17
    expect(calculateCajasForGender(16)).toBe(17);
  });

  it('should apply 5% for count = 20', () => {
    // 20 * 1.05 = 21 → ceil = 21
    expect(calculateCajasForGender(20)).toBe(21);
  });

  it('should apply 5% for count = 50', () => {
    // 50 * 1.05 = 52.5 → ceil = 53
    expect(calculateCajasForGender(50)).toBe(53);
  });

  it('should apply 5% for count = 100', () => {
    // 100 * 1.05 = 105 → ceil = 105
    expect(calculateCajasForGender(100)).toBe(105);
  });

  describe('combined grade totals', () => {
    it('should calculate total boxes for a grade with both genders', () => {
      const hombres = 10;
      const mujeres = 12;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 10*1.05=10.5→11, 12*1.05=12.6→13, total=24
      expect(total).toBe(24);
    });

    it('should calculate total boxes for a grade with larger counts', () => {
      const hombres = 20;
      const mujeres = 25;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 20*1.05=21→21, 25*1.05=26.25→27, total=48
      expect(total).toBe(48);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for computeFinalCount — 5% increment
// ─────────────────────────────────────────────────────────────────────────────

describe('computeFinalCount', () => {
  describe('Clothing (multiplier=2) — extra = ceilToEven(base * 0.05)', () => {
    it('should handle original=12', () => {
      // original=12 → base=24 → extra=ceilToEven(24*0.05)=ceilToEven(1.2)=2 → final=26
      const result = computeFinalCount(12, 2);
      expect(result).toEqual({ base: 24, extra: 2, final: 26 });
    });

    it('should handle original=10', () => {
      // original=10 → base=20 → extra=ceilToEven(20*0.05)=ceilToEven(1)=2 → final=22
      const result = computeFinalCount(10, 2);
      expect(result).toEqual({ base: 20, extra: 2, final: 22 });
    });

    it('should handle original=2 (below threshold, no extra)', () => {
      // original=2 → base=4 → below threshold (base<20) → extra=0 → final=4
      const result = computeFinalCount(2, 2);
      expect(result).toEqual({ base: 4, extra: 0, final: 4 });
    });

    it('should handle original=3 (below threshold, no extra)', () => {
      // original=3 → base=6 → below threshold (base<20) → extra=0 → final=6
      const result = computeFinalCount(3, 2);
      expect(result).toEqual({ base: 6, extra: 0, final: 6 });
    });

    it('should handle original=25', () => {
      // original=25 → base=50 → extra=ceilToEven(50*0.05)=ceilToEven(2.5)=4 → final=54
      const result = computeFinalCount(25, 2);
      expect(result).toEqual({ base: 50, extra: 4, final: 54 });
    });

    it('should handle original=50', () => {
      // original=50 → base=100 → extra=ceilToEven(100*0.05)=ceilToEven(5)=6 → final=106
      const result = computeFinalCount(50, 2);
      expect(result).toEqual({ base: 100, extra: 6, final: 106 });
    });

    it('should handle zero count', () => {
      const result = computeFinalCount(0, 2);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });

  describe('Shoes (multiplier=1) — extra = Math.ceil(base * 0.05)', () => {
    it('should handle original=8', () => {
      // original=8 → base=8 → extra=ceil(8*0.05)=ceil(0.4)=1 → final=9
      const result = computeFinalCount(8, 1);
      expect(result).toEqual({ base: 8, extra: 1, final: 9 });
    });

    it('should handle original=12', () => {
      // original=12 → base=12 → extra=ceil(12*0.05)=ceil(0.6)=1 → final=13
      const result = computeFinalCount(12, 1);
      expect(result).toEqual({ base: 12, extra: 1, final: 13 });
    });

    it('should handle original=20', () => {
      // original=20 → base=20 → extra=ceil(20*0.05)=ceil(1)=1 → final=21
      const result = computeFinalCount(20, 1);
      expect(result).toEqual({ base: 20, extra: 1, final: 21 });
    });

    it('should handle original=4', () => {
      // original=4 → base=4 → extra=ceil(4*0.05)=ceil(0.2)=1 → final=5
      const result = computeFinalCount(4, 1);
      expect(result).toEqual({ base: 4, extra: 1, final: 5 });
    });

    it('should handle original=100', () => {
      // original=100 → base=100 → extra=ceil(100*0.05)=ceil(5)=5 → final=105
      const result = computeFinalCount(100, 1);
      expect(result).toEqual({ base: 100, extra: 5, final: 105 });
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

    // T12: 10 → base=20 → extra=ceilToEven(1)=2 → final=22
    // T14: 15 → base=30 → extra=ceilToEven(1.5)=2 → final=32
    // T16: 5 → base=10 → below threshold (base<20) → extra=0 → final=10
    expect(result).toEqual({
      T12: 22,
      T14: 32,
      T16: 10,
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

    // 25: 12 → base=12 → extra=ceil(0.6)=1 → final=13
    // 26: 10 → base=10 → extra=ceil(0.5)=1 → final=11
    // 27: 0 → base=0 → extra=0 → final=0
    // 28: 2 → base=2 → extra=ceil(0.1)=1 → final=3
    expect(result).toEqual({
      '25': 13,
      '26': 11,
      '27': 0,
      '28': 3,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline 0.05 usage in sections/builders (same formula)
// ─────────────────────────────────────────────────────────────────────────────

describe('inline ceilToEven(base * 0.05) formula', () => {
  it('should match inline formula for base=20', () => {
    const base = 20;
    const extra = ceilToEven(base * 0.05);
    // 20*0.05=1 → ceilToEven(1)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(22);
  });

  it('should match inline formula for base=6', () => {
    const base = 6;
    const extra = ceilToEven(base * 0.05);
    // 6*0.05=0.3 → ceilToEven(0.3)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(8);
  });

  it('should match inline formula for base=30', () => {
    const base = 30;
    const extra = ceilToEven(base * 0.05);
    // 30*0.05=1.5 → ceilToEven(1.5)=2
    expect(extra).toBe(2);
    expect(base + extra).toBe(32);
  });

  it('should match inline formula for base=100', () => {
    const base = 100;
    const extra = ceilToEven(base * 0.05);
    // 100*0.05=5 → ceilToEven(5)=6
    expect(extra).toBe(6);
    expect(base + extra).toBe(106);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases and real-world scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases and real-world scenarios', () => {
  it('should handle large counts correctly', () => {
    // Large clothing count
    const clothingResult = computeFinalCount(100, 2);
    // base=200, extra=ceilToEven(200*0.05)=ceilToEven(10)=10, final=210
    expect(clothingResult).toEqual({ base: 200, extra: 10, final: 210 });

    // Large shoe count
    const shoeResult = computeFinalCount(100, 1);
    // base=100, extra=ceil(100*0.05)=ceil(5)=5, final=105
    expect(shoeResult).toEqual({ base: 100, extra: 5, final: 105 });
  });

  it('should handle single-digit counts', () => {
    // Clothing: original=1 (below threshold, no extra)
    const clothing1 = computeFinalCount(1, 2);
    // base=2, below threshold (base<20) → extra=0, final=2
    expect(clothing1).toEqual({ base: 2, extra: 0, final: 2 });

    // Shoes: original=1
    const shoe1 = computeFinalCount(1, 1);
    // base=1, extra=ceil(1*0.05)=ceil(0.05)=1, final=2
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
// ─────────────────────────────────────────────────────────────────────────────

describe('Acta Recepcion Uniformes calculation pattern', () => {
  describe('computeFinalCount with multiplier=2 for uniform items', () => {
    it('should compute for small group (5 students same camisa size, below threshold)', () => {
      // orig=5, base=10, below threshold (base<20) → extra=0, final=10
      const result = computeFinalCount(5, 2);
      expect(result).toEqual({ base: 10, extra: 0, final: 10 });
    });

    it('should compute for medium group (15 students same pantalon size)', () => {
      // orig=15, base=30, extra=ceilToEven(30*0.05)=ceilToEven(1.5)=2, final=32
      const result = computeFinalCount(15, 2);
      expect(result).toEqual({ base: 30, extra: 2, final: 32 });
    });

    it('should compute for larger group (25 students)', () => {
      // orig=25, base=50, extra=ceilToEven(50*0.05)=ceilToEven(2.5)=4, final=54
      const result = computeFinalCount(25, 2);
      expect(result).toEqual({ base: 50, extra: 4, final: 54 });
    });

    it('should compute for large group (50 students)', () => {
      // orig=50, base=100, extra=ceilToEven(100*0.05)=ceilToEven(5)=6, final=106
      const result = computeFinalCount(50, 2);
      expect(result).toEqual({ base: 100, extra: 6, final: 106 });
    });

    it('should return zeros for empty count', () => {
      const result = computeFinalCount(0, 2);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });

  describe('inline ceilToEven(base * 0.05) for uniform-specific bases', () => {
    it('should compute extra for base=10 (5 students × 2)', () => {
      // 10*0.05=0.5 → ceilToEven(0.5)=2
      expect(ceilToEven(10 * 0.05)).toBe(2);
    });

    it('should compute extra for base=50 (25 students × 2)', () => {
      // 50*0.05=2.5 → ceilToEven(2.5)=4
      expect(ceilToEven(50 * 0.05)).toBe(4);
    });

    it('should compute extra for base=100 (50 students × 2)', () => {
      // 100*0.05=5 → ceilToEven(5)=6
      expect(ceilToEven(100 * 0.05)).toBe(6);
    });

    it('should compute extra for base=4 (2 students × 2)', () => {
      // 4*0.05=0.2 → ceilToEven(0.2)=2
      expect(ceilToEven(4 * 0.05)).toBe(2);
    });
  });
});
