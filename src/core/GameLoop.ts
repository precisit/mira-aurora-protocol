/**
 * Fixed-timestep game loop (PLAN.md §6: "Fast timestep (120 Hz-ackumulator)
 * + rendering vid displayfrekvens").
 *
 * Pattern:
 *   - `requestAnimationFrame` drives frames at the display's cadence.
 *   - Each frame's measured delta is added to an accumulator.
 *   - The accumulator is drained in fixed 1/120 s slices, calling `update`
 *     once per slice — physics/simulation is deterministic regardless of
 *     display refresh rate.
 *   - `render` is called once per frame with a normalized interpolation alpha
 *     (`accumulator / STEP`) so later waves can interpolate entity transforms.
 *
 * A per-frame delta clamp prevents the "spiral of death" after tab switches:
 * huge gaps are simulated for at most MAX_FRAME_TIME_MS of catch-up steps.
 *
 * Battery-friendly FPS lock (task C3): with {@link setFpsCap} (e.g. 60 on
 * mobile) frames arriving sooner than the cap interval skip simulation AND
 * presentation entirely; their time accrues and is simulated by the next
 * presented frame, so the 120 Hz logic cadence is preserved while the GPU
 * only presents at ≤ the locked rate. Uncapped (default) presents every rAF.
 */

import { shouldPresentFrame, type FpsCap } from './Perf';

/** Fixed simulation step, in milliseconds: 1000 / 120 Hz. */
export const FIXED_STEP_MS = 1000 / 120;

/** Largest frame delta we will ever feed to the accumulator (ms). */
export const MAX_FRAME_TIME_MS = 250;

/** Frames slower than this are reported via `onLongFrame` (once per stall). */
export const LONG_FRAME_THRESHOLD_MS = 50;

export interface GameLoopOptions {
  /** Called zero or more times per frame, always with FIXED_STEP_MS. */
  update: (stepMs: number) => void;
  /** Called once per animation frame; alpha ∈ [0,1) interpolates between steps. */
  render: (alpha: number, frameDeltaMs: number) => void;
  /** Stop running when true is returned from render (optional). */
  shouldQuit?: () => boolean;
  /**
   * Battery-friendly present cap (C3). `null`/omitted = present every rAF.
   * Simulation stays 120 Hz regardless — skipped frames only skip presents.
   */
  fpsCap?: FpsCap;
  /**
   * Long-frame telemetry (C3): invoked when a rendered frame's delta first
   * crosses {@link LONG_FRAME_THRESHOLD_MS} (once per sustained stall).
   */
  onLongFrame?: (frameDeltaMs: number) => void;
}

export interface FrameStepResult {
  /** Number of fixed update steps executed this frame. */
  readonly steps: number;
  /** Interpolation alpha left over for rendering, in [0, 1). */
  readonly alpha: number;
}

export class GameLoop {
  private readonly opts: GameLoopOptions;
  private accumulatorMs = 0;
  private lastTimeMs = 0;
  private rafId = 0;
  private _running = false;
  private fpsEma = 60;
  private _fpsCap: FpsCap = null;
  /** Drift-corrected presentation budget for the FPS lock (ms). */
  private presentCreditMs = 0;
  private longFrameActive = false;

  public constructor(opts: GameLoopOptions) {
    this.opts = opts;
    if (opts.fpsCap !== undefined) this._fpsCap = opts.fpsCap;
  }

  public get isRunning(): boolean {
    return this._running;
  }

  /** Smoothed frames-per-second estimate, updated once per rendered frame. */
  public get fps(): number {
    return this.fpsEma;
  }

  /** Current present cap (null = uncapped); changeable at runtime. */
  public get fpsCap(): FpsCap {
    return this._fpsCap;
  }

  public setFpsCap(cap: FpsCap): void {
    this._fpsCap = cap;
  }

  public start(now: number = performance.now()): void {
    if (this._running) return;
    this._running = true;
    this.lastTimeMs = now;
    this.presentCreditMs = 0;
    this.longFrameActive = false;
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * Advance the accumulator by `frameDeltaMs` and run whole fixed steps.
   * Exposed separately from {@link tick} so unit tests can drive the loop
   * deterministically without requestAnimationFrame.
   */
  public processFrame(frameDeltaMs: number): FrameStepResult {
    // Clamp pathological deltas (background tab, debugger pause, GC hitch).
    const clamped = Math.min(Math.max(frameDeltaMs, 0), MAX_FRAME_TIME_MS);
    this.accumulatorMs += clamped;

    let steps = 0;
    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.accumulatorMs -= FIXED_STEP_MS;
      steps += 1;
      this.opts.update(FIXED_STEP_MS);
    }
    return { steps, alpha: this.alpha };
  }

  /** Normalized interpolation position between the last two simulation steps. */
  public get alpha(): number {
    return this.accumulatorMs / FIXED_STEP_MS;
  }

  private readonly tick = (now: number): void => {
    if (!this._running) return;

    const frameDelta = now - this.lastTimeMs;

    // FPS lock: accumulate a presentation budget and skip simulation AND
    // presentation for too-early frames. lastTimeMs is intentionally NOT
    // advanced — skipped time is credited to the next presented frame, so
    // the 120 Hz logic cadence is preserved (drift-corrected: leftover
    // budget carries over, keeping e.g. ~60 presents/s on an 80 Hz display).
    if (this._fpsCap !== null && frameDelta >= 0) {
      this.presentCreditMs = Math.min(
        this.presentCreditMs + frameDelta,
        (1000 / this._fpsCap) * 2,
      );
      if (!shouldPresentFrame(this.presentCreditMs, this._fpsCap)) {
        this.rafId = requestAnimationFrame(this.tick);
        return;
      }
      const interval = 1000 / this._fpsCap;
      this.presentCreditMs = Math.max(0, this.presentCreditMs - interval);
    }

    this.lastTimeMs = now;

    if (frameDelta > 0) {
      // Exponential moving average keeps the FPS readout stable but responsive.
      const instantFps = 1000 / frameDelta;
      this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
      this.reportFrameTime(frameDelta);
    }

    this.processFrame(frameDelta);
    this.opts.render(this.alpha, frameDelta);

    if (this.opts.shouldQuit?.() ?? false) {
      this.stop();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Long-frame telemetry hook. Separated from {@link tick} so tests can feed
   * deterministic deltas without requestAnimationFrame.
   */
  protected reportFrameTime(frameDeltaMs: number): void {
    const isLong = frameDeltaMs >= LONG_FRAME_THRESHOLD_MS;
    if (!isLong) {
      this.longFrameActive = false;
      return;
    }
    // Report only the transition into a stall — sustained slowness logs once.
    if (this.longFrameActive) return;
    this.longFrameActive = true;
    this.opts.onLongFrame?.(frameDeltaMs);
  }
}
