import { ENEMIES, type EnemyDescriptor, type EnemyTypeName } from './entities';
import type { Entity, Vec2 } from './entities';
import { TILE_SIZE, TileType } from '../levels/LevelData';
import { Level } from '../levels/Level';
import { aimDirection } from './weapons';

/**
 * Base enemy set (PLAN.md §4 "Fiender (basuppsättning)") built from the A2
 * spawn descriptors in entities.ts:
 *
 *   Drone      — flies straight, patrols horizontally, turns at walls/range.
 *   TunnelWorm — crawls along the floor (or a ceiling when spawned hanging).
 *   Glitcher   — hovers and blink-teleports short distances. 2 hp.
 *   Purger     — hovers and shoots aimed shots back at AURORA. 3 hp.
 *
 * All enemies damage the player on contact; hit resolution/death effects are
 * GameSession's job so this module stays pure simulation.
 */

// ------------------------------------------------------------- tuning --

const DRONE_SPEED_PX_PER_S = 95;
const DRONE_PATROL_RADIUS_PX = 128;

const WORM_SPEED_PX_PER_S = 145;

const GLITCHER_TELEPORT_MS = 1400;
const GLITCHER_TELEPORT_RADIUS_PX = 3 * TILE_SIZE;
const GLITCHER_BOB_SPEED = 3.2;
const GLITCHER_BOB_AMPLITUDE_PX = 6;

const PURGER_FIRE_INTERVAL_MS = 1600;
const PURGER_RANGE_PX = 480;
const PURGER_BOB_SPEED = 2.1;
const PURGER_BOB_AMPLITUDE_PX = 9;

/** Contact-damage cooldown is handled by the player's i-frames. */

// ------------------------------------------------------------- model --

/** Monotonic enemy id source — see {@link spawnEnemyAt}. */
let nextEnemyId = 1;

export interface Enemy extends Entity {
  readonly kind: EnemyTypeName;
  hp: number;
  readonly maxHp: number;
  /** +1 right / −1 left. */
  facing: 1 | -1;
  /** White flash remaining after taking a hit (ms). */
  hitFlashMs: number;
  /** Anchor point the AI patrols/bobs around (world px, top-left space). */
  homeX: number;
  homeY: number;
  /** Accumulated ms used for bobbing/teleport/fire cadence. */
  timerMs: number;
  /** TunnelWorm only: which surface it clings to. */
  crawlSurface: 'floor' | 'ceiling';
  /** Shooters only: false until the first shot leaves the cannon. */
  firedOnce: boolean;
}

export const ENEMY_SIZES: Readonly<Record<EnemyTypeName, { width: number; height: number }>> = {
  Drone: { width: 26, height: 20 },
  TunnelWorm: { width: 28, height: 18 },
  Glitcher: { width: 24, height: 24 },
  Purger: { width: 30, height: 26 },
};

export interface EnemyFireEvent {
  enemy: Enemy;
  /** Normalized shot direction toward the player. */
  direction: Vec2;
}

export interface EnemyStepContext {
  level: Level;
  playerCenter: Vec2;
  dtSeconds: number;
  rng: () => number;
}

/**
 * Advance one enemy. Returns a fire event when a Purger released a shot this
 * step (GameSession spawns the actual projectile).
 */
export function updateEnemy(enemy: Enemy, ctx: EnemyStepContext): EnemyFireEvent | null {
  if (!enemy.active) return null;
  if (enemy.hitFlashMs > 0) enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - ctx.dtSeconds * 1000);
  enemy.timerMs += ctx.dtSeconds * 1000;

  switch (enemy.kind) {
    case 'Drone':
      updateDrone(enemy, ctx);
      return null;
    case 'TunnelWorm':
      updateTunnelWorm(enemy, ctx);
      return null;
    case 'Glitcher':
      updateGlitcher(enemy, ctx);
      return null;
    case 'Purger':
      return updatePurger(enemy, ctx);
  }
}

/** Build a live enemy from a spawn descriptor's type name. */
export function spawnEnemyAt(
  kind: EnemyTypeName,
  tileCenterPoint: Vec2,
  descriptor: EnemyDescriptor = ENEMIES[kind],
): Enemy {
  const size = ENEMY_SIZES[kind] ?? { width: 24, height: 24 };
  const x = tileCenterPoint.x - size.width / 2;
  const y = tileCenterPoint.y - size.height / 2;

  return {
    // Unique per enemy (B3): weapon behaviors key their per-shot
    // already-hit lists on this id (pierce/splash de-dup).
    id: nextEnemyId++,
    kind,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    size: { x: size.width, y: size.height },
    active: true,
    hp: Math.max(1, descriptor.hitsToDestroy),
    maxHp: Math.max(1, descriptor.hitsToDestroy),
    facing: -1,
    hitFlashMs: 0,
    homeX: x,
    homeY: y,
    timerMs: 0,
    crawlSurface: 'floor',
    firedOnce: false,
  };
}

/** Detect ceiling-hugging spawns for TunnelWorms (solid right above). */
export function classifyCrawlSurface(enemy: Enemy, level: Level): void {
  const centerX = enemy.position.x + enemy.size.x / 2;
  const aboveTy = Level.worldToTileY(enemy.position.y - 2);
  const tx = Level.worldToTileX(centerX);
  enemy.crawlSurface = level.tileAt(tx, aboveTy) === TileType.Solid ? 'ceiling' : 'floor';
}

// ------------------------------------------------------------ behaviors --

