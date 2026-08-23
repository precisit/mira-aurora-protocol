/**
 * Save layer skeleton (PLAN.md §5 src/save + §6 "Data & sparande").
 *
 * localStorage-backed store for highscores (score AND time per level), the
 * accumulating total score, weapon unlocks and settings. Storage is injected
 * so unit tests can use an in-memory fake; a corrupt/missing blob always
 * degrades to defaults instead of crashing boot.
 */

export interface HighscoreEntry {
  score: number;
  timeMs: number;
}

export interface GameSettings {
  /** Master volume, 0..1. */
  volume: number;
  /** SFX bus volume, 0..1. */
  sfxVolume: number;
  /** Music volume, 0..1. */
  musicVolume: number;
  /** FPS cap for battery saving on mobile; null = uncapped. */
  fpsCap: number | null;
}

export interface SaveData {
  version: 1;
  /** Best result per level id. */
  highscores: Record<string, HighscoreEntry>;
  /** Accumulated across all runs; unlocks weapons, never decreases. */
  totalScore: number;
  /**
   * Fastest complete campaign run (level 1→7), in ms — speedrun best per
   * PLAN.md §4 "Vinst & replay". null until a first full run is finished.
   * Additive field (B5): older save blobs without it load as null.
   */
  bestRunTimeMs: number | null;
  unlockedWeapons: string[];
  settings: GameSettings;
}

/** Minimal storage surface (subset of DOM Storage) for injection. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SAVE_KEY = 'aurora-protocol.save.v1';

export function defaultSaveData(): SaveData {
  return {
    version: 1,
    highscores: {},
    totalScore: 0,
    bestRunTimeMs: null,
    unlockedWeapons: ['puls'], // starting weapon
    settings: { volume: 0.8, sfxVolume: 0.9, musicVolume: 0.7, fpsCap: null },
  };
}

/** Fallback when localStorage is unavailable (private mode, tests, SSR). */
export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function safeLocalStorage(): StorageLike {
  try {
    if (typeof localStorage === 'object' && localStorage !== null) return localStorage;
  } catch {
    // Accessing localStorage can itself throw (sandboxed iframe).
  }
  return new MemoryStorage();
}

export class SaveStore {
  private readonly storage: StorageLike;

  public constructor(storage: StorageLike = safeLocalStorage()) {
    this.storage = storage;
  }

  /** Load save data, merging over defaults and repairing corruption. */
  public load(): SaveData {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return defaultSaveData();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return this.mergeDefaults(parsed);
    } catch {
      return defaultSaveData();
    }
  }

  public save(data: SaveData): boolean {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false; // Quota exceeded / blocked storage — gameplay continues.
    }
  }

  /** Keep the better of old/new per level: max score, min time (>0 only). */
  public recordLevelResult(
    data: SaveData,
    levelId: string,
    score: number,
    timeMs: number,
  ): SaveData {
    const previous = data.highscores[levelId];
    const bestScore = Math.max(previous?.score ?? 0, score);
    const bestTime =
      timeMs > 0 && previous?.timeMs ? Math.min(previous.timeMs, timeMs) : previous?.timeMs ?? timeMs;
    data.highscores[levelId] = { score: bestScore, timeMs: bestTime };
    // Total score accumulates across runs and never decreases (PLAN §4).
    data.totalScore += Math.max(0, score);
    return data;
  }

  /**
   * Records the total time of a completed campaign run; keeps the fastest.
   * Returns true when it is a new best-run record (false for non-finishes,
   * i.e. `runTimeMs <= 0`, or slower times).
   */
  public recordRunTime(data: SaveData, runTimeMs: number): boolean {
    if (!(runTimeMs > 0)) return false;
    if (data.bestRunTimeMs !== null && runTimeMs >= data.bestRunTimeMs) return false;
    data.bestRunTimeMs = runTimeMs;
    return true;
  }

  /** Weapon unlock by accumulated total score; idempotent. */
  public unlockWeapon(data: SaveData, weaponId: string): boolean {
    if (data.unlockedWeapons.includes(weaponId)) return false;
    data.unlockedWeapons.push(weaponId);
    return true;
  }

  private mergeDefaults(parsed: Partial<SaveData>): SaveData {
    const fallback = defaultSaveData();
    return {
      version: 1,
      highscores:
        parsed.highscores && typeof parsed.highscores === 'object'
          ? (parsed.highscores as Record<string, HighscoreEntry>)
          : fallback.highscores,
      totalScore: typeof parsed.totalScore === 'number' ? parsed.totalScore : 0,
      // Additive (B5): old blobs lack bestRunTimeMs — treat junk as "no run yet".
      bestRunTimeMs:
        typeof parsed.bestRunTimeMs === 'number' && parsed.bestRunTimeMs > 0
          ? parsed.bestRunTimeMs
          : null,
      unlockedWeapons: Array.isArray(parsed.unlockedWeapons)
        ? parsed.unlockedWeapons
        : fallback.unlockedWeapons,
      settings: {
        volume:
          typeof parsed.settings?.volume === 'number'
            ? Math.min(1, Math.max(0, parsed.settings.volume))
            : fallback.settings.volume,
        sfxVolume:
          typeof parsed.settings?.sfxVolume === 'number'
            ? Math.min(1, Math.max(0, parsed.settings.sfxVolume))
            : fallback.settings.sfxVolume,
        musicVolume:
          typeof parsed.settings?.musicVolume === 'number'
            ? Math.min(1, Math.max(0, parsed.settings.musicVolume))
            : fallback.settings.musicVolume,
        fpsCap:
          typeof parsed.settings?.fpsCap === 'number' || parsed.settings?.fpsCap === null
            ? (parsed.settings.fpsCap as number | null)
            : fallback.settings.fpsCap,
      },
    };
  }
}
