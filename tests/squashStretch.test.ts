import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SQUASH_OPTIONS,
  SquashStretch,
  springStep,
  type SpringState,
} from '../src/effects/SquashStretch';

const STEP = 1 / 120;

function settle(spring: SquashStretch, seconds = 4): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) spring.update(STEP);
}

describe('springStep (pure integrator)', () => {
  it('converges to the target and stays there', () => {
    const s: SpringState = { value: 0.5, velocity: 0 };
    for (let i = 0; i < 120 * 5; i++) springStep(s, 1, DEFAULT_SQUASH_OPTIONS.stiffness, DEFAULT_SQUASH_OPTIONS.damping, STEP);
    expect(s.value).toBeCloseTo(1, 6);
    expect(s.velocity).toBeCloseTo(0, 6);
    // Settled: further steps change nothing.
    const frozen = s.value;
    springStep(s, 1, DEFAULT_SQUASH_OPTIONS.stiffness, DEFAULT_SQUASH_OPTIONS.damping, STEP);
    expect(s.value).toBeCloseTo(frozen, 12);
  });

  it('overshoots an underdamped impulse before returning', () => {
    const s: SpringState = { value: 1, velocity: -6 };
    let maxBelow = 0;
    for (let i = 0; i < 240; i++) {
      springStep(s, 1, DEFAULT_SQUASH_OPTIONS.stiffness, DEFAULT_SQUASH_OPTIONS.damping, STEP);
      maxBelow = Math.min(maxBelow, s.value);
    }
    expect(maxBelow).toBeLessThan(1 - 1e-3); // actually dipped past target
    expect(s.value).toBeCloseTo(1, 6); // ...and came back
  });

  it('is stable under a large single step (no explosion)', () => {
    const s: SpringState = { value: 0.35, velocity: 0 };
    springStep(s, 1, DEFAULT_SQUASH_OPTIONS.stiffness, DEFAULT_SQUASH_OPTIONS.damping, 0.25);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(10);
  });
});

describe('SquashStretch component', () => {
  it('starts at rest scale (1, 1)', () => {
    const sq = new SquashStretch();
    expect(sq.scaleX).toBe(1);
    expect(sq.scaleY).toBe(1);
    expect(sq.isAtRest).toBe(true);
  });

  it('squash widens + shortens with volume preserved; springs back', () => {
    const sq = new SquashStretch();
    sq.squash(0.4);
    expect(sq.scaleX).toBeGreaterThan(1);
    expect(sq.scaleY).toBeLessThan(1);
    // Reciprocal pairing keeps area ≈ constant.
    expect(sq.scaleX * sq.scaleY).toBeCloseTo(1, 6);

    settle(sq);
    expect(sq.isAtRest).toBe(true);
    expect(sq.scaleX).toBeCloseTo(1, 3);
    expect(sq.scaleY).toBeCloseTo(1, 3);
  });

  it('stretch lengthens + narrows; converges within ~2 s', () => {
    const sq = new SquashStretch();
    sq.stretch(0.32);
    expect(sq.scaleY).toBeGreaterThan(1);
    expect(sq.scaleX).toBeLessThan(1);

    for (let i = 0; i < Math.round(2 / STEP); i++) sq.update(STEP);
    expect(Math.abs(sq.scaleX - 1)).toBeLessThan(1e-3);
    expect(Math.abs(sq.scaleY - 1)).toBeLessThan(1e-3);
    expect(sq.isAtRest).toBe(true);
  });

  it('clamps impulses to the deform limit (never inside-out or huge)', () => {
    const sq = new SquashStretch();
    sq.squash(50);
    sq.stretch(-42); // clamped to 0 amount
    expect(sq.scaleX).toBeLessThanOrEqual(1 + DEFAULT_SQUASH_OPTIONS.maxDeform + 1e-9);
    expect(sq.scaleY).toBeGreaterThanOrEqual(1 - DEFAULT_SQUASH_OPTIONS.maxDeform - 1e-9);
    settle(sq);
    expect(sq.isAtRest).toBe(true);
  });

  it('direct impulses clamp and reset returns instantly to rest', () => {
    const sq = new SquashStretch();
    sq.impulse(3, Number.NaN); // NaN leaves the Y axis untouched
    expect(sq.scaleX).toBeCloseTo(1 + DEFAULT_SQUASH_OPTIONS.maxDeform, 9);
    expect(sq.scaleY).toBe(1);
    sq.impulse(Number.NaN, -2); // negatives clamp to the deform floor
    expect(sq.scaleY).toBeCloseTo(1 - DEFAULT_SQUASH_OPTIONS.maxDeform, 9);
    settle(sq);
    expect(sq.isAtRest).toBe(true);
    sq.reset();
    expect(sq.isAtRest).toBe(true);
  });
});
