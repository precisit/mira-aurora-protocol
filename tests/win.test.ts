import { describe, expect, it } from 'vitest';
import {
  buildWinSummary,
  campaignLevelId,
  type WinSummary,
} from '../src/ui/win';
import { defaultSaveData } from '../src/save/SaveStore';
import type { LevelResultSnapshot } from '../src/game/RunStats';

function result(overrides: Partial<LevelResultSnapshot>): LevelResultSnapshot {
  return {
    index: 1,
    levelId: 'lvl-01-mnemosynes-fall',
    score: 0,
    timeMs: 0,
    checkpointsPassed: 0,
    deaths: 0,
    fragmentsByType: {},
    ...overrides,
  };
}

describe('campaignLevelId', () => {
  it('produces stable zero-padded save keys for all seven slots', () => {
    expect(campaignLevelId(1)).toBe('lvl-01');
    expect(campaignLevelId(7)).toBe('lvl-07');
  });
});

describe('buildWinSummary', () => {
  it('builds one row per campaign level (all 7, PLAN.md §4)', () => {
    const summary = buildWinSummary([], { totalRunTimeMs: 0 }, defaultSaveData());
    expect(summary.levels).toHaveLength(7);
    expect(summary.levels.map((row) => row.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('uses real level ids/titles from run results, titles for the rest', () => {
    const results = [result({ index: 1, levelId: 'lvl-01-mnemosynes-fall', score: 900 })];
    const summary = buildWinSummary(results, { totalRunTimeMs: 61_000 }, defaultSaveData());
    const first = summary.levels[0]!;
    expect(first.levelId).toBe('lvl-01-mnemosynes-fall');
    expect(first.title).toBe('The Fall of Mnemosyne'); // from story.ts intros
    // Unbuilt slots fall back to the synthetic id and keep their table slot.
    const fifth = summary.levels[4]!;
    expect(fifth.levelId).toBe('lvl-05');
    expect(fifth.title.length).toBeGreaterThan(0);
  });

  it('sums score, time, fragments, checkpoints and deaths across levels', () => {
    const results = [
      result({
        index: 1,
        score: 500,
        checkpointsPassed: 3,
        deaths: 1,
        fragmentsByType: { Music: 4, Philosophy: 1 },
      }),
      result({
        index: 2,
        levelId: 'lvl-02-datastormen',
        score: 750,
        checkpointsPassed: 2,
        fragmentsByType: { Science: 2 },
      }),
    ];
    const summary = buildWinSummary(results, { totalRunTimeMs: 125_990 }, defaultSaveData());
    expect(summary.totalRunScore).toBe(1250);
    expect(summary.formattedTotalRunTime).toBe('02:05.99');
    expect(summary.fragmentsCollected).toBe(7);
    expect(summary.checkpointsPassed).toBe(5);
    expect(summary.deaths).toBe(1);
  });

  it('reads per-level bests (score + time) from the save file', () => {
    const save = defaultSaveData();
    save.highscores['lvl-01-mnemosynes-fall'] = { score: 1200, timeMs: 74_320 };
    const results = [result({ index: 1, levelId: 'lvl-01-mnemosynes-fall' })];
    const summary = buildWinSummary(results, { totalRunTimeMs: 74_320 }, save);
    const row = summary.levels[0]!;
    expect(row.bestScore).toBe(1200);
    expect(row.bestTimeMs).toBe(74_320);
    expect(summary.levels[1]!.bestScore).toBeNull(); // no entry yet
  });

  it('flags new best-run records and carries par times through', () => {
    const save = defaultSaveData();
    save.bestRunTimeMs = 600_000;
    const record: WinSummary = buildWinSummary(
      [],
      { totalRunTimeMs: 589_000 },
      save,
      { newRecord: true },
    );
    expect(record.isNewBestRunTime).toBe(true);

    const notRecord = buildWinSummary([], { totalRunTimeMs: 601_000 }, save);
    expect(notRecord.isNewBestRunTime).toBe(false);
    expect(notRecord.bestRunTimeMs).toBe(600_000);

    const withPar = buildWinSummary([], { totalRunTimeMs: 1000 }, defaultSaveData(), {
      parTimes: { 1: 90 },
    });
    expect(withPar.parTimeSecondsByLevel[1]).toBe(90);
  });
});
