/**
 * Per-run scoring & statistics (task B5; PLAN.md §4 "Poäng & highscore",
 * "Liv, död & checkpoints", "Vinst & replay").
 *
 * Pure game-data accumulator — no DOM, no audio. The caller (gameplay wave)
 * feeds events and reads snapshots:
 *
 *   - {@link RunStats.addFragment}      → fragment points by archive theme
 *   - {@link RunStats.registerCheckpoint} → +{@link CHECKPOINT_BONUS_POINTS}
 *     (the caller plays the 'checkpoint' SFX hook — see AudioEngine.playSfx)
 *   - {@link RunStats.registerDeath}    → death counter
 *   - {@link RunStats.restartLevel}     → game-over: level score resets to
 *     zero while the accumulated totals are kept (PLAN.md §4: "banans
 *     pågående poäng nollställs (totalpoängen behålls)")
 *   - {@link RunStats.completeLevel}    → snapshot for SaveStore.recordLevelResult
 *     and the win screen (src/ui/win.ts)
 */

import type { FragmentTypeName } from './entities';
import { FRAGMENT_POINT_VALUES } from './entities';

/** Points awarded per checkpoint passed ("små bonuspoäng", PLAN.md §4). */
export const CHECKPOINT_BONUS_POINTS = 500;

/** One finished level inside a run — the unit persisted to the save file. */
export interface LevelResultSnapshot {
  /** Campaign slot 1–7. */
  index: number;
  levelId: string;
  /** Level score at the exit: fragments + checkpoint bonuses + combat later. */
  score: number;
  timeMs: number;
  checkpointsPassed: number;
  deaths: number;
  fragmentsByType: Partial<Record<FragmentTypeName, number>>;
}

export class RunStats {
  private levelScoreValue = 0;
  private checkpointsThisLevel = 0;
  private deathsTotal = 0;
  /** Run-wide death count when the current level attempt began. */
  private deathsAtLevelStart = 0;
  private readonly fragmentsThisLevel = new Map<FragmentTypeName, number>();
  private readonly completedResults: LevelResultSnapshot[] = [];

  /** Score of the current (not yet completed) level attempt. */
  public get levelScore(): number {
    return this.levelScoreValue;
  }

  /** Sum of all completed levels' scores this run (win-screen totalpoäng). */
  public get totalRunScore(): number {
    return this.completedResults.reduce((sum, r) => sum + r.score, 0);
  }

  public get checkpointsPassed(): number {
    return this.checkpointsThisLevel;
  }

  public get deaths(): number {
    return this.deathsTotal;
  }

  public get results(): readonly LevelResultSnapshot[] {
    return this.completedResults;
  }

  /** Checkpoints across all completed levels + current one. */
  public get totalCheckpoints(): number {
    return (
      this.completedResults.reduce((sum, r) => sum + r.checkpointsPassed, 0) +
      this.checkpointsThisLevel
    );
  }

  /** Total memory-fragment pickups across the whole run so far. */
  public get totalFragments(): number {
    let count = 0;
    for (const n of this.fragmentsThisLevel.values()) count += n;
    for (const result of this.completedResults) {
      for (const n of Object.values(result.fragmentsByType)) count += n ?? 0;
    }
    return count;
  }

  /** Fragment pickups tallied by archive theme, run-wide. */
  public get fragmentsByType(): ReadonlyMap<FragmentTypeName, number> {
    const tally = new Map<FragmentTypeName, number>();
    const add = (type: FragmentTypeName, n: number): void => {
      tally.set(type, (tally.get(type) ?? 0) + n);
    };
    for (const result of this.completedResults) {
      for (const [type, n] of Object.entries(result.fragmentsByType)) {
        add(type as FragmentTypeName, n ?? 0);
      }
    }
    for (const [type, n] of this.fragmentsThisLevel) add(type, n);
    return tally;
  }

  /**
   * Collects a memory fragment: adds its archive-theme value (Music 10 …
   * Philosophy 100) to the current level score and returns points awarded.
   */
  public addFragment(type: FragmentTypeName): number {
    const value = FRAGMENT_POINT_VALUES[type];
    this.fragmentsThisLevel.set(type, (this.fragmentsThisLevel.get(type) ?? 0) + 1);
    this.levelScoreValue += value;
    return value;
  }

  /**
   * Passing a checkpoint: awards {@link CHECKPOINT_BONUS_POINTS}. The clock
   * keeps running (see LevelTimer.notifyCheckpoint); the caller fires the
   * 'checkpoint' SFX when this returns > 0.
   */
  public registerCheckpoint(): number {
    this.checkpointsThisLevel += 1;
    this.levelScoreValue += CHECKPOINT_BONUS_POINTS;
    return CHECKPOINT_BONUS_POINTS;
  }

  /** Registers a death (−1 liv). Timing/scoring unaffected here. */
  public registerDeath(): void {
    this.deathsTotal += 1;
  }

  /**
   * Game over on the current level: its ongoing score/checkpoints/fragments
   * reset (PLAN.md §4) while completed-level results and total deaths stay.
   */
  public restartLevel(): void {
    this.levelScoreValue = 0;
    this.checkpointsThisLevel = 0;
    this.fragmentsThisLevel.clear();
  }

  /**
   * Closes out the current level: freezes a snapshot for persistence/win
   * stats, banks it into the run total and resets level-scoped counters for
   * the next level.
   */
  public completeLevel(index: number, levelId: string, timeMs: number): LevelResultSnapshot {
    const snapshot: LevelResultSnapshot = {
      index,
      levelId,
      score: this.levelScoreValue,
      timeMs,
      checkpointsPassed: this.checkpointsThisLevel,
      deaths: this.deathsTotal - this.deathsAtLevelStart,
      fragmentsByType: Object.fromEntries(this.fragmentsThisLevel),
    };
    this.completedResults.push(snapshot);
    this.levelScoreValue = 0;
    this.checkpointsThisLevel = 0;
    this.deathsAtLevelStart = this.deathsTotal;
    this.fragmentsThisLevel.clear();
    return snapshot;
  }

  /** Fresh campaign run (back to menu → start again). */
  public resetRun(): void {
    this.levelScoreValue = 0;
    this.checkpointsThisLevel = 0;
    this.deathsTotal = 0;
    this.deathsAtLevelStart = 0;
    this.fragmentsThisLevel.clear();
    this.completedResults.length = 0;
  }
}
