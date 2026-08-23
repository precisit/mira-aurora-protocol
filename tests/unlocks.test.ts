import { describe, expect, it } from 'vitest';
import {
  nextWeaponUnlock,
  syncWeaponUnlocks,
  unlockedWeaponsFor,
  WEAPON_UNLOCK_THRESHOLDS,
} from '../src/save/unlocks';
import { defaultSaveData } from '../src/save/SaveStore';

describe('WEAPON_UNLOCK_THRESHOLDS (PLAN.md §4 vapentabell)', () => {
  it('matches the planned weapons and score curve', () => {
    expect(WEAPON_UNLOCK_THRESHOLDS).toEqual([
      { weaponId: 'puls', requiredTotalScore: 0 },
      { weaponId: 'spridare', requiredTotalScore: 10_000 },
      { weaponId: 'piercer', requiredTotalScore: 25_000 },
      { weaponId: 'studsare', requiredTotalScore: 50_000 },
      { weaponId: 'fragment', requiredTotalScore: 100_000 },
      { weaponId: 'nova', requiredTotalScore: 200_000 },
    ]);
  });

  it('is ordered by ascending requirement', () => {
    for (let i = 1; i < WEAPON_UNLOCK_THRESHOLDS.length; i++) {
      expect(WEAPON_UNLOCK_THRESHOLDS[i]!.requiredTotalScore).toBeGreaterThan(
        WEAPON_UNLOCK_THRESHOLDS[i - 1]!.requiredTotalScore,
      );
    }
  });
});

describe('unlockedWeaponsFor', () => {
  it('gives only Puls at start', () => {
    expect(unlockedWeaponsFor(0)).toEqual(['puls']);
    expect(unlockedWeaponsFor(9_999)).toEqual(['puls']);
  });

  it('unlocks exactly at the threshold boundary (inclusive)', () => {
    expect(unlockedWeaponsFor(10_000)).toEqual(['puls', 'spridare']);
    expect(unlockedWeaponsFor(25_000)).toEqual(['puls', 'spridare', 'piercer']);
    expect(unlockedWeaponsFor(50_000)).toContain('studsare');
    expect(unlockedWeaponsFor(100_000)).toContain('fragment');
  });

  it('opens everything at and beyond Nova', () => {
    const all = unlockedWeaponsFor(200_000);
    expect(all).toHaveLength(6);
    expect(unlockedWeaponsFor(Number.MAX_SAFE_INTEGER)).toEqual(all);
  });
});

describe('nextWeaponUnlock', () => {
  it('points at Spridare from zero', () => {
    expect(nextWeaponUnlock(0)).toEqual({ weaponId: 'spridare', requiredTotalScore: 10_000 });
  });

  it('walks up the ladder', () => {
    expect(nextWeaponUnlock(26_000)?.weaponId).toBe('studsare');
    expect(nextWeaponUnlock(199_999)?.weaponId).toBe('nova');
  });

  it('returns null once everything is unlocked', () => {
    expect(nextWeaponUnlock(200_000)).toBeNull();
    expect(nextWeaponUnlock(999_999)).toBeNull();
  });
});

describe('syncWeaponUnlocks', () => {
  it('grants newly earned weapons additively and reports changes', () => {
    const data = defaultSaveData();
    data.totalScore = 12_500; // puls + spridare earned
    expect(syncWeaponUnlocks(data)).toBe(true);
    expect(data.unlockedWeapons).toEqual(['puls', 'spridare']);
  });

  it('is idempotent when nothing new is earned', () => {
    const data = defaultSaveData();
    data.totalScore = 12_500;
    syncWeaponUnlocks(data);
    expect(syncWeaponUnlocks(data)).toBe(false);
  });

  it('never revokes manually granted weapons outside the table', () => {
    const data = defaultSaveData();
    data.unlockedWeapons.push('dev-only');
    data.totalScore = 0;
    syncWeaponUnlocks(data);
    expect(data.unlockedWeapons).toContain('dev-only');
    expect(data.unlockedWeapons[0]).toBe('puls'); // threshold order preserved
  });
});
