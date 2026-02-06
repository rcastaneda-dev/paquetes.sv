/**
 * Unit tests for vacíos (empty/buffer) size distribution calculator
 *
 * These tests validate the transformation rules:
 * - Clothing (camisas, prenda_inferior): base = original × 2
 * - Shoes (zapatos): base = original × 1
 * - Extra (vacíos): ceilToEven(base × 0.15)
 * - Final: base + extra
 */

import { ceilToEven, computeFinalCount, transformSizeCounts } from '../vacios';

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

describe('computeFinalCount', () => {
  describe('Clothing (multiplier=2)', () => {
    it('should handle golden sample: original=12', () => {
      // original=12 → base=24 → extra=ceilEven(24*0.15)=ceilEven(3.6)=4 → final=28
      const result = computeFinalCount(12, 2);
      expect(result).toEqual({ base: 24, extra: 4, final: 28 });
    });

    it('should handle golden sample: original=10', () => {
      // original=10 → base=20 → extra=ceilEven(20*0.15)=ceilEven(3)=4 → final=24
      const result = computeFinalCount(10, 2);
      expect(result).toEqual({ base: 20, extra: 4, final: 24 });
    });

    it('should handle golden sample: original=2', () => {
      // original=2 → base=4 → extra=ceilEven(4*0.15)=ceilEven(0.6)=2 → final=6
      const result = computeFinalCount(2, 2);
      expect(result).toEqual({ base: 4, extra: 2, final: 6 });
    });

    it('should handle golden sample: original=3', () => {
      // original=3 → base=6 → extra=ceilEven(6*0.15)=ceilEven(0.9)=2 → final=8
      const result = computeFinalCount(3, 2);
      expect(result).toEqual({ base: 6, extra: 2, final: 8 });
    });

    it('should handle zero count', () => {
      const result = computeFinalCount(0, 2);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });

  describe('Shoes (multiplier=1)', () => {
    it('should handle golden sample: original=8', () => {
      // original=8 → base=8 → extra=ceilEven(8*0.15)=ceilEven(1.2)=2 → final=10
      const result = computeFinalCount(8, 1);
      expect(result).toEqual({ base: 8, extra: 2, final: 10 });
    });

    it('should handle golden sample: original=12', () => {
      // original=12 → base=12 → extra=ceilEven(12*0.15)=ceilEven(1.8)=2 → final=14
      const result = computeFinalCount(12, 1);
      expect(result).toEqual({ base: 12, extra: 2, final: 14 });
    });

    it('should handle golden sample: original=20', () => {
      // original=20 → base=20 → extra=ceilEven(20*0.15)=ceilEven(3)=4 → final=24
      const result = computeFinalCount(20, 1);
      expect(result).toEqual({ base: 20, extra: 4, final: 24 });
    });

    it('should handle golden sample: original=4', () => {
      // original=4 → base=4 → extra=ceilEven(4*0.15)=ceilEven(0.6)=2 → final=6
      const result = computeFinalCount(4, 1);
      expect(result).toEqual({ base: 4, extra: 2, final: 6 });
    });

    it('should handle zero count', () => {
      const result = computeFinalCount(0, 1);
      expect(result).toEqual({ base: 0, extra: 0, final: 0 });
    });
  });
});

describe('transformSizeCounts', () => {
  it('should transform all sizes with clothing multiplier', () => {
    const originalCounts = {
      T12: 10,
      T14: 15,
      T16: 5,
    };

    const result = transformSizeCounts(originalCounts, 2);

    // T12: 10 → base=20 → extra=4 → final=24
    // T14: 15 → base=30 → extra=6 → final=36
    // T16: 5 → base=10 → extra=2 → final=12
    expect(result).toEqual({
      T12: 24,
      T14: 36,
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

    // 25: 12 → base=12 → extra=2 → final=14
    // 26: 10 → base=10 → extra=2 → final=12
    // 27: 0 → base=0 → extra=0 → final=0
    // 28: 2 → base=2 → extra=2 → final=4
    expect(result).toEqual({
      '25': 14,
      '26': 12,
      '27': 0,
      '28': 4,
    });
  });
});

describe('Edge cases and real-world scenarios', () => {
  it('should handle large counts correctly', () => {
    // Large clothing count
    const clothingResult = computeFinalCount(100, 2);
    // base=200, extra=ceilEven(200*0.15)=ceilEven(30)=30, final=230
    expect(clothingResult).toEqual({ base: 200, extra: 30, final: 230 });

    // Large shoe count
    const shoeResult = computeFinalCount(100, 1);
    // base=100, extra=ceilEven(100*0.15)=ceilEven(15)=16, final=116
    expect(shoeResult).toEqual({ base: 100, extra: 16, final: 116 });
  });

  it('should handle single-digit counts', () => {
    // Clothing: original=1
    const clothing1 = computeFinalCount(1, 2);
    // base=2, extra=ceilEven(2*0.15)=ceilEven(0.3)=2, final=4
    expect(clothing1).toEqual({ base: 2, extra: 2, final: 4 });

    // Shoes: original=1
    const shoe1 = computeFinalCount(1, 1);
    // base=1, extra=ceilEven(1*0.15)=ceilEven(0.15)=2, final=3
    expect(shoe1).toEqual({ base: 1, extra: 2, final: 3 });
  });

  it('should maintain consistency across multiple transformations', () => {
    // Verify that transforming the same count multiple times gives the same result
    const original = 15;
    const result1 = computeFinalCount(original, 2);
    const result2 = computeFinalCount(original, 2);
    expect(result1).toEqual(result2);
  });
});
