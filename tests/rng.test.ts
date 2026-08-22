import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/Rng';

describe('SeededRng (procedural generation determinism)', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new SeededRng(1234);
    const b = new SeededRng(1234);
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, 1) over many draws', () => {
    const rng = new SeededRng(42);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('range/int respect their bounds', () => {
    const rng = new SeededRng(77);
    for (let i = 0; i < 1000; i++) {
      const f = rng.range(-2.5, 4.5);
      expect(f).toBeGreaterThanOrEqual(-2.5);
      expect(f).toBeLessThan(4.5);

      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});
