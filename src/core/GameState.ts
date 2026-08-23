/**
 * Global game state machine.
 *
 * Legal transitions (per PLAN.md Fas 0 + section 4):
 *
 *   BOOT ──► MENU ──► PLAYING ──┬─► PAUSED ──► PLAYING | MENU
 *                               ├─► GAMEOVER ──► PLAYING | MENU
 *                               └─► WIN ──► MENU
 */
export enum GameStateName {
  Boot = 'BOOT',
  Menu = 'MENU',
  Playing = 'PLAYING',
  Paused = 'PAUSED',
  GameOver = 'GAMEOVER',
  Win = 'WIN',
}

/** Directed graph of legal transitions between states. */
const LEGAL_TRANSITIONS: Readonly<Record<GameStateName, readonly GameStateName[]>> = {
  [GameStateName.Boot]: [GameStateName.Menu],
  [GameStateName.Menu]: [GameStateName.Playing],
  [GameStateName.Playing]: [
    GameStateName.Paused,
    GameStateName.GameOver,
    GameStateName.Win,
  ],
  [GameStateName.Paused]: [GameStateName.Playing, GameStateName.Menu],
  // Restart current level, or bail to menu.
  [GameStateName.GameOver]: [GameStateName.Playing, GameStateName.Menu],
  [GameStateName.Win]: [GameStateName.Menu],
};

/** Thrown when an illegal transition is attempted. */
export class StateTransitionError extends Error {
  public constructor(from: GameStateName, to: GameStateName) {
    super(`Illegal state transition: ${from} → ${to}`);
    this.name = 'StateTransitionError';
  }
}

export type StateChangeListener = (from: GameStateName, to: GameStateName) => void;

export class GameStateMachine {
  private _current: GameStateName = GameStateName.Boot;
  private readonly listeners = new Set<StateChangeListener>();

  public get current(): GameStateName {
    return this._current;
  }

  /** True if `to` is reachable from the current state. */
  public can(to: GameStateName): boolean {
    return LEGAL_TRANSITIONS[this._current].includes(to);
  }

  /**
   * Transition to `to`. Throws {@link StateTransitionError} on illegal moves,
   * leaving the machine unchanged.
   */
  public transition(to: GameStateName): this {
    if (this._current === to) return this; // idempotent no-op
    if (!this.can(to)) throw new StateTransitionError(this._current, to);

    const from = this._current;
    this._current = to;
    for (const listener of this.listeners) listener(from, to);
    return this;
  }

  /** Like {@link transition}, but reports success as a boolean instead of throwing. */
  public tryTransition(to: GameStateName): boolean {
    if (!this.can(to)) return false;
    this.transition(to);
    return true;
  }

  /** Subscribe to transitions. Returns an unsubscribe function. */
  public onChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hard reset back to BOOT (e.g. on full game restart). */
  public reset(): void {
    this.transitionToBoot();
  }

  private transitionToBoot(): void {
    if (this._current === GameStateName.Boot) return;
    const from = this._current;
    this._current = GameStateName.Boot;
    for (const listener of this.listeners) listener(from, GameStateName.Boot);
  }
}
