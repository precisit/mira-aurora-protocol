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
 */

/** Fixed simulation step, in milliseconds: 1000 / 120 Hz. */
export const FIXED_STEP_MS = 1000 / 120;

/** Largest frame delta we will ever feed to the accumulator (ms). */
export const MAX_FRAME_TIME_MS = 250;

export interface GameLoopOptions {
  /** Called zero or more times per frame, always with FIXED_STEP_MS. */
  update: (stepMs: number) => void;
  /** Called once per animation frame; alpha ∈ [0,1) interpolates between steps. */
  render: (alpha: number, frameDeltaMs: number) => void;
  /** Stop running when true is returned from render (optional). */
  shouldQuit?: () => boolean;
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

  public constructor(opts: GameLoopOptions) {
    this.opts = opts;
  }

  public get isRunning(): boolean {
    return this._running;
  }

  /** Smoothed frames-per-second estimate, updated once per rendered frame. */
  public get fps(): number {
    return this.fpsEma;
  }

  public start(now: number = performance.now()): void {
    if (this._running) return;
    this._running = true;
    this.lastTimeMs = now;
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
    this.lastTimeMs = now;

    if (frameDelta > 0) {
      // Exponential moving average keeps the FPS readout stable but responsive.
      const instantFps = 1000 / frameDelta;
      this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
    }

    this.processFrame(frameDelta);
    this.opts.render(this.alpha, frameDelta);

    if (this.opts.shouldQuit?.() ?? false) {
      this.stop();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}
