/**
 * SquashStretch (PLAN.md §4: "Squash-and-stretch på hopp").
 *
 * A reusable scale component for arcade feel: gameplay sets impulses
 * (`squash` on land, `stretch` on jump), and two damped springs pull
 * scaleX/scaleY back to rest (1, 1) with a lively overshoot.
 *
 * Impulses are volume-preserving by default (`sx · sy ≈ 1`) so the sprite
 * reads as elastic rather than inflating. The player entity (wave B) owns one
 * instance and applies `(scaleX, scaleY)` around its feet anchor when drawing.
 *
 * The spring integrator is a pure exported function for unit tests.
 */

export interface SquashStretchOptions {
  /** Spring stiffness toward rest scale (1/s²). Default 190. */
  stiffness?: number;
  /** Spring damping; ~12 gives a slight overshoot, ~2·√stiffness is critical. Default 13. */
  damping?: number;
  /** Clamp for |scale − 1| in either direction. Default 0.65 (never inside-out). */
  maxDeform?: number;
}

export const DEFAULT_SQUASH_OPTIONS: Readonly<Required<SquashStretchOptions>> = {
  stiffness: 190,
  damping: 13,
  maxDeform: 0.65,
};

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * One semi-implicit Euler spring step toward `target`.
 * Stable at 120 Hz fixed timestep with the default constants.
 */
export function springStep(
  state: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dtSeconds: number,
): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  const k = Number.isFinite(stiffness) ? stiffness : DEFAULT_SQUASH_OPTIONS.stiffness;
  const c = Number.isFinite(damping) ? damping : DEFAULT_SQUASH_OPTIONS.damping;
  const accel = (target - state.value) * k - state.velocity * c;
  state.velocity += accel * dtSeconds;
  state.value += state.velocity * dtSeconds;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? (value < 0 ? 0 : value > 1 ? 1 : value) : 0;
}

/** Clamp a scale value into `[1 - maxDeform, 1 + maxDeform]`. */
function clampScale(scale: number, maxDeform: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1 + maxDeform, Math.max(1 - maxDeform, scale));
}

/**
 * Spring-driven scaleX/scaleY with squash/stretch impulses.
 * Start values are rest (1, 1); `update(dt)` converges back to rest.
 */
export class SquashStretch {
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly maxDeform: number;
  private readonly sx: SpringState = { value: 1, velocity: 0 };
  private readonly sy: SpringState = { value: 1, velocity: 0 };

  public constructor(opts: SquashStretchOptions = {}) {
    this.stiffness = pickPositive(opts.stiffness, DEFAULT_SQUASH_OPTIONS.stiffness);
    this.damping = pickPositive(opts.damping, DEFAULT_SQUASH_OPTIONS.damping);
    this.maxDeform = clamp01(opts.maxDeform ?? DEFAULT_SQUASH_OPTIONS.maxDeform);
  }

  /** Current horizontal scale (multiply the sprite's width). */
  public get scaleX(): number {
    return this.sx.value;
  }

  /** Current vertical scale (multiply the sprite's height). */
  public get scaleY(): number {
    return this.sy.value;
  }

  /** True once both springs have settled at rest (within 0.001). */
  public get isAtRest(): boolean {
    return (
      Math.abs(this.sx.value - 1) < 1e-3 &&
      Math.abs(this.sy.value - 1) < 1e-3 &&
      Math.abs(this.sx.velocity) < 1e-3 &&
      Math.abs(this.sy.velocity) < 1e-3
    );
  }

  /**
   * Landing-style impulse: wide + short. `amount` ∈ [0, 1] scales intensity
   * (scaleX up to 1 + maxDeform). Volume preserved via reciprocal pairing.
   */
  public squash(amount = 0.35): void {
    this.setVolumePreserved(this.sx, this.sy, 1 + clamp01(amount));
  }

  /**
   * Jump-style impulse: tall + thin. `amount` ∈ [0, 1] scales intensity.
   */
  public stretch(amount = 0.35): void {
    this.setVolumePreserved(this.sy, this.sx, 1 + clamp01(amount));
  }

  /**
   * Direct impulse: immediately set both scales (clamped into
   * `[1 ± maxDeform]`; NaN leaves an axis untouched) and let the springs
   * carry them back to rest. Volume is *not* forced here; prefer
   * {@link squash}/{@link stretch} for elastic reads.
   */
  public impulse(scaleX: number, scaleY: number): void {
    if (Number.isFinite(scaleX)) this.setAxis(this.sx, clampScale(scaleX, this.maxDeform));
    if (Number.isFinite(scaleY)) this.setAxis(this.sy, clampScale(scaleY, this.maxDeform));
  }

  /** Advance both springs toward rest. Call once per fixed step. */
  public update(dtSeconds: number): void {
    springStep(this.sx, 1, this.stiffness, this.damping, dtSeconds);
    springStep(this.sy, 1, this.stiffness, this.damping, dtSeconds);
    // Snap tiny residuals so isAtRest becomes exactly true.
    if (Math.abs(this.sx.value - 1) < 5e-4 && Math.abs(this.sx.velocity) < 5e-4) {
      this.sx.value = 1;
      this.sx.velocity = 0;
    }
    if (Math.abs(this.sy.value - 1) < 5e-4 && Math.abs(this.sy.velocity) < 5e-4) {
      this.sy.value = 1;
      this.sy.velocity = 0;
    }
  }

  /** Immediately return to rest (respawn, level change). */
  public reset(): void {
    this.sx.value = 1;
    this.sx.velocity = 0;
    this.sy.value = 1;
    this.sy.velocity = 0;
  }

  private setAxis(axis: SpringState, scale: number): void {
    // A small outward kick sells impact better than teleporting alone.
    axis.velocity += (scale - axis.value) * 6;
    axis.value = scale;
  }

  /** Set one axis to `scale` and its pair to the reciprocal (volume ≈ 1). */
  private setVolumePreserved(
    primary: SpringState,
    other: SpringState,
    scale: number,
  ): void {
    const safe = Math.max(1e-4, scale);
    this.setAxis(primary, clampScale(safe, this.maxDeform));
    this.setAxis(other, clampScale(1 / safe, this.maxDeform));
  }
}

function pickPositive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
