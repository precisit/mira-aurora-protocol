import { describe, expect, it } from 'vitest';
import {
  FIXED_STEP_MS,
  GameLoop,
  MAX_FRAME_TIME_MS,
} from '../src/core/GameLoop';

/** Deterministic loop harness — no rAF needed. */
function makeLoop() {
  let updates = 0;
  let renders = 0;
  const loop = new GameLoop({
    update: () => {
      updates += 1;
    },
    render: () => {
      renders += 1;
    },
  });
  return { loop, counts: { get updates() { return updates; }, get renders() { return renders; } } };
}

describe('GameLoop fixed timestep', () => {
  it('uses a 120 Hz fixed step (≈8.333 ms)', () => {
    expect(FIXED_STEP_MS).toBeCloseTo(1000 / 120, 10);
  });

  it('runs exactly one update for a frame of exactly one step', () => {
    const { loop, counts } = makeLoop();
    const result = loop.processFrame(FIXED_STEP_MS);
    expect(result.steps).toBe(1);
    expect(counts.updates).toBe(1);
    expect(result.alpha).toBeCloseTo(0, 10);
  });

  it('carries the remainder across frames (accumulator behaviour)', () => {
    const { loop, counts } = makeLoop();
    // Two 10 ms frames at ~8.333 ms/step: each frame drains to one step.
    expect(loop.processFrame(10).steps).toBe(1);
    expect(counts.updates).toBe(1);

    expect(loop.processFrame(10).steps).toBe(1);
    expect(counts.updates).toBe(2); // second frame consumed the carried remainder
    expect(loop.alpha).toBeGreaterThan(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('runs multiple catch-up steps after a long freeze', () => {
    const { loop, counts } = makeLoop();
    const result = loop.processFrame(100); // 100 ms ≈ 12 steps
    expect(result.steps).toBe(Math.floor(100 / FIXED_STEP_MS));
    expect(counts.updates).toBe(result.steps);
  });

  it('clamps pathological deltas to avoid the spiral of death', () => {
    const { loop, counts } = makeLoop();
    const result = loop.processFrame(MAX_FRAME_TIME_MS * 50); // tab slept for ages
    expect(result.steps).toBe(Math.floor(MAX_FRAME_TIME_MS / FIXED_STEP_MS));
    expect(counts.updates).toBe(result.steps);
    // Accumulator must stay below one extra step afterwards.
    expect(loop.alpha).toBeLessThan(1);
  });

  it('always reports alpha within [0, 1)', () => {
    const { loop } = makeLoop();
    for (const delta of [0, 3.7, FIXED_STEP_MS, 16.6, 33.4]) {
      const { alpha } = loop.processFrame(delta);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });
});
