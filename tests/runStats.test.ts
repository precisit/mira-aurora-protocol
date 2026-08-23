import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_BONUS_POINTS,
  RunStats,
} from '../src/game/RunStats';

describe('RunStats — checkpoint bonus (PLAN.md §4)', () => {
  it('awards a fixed bonus per checkpoint and reports the amount', () => {
    const stats = new RunStats();
    expect(stats.registerCheckpoint()).toBe(CHECKPOINT_BONUS_POINTS);
    expect(stats.levelScore).toBe(CHECKPOINT_BONUS_POINTS);
    stats.registerCheckpoint();
    expect(stats.levelScore).toBe(CHECKPOINT_BONUS_POINTS * 2);
    expect(stats.checkpointsPassed).toBe(2);
  });

  it('the bonus is "small" relative to fragment values', () => {
    // Sanity guard so nobody turns it into a jackpot by accident.
    expect(CHECKPOINT_BONUS_POINTS).toBeLessThan(1000);
    expect(CHECKPOINT_BONUS_POINTS).toBeGreaterThan(0);
  });

  it('checkpoint counters reset with restartLevel but survive in snapshots', () => {
    const stats = new RunStats();
    stats.addFragment('Music');
    stats.registerCheckpoint();
    stats.registerDeath();
    const snapshot = stats.completeLevel(1, 'lvl-01-x', 60_000);
    expect(snapshot.checkpointsPassed).toBe(1);
    expect(snapshot.score).toBe(10 + CHECKPOINT_BONUS_POINTS);

    stats.restartLevel(); // simulate game-over on next level
    expect(stats.levelScore).toBe(0);
    expect(stats.checkpointsPassed).toBe(0);
  });
});

describe('RunStats — fragments & totals', () => {
  it('scores fragments by archive-theme value', () => {
    const stats = new RunStats();
    expect(stats.addFragment('Music')).toBe(10);
    expect(stats.addFragment('Philosophy')).toBe(100);
    expect(stats.levelScore).toBe(110);
  });

  it('tallies fragments by type across levels', () => {
    const stats = new RunStats();
    stats.addFragment('Science');
    stats.addFragment('Science');
    stats.completeLevel(1, 'lvl-01-a', 50_000);
    stats.addFragment('Art');
    expect(stats.totalFragments).toBe(3);
    expect(stats.fragmentsByType.get('Science')).toBe(2);
    expect(stats.fragmentsByType.get('Art')).toBe(1);
  });

  it('banks completed levels; totalRunScore only counts finished ones', () => {
    const stats = new RunStats();
    stats.addFragment('History'); // 60
    stats.completeLevel(1, 'lvl-01-a', 40_000);
    stats.addFragment('Medicine'); // 75, still open
    expect(stats.totalRunScore).toBe(60);
    stats.completeLevel(2, 'lvl-02-b', 45_000);
    expect(stats.totalRunScore).toBe(135);
    expect(stats.results).toHaveLength(2);
  });

  it('restartLevel wipes ongoing level score but keeps banked results + deaths', () => {
    const stats = new RunStats();
    stats.addFragment('Language');
    stats.completeLevel(1, 'lvl-01-a', 30_000);
    stats.addFragment('Philosophy');
    stats.registerCheckpoint();
    stats.registerDeath();
    stats.restartLevel(); // game over → "banans pågående poäng nollställs"
    expect(stats.levelScore).toBe(0);
    expect(stats.totalRunScore).toBe(40); // banked level 1 kept
    expect(stats.deaths).toBe(1); // run-wide deaths kept
  });

  it('snapshots attribute deaths to the level where they happened', () => {
    const stats = new RunStats();
    stats.registerDeath();
    stats.registerDeath();
    const first = stats.completeLevel(1, 'lvl-01-a', 20_000);
    expect(first.deaths).toBe(2);
    stats.registerDeath();
    const second = stats.completeLevel(2, 'lvl-02-b', 25_000);
    expect(second.deaths).toBe(1);
    expect(first.deaths).toBe(2); // untouched
  });

  it('resetRun clears everything for a fresh campaign', () => {
    const stats = new RunStats();
    stats.addFragment('Music');
    stats.registerCheckpoint();
    stats.registerDeath();
    stats.completeLevel(1, 'lvl-01-a', 15_000);
    stats.resetRun();
    expect(stats.levelScore).toBe(0);
    expect(stats.totalRunScore).toBe(0);
    expect(stats.deaths).toBe(0);
    expect(stats.totalFragments).toBe(0);
    expect(stats.results).toHaveLength(0);
  });
});
