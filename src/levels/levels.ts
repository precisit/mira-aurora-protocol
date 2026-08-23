import type { LevelData } from './LevelData';
import { buildLevel01 } from './Level01MnemosynesFall';
import { buildLevel02 } from './Level02Datastormen';
import { buildLevel03 } from './Level03XenoTunneln';
import { buildLevel05 } from './Level05VesselsValv';
import { buildLevel07 } from './Level07OutpostAurora';

/**
 * Campaign registry (task A2). Levels are pure data modules; wave A2 ships
 * levels 1–3 per the PLAN.md §4 level table. Later waves append 4–7.
 *
 * Task B2 note — boss rooms: CAMPAIGN_LEVELS still holds the authored
 * campaign only. The two boss arenas below are minimal playable stand-ins
 * for slots 5 (VESSEL) and 7 (NULL) so the fights are browser-testable now.
 * When wave Fas 3 authors the real levels, each simply embeds a
 * `{ kind: 'boss', boss: 'VESSEL' | 'NULL', tx0…ty1 }` spawn (see
 * LevelBuilder.bossArena) anywhere along its route and deletes the matching
 * stand-in here — no gameplay code changes are needed: GameSession arms the
 * encounter when AURORA enters the rect, locks the camera, shows the HP bar
 * and seals the exit until the boss falls.
 */

export const CAMPAIGN_LEVELS: readonly LevelData[] = [
  buildLevel01(),
  buildLevel02(),
  buildLevel03(),
];

/** Minimal boss-fight stand-ins for PLAN.md slots 5 and 7 (see note above). */
export const ARENA_TEST_LEVELS: readonly LevelData[] = [buildLevel05(), buildLevel07()];

/**
 * Every playable level, indexed by campaign slot: authored campaign first,
 * then the boss-arena stand-ins for the unbuilt slots.
 */
export const PLAYABLE_LEVELS: readonly LevelData[] = [...CAMPAIGN_LEVELS, ...ARENA_TEST_LEVELS];

export const LEVEL_COUNT = 7;

/** Look up a campaign level by its 1-based index. */
export function getLevel(index: number): LevelData {
  const level = CAMPAIGN_LEVELS.find((l) => l.index === index);
  if (!level) {
    throw new Error(`getLevel: no level with index ${index} (built: ${CAMPAIGN_LEVELS.length}/${LEVEL_COUNT})`);
  }
  return level;
}

/** Look up any playable level (campaign or boss arena) by campaign slot. */
export function getPlayableLevel(index: number): LevelData | undefined {
  return PLAYABLE_LEVELS.find((l) => l.index === index);
}
