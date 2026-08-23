import { describe, expect, it, vi } from 'vitest';
import { GameStateMachine, GameStateName as S, StateTransitionError } from '../src/core/GameState';

describe('GameStateMachine transitions', () => {
  it('starts in BOOT', () => {
    expect(new GameStateMachine().current).toBe(S.Boot);
  });

  it('follows the happy path BOOT → MENU → PLAYING → PAUSED → PLAYING', () => {
    const sm = new GameStateMachine();
    sm.transition(S.Menu);
    sm.transition(S.Playing);
    sm.transition(S.Paused);
    sm.transition(S.Playing);
    expect(sm.current).toBe(S.Playing);
  });

  it('supports death and win flows', () => {
    const died = new GameStateMachine();
    died.transition(S.Menu);
    died.transition(S.Playing);
    died.transition(S.GameOver);
    died.transition(S.Playing); // restart current level
    expect(died.current).toBe(S.Playing);

    const won = new GameStateMachine();
    won.transition(S.Menu);
    won.transition(S.Playing);
    won.transition(S.Win);
    won.transition(S.Menu); // back for replay
    expect(won.current).toBe(S.Menu);
  });

  it('allows quitting from pause to menu', () => {
    const sm = new GameStateMachine();
    sm.transition(S.Menu);
    sm.transition(S.Playing);
    sm.transition(S.Paused);
    sm.transition(S.Menu);
    expect(sm.current).toBe(S.Menu);
  });

  it('throws on illegal transitions and leaves state unchanged', () => {
    const sm = new GameStateMachine();
    expect(() => sm.transition(S.Playing)).toThrow(StateTransitionError);
    expect(sm.current).toBe(S.Boot);

    sm.transition(S.Menu);
    expect(() => sm.transition(S.Win)).toThrow(/Illegal state transition: MENU → WIN/);
    expect(() => sm.transition(S.Paused)).toThrow(); // can't pause from menu
    expect(sm.current).toBe(S.Menu);
  });

  it('tryTransition returns false instead of throwing', () => {
    const sm = new GameStateMachine();
    expect(sm.tryTransition(S.GameOver)).toBe(false);
    sm.transition(S.Menu);
    expect(sm.tryTransition(S.Playing)).toBe(true);
  });

  it('treats re-entering the same state as a no-op without events', () => {
    const sm = new GameStateMachine();
    sm.transition(S.Menu);
    const listener = vi.fn();
    sm.onChange(listener);
    sm.transition(S.Menu);
    expect(listener).not.toHaveBeenCalled();
    expect(sm.current).toBe(S.Menu);
  });

  it('notifies listeners with from/to and supports unsubscribe', () => {
    const sm = new GameStateMachine();
    const listener = vi.fn();
    const off = sm.onChange(listener);

    sm.transition(S.Menu);
    expect(listener).toHaveBeenCalledWith(S.Boot, S.Menu);

    off();
    sm.transition(S.Playing);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
