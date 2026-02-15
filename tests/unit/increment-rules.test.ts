/**
 * Unit tests for increment percentage rules and vacíos calculations.
 *
 * All types use a flat 5% increment:
 * 1. Cajas (Boxes): Math.round(count * 1.05) per gender, no threshold
 * 2. Garments (clothing): ceilToEven(base * 0.05), multiplier=2, only when original≥10 — vacios.ts → computeFinalCount
 * 3. Shoes: Math.round(base * 0.05), multiplier=1, no gap filling — vacios.ts → computeFinalCount
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
  return Math.round(count * 1.05);
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
    // 1 * 1.05 = 1.05 → round(1.05) = 1 (fractional 0.05 < 0.5)
    expect(calculateCajasForGender(1)).toBe(1);
  });

  it('should apply 5% for count = 5', () => {
    // 5 * 1.05 = 5.25 → round(5.25) = 5 (fractional 0.25 < 0.5)
    expect(calculateCajasForGender(5)).toBe(5);
  });

  it('should apply 5% for count = 10', () => {
    // 10 * 1.05 = 10.5 → round = 11 (fractional 0.5 >= 0.5)
    expect(calculateCajasForGender(10)).toBe(11);
  });

  it('should apply 5% for count = 15', () => {
    // 15 * 1.05 = 15.75 → round = 16 (fractional 0.75 >= 0.5)
    expect(calculateCajasForGender(15)).toBe(16);
  });

  it('should apply 5% for count = 16', () => {
    // 16 * 1.05 = 16.8 → round = 17 (fractional 0.8 >= 0.5)
    expect(calculateCajasForGender(16)).toBe(17);
  });

  it('should apply 5% for count = 20', () => {
    // 20 * 1.05 = 21 → round = 21 (exact)
    expect(calculateCajasForGender(20)).toBe(21);
  });

  it('should apply 5% for count = 50', () => {
    // 50 * 1.05 = 52.5 → round = 53 (fractional 0.5 >= 0.5)
    expect(calculateCajasForGender(50)).toBe(53);
  });

  it('should apply 5% for count = 100', () => {
    // 100 * 1.05 = 105 → round = 105 (exact)
    expect(calculateCajasForGender(100)).toBe(105);
  });

  describe('combined grade totals', () => {
    it('should calculate total boxes for a grade with both genders', () => {
      const hombres = 10;
      const mujeres = 12;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 10*1.05=10.5→round=11, 12*1.05=12.6→round=13, total=24
      expect(total).toBe(24);
    });

    it('should calculate total boxes for a grade with larger counts', () => {
      const hombres = 20;
      const mujeres = 25;
      const total = calculateCajasForGender(hombres) + calculateCajasForGender(mujeres);
      // 20*1.05=21→round=21, 25*1.05=26.25→round=26, total=47
      expect(total).toBe(47);
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

  describe('Shoes (multiplier=1) — extra = Math.round(base * 0.05)', () => {
    it('should handle original=8 (5% < 0.5, no extra)', () => {
      // original=8 → base=8 → 8*0.05=0.4 → round=0 → extra=0, final=8
      const result = computeFinalCount(8, 1);
      expect(result).toEqual({ base: 8, extra: 0, final: 8 });
    });

    it('should handle original=12 (5% >= 0.5, rounds up)', () => {
      // original=12 → base=12 → 12*0.05=0.6 → round=1 → extra=1, final=13
      const result = computeFinalCount(12, 1);
      expect(result).toEqual({ base: 12, extra: 1, final: 13 });
    });

    it('should handle original=20', () => {
      // original=20 → base=20 → 20*0.05=1.0 → round=1 → extra=1, final=21
      const result = computeFinalCount(20, 1);
      expect(result).toEqual({ base: 20, extra: 1, final: 21 });
    });

    it('should handle original=4 (5% < 0.5, no extra)', () => {
      // original=4 → base=4 → 4*0.05=0.2 → round=0 → extra=0, final=4
      const result = computeFinalCount(4, 1);
      expect(result).toEqual({ base: 4, extra: 0, final: 4 });
    });

    it('should handle original=100', () => {
      // original=100 → base=100 → 100*0.05=5.0 → round=5 → extra=5, final=105
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

    // 25: 12 → base=12 → 12*0.05=0.6 → round=1 → final=13
    // 26: 10 → base=10 → 10*0.05=0.5 → round=1 → final=11
    // 27: 0 → base=0 → extra=0 → final=0
    // 28: 2 → base=2 → 2*0.05=0.1 → round=0 → final=2
    expect(result).toEqual({
      '25': 13,
      '26': 11,
      '27': 0,
      '28': 2,
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
    // base=100, extra=round(100*0.05)=round(5)=5, final=105
    expect(shoeResult).toEqual({ base: 100, extra: 5, final: 105 });
  });

  it('should handle single-digit counts', () => {
    // Clothing: original=1 (below threshold, no extra)
    const clothing1 = computeFinalCount(1, 2);
    // base=2, below threshold (base<20) → extra=0, final=2
    expect(clothing1).toEqual({ base: 2, extra: 0, final: 2 });

    // Shoes: original=1 (5% < 0.5, no extra)
    const shoe1 = computeFinalCount(1, 1);
    // base=1, 1*0.05=0.05 → round=0, extra=0, final=1
    expect(shoe1).toEqual({ base: 1, extra: 0, final: 1 });
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
