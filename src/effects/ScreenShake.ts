/**
 * ScreenShake (PLAN.md §4 "Juice & effekter": "mjuk skärmshake vid explosioner").
 *
 * Trauma-based shake (industry-standard "juice" model):
 *   - gameplay events add **trauma** ∈ [0, 1] instead of raw offsets;
 *   - trauma decays linearly over time;
 *   - the visible offset is `maxOffset · trauma² · noise(t)` — squaring makes
 *     small hits gentle and big explosions violent while sharing one scalar;
 *   - noise is smooth value noise (hashed lattice + quintic fade), i.e.
 *     Perlin-ish: continuous, non-repeating-feeling, deterministic.
 *
 * Pure math (`decayTrauma`, `valueNoise1D`, `sampleShake`) is exported for
 * unit testing without any DOM/GPU involvement. The renderer camera consumes
 * `offsetX/offsetY` each frame after `update(dt)`.
 */

export interface ScreenShakeOptions {
  /** Peak horizontal offset at full trauma, px. Default 22. */
  maxOffsetX?: number;
  /** Peak vertical offset at full trauma, px. Default 16. */
  maxOffsetY?: number;
  /** Trauma units drained per second. Default 1.5 (≈0.67 s from full). */
  decayPerSecond?: number;
  /** Horizontal noise frequency (lattice steps/s). Default 26. */
  frequencyX?: number;
  /** Vertical noise frequency. Default 31 (prime-ish vs X → no visible lock). */
  frequencyY?: number;
}

export type RequiredScreenShakeOptions = Required<ScreenShakeOptions>;

export const DEFAULT_SHAKE_OPTIONS: Readonly<RequiredScreenShakeOptions> = {
  maxOffsetX: 22,
  maxOffsetY: 16,
  decayPerSecond: 1.5,
  frequencyX: 26,
  frequencyY: 31,
};

function clamp01(value: number): number {
  return Number.isFinite(value) ? (value < 0 ? 0 : value > 1 ? 1 : value) : 0;
}

/**
 * Linear decay of trauma by `decayPerSecond · dt`, clamped to [0, 1].
 */
export function decayTrauma(trauma: number, dtSeconds: number, decayPerSecond: number): number {
  const t = clamp01(trauma);
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
  const decay = Number.isFinite(decayPerSecond) ? Math.max(0, decayPerSecond) : 0;
  return clamp01(t - decay * dt);
}

/** Deterministic hash → [0, 1). Sin-based lattice hash: stable within a session. */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Smooth 1D value noise in [-1, 1]: interpolate hashed lattice points with a
 * quintic fade. Continuous everywhere, cheap, and deterministic.
 */
export function valueNoise1D(t: number, seedOffset = 0): number {
  if (!Number.isFinite(t)) return 0;
  const x = t + seedOffset;
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i);
  const b = hash1(i + 1);
  return (a + (b - a) * smootherstep(f)) * 2 - 1;
}

export interface ShakeSample {
  x: number;
  y: number;
}

/**
 * Offset for a given trauma/time: `maxOffset · trauma² · noise`.
 * Zero at zero trauma; bounded by ±maxOffset at full trauma.
 */
export function sampleShake(
  trauma: number,
  timeSeconds: number,
  opts: Readonly<ScreenShakeOptions> = DEFAULT_SHAKE_OPTIONS,
): ShakeSample {
  const o = { ...DEFAULT_SHAKE_OPTIONS, ...opts };
  const t = clamp01(trauma);
  if (t <= 0) return { x: 0, y: 0 };
  const amp = t * t;
  return {
    x: o.maxOffsetX * amp * valueNoise1D(timeSeconds * o.frequencyX, 0),
    y: o.maxOffsetY * amp * valueNoise1D(timeSeconds * o.frequencyY, 57.3),
  };
}

/**
 * Trauma accumulator + noise sampler. Typical use per frame:
 *
 *   shake.addTrauma(0.4);          // on explosion
 *   shake.update(dt);              // in fixed update
 *   const { offsetX, offsetY } = shake; // feed into camera transform
 */
export class ScreenShake {
  private opts: RequiredScreenShakeOptions;
  private _trauma = 0;
  private time = 0;
  private sample: ShakeSample = { x: 0, y: 0 };

  public constructor(opts: ScreenShakeOptions = {}) {
    this.opts = sanitizeOptions(opts);
  }

  /** Current trauma level [0, 1]. */
  public get trauma(): number {
    return this._trauma;
  }

  /** Camera offset X in px for this frame (valid after update()). */
  public get offsetX(): number {
    return this.sample.x;
  }

  /** Camera offset Y in px for this frame (valid after update()). */
  public get offsetY(): number {
    return this.sample.y;
  }

  /**
   * Add trauma (clamped to [0, 1]). Rough guide: 0.1 hit-tap, 0.25 enemy
   * death, 0.5 explosion, 0.8+ player death / boss slams.
   */
  public addTrauma(amount: number): void {
    this._trauma = clamp01(this._trauma + (Number.isFinite(amount) ? amount : 0));
  }

  /** Alias used by event-style call sites (`shake.kick(0.3)`). */
  public kick(amount: number): void {
    this.addTrauma(amount);
  }

  /** Advance time, decay trauma, recompute this frame's offset. */
  public update(dtSeconds: number): void {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    this.time += dt;
    this._trauma = decayTrauma(this._trauma, dt, this.opts.decayPerSecond);
    this.sample = sampleShake(this._trauma, this.time, this.opts);
  }

  /** Zero everything (level transitions). */
  public reset(): void {
    this._trauma = 0;
    this.time = 0;
    this.sample.x = 0;
    this.sample.y = 0;
  }
}

function sanitizeOptions(opts: Readonly<ScreenShakeOptions>): RequiredScreenShakeOptions {
  const pick = (v: number | undefined, fb: number, min: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fb;
  return {
    maxOffsetX: pick(opts.maxOffsetX, DEFAULT_SHAKE_OPTIONS.maxOffsetX, 0),
    maxOffsetY: pick(opts.maxOffsetY, DEFAULT_SHAKE_OPTIONS.maxOffsetY, 0),
    decayPerSecond: pick(opts.decayPerSecond, DEFAULT_SHAKE_OPTIONS.decayPerSecond, 0.001),
    frequencyX: pick(opts.frequencyX, DEFAULT_SHAKE_OPTIONS.frequencyX, 0.001),
    frequencyY: pick(opts.frequencyY, DEFAULT_SHAKE_OPTIONS.frequencyY, 0.001),
  };
}
