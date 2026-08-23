/**
 * Score & combo (PLAN.md §4 "Poäng & highscore"): fragment points by archive
 * theme, combo multiplier for quick pickups/kills, checkpoint bonuses.
 *
 * The multiplier escalates while events keep arriving inside the combo window
 * and resets to ×1 when it lapses. Kills and fragment pickups both feed it.
 */

import type { SfxName } from '../audio/SfxSynth';

/** Window in which another qualifying event extends the combo. */
export const COMBO_WINDOW_MS = 2200;

/** Chain counts required to reach each multiplier tier (index 0 → ×1). */
export const COMBO_TIERS: readonly number[] = [0, 2, 4, 7, 10];
export const MAX_COMBO_MULTIPLIER = COMBO_TIERS.length; // ×5

/** Flat bonus for passing a checkpoint (PLAN.md §4 "checkpoint-bonuspoäng"). */
export const CHECKPOINT_BONUS = 250;

export interface ScoreEvent {
  kind: 'fragment' | 'kill';
}

export interface ComboTickEvent {
  /** New multiplier tier (1..MAX). */
  tier: number;
}

export interface ScoreTrackerHooks {
  /** Fired whenever a combo-tick sfx should play at the given ladder step. */
  onComboTick?: (event: ComboTickEvent) => void;
}

export class ScoreTracker {
  private _score = 0;
  private chain = 0;
  private _multiplier = 1;
  private comboExpireAtMs = Number.NEGATIVE_INFINITY;

  public constructor(private readonly hooks: ScoreTrackerHooks = {}) {}

  public get score(): number {
    return this._score;
  }

  /** Current multiplier tier (1..×5). */
  public get multiplier(): number {
    return this._multiplier;
  }

  /** Qualifying events in the current combo window. */
  public get chainCount(): number {
    return this.chain;
  }

  public reset(): void {
    this._score = 0;
    this.chain = 0;
    this._multiplier = 1;
    this.comboExpireAtMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Register a pickup/kill worth `basePoints`, apply the current multiplier
   * and advance the combo. Returns the points actually awarded.
   */
  public award(basePoints: number, nowMs: number, event: ScoreEvent): number {
    void event;
    this.extendCombo(nowMs);
    const points = Math.max(0, Math.round(basePoints)) * this._multiplier;
    this._score += points;
    return points;
  }

  /** Flat bonus (checkpoints) — deliberately bypasses the combo system. */
  public addFlatBonus(points: number): number {
    const safe = Math.max(0, Math.round(points));
    this._score += safe;
    return safe;
  }

  /** Lapse the combo when its window has expired as of `nowMs`. */
  public update(nowMs: number): void {
    if (this.chain > 0 && nowMs >= this.comboExpireAtMs) {
      this.chain = 0;
      this.setMultiplier(1);
    }
  }

  private extendCombo(nowMs: number): void {
    // A lapsed window restarts the chain from zero.
    if (nowMs >= this.comboExpireAtMs && this.chain > 0) {
      this.chain = 0;
      this.setMultiplier(1);
    }
    this.chain += 1;
    this.comboExpireAtMs = nowMs + COMBO_WINDOW_MS;
    this.setMultiplier(multiplierForChain(this.chain));
  }

  private setMultiplier(tier: number): void {
    if (tier === this._multiplier) return;
    const rising = tier > this._multiplier;
    this._multiplier = tier;
    if (rising && tier > 1) this.hooks.onComboTick?.({ tier });
  }
}

/** Multiplier tier for a qualifying-event chain count. */
export function multiplierForChain(chain: number): number {
  let tier = 1;
  for (let i = COMBO_TIERS.length - 1; i >= 0; i--) {
    const threshold = COMBO_TIERS[i] ?? 0;
    if (chain >= threshold) {
      tier = i + 1;
      break;
    }
  }
  return Math.min(Math.max(1, tier), MAX_COMBO_MULTIPLIER);
}

/** Adapter so gameplay code can stay decoupled from AudioEngine typing. */
export type SfxSink = (name: SfxName, options?: { step?: number }) => void;
