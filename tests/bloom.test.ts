import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOOM_PARAMS,
  brightFactor,
  resolveBloomParams,
} from '../src/renderer/BloomPass';
import { GAUSSIAN_TAPS_9 } from '../src/renderer/shaders';

describe('resolveBloomParams', () => {
  it('returns the defaults for empty input', () => {
    expect(resolveBloomParams({})).toEqual({ ...DEFAULT_BLOOM_PARAMS });
  });

  it('falls back to defaults for non-finite values', () => {
    const p = resolveBloomParams({
      threshold: Number.NaN,
      knee: Number.POSITIVE_INFINITY,
      intensity: Number.NEGATIVE_INFINITY,
      radius: Number.NaN,
      downsample: Number.NaN,
    });
    expect(p).toEqual({ ...DEFAULT_BLOOM_PARAMS });
  });

  it('clamps out-of-range values', () => {
    const p = resolveBloomParams({
      threshold: 100,
      knee: -5,
      intensity: 1e9,
      radius: 0.001,
      downsample: 64,
    });
    expect(p.threshold).toBeLessThanOrEqual(4);
    expect(p.knee).toBe(0);
    expect(p.intensity).toBeLessThanOrEqual(8);
    expect(p.radius).toBeGreaterThanOrEqual(0.5);
    expect(p.downsample).toBe(4);
  });

  it('rounds downsample to an integer within range', () => {
    expect(resolveBloomParams({ downsample: 2.6 }).downsample).toBe(3);
    expect(resolveBloomParams({ downsample: 0.2 }).downsample).toBe(1);
  });

  it('merges patches over the current params without losing fields', () => {
    const p = resolveBloomParams({ ...DEFAULT_BLOOM_PARAMS, intensity: 3 });
    expect(p.intensity).toBe(3);
    expect(p.threshold).toBe(DEFAULT_BLOOM_PARAMS.threshold);
    expect(p.knee).toBe(DEFAULT_BLOOM_PARAMS.knee);
    expect(p.radius).toBe(DEFAULT_BLOOM_PARAMS.radius);
    expect(p.downsample).toBe(DEFAULT_BLOOM_PARAMS.downsample);
  });
});

describe('brightFactor (soft-knee extraction curve)', () => {
  it('is zero well below the threshold', () => {
    expect(brightFactor(0.1, 0.62, 0.4)).toBe(0);
    expect(brightFactor(0.62 - 0.4 - 0.01, 0.62, 0.4)).toBe(0);
  });

  it('approaches full brightness far above the threshold', () => {
    // Subtractive threshold: factor = (b - t) / b → 1 as b grows.
    expect(brightFactor(10, 0.62, 0.4)).toBeCloseTo((10 - 0.62) / 10, 6);
    expect(brightFactor(100, 0.62, 0.4)).toBeCloseTo((100 - 0.62) / 100, 6);
    expect(brightFactor(1e7, 0.62, 0.4)).toBeCloseTo(1, 5);
    expect(brightFactor(1e7, 0.62, 0.4)).toBeGreaterThan(
      brightFactor(100, 0.62, 0.4),
    );
  });

  it('ramps smoothly through the knee (monotonic, no discontinuity)', () => {
    let prev = -1;
    for (let b = 0; b <= 2; b += 0.005) {
      const f = brightFactor(b, 0.62, 0.4);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('uses a hard cut when knee is zero', () => {
    expect(brightFactor(0.61, 0.62, 0)).toBe(0);
    expect(brightFactor(0.62, 0.62, 0)).toBe(0); // strictly greater required
    expect(brightFactor(1.24, 0.62, 0)).toBeCloseTo((1.24 - 0.62) / 1.24, 6);
  });

  it('is defensive against NaN/negative/zero brightness', () => {
    expect(brightFactor(Number.NaN, 0.62, 0.4)).toBe(0);
    expect(brightFactor(-1, 0.62, 0.4)).toBe(0);
    expect(brightFactor(0, 0.62, 0.4)).toBe(0);
    // Non-finite threshold/knee degrade to a sane hard threshold at 0.
    expect(brightFactor(0.5, Number.NaN, Number.NaN)).toBeGreaterThan(0);
  });
});

describe('GAUSSIAN_TAPS_9 (blur kernel)', () => {
  it('has nine symmetric taps that normalize to ~1', () => {
    expect(GAUSSIAN_TAPS_9.length).toBe(9);
    for (let i = 0; i < 4; i++) {
      expect(GAUSSIAN_TAPS_9[i]).toBeCloseTo(GAUSSIAN_TAPS_9[8 - i] as number, 12);
    }
    const sum = GAUSSIAN_TAPS_9.reduce((acc, w) => acc + w, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it('peaks at the center tap', () => {
    const center = GAUSSIAN_TAPS_9[4] as number;
    for (const w of GAUSSIAN_TAPS_9) {
      expect(w).toBeLessThanOrEqual(center + 1e-12);
    }
  });
});
