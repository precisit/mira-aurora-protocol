/**
 * Weapon unlock thresholds (task B5; PLAN.md §4 "Vapen" table):
 *
 *   | Vapen     | Lås (totalpoäng) |
 *   |-----------|------------------|
 *   | Puls      | Start            |
 *   | Spridare  | 10 000           |
 *   | Piercer   | 25 000           |
 *   | Studsare  | 50 000           |
 *   | Fragment  | 100 000          |
 *   | Nova      | 200 000          |
 *
 * Pure data + lookups so the actual unlock flow (wave B3/C2) can hook in
 * without re-deriving the curve. Total score is the accumulating lifetime
 * value from SaveData.totalScore — it never decreases (PLAN.md §4), so
 * unlocks are permanent.
 */

import type { SaveData } from './SaveStore';

export interface WeaponUnlockThreshold {
  weaponId: string;
  /** Accumulated total score required; 0 = available from the start. */
  requiredTotalScore: number;
}

/** Ordered from lowest to highest requirement (PLAN.md §4). */
export const WEAPON_UNLOCK_THRESHOLDS: readonly WeaponUnlockThreshold[] = [
  { weaponId: 'puls', requiredTotalScore: 0 },
  { weaponId: 'spridare', requiredTotalScore: 10_000 },
  { weaponId: 'piercer', requiredTotalScore: 25_000 },
  { weaponId: 'studsare', requiredTotalScore: 50_000 },
  { weaponId: 'fragment', requiredTotalScore: 100_000 },
  { weaponId: 'nova', requiredTotalScore: 200_000 },
];

/** All weapons unlocked at `totalScore`, in threshold order. */
export function unlockedWeaponsFor(totalScore: number): string[] {
  return WEAPON_UNLOCK_THRESHOLDS.filter((w) => totalScore >= w.requiredTotalScore).map(
    (w) => w.weaponId,
  );
}

/** The next weapon still locked at `totalScore`, or null when everything is open. */
export function nextWeaponUnlock(totalScore: number): WeaponUnlockThreshold | null {
  return WEAPON_UNLOCK_THRESHOLDS.find((w) => totalScore < w.requiredTotalScore) ?? null;
}

/**
 * Grants every weapon `data.totalScore` has earned but that is missing from
 * `unlockedWeapons` (additive, idempotent, never revokes). Returns true when
 * anything changed — callers can persist and toast "new weapon!" then.
 */
export function syncWeaponUnlocks(data: SaveData): boolean {
  let changed = false;
  for (const weaponId of unlockedWeaponsFor(data.totalScore)) {
    if (!data.unlockedWeapons.includes(weaponId)) {
      data.unlockedWeapons.push(weaponId);
      changed = true;
    }
  }
  return changed;
}
