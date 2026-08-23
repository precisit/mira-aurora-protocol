import type { Rgba } from '../renderer/types';
import type { EnemyTypeName } from './entities';

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
