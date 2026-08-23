import type { LevelData } from './LevelData';
import { buildLevel01 } from './Level01MnemosynesFall';
import { buildLevel02 } from './Level02Datastormen';
import { buildLevel03 } from './Level03XenoTunneln';
import { buildLevel04 } from './Level04KoloninTystnad';
import { buildLevel05 } from './Level05VesselsValv';
import { buildLevel06 } from './Level06Glitchskeppet';
import { buildLevel07 } from './Level07OutpostAurora';
import { buildGhostLevel } from './Level08Spokfrekvensen';
import { isGhostLevelUnlocked } from '../save/unlocks';

/**
 * Campaign registry (task C2 — the complete campaign per PLAN.md §4):
 *
 *   1 Mnemosynes fall · 2 Datastormen · 3 XENO-tunneln · 4 Kolonin Tystnad
 *   5 VESSEL:s valv (boss: VESSEL) · 6 Glitchskeppet · 7 Utpost Aurora (boss: NULL)
 *
 * Levels are pure data modules. Slots 5 and 7 embed their `{ kind: 'boss' }`
 * arena spawns directly (see LevelBuilder.bossArena): GameSession arms the
 * encounter when AURORA enters the rect, locks the camera, shows the HP bar
 * and seals the exit until the boss falls.
 *
 * The ghost level ("Spökfrekvensen", slot 8) lives outside the campaign flow
 * so the win screen still lands after level 7; it joins the playable list
 * only once total score passes GHOST_LEVEL_UNLOCK_SCORE (see
 * {@link playableLevelsForTotalScore}).
 */

export const CAMPAIGN_LEVELS: readonly LevelData[] = [
  buildLevel01(),
  buildLevel02(),
  buildLevel03(),
  buildLevel04(),
  buildLevel05(),
  buildLevel06(),
  buildLevel07(),
];

/** Hidden bonus level (slot 8) — gated behind the 150k lifetime total. */
export const GHOST_LEVEL: LevelData = buildGhostLevel();

/** Every campaign level plus the ghost level when `totalScore` earned it. */
export function playableLevelsForTotalScore(totalScore: number): readonly LevelData[] {
  return isGhostLevelUnlocked(totalScore) ? [...CAMPAIGN_LEVELS, GHOST_LEVEL] : CAMPAIGN_LEVELS;
}

/** The linear campaign flow (1→7); main.ts progression walks exactly this. */
export const PLAYABLE_LEVELS: readonly LevelData[] = CAMPAIGN_LEVELS;

export const LEVEL_COUNT = 7;

/** Look up a campaign level by its 1-based index. */
export function getLevel(index: number): LevelData {
  const level = CAMPAIGN_LEVELS.find((l) => l.index === index);
  if (!level) {
    throw new Error(`getLevel: no level with index ${index} (built: ${CAMPAIGN_LEVELS.length}/${LEVEL_COUNT})`);
  }
  return level;
}
