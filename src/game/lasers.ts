import type { AABB } from './entities';
import { TILE_SIZE, type LevelSpawn } from '../levels/LevelData';

/**
 * Level laser grids (task C2, PLAN.md §4 level 4 "Kolonin Tystnad"):
 * timed environmental hazards that pulse on a fixed rhythm — telegraph,
 * fire, rest — unlike the boss-driven beams in bosses.ts. Pure simulation:
 * GameSession steps them from the session clock and applies the damage.
 *
 * A grid's damage box is its full tile rect while firing; during the
 * telegraph window (last {@link LASER_TELEGRAPH_MS} of the off phase) a thin
 * warning line renders along the beam so the rhythm can be read.
 */

/** Telegraph warning time at the end of each off window, in ms. */
export const LASER_TELEGRAPH_MS = 620;

export interface LaserGrid {
  /** World-px rect of the beam (from the spawn's tile rect). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Full pulse length in ms (on + off). */
  readonly periodMs: number;
  /** Beam-on time per cycle in ms. */
  readonly onMs: number;
  /** Phase shift in ms so grids can interleave. */
  readonly offsetMs: number;
}

export type LaserPhase = 'idle' | 'telegraph' | 'firing';

/** Build the world-space grid from a level spawn (tile coords → px). */
export function laserGridFromSpawn(spawn: Extract<LevelSpawn, { kind: 'laser' }>): LaserGrid {
  const tx0 = Math.min(spawn.tx0, spawn.tx1);
  const tx1 = Math.max(spawn.tx0, spawn.tx1);
  const ty0 = Math.min(spawn.ty0, spawn.ty1);
  const ty1 = Math.max(spawn.ty0, spawn.ty1);
  return {
    x: tx0 * TILE_SIZE,
    y: ty0 * TILE_SIZE,
    width: (tx1 - tx0 + 1) * TILE_SIZE,
    height: (ty1 - ty0 + 1) * TILE_SIZE,
    periodMs: spawn.periodMs,
    onMs: spawn.onMs,
    offsetMs: spawn.offsetMs,
  };
}

/**
 * Phase of the pulse at `timeMs`. Each period is off → telegraph → firing:
 *   idle      — safe, beam dark
 *   telegraph — still safe, warning line blinks ({@link LASER_TELEGRAPH_MS})
 *   firing    — the {@link LaserGrid} rect damages
 */
export function laserPhaseAt(grid: LaserGrid, timeMs: number): LaserPhase {
  const period = Math.max(1, grid.periodMs);
  const on = Math.min(Math.max(0, grid.onMs), period);
  const t = (((timeMs - grid.offsetMs) % period) + period) % period;
  if (t >= period - on) return 'firing';
  if (t >= period - on - LASER_TELEGRAPH_MS) return 'telegraph';
  return 'idle';
}

/** Damage box while firing; null otherwise. */
export function laserDamageBox(grid: LaserGrid, timeMs: number): AABB | null {
  if (laserPhaseAt(grid, timeMs) !== 'firing') return null;
  return { x: grid.x, y: grid.y, width: grid.width, height: grid.height };
}

/** Thin blinking warning line shown along the beam while telegraphing. */
export function laserTelegraphRect(grid: LaserGrid, timeMs: number): AABB | null {
  if (laserPhaseAt(grid, timeMs) !== 'telegraph') return null;
  const horizontal = grid.height <= grid.width;
  return horizontal
    ? { x: grid.x, y: grid.y + grid.height / 2 - 2, width: grid.width, height: 4 }
    : { x: grid.x + grid.width / 2 - 2, y: grid.y, width: 4, height: grid.height };
}

/** ms until the beam next starts firing (readability for HUD/debug tools). */
export function msUntilLaserFires(grid: LaserGrid, timeMs: number): number {
  const period = Math.max(1, grid.periodMs);
  const on = Math.min(Math.max(0, grid.onMs), period);
  const t = (((timeMs - grid.offsetMs) % period) + period) % period;
  const untilFire = period - on - t;
  return untilFire < 0 ? 0 : untilFire;
}
