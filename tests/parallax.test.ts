import { describe, expect, it } from 'vitest';
import {
  PARALLAX_LAYERS,
  ParallaxLayerName,
  computeTilePositions,
  smoothTowards,
  wrapPeriod,
} from '../src/renderer/ParallaxBackground';

describe('PARALLAX_LAYERS (PLAN.md §6 depth order)', () => {
  it('lists exactly the five spec layers', () => {
    expect(PARALLAX_LAYERS.map((l) => l.name)).toEqual([
      ParallaxLayerName.Nebula,
      ParallaxLayerName.Starfield,
      ParallaxLayerName.Celestial,
      ParallaxLayerName.Mid,
      ParallaxLayerName.Foreground,
    ]);
  });

  it('is strictly sorted back-to-front by depth', () => {
    for (let i = 1; i < PARALLAX_LAYERS.length; i++) {
      expect(PARALLAX_LAYERS[i]?.depth ?? 0).toBeGreaterThan(
        PARALLAX_LAYERS[i - 1]?.depth ?? 0,
      );
    }
  });

  it('has sane scroll factors, tile widths and finite drift', () => {
    for (const layer of PARALLAX_LAYERS) {
      expect(layer.scrollFactor).toBeGreaterThanOrEqual(0);
      expect(layer.scrollFactor).toBeLessThanOrEqual(1);
      expect(layer.tileWidth).toBeGreaterThan(0);
      expect(Number.isFinite(layer.driftPxPerSec)).toBe(true);
      expect(layer.alpha).toBeGreaterThanOrEqual(0);
      expect(layer.alpha).toBeLessThanOrEqual(1);
    }
    // Foreground scrolls faster than mid, which scrolls faster than nebula.
    const fg = PARALLAX_LAYERS.find((l) => l.name === ParallaxLayerName.Foreground);
    const mid = PARALLAX_LAYERS.find((l) => l.name === ParallaxLayerName.Mid);
    const nebula = PARALLAX_LAYERS.find((l) => l.name === ParallaxLayerName.Nebula);
    expect((fg?.scrollFactor ?? 0)).toBeGreaterThan(mid?.scrollFactor ?? 0);
    expect((mid?.scrollFactor ?? 0)).toBeGreaterThan(nebula?.scrollFactor ?? 0);
  });
});

describe('wrapPeriod (seamless horizontal looping)', () => {
  it('wraps positive values into [0, period)', () => {
    expect(wrapPeriod(0, 960)).toBe(0);
    expect(wrapPeriod(500, 960)).toBe(500);
    expect(wrapPeriod(960, 960)).toBe(0);
    expect(wrapPeriod(1057, 960)).toBe(97);
    expect(wrapPeriod(2000, 960)).toBe(80);
  });

  it('wraps negative values into [0, period)', () => {
    expect(wrapPeriod(-1, 960)).toBe(959);
    expect(wrapPeriod(-960, 960)).toBe(0);
    expect(wrapPeriod(-1057, 960)).toBe(863);
  });

  it('is defensive against invalid input', () => {
    expect(wrapPeriod(10, 0)).toBe(0);
    expect(wrapPeriod(10, -5)).toBe(0);
    expect(wrapPeriod(Number.NaN, 100)).toBe(0);
    expect(wrapPeriod(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe('computeTilePositions (view coverage)', () => {
  it('covers the whole view with abutting tiles for any offset', () => {
    const tileWidth = 960;
    for (let offset = 0; offset < tileWidth; offset += 37.3) {
      const left = -140.5;
      const right = 1420.25;
      const xs = computeTilePositions(left, right, tileWidth, offset);
      expect(xs.length).toBeGreaterThan(0);

      // First tile starts at or before the view's left edge.
      expect(xs[0]).toBeLessThanOrEqual(left);
      // Consecutive tiles abut exactly.
      for (let i = 1; i < xs.length; i++) {
        expect((xs[i] as number) - (xs[i - 1] as number)).toBeCloseTo(tileWidth, 6);
      }
      // The union of tiles covers [left, right).
      expect((xs[xs.length - 1] as number) + tileWidth).toBeGreaterThanOrEqual(right);
    }
  });

  it('handles views narrower than one tile', () => {
    const xs = computeTilePositions(0, 100, 2048, 512);
    expect(xs).toEqual([-512]);
  });

  it('returns no tiles for degenerate bounds/widths', () => {
    expect(computeTilePositions(100, 100, 960, 0)).toEqual([]);
    expect(computeTilePositions(200, 100, 960, 0)).toEqual([]);
    expect(computeTilePositions(0, 100, 0, 0)).toEqual([]);
    expect(computeTilePositions(Number.NaN, 100, 960, 0)).toEqual([]);
  });
});

describe('smoothTowards (camera smoothing)', () => {
  it('moves monotonically toward the target and converges', () => {
    let current = 0;
    for (let i = 0; i < 500; i++) {
      current = smoothTowards(current, 1000, 1 / 60, 0.08);
      expect(current).toBeGreaterThanOrEqual(0);
      expect(current).toBeLessThanOrEqual(1000);
    }
    expect(current).toBeCloseTo(1000, 3);
  });

  it('never overshoots the target in a single step', () => {
    const next = smoothTowards(10, 20, 5, 0.08);
    expect(next).toBeGreaterThan(10);
    expect(next).toBeLessThanOrEqual(20);
  });

  it('returns the current value for degenerate dt/response', () => {
    expect(smoothTowards(7, 100, 0, 0.08)).toBe(7);
    expect(smoothTowards(7, 100, -1, 0.08)).toBe(7);
    expect(smoothTowards(7, 100, Number.NaN, 0.08)).toBe(7);
    expect(smoothTowards(7, 100, 1 / 60, 0)).toBe(7);
    expect(smoothTowards(7, 100, 1 / 60, Number.NaN)).toBe(7);
  });

  it('is frame-rate independent over equal total time', () => {
    // 60 × 16.6ms ≈ 6 × 166ms — both should land near the same place.
    let perFrame = 0;
    for (let i = 0; i < 60; i++) perFrame = smoothTowards(perFrame, 1000, 1 / 60, 0.08);
    let chunky = 0;
    for (let i = 0; i < 6; i++) chunky = smoothTowards(chunky, 1000, 10 / 60, 0.08);
    expect(Math.abs(perFrame - chunky)).toBeLessThan(30);
  });
});
