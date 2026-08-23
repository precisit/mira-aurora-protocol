import { describe, expect, it } from 'vitest';
import {
  attachLevelTimer,
  formatTimeMs,
  LevelTimer,
} from '../src/core/Timer';
import { GameStateMachine, GameStateName } from '../src/core/GameState';

describe('formatTimeMs', () => {
  it('formats zero as 00:00.00', () => {
    expect(formatTimeMs(0)).toBe('00:00.00');
  });

  it('formats minutes, seconds and centiseconds', () => {
    expect(formatTimeMs(61_400)).toBe('01:01.40');
    expect(formatTimeMs(5_003_210)).toBe('83:23.21'); // minutes unbounded
  });

  it('floors centiseconds so time is never over-reported', () => {
    expect(formatTimeMs(61_499)).toBe('01:01.49');
    expect(formatTimeMs(999)).toBe('00:00.99');
    expect(formatTimeMs(1_000)).toBe('00:01.00');
  });

  it('clamps negative input to zero', () => {
    expect(formatTimeMs(-42)).toBe('00:00.00');
  });
});

describe('LevelTimer math', () => {
  it('starts at zero and does not run before startRun', () => {
    const timer = new LevelTimer();
    timer.advance(1000);
    expect(timer.levelElapsedMs).toBe(0);
    expect(timer.totalElapsedMs).toBe(0);
    expect(timer.isRunning).toBe(false);
  });

  it('accumulates level and total time while running', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(1500);
    timer.advance(500);
    expect(timer.levelElapsedMs).toBe(2000);
    expect(timer.totalElapsedMs).toBe(2000);
  });

  it('pause freezes both clocks; resume continues where they left off', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(1000);
    timer.pause();
    expect(timer.isRunning).toBe(false);
    timer.advance(10_000); // paused — ignored
    expect(timer.totalElapsedMs).toBe(1000);
    timer.resume();
    timer.advance(250);
    expect(timer.levelElapsedMs).toBe(1250);
    expect(timer.totalElapsedMs).toBe(1250);
  });

  it('stop freezes for good (win screen must read stable values)', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(700);
    timer.stop();
    timer.advance(700);
    expect(timer.totalElapsedMs).toBe(700);
  });

  it('restartLevel resets the level clock but keeps total run time', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(2000);
    timer.restartLevel(); // game-over restart / next level
    expect(timer.levelElapsedMs).toBe(0);
    expect(timer.totalElapsedMs).toBe(2000);
    timer.advance(300);
    expect(timer.levelElapsedMs).toBe(300);
    expect(timer.totalElapsedMs).toBe(2300);
  });

  it('startRun zeroes everything for a fresh campaign run', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(5000);
    timer.startRun();
    expect(timer.levelElapsedMs).toBe(0);
    expect(timer.totalElapsedMs).toBe(0);
  });

  it('ignores negative deltas', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(-100);
    expect(timer.totalElapsedMs).toBe(0);
  });
});

describe('LevelTimer checkpoints', () => {
  it('keeps the clock running through checkpoint passes', () => {
    const timer = new LevelTimer();
    timer.startRun();
    timer.advance(1000);
    const stamp = timer.notifyCheckpoint();
    expect(stamp).toBe(1000);
    timer.advance(1000);
    expect(timer.levelElapsedMs).toBe(2000);
    expect(timer.isRunning).toBe(true);
  });
});

describe('LevelTimer × state machine wiring', () => {
  function playThrough(): { machine: GameStateMachine; timer: LevelTimer } {
    const machine = new GameStateMachine();
    machine.transition(GameStateName.Menu);
    const timer = new LevelTimer();
    attachLevelTimer(machine, timer);
    return { machine, timer };
  }

  it('menu → playing starts a fresh run', () => {
    const { machine, timer } = playThrough();
    machine.transition(GameStateName.Playing);
    expect(timer.isRunning).toBe(true);
    timer.advance(100);
    expect(timer.totalElapsedMs).toBe(100);
  });

  it('playing → paused → playing pauses/resumes via the machine', () => {
    const { machine, timer } = playThrough();
    machine.transition(GameStateName.Playing);
    timer.advance(500);
    machine.transition(GameStateName.Paused);
    expect(timer.phase).toBe('paused');
    timer.advance(500);
    machine.transition(GameStateName.Playing);
    timer.advance(200);
    expect(timer.totalElapsedMs).toBe(700);
  });

  it('game over stops the clock; retry restarts only the level clock', () => {
    const { machine, timer } = playThrough();
    machine.transition(GameStateName.Playing);
    timer.advance(4000); // some of level N
    machine.transition(GameStateName.GameOver);
    expect(timer.isRunning).toBe(false);
    expect(timer.levelElapsedMs).toBe(4000); // frozen value stays readable

    machine.transition(GameStateName.Playing); // "retry bana"
    expect(timer.levelElapsedMs).toBe(0);
    expect(timer.totalElapsedMs).toBe(4000); // speedrun total keeps going
  });

  it('win stops the clock with totals intact', () => {
    const { machine, timer } = playThrough();
    machine.transition(GameStateName.Playing);
    timer.advance(12_345);
    machine.transition(GameStateName.Win);
    expect(timer.phase).toBe('stopped');
    expect(timer.formatTotalTime()).toBe('00:12.34');
  });

  it('detaching stops following the machine', () => {
    const machine = new GameStateMachine();
    machine.transition(GameStateName.Menu);
    const timer = new LevelTimer();
    const detach = attachLevelTimer(machine, timer);
    detach();
    machine.transition(GameStateName.Playing);
    expect(timer.isRunning).toBe(false);
  });
});
