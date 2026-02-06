#!/usr/bin/env node
/**
 * Validation script for vacíos transformation
 * Run with: npx tsx src/lib/reports/__tests__/validate-vacios.ts
 */

import { ceilToEven, computeFinalCount } from '../vacios';

interface TestCase {
  name: string;
  original: number;
  multiplier: 1 | 2;
  expected: { base: number; extra: number; final: number };
}

const testCases: TestCase[] = [
  // Clothing (multiplier=2) golden samples
  {
    name: 'Clothing: original=12',
    original: 12,
    multiplier: 2,
    expected: { base: 24, extra: 4, final: 28 },
  },
  {
    name: 'Clothing: original=10',
    original: 10,
    multiplier: 2,
    expected: { base: 20, extra: 4, final: 24 },
  },
  {
    name: 'Clothing: original=2',
    original: 2,
    multiplier: 2,
    expected: { base: 4, extra: 2, final: 6 },
  },
  {
    name: 'Clothing: original=3',
    original: 3,
    multiplier: 2,
    expected: { base: 6, extra: 2, final: 8 },
  },
  // Shoes (multiplier=1) golden samples
  {
    name: 'Shoes: original=8',
    original: 8,
    multiplier: 1,
    expected: { base: 8, extra: 2, final: 10 },
  },
  {
    name: 'Shoes: original=12',
    original: 12,
    multiplier: 1,
    expected: { base: 12, extra: 2, final: 14 },
  },
  {
    name: 'Shoes: original=20',
    original: 20,
    multiplier: 1,
    expected: { base: 20, extra: 4, final: 24 },
  },
  {
    name: 'Shoes: original=4',
    original: 4,
    multiplier: 1,
    expected: { base: 4, extra: 2, final: 6 },
  },
];

console.log('🧪 Validating vacíos transformation...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = computeFinalCount(testCase.original, testCase.multiplier);
  const isMatch =
    result.base === testCase.expected.base &&
    result.extra === testCase.expected.extra &&
    result.final === testCase.expected.final;

  if (isMatch) {
    console.log(`✅ ${testCase.name}`);
    console.log(`   original=${testCase.original} → base=${result.base}, extra=${result.extra}, final=${result.final}`);
    passed++;
  } else {
    console.log(`❌ ${testCase.name}`);
    console.log(`   Expected: base=${testCase.expected.base}, extra=${testCase.expected.extra}, final=${testCase.expected.final}`);
    console.log(`   Got:      base=${result.base}, extra=${result.extra}, final=${result.final}`);
    failed++;
  }
  console.log('');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

// Test ceilToEven edge cases
console.log('\n🔢 Testing ceilToEven function:');
const ceilTests = [
  { input: 0, expected: 0 },
  { input: 0.1, expected: 2 },
  { input: 1, expected: 2 },
  { input: 2, expected: 2 },
  { input: 3, expected: 4 },
  { input: 3.6, expected: 4 },
  { input: 4, expected: 4 },
  { input: 5, expected: 6 },
];

for (const test of ceilTests) {
  const result = ceilToEven(test.input);
  const match = result === test.expected;
  console.log(`${match ? '✅' : '❌'} ceilToEven(${test.input}) = ${result} (expected ${test.expected})`);
}

if (failed === 0) {
  console.log('\n✨ All validations passed!');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} validation(s) failed!`);
  process.exit(1);
}
