import type { Rgba } from '../renderer/types';

/**
 * Hit flash helpers (PLAN.md §4: "hit-flash").
 *
 * Two complementary effects:
 *  - {@link HitFlash} — **sprite-level** white flash on damage. The damaged
 *    entity mixes its tint toward white by `amount` for a few frames:
 *    `sprite.tint = hitFlash.tint(baseColor)` — no shader changes needed.
 *  - {@link ScreenFlash} — brief fullscreen tint driven by one additive quad
 *    covering the view (explosions, boss warnings). The game layer draws it;
 *    this class only owns the envelope + color.
 *
 * Both are pure CPU envelopes; rendering stays the renderer's job.
 */

/** Clamp helper shared below. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? (value < 0 ? 0 : value > 1 ? 1 : value) : 0;
}

/**
 * Mix `base` toward white by `amount` ∈ [0, 1]. Writes into `out` when given
 * (allocation-free path for per-frame use); returns the mixed color.
 */
export function mixToWhite(base: Rgba, amount: number, out?: [number, number, number, number]): Rgba {
  const t = clamp01(amount);
  const target: [number, number, number, number] = out ?? [0, 0, 0, 0];
  target[0] = base[0] + (1 - base[0]) * t;
  target[1] = base[1] + (1 - base[1]) * t;
  target[2] = base[2] + (1 - base[2]) * t;
  target[3] = base[3];
  return target;
}

/**
 * Sprite-level white flash envelope. `flash()` jumps `amount` to its peak
 * (constructor strength, optionally overridden per call), then it decays
 * linearly to 0 over `durationSeconds`.
 */
export class HitFlash {
  private readonly durationSeconds: number;
  private readonly defaultStrength: number;
  private peak: number;
  private remaining = 0;

  public constructor(durationSeconds = 0.09, strength = 1) {
    this.durationSeconds = Math.max(0.001, durationSeconds);
    this.defaultStrength = clamp01(strength);
    this.peak = this.defaultStrength;
  }

  /** Current flash amount in [0, 1]; 0 = no flash. */
  public get amount(): number {
    if (this.remaining <= 0) return 0;
    return this.peak * (this.remaining / this.durationSeconds);
  }

  public get isActive(): boolean {
    return this.remaining > 0;
  }

  /** Trigger the flash; re-flashing while active restarts the envelope. */
  public flash(strengthOverride?: number): void {
    this.remaining = this.durationSeconds;
    this.peak = strengthOverride === undefined ? this.defaultStrength : clamp01(strengthOverride);
  }

  /** Advance the envelope. Safe with dt ≤ 0 (no-op). */
  public update(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dtSeconds);
  }

  /**
   * Convenience for render code: mix `base` by the current amount into `out`
   * (or a fresh tuple). Pass a pooled tuple per sprite to avoid allocation.
   */
  public tint(base: Rgba, out?: [number, number, number, number]): Rgba {
    return mixToWhite(base, this.amount, out);
  }
}

/**
 * Fullscreen flash envelope: color + fading alpha, drawn as one additive
 * quad over the frame (see demo wiring in main.ts).
 */
export class ScreenFlash {
  private readonly durationSeconds: number;
  private remaining = 0;
  private peakAlpha: number;
  private _color: Rgba;

  public constructor(durationSeconds = 0.14) {
    this.durationSeconds = Math.max(0.001, durationSeconds);
    this.peakAlpha = 0;
    this._color = WHITE;
  }

  /** Current alpha in [0, peakAlpha]; 0 when idle. */
  public get amount(): number {
    if (this.remaining <= 0) return 0;
    return this.peakAlpha * (this.remaining / this.durationSeconds);
  }

  /** Base RGB (alpha is owned by the envelope). */
  public get color(): Rgba {
    return this._color;
  }

  public get isActive(): boolean {
    return this.remaining > 0;
  }

  /**
   * Trigger a flash. `strength` scales peak alpha (default 0.55); repeated
   * calls while active keep the strongest remaining envelope.
   */
  public flash(color: Rgba = WHITE, strength = 0.55, durationOverride?: number): void {
    const duration = Math.max(0.001, durationOverride ?? this.durationSeconds);
    const candidate = duration * clamp01(strength);
    if (this.isActive && this.remaining >= candidate) return; // stronger already running
    this._color = color;
    this.peakAlpha = clamp01(strength);
    this.remaining = duration;
  }

  /** Advance the envelope. */
  public update(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dtSeconds);
  }

  /** Write the current display color (`color.rgb`, alpha = amount) into `out`. */
  public currentColor(out: [number, number, number, number]): Rgba {
    out[0] = this._color[0];
    out[1] = this._color[1];
    out[2] = this._color[2];
    out[3] = this.amount;
    return out;
  }
}

const WHITE: Rgba = [1, 1, 1, 1];
