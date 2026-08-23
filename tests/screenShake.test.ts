import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAKE_OPTIONS,
  ScreenShake,
  decayTrauma,
  sampleShake,
  valueNoise1D,
} from '../src/effects/ScreenShake';

describe('trauma decay math', () => {
  it('decays linearly by decayPerSecond · dt', () => {
    expect(decayTrauma(1, 0.5, 1.4)).toBeCloseTo(0.3, 9);
    expect(decayTrauma(0.8, 0.25, 1.5)).toBeCloseTo(0.425, 9);
  });

  it('clamps at zero and never goes negative', () => {
    expect(decayTrauma(0.2, 10, 1.5)).toBe(0);
    expect(decayTrauma(0, 1, 1.5)).toBe(0);
  });

  it('clamps trauma above 1 and ignores negative dt', () => {
    expect(decayTrauma(5, 0, 1.5)).toBe(1);
    expect(decayTrauma(0.5, -1, 1.5)).toBe(0.5);
  });

  it('ScreenShake.update matches the pure decay function over time', () => {
    const shake = new ScreenShake({ decayPerSecond: 1.5 });
    shake.addTrauma(1);
    const dt = 1 / 120;
    let expected = 1;
    for (let i = 0; i < 120; i++) {
      shake.update(dt);
      expected = decayTrauma(expected, dt, 1.5);
      expect(shake.trauma).toBeCloseTo(expected, 9);
    }
    // 1 s of decay at 1.5/s drains fully.
    expect(shake.trauma).toBeCloseTo(0, 6);
  });
});

describe('shake offset sampling', () => {
  it('is exactly zero at zero trauma', () => {
    for (let t = 0; t < 2; t += 0.13) {
      const s = sampleShake(0, t);
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
    }
  });

  it('scales with the square of trauma (small hits stay gentle)', () => {
    const half = sampleShake(0.5, 0.37);
    const full = sampleShake(1, 0.37);
    // Same noise phase ratio; amplitude ratio must equal (0.5² / 1²) = 0.25.
    if (Math.abs(full.x) > 1e-9) {
      expect(Math.abs(half.x / full.x)).toBeCloseTo(0.25, 9);
    }
    expect(Math.abs(half.x)).toBeLessThanOrEqual(Math.abs(full.x) + 1e-12);
  });

  it('is bounded by maxOffset in both axes', () => {
    let maxX = 0;
    let maxY = 0;
    for (let t = 0; t <= 3; t += 1 / 240) {
      const s = sampleShake(1, t);
      maxX = Math.max(maxX, Math.abs(s.x));
      maxY = Math.max(maxY, Math.abs(s.y));
    }
    expect(maxX).toBeLessThanOrEqual(DEFAULT_SHAKE_OPTIONS.maxOffsetX + 1e-9);
    expect(maxY).toBeLessThanOrEqual(DEFAULT_SHAKE_OPTIONS.maxOffsetY + 1e-9);
    // And actually reaches a meaningful magnitude somewhere (not dead noise).
    expect(maxX).toBeGreaterThan(DEFAULT_SHAKE_OPTIONS.maxOffsetX * 0.4);
  });

  it('is deterministic and continuous in time', () => {
    const a = sampleShake(0.7, 1.234);
    const b = sampleShake(0.7, 1.234);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);

    let prev = sampleShake(0.7, 0);
    for (let t = 1 / 240; t <= 1; t += 1 / 240) {
      const s = sampleShake(0.7, t);
      // Bounded per-step delta at 240 Hz (max noise slope × amplitude/frequency
      // ≈ 22·26·1.875/240 + 16·31·1.875/240 ≈ 8 px) — no teleporting offsets.
      expect(Math.abs(s.x - prev.x)).toBeLessThan(10);
      prev = s;
    }
  });

  it('valueNoise1D stays in [-1, 1] and is continuous', () => {
    for (let x = -20; x <= 20; x += 0.05) {
      const v = valueNoise1D(x);
      expect(v).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    const l = valueNoise1D(4.999);
    const r = valueNoise1D(5.001);
    expect(Math.abs(r - l)).toBeLessThan(0.01);
  });
});

describe('ScreenShake accumulator API', () => {
  it('clamps addTrauma to [0, 1]', () => {
    const shake = new ScreenShake();
    shake.addTrauma(0.5);
    shake.addTrauma(0.9);
    expect(shake.trauma).toBe(1);
  });

  it('exposes offsets only after update and resets cleanly', () => {
    const shake = new ScreenShake();
    shake.addTrauma(1);
    shake.update(1 / 60);
    const mag = Math.hypot(shake.offsetX, shake.offsetY);
    expect(mag).toBeGreaterThan(0);

    shake.reset();
    expect(shake.trauma).toBe(0);
    expect(shake.offsetX).toBe(0);
    expect(shake.offsetY).toBe(0);
  });
});
