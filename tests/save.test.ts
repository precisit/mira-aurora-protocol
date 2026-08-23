import { describe, expect, it } from 'vitest';
import {
  defaultSaveData,
  MemoryStorage,
  SAVE_KEY,
  SaveStore,
  type HighscoreEntry,
} from '../src/save/SaveStore';

describe('SaveStore (localStorage layer)', () => {
  it('returns defaults when nothing is saved', () => {
    const store = new SaveStore(new MemoryStorage());
    const data = store.load();
    expect(data.version).toBe(1);
    expect(data.totalScore).toBe(0);
    expect(data.unlockedWeapons).toContain('puls');
    expect(data.settings.volume).toBeGreaterThan(0);
  });

  it('round-trips data through storage', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    const data = store.load();
    data.totalScore = 12_500;
    store.save(data);

    // A brand-new store over the same storage must see the saved values.
    expect(new SaveStore(storage).load().totalScore).toBe(12_500);
  });

  it('round-trips B5 fields (bestRunTimeMs) through storage', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    const data = store.load();
    expect(store.recordRunTime(data, 512_340)).toBe(true);
    store.save(data);

    const reloaded = new SaveStore(storage).load();
    expect(reloaded.bestRunTimeMs).toBe(512_340);
  });

  it('loads pre-B5 saves (missing bestRunTimeMs) without losing old fields', () => {
    const storage = new MemoryStorage();
    // Blob written by an older build: no bestRunTimeMs anywhere.
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        highscores: { 'lvl-01-mnemosynes-fall': { score: 800, timeMs: 71_500 } },
        totalScore: 4321,
        unlockedWeapons: ['puls', 'spridare'],
        settings: { volume: 0.5, sfxVolume: 0.6, musicVolume: 0.4, fpsCap: 60 },
      }),
    );
    const data = new SaveStore(storage).load();
    expect(data.bestRunTimeMs).toBeNull(); // filled additively
    expect(data.highscores['lvl-01-mnemosynes-fall']).toEqual({ score: 800, timeMs: 71_500 });
    expect(data.totalScore).toBe(4321);
    expect(data.unlockedWeapons).toEqual(['puls', 'spridare']);
    expect(data.settings.fpsCap).toBe(60);
  });

  it('keeps the fastest complete-run time and rejects junk values', () => {
    const store = new SaveStore(new MemoryStorage());
    const data = defaultSaveData();
    expect(store.recordRunTime(data, 0)).toBe(false); // not a finished run
    expect(store.recordRunTime(data, -5)).toBe(false);
    expect(data.bestRunTimeMs).toBeNull();

    expect(store.recordRunTime(data, 600_000)).toBe(true);
    expect(store.recordRunTime(data, 590_000)).toBe(true); // faster → new best
    expect(store.recordRunTime(data, 610_000)).toBe(false); // slower → kept
    expect(data.bestRunTimeMs).toBe(590_000);
  });

  it('falls back to defaults on corrupt JSON instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not valid json!!');
    const data = new SaveStore(storage).load();
    expect(data).toEqual(defaultSaveData());
  });

  it('keeps the best score and the best time per level', () => {
    const store = new SaveStore(new MemoryStorage());
    let data = defaultSaveData();

    data = store.recordLevelResult(data, 'level-1', 500, 61_000);
    data = store.recordLevelResult(data, 'level-1', 300, 55_000); // worse score, better time
    const entry: HighscoreEntry | undefined = data.highscores['level-1'];
    expect(entry?.score).toBe(500);
    expect(entry?.timeMs).toBe(55_000);
  });

  it('accumulates total score without ever decreasing it', () => {
    const store = new SaveStore(new MemoryStorage());
    let data = defaultSaveData();
    data = store.recordLevelResult(data, 'level-1', 400, 30_000);
    data = store.recordLevelResult(data, 'level-2', 250, 40_000);
    expect(data.totalScore).toBe(650);
  });

  it('unlocks weapons idempotently', () => {
    const store = new SaveStore(new MemoryStorage());
    const data = defaultSaveData();
    expect(store.unlockWeapon(data, 'spridare')).toBe(true);
    expect(store.unlockWeapon(data, 'spridare')).toBe(false);
    expect(data.unlockedWeapons).toEqual(['puls', 'spridare']);
  });
});
