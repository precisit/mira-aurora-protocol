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
