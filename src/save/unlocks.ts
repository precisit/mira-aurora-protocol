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
 * Weapons whose thresholds were crossed between two total-score readings,
 * in threshold order. Used by the live unlock watcher (B3): feed it the
 * previous best-known total and the current one; empty result = nothing new.
 * A decreasing score (attempt resets) simply yields [] — unlocks never go
 * backwards.
 */
export function newlyUnlockedWeapons(beforeTotal: number, afterTotal: number): string[] {
  return WEAPON_UNLOCK_THRESHOLDS.filter(
    (w) => beforeTotal < w.requiredTotalScore && afterTotal >= w.requiredTotalScore,
  ).map((w) => w.weaponId);
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

// --------------------------------------------------------- ghost level --
// Bonusbanan ("Spökfrekvensen", task C2) låses upp av ackumulerad poäng —
// PLAN.md §4: "en spökbana låses upp om totalpoängen passerar 150 000".

/** Total score required before the ghost level appears. */
export const GHOST_LEVEL_UNLOCK_SCORE = 150_000;

/** True once the lifetime total score has earned the hidden ghost level. */
export function isGhostLevelUnlocked(totalScore: number): boolean {
  return totalScore >= GHOST_LEVEL_UNLOCK_SCORE;
}

/**
 * True when the ghost level was freshly earned between two total-score
 * readings (same monotonic contract as {@link newlyUnlockedWeapons}).
 */
export function newlyUnlockedGhostLevel(beforeTotal: number, afterTotal: number): boolean {
  return !isGhostLevelUnlocked(beforeTotal) && isGhostLevelUnlocked(afterTotal);
}
