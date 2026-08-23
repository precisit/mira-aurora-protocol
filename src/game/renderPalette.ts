import type { Rgba } from '../renderer/types';
import type { EnemyTypeName } from './entities';
import type { BossId } from './bosses';

/**
 * Shared neon palette for enemy visuals (task B0): GameSession tints death
 * particle bursts with it and main.ts draws enemy bodies in the same hues,
 * so kills read as "the enemy shattered into its own color".
 */
export const ENEMY_COLORS_FALLBACK: Readonly<Record<EnemyTypeName, Rgba>> = {
  Drone: [1, 0.35, 0.85, 1],
  TunnelWorm: [0.65, 1, 0.35, 1],
  Glitcher: [0.85, 0.4, 1, 1],
  Purger: [1, 0.55, 0.25, 1],
};

/** Boss body hues (task B2): VESSEL a pale archive-cyan, NULL an absence-violet. */
export const BOSS_COLORS_FALLBACK: Readonly<Record<BossId, Rgba>> = {
  VESSEL: [0.62, 0.95, 1, 1],
  NULL: [0.6, 0.25, 0.95, 1],
};
