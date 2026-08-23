/**
 * Timing & statistics core (task B5, PLAN.md §4 "Vinst & replay" +
 * §6 "Data & sparande").
 *
 * `LevelTimer` tracks two clocks driven by the fixed-timestep loop:
 *   - per-level elapsed time (resets on level start / game-over restart)
 *   - total run time (accumulates across levels for the whole campaign run;
 *     speedrun time per PLAN.md: "speedrun-tid mäts per bana och totalt")
 *
 * The clock is advanced explicitly via {@link LevelTimer.advance} so tests are
 * deterministic; it never reads wall-clock time. Pausing the game pauses both
 * clocks ({@link GameStateName.Paused}), checkpoints intentionally do NOT
 * stop the clock ({@link LevelTimer.notifyCheckpoint}).
 */

import { GameStateName, type GameStateMachine } from './GameState';

export type TimerPhase = 'idle' | 'running' | 'paused' | 'stopped';

/** Formats milliseconds as `mm:ss.xx` (centiseconds, floored). */
export function formatTimeMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const xx = String(centiseconds).padStart(2, '0');
  return `${mm}:${ss}.${xx}`;
}

export class LevelTimer {
  private phaseValue: TimerPhase = 'idle';
  private levelMs = 0;
  private totalMs = 0;

  public get phase(): TimerPhase {
    return this.phaseValue;
  }

  /** True while the clocks accumulate time (i.e. between start and stop/pause). */
  public get isRunning(): boolean {
    return this.phaseValue === 'running';
  }

  /** Elapsed PLAYING time in the current level attempt. */
  public get levelElapsedMs(): number {
    return this.levelMs;
  }

  /** Elapsed PLAYING time across the whole run (all levels + retries). */
  public get totalElapsedMs(): number {
    return this.totalMs;
  }

  /** Fresh run (menu → level 1): zeroes both clocks and starts counting. */
  public startRun(): void {
    this.levelMs = 0;
    this.totalMs = 0;
    this.phaseValue = 'running';
  }

  /**
   * New level attempt: zeroes the level clock only. Used when entering the
   * next level and on game-over restart (PLAN.md: banan startas om; tiden i
   * banan börjar om medan totaltiden — som en riktig speedrun — fortsätter).
   */
  public restartLevel(): void {
    this.levelMs = 0;
    this.phaseValue = 'running';
  }

  /** Starts/resumes counting from current accumulations without resetting. */
  public start(): void {
    this.phaseValue = 'running';
  }

  /** Freezes both clocks (PAUSED); values stay readable for the HUD. */
  public pause(): void {
    if (this.phaseValue === 'running') this.phaseValue = 'paused';
  }

  /** Continues counting after {@link pause}. */
  public resume(): void {
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
  }

  /** Stops for good (WIN/GAMEOVER/menu exit); further advance() is a no-op. */
  public stop(): void {
    this.phaseValue = 'stopped';
  }

  /**
   * Advances both clocks by `deltaMs` — call once per fixed timestep. Only
   * accumulates while running; negative deltas are ignored.
   */
  public advance(deltaMs: number): void {
    if (this.phaseValue !== 'running') return;
    if (!(deltaMs > 0)) return;
    this.levelMs += deltaMs;
    this.totalMs += deltaMs;
  }

  /**
   * Checkpoint pass-through hook. Checkpoints must not stop the clock — this
   * is deliberately a no-op that returns the running level time so callers
   * can stamp bonus events against it.
   */
  public notifyCheckpoint(): number {
    return this.levelMs;
  }

  /** Formatted current level time, e.g. `01:23.45`. */
  public formatLevelTime(): string {
    return formatTimeMs(this.levelMs);
  }

  /** Formatted total run time, e.g. `12:03.90`. */
  public formatTotalTime(): string {
    return formatTimeMs(this.totalMs);
  }

  /**
   * Maps state-machine transitions onto the clocks:
   *   MENU→PLAYING   fresh run          · PLAYING→PAUSED      pause
   *   PAUSED→PLAYING resume            · PLAYING→GAMEOVER/WIN stop
   *   GAMEOVER→PLAYING restart level    · any→MENU            stop
   */
  public handleStateChange(from: GameStateName, to: GameStateName): void {
    switch (to) {
      case GameStateName.Playing:
        if (from === GameStateName.Menu) this.startRun();
        else if (from === GameStateName.GameOver) this.restartLevel();
        else if (from === GameStateName.Paused) this.resume();
        else this.start();
        return;
      case GameStateName.Paused:
        this.pause();
        return;
      case GameStateName.Menu:
      case GameStateName.Win:
      case GameStateName.GameOver:
        this.stop();
        return;
      default:
        return; // BOOT etc.
    }
  }
}

/**
 * Subscribes a timer to a state machine. Returns an unsubscribe function.
 * Wire-up used by main.ts so timing stays in sync with the single source of
 * truth (the state machine) instead of scattered ad-hoc calls.
 */
export function attachLevelTimer(machine: GameStateMachine, timer: LevelTimer): () => void {
  return machine.onChange((from, to) => timer.handleStateChange(from, to));
}