function updateDrone(enemy: Enemy, ctx: EnemyStepContext): void {
  const speed = DRONE_SPEED_PX_PER_S * enemy.facing;
  enemy.velocity.x = speed;
  enemy.velocity.y = 0;

  const nextX = enemy.position.x + speed * ctx.dtSeconds;
  const leadEdge = enemy.facing > 0 ? nextX + enemy.size.x : nextX;
  const midY = enemy.position.y + enemy.size.y / 2;

  const wallAhead = ctx.level.isSolidAtTile(Level.worldToTileX(leadEdge), Level.worldToTileY(midY));
  const beyondPatrol =
    enemy.facing > 0
      ? nextX > enemy.homeX + DRONE_PATROL_RADIUS_PX
      : nextX < enemy.homeX - DRONE_PATROL_RADIUS_PX;

  if (wallAhead || beyondPatrol) {
    enemy.facing = enemy.facing > 0 ? -1 : 1;
  } else {
    enemy.position.x = nextX;
  }
}

function updateTunnelWorm(enemy: Enemy, ctx: EnemyStepContext): void {
  const speed = WORM_SPEED_PX_PER_S * enemy.facing;
  enemy.velocity.x = speed;
  enemy.velocity.y = 0;

  const nextX = enemy.position.x + speed * ctx.dtSeconds;
  const leadEdge = enemy.facing > 0 ? nextX + enemy.size.x : nextX;
  const midY = enemy.position.y + enemy.size.y / 2;

  // Wall directly ahead blocks the crawl.
  const leadTx = Level.worldToTileX(leadEdge);
  if (ctx.level.isSolidAtTile(leadTx, Level.worldToTileY(midY))) {
    enemy.facing = enemy.facing > 0 ? -1 : 1;
    return;
  }

  // Surface must continue beneath (floor crawl) or above (ceiling crawl).
  const supportTy =
    enemy.crawlSurface === 'floor'
      ? Level.worldToTileY(enemy.position.y + enemy.size.y + 2)
      : Level.worldToTileY(enemy.position.y - 2);
  const support = ctx.level.tileAt(leadTx, supportTy);

  const hasSupport = enemy.crawlSurface === 'floor'
    ? support === TileType.Solid || support === TileType.Platform
    : support === TileType.Solid;

  if (!hasSupport) {
    enemy.facing = enemy.facing > 0 ? -1 : 1;
    return;
  }

  enemy.position.x = nextX;
}

function updateGlitcher(enemy: Enemy, ctx: EnemyStepContext): void {
  // Hover bob around home while waiting for the next blink.
  const bob = Math.sin((enemy.timerMs / 1000) * GLITCHER_BOB_SPEED) * GLITCHER_BOB_AMPLITUDE_PX;
  enemy.position.y = enemy.homeY + bob;

  if (enemy.timerMs < GLITCHER_TELEPORT_MS) return;
  enemy.timerMs = 0;

  const candidates = 8;
  for (let attempt = 0; attempt < candidates; attempt++) {
    const angle = ctx.rng() * Math.PI * 2;
    const distance = GLITCHER_TELEPORT_RADIUS_PX * (0.35 + 0.65 * ctx.rng());
    const nx = enemy.homeX + Math.cos(angle) * distance;
    const ny = enemy.homeY + Math.sin(angle) * distance;
    if (isFreeSpot(ctx.level, nx, ny, enemy.size.x, enemy.size.y)) {
      enemy.position.x = nx;
      enemy.homeX = nx;
      enemy.position.y = ny;
      enemy.homeY = ny;
      return;
    }
  }
  // No free cell found — stay put until the next cycle.
}

function updatePurger(enemy: Enemy, ctx: EnemyStepContext): EnemyFireEvent | null {
  const bob = Math.sin((enemy.timerMs / 1000) * PURGER_BOB_SPEED) * PURGER_BOB_AMPLITUDE_PX;
  enemy.position.y = enemy.homeY + bob;

  const center = enemyCenter(enemy);
  const dx = ctx.playerCenter.x - center.x;
  const dy = ctx.playerCenter.y - center.y;
  if (Math.hypot(dx, dy) > PURGER_RANGE_PX) return null;

  // Fire cadence: first volley comes after half an interval so a newly
  // discovered Purger threatens quickly, then settles into full cadence.
  const dueMs = enemy.firedOnce ? PURGER_FIRE_INTERVAL_MS : PURGER_FIRE_INTERVAL_MS / 2;
  if (enemy.timerMs < dueMs) return null;
  enemy.timerMs = 0;
  enemy.firedOnce = true;

  enemy.facing = dx >= 0 ? 1 : -1;
  return { enemy, direction: aimDirection(center, ctx.playerCenter) };
}

// ------------------------------------------------------------- helpers --

export function enemyCenter(enemy: Enemy): Vec2 {
  return { x: enemy.position.x + enemy.size.x / 2, y: enemy.position.y + enemy.size.y / 2 };
}

function isFreeSpot(level: Level, x: number, y: number, width: number, height: number): boolean {
  const corners: Array<[number, number]> = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
    [x + width / 2, y + height / 2],
  ];
  for (const [cx, cy] of corners) {
    const tile = level.tileAt(Level.worldToTileX(cx), Level.worldToTileY(cy));
    if (tile === TileType.Solid || tile === TileType.Hazard) return false;
  }
  return true;
}

/** Apply projectile damage; returns true when this hit destroyed the enemy. */
export function damageEnemy(enemy: Enemy, amount: number): boolean {
  if (!enemy.active) return false;
  enemy.hp -= Math.max(1, Math.round(amount));
  enemy.hitFlashMs = 90;
  if (enemy.hp <= 0) {
    enemy.active = false;
    return true;
  }
  return false;
}
