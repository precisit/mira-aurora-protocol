import type { LevelData } from './LevelData';
import { buildLevel01 } from './Level01MnemosynesFall';
import { buildLevel02 } from './Level02Datastormen';
import { buildLevel03 } from './Level03XenoTunneln';

/**
 * Campaign registry (task A2). Levels are pure data modules; wave A2 ships
 * levels 1–3 per the PLAN.md §4 level table. Later waves append 4–7.
 */

export const CAMPAIGN_LEVELS: readonly LevelData[] = [
  buildLevel01(),
  buildLevel02(),
  buildLevel03(),
];

export const LEVEL_COUNT = 7;

/** Look up a campaign level by its 1-based index. */
export function getLevel(index: number): LevelData {
  const level = CAMPAIGN_LEVELS.find((l) => l.index === index);
  if (!level) {
    throw new Error(`getLevel: no level with index ${index} (built: ${CAMPAIGN_LEVELS.length}/${LEVEL_COUNT})`);
  }
  return level;
}
