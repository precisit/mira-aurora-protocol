import type { BloomParams } from '../renderer/BloomPass';

/**
 * BloomPulse (B1: "pump bloom intensity on big events").
 *
 * Owns a decaying energy envelope and translates it into bloom `intensity`
 * patches through a callback — in the demo that callback is
 * `renderer.setBloomOptions(patch)`; tests use a spy. Baseline intensity is
 * restored exactly once when the envelope empties, so the post-pass never
 * stays "hot" after an explosion.
 *
 * Deliberately renderer-free so it runs headless in unit tests.
 */

export interface BloomPulseOptions {
  /** Resting composite intensity (matches DEFAULT_BLOOM_PARAMS ≈ 0.95). */
  baseIntensity?: number;
  /** Intensity at full energy. Default 2.6. */
  peakIntensity?: number;
  /** Seconds for full energy to drain to zero. Default 0.45. */
  decaySeconds?: number;
}

export const DEFAULT_BLOOM_PULSE_OPTIONS: Readonly<Required<BloomPulseOptions>> = {
  baseIntensity: 0.95,
  peakIntensity: 2.6,
  decaySeconds: 0.45,
};

/** Signature compatible with WebGPURenderer.setBloomOptions(). */
export type BloomApplyFn = (patch: Partial<BloomParams>) => void;

function clamp01(value: number): number {
  return Number.isFinite(value) ? (value < 0 ? 0 : value > 1 ? 1 : value) : 0;
}

function pickPositive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

export class BloomPulse {
  private readonly apply: BloomApplyFn | null;
  private readonly baseIntensity: number;
  private readonly peakIntensity: number;
  private readonly decaySeconds: number;
  private energy = 0;

  public constructor(
    apply: BloomApplyFn | null = null,
    opts: BloomPulseOptions = {},
  ) {
    this.apply = apply;
    this.baseIntensity = opts.baseIntensity ?? DEFAULT_BLOOM_PULSE_OPTIONS.baseIntensity;
    this.peakIntensity = Math.max(
      this.baseIntensity,
      opts.peakIntensity ?? DEFAULT_BLOOM_PULSE_OPTIONS.peakIntensity,
    );
    this.decaySeconds = pickPositive(opts.decaySeconds, DEFAULT_BLOOM_PULSE_OPTIONS.decaySeconds);
  }

  /** Current envelope energy [0, 1]. */
  public get energyLevel(): number {
    return this.energy;
  }

  public get isActive(): boolean {
    return this.energy > 0;
  }

  /**
   * Intensity the last update emitted, or the baseline while idle.
   * Useful for HUD readouts and tests.
   */
  public get currentIntensity(): number {
    return (
      this.baseIntensity +
      (this.peakIntensity - this.baseIntensity) * (this.energy * (2 - this.energy))
    );
  }

  /**
   * Pump the envelope toward full. `strength` ∈ [0, 1] scales how much of the
   * gap to peak is used (small pickups blip, boss warnings slam); repeated
   * calls stack up to 1.
   */
  public pulse(strength = 1): void {
    const s = clamp01(strength);
    // Additive stacking with diminishing returns near full.
    this.energy = Math.min(1, this.energy + s * Math.max(0.25, 1 - this.energy));
  }

  /**
   * Drain the envelope and emit intensity patches through the callback.
   * Emits at most one patch per call; emits the baseline once on settle.
   */
  public update(dtSeconds: number): void {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    if (!this.isActive) return;

    if (dt >= this.energy * this.decaySeconds) {
      this.settle();
      return;
    }
    this.energy -= dt / this.decaySeconds;
    if (this.energy <= 1e-4) {
      this.settle();
      return;
    }
    this.apply?.({ intensity: this.currentIntensity });
  }

  /** Immediately drop to baseline (level transitions). */
  public reset(): void {
    if (this.isActive) this.settle();
    else this.energy = 0;
  }

  private settle(): void {
    this.energy = 0;
    this.apply?.({ intensity: this.baseIntensity });
  }
}
