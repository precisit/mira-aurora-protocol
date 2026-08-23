import type { AbilityUnlockName, FragmentTypeName, PowerupTypeName } from './entities';
import type { Entity } from './entities';
import type { LevelSpawn } from '../levels/LevelData';
import { Level } from '../levels/Level';

/**
 * Pickups: memory fragments, temporary powerups and permanent ability
 * unlocks (PLAN.md §4). Pure data + gentle bob animation; effect application
 * lives in GameSession where score/lives/audio are available.
 */

export const PICKUP_SIZE_PX = 18;

/** How far above the tile floor pickups hover (visual). */
const BOB_AMPLITUDE_PX = 3;

export type PickupKind = 'fragment' | 'powerup' | 'unlock';

export interface Pickup extends Entity {
  readonly kind: PickupKind;
  readonly fragment: FragmentTypeName | null;
  readonly powerup: PowerupTypeName | null;
  readonly unlock: AbilityUnlockName | null;
  /** Resting Y the bob oscillates around (world px). */
  readonly baseY: number;
  /** Bob phase offset so clusters don't pulse in lockstep. */
  bobPhase: number;
}

export function createPickupsFromSpawns(spawns: readonly LevelSpawn[]): Pickup[] {
  const pickups: Pickup[] = [];
  for (const spawn of spawns) {
    const built = buildPickup(spawn);
    if (built) pickups.push(built);
  }
  return pickups;
}

function buildPickup(spawn: LevelSpawn): Pickup | null {
  let kind: PickupKind;
  let fragment: FragmentTypeName | null = null;
  let powerup: PowerupTypeName | null = null;
  let unlock: AbilityUnlockName | null = null;

  switch (spawn.kind) {
    case 'fragment':
      kind = 'fragment';
      fragment = spawn.fragment;
      break;
    case 'powerup':
      kind = 'powerup';
      powerup = spawn.powerup;
      break;
    case 'unlock':
      kind = 'unlock';
      unlock = spawn.unlock;
      break;
    default:
      return null; // structural spawns (spawn/checkpoint/exit) aren't pickups
  }

  const center = Level.tileCenter(spawn.tx, spawn.ty);
  const baseY = center.y - PICKUP_SIZE_PX / 2;
  return {
    id: 0,
    kind,
    fragment,
    powerup,
    unlock,
    position: {
      x: center.x - PICKUP_SIZE_PX / 2,
      y: baseY,
    },
    velocity: { x: 0, y: 0 },
    size: { x: PICKUP_SIZE_PX, y: PICKUP_SIZE_PX },
    active: true,
    baseY,
    bobPhase: ((spawn.tx * 7 + spawn.ty * 13) % 10) / 10,
  };
}

/** Advance the idle bob around the pickup's resting height. */
export function animatePickup(pickup: Pickup, timeMs: number): void {
  if (!pickup.active) return;
  const phase = timeMs / 1000 + pickup.bobPhase * Math.PI * 2;
  pickup.position.y = pickup.baseY + Math.sin(phase) * BOB_AMPLITUDE_PX;
}
