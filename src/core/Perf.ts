/**
 * Pure performance-policy helpers (task C3, PLAN.md §6 "Objektpooling,
 * sprite-atlas, devicePixelRatio-cap för batteri, 60 FPS-lock-möjlighet").
 *
 * Everything here is side-effect-free so the battery/render policies can be
 * unit-tested in Node without DOM/WebGPU:
 *
 *   - {@link clampDevicePixelRatio} — backing-store cap (render at most 2×).
 *   - {@link sanitizeFpsCap}        — persisted FPS-lock setting repair.
 *   - {@link shouldPresentFrame}    — frame-skip decision for the FPS lock.
 *   - {@link LongFrameMonitor}      — log long frames once per hitch episode.
 */

/** Hard upper bound for the render scale, regardless of the user setting. */
export const HARD_MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * Cap a raw `devicePixelRatio` to the battery-friendly maximum.
 *
 * Non-finite / non-positive ratios degrade to 1 (never scale down below the
 * CSS pixel grid); caps above the hard max are clamped so a hostile setting
 * can never ask for a 4× backing store on an iPhone. Exported pure for tests
 * and used by `WebGPURenderer.resize()`.
 */
export function clampDevicePixelRatio(
  dpr: number,
  cap: number = HARD_MAX_DEVICE_PIXEL_RATIO,
): number {
  const safeCap = Number.isFinite(cap) && cap > 1 ? Math.min(cap, HARD_MAX_DEVICE_PIXEL_RATIO) : 1;
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(Math.max(dpr, 1), safeCap);
}

/** Allowed discrete FPS-lock values (`null` = present every display frame). */
export const FPS_CAP_CHOICES = [30, 60, 120] as const;

export type FpsCap = (typeof FPS_CAP_CHOICES)[number] | null;

/**
 * Repair a persisted fpsCap setting: keep valid choices, snap junk/NaN to
 * `null` (uncapped) and out-of-range numbers to the nearest allowed value so
 * a corrupt save blob can never produce a nonsensical lock.
 */
export function sanitizeFpsCap(value: unknown): FpsCap {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return null;
  let best: FpsCap = FPS_CAP_CHOICES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const choice of FPS_CAP_CHOICES) {
    const distance = Math.abs(choice - n);
    if (distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  return best;
}

/** Present interval for an fps cap, in ms; `null` when uncapped. */
export function frameIntervalMs(cap: FpsCap): number | null {
  if (cap === null || !(cap > 0)) return null;
  return 1000 / cap;
}

/**
 * Decide whether a frame should be presented under the FPS lock.
 *
 * `creditMs` is the caller's running presentation budget: time since the last
 * present **plus** any leftover credit from earlier skipped frames (drift
 * correction). The ~2 % tolerance absorbs rAF jitter so a 60 FPS lock really
 * holds ~60 presents/s on ProMotion displays instead of skipping every other
 * frame due to sub-millisecond timing noise. Uncapped always presents.
 *
 * Skipped frames only skip simulation+presentation; their time is credited to
 * the next presented frame, keeping the fixed-step logic cadence intact.
 */
export function shouldPresentFrame(creditMs: number, cap: FpsCap): boolean {
  const interval = frameIntervalMs(cap);
  if (interval === null) return true;
  return creditMs >= interval * 0.98;
}

/**
 * Long-frame watchdog: reports a callback only on the *transition* into a
 * slow frame, so one GC hitch logs once instead of spamming every frame of a
 * sustained stall ("log long frames (>50ms) once"). Also counts episodes and
 * keeps the worst delta for HUD/debug readouts.
 */
export class LongFrameMonitor {
  /** Frames at or above this duration (ms) count as long. */
  public readonly thresholdMs: number;

  private _episodes = 0;
  private _worstMs = 0;
  private _inLongFrame = false;

  public constructor(thresholdMs = 50) {
    this.thresholdMs = thresholdMs > 0 ? thresholdMs : 50;
  }

  /** Number of distinct long-frame episodes observed so far. */
  public get episodes(): number {
    return this._episodes;
  }

  /** Slowest single frame seen (ms). */
  public get worstMs(): number {
    return this._worstMs;
  }

  /**
   * Feed one frame duration; returns true exactly when a new long-frame
   * episode *begins* (i.e. callers should log). Sustained stalls log once.
   */
  public observe(frameDeltaMs: number): boolean {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0) return false;
    if (frameDeltaMs > this._worstMs) this._worstMs = frameDeltaMs;
    if (frameDeltaMs >= this.thresholdMs) {
      if (!this._inLongFrame) {
        this._inLongFrame = true;
        this._episodes += 1;
        return true;
      }
      return false;
    }
    this._inLongFrame = false;
    return false;
  }

  public reset(): void {
    this._episodes = 0;
    this._worstMs = 0;
    this._inLongFrame = false;
  }
}
