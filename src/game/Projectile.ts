import { aabbOverlap, type AABB, type Entity, type Vec2 } from './entities';
import { touchesHazard } from './collision';
import type { Level } from '../levels/Level';
import { TILE_SIZE } from '../levels/LevelData';

/**
 * Projectiles (PLAN.md §6 "Objektpooling"): pooled shots for both the player
 * and enemy shooters. They travel in a straight line, die on solid tiles,
 * world bounds or lifetime expiry, and are resolved against enemies/player by
 * GameSession (which owns those entity lists).
 */

export const PROJECTILE_WIDTH = 8;
export const PROJECTILE_HEIGHT = 8;

export type ProjectileOwner = 'player' | 'enemy';

export interface Projectile extends Entity {
  owner: ProjectileOwner;
  damage: number;
  /** Remaining lifetime in seconds. */
  lifeSeconds: number;
}

export function createProjectile(id: number): Projectile {
  return {
    id,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    size: { x: PROJECTILE_WIDTH, y: PROJECTILE_HEIGHT },
    active: false,
    owner: 'player',
    damage: 1,
    lifeSeconds: 0,
  };
}

/** Center point of a projectile (they are positioned by top-left corner). */
export function projectileCenter(p: Projectile): Vec2 {
  return { x: p.position.x + p.size.x / 2, y: p.position.y + p.size.y / 2 };
}

export interface ProjectileStepResult {
  /** Died this step (tile/bounds/lifetime). Collision with entities is separate. */
  expired: boolean;
  hitTile: boolean;
}

/**
 * Move one projectile for `dtSeconds` and resolve it against the tilemap.
 * Point-samples the tile ahead of travel — at fixed 120 Hz steps and arcade
 * speeds (< 10 px/step) tunneling is impossible for our tile size.
 */
export function updateProjectile(
  level: Level,
  projectile: Projectile,
  dtSeconds: number,
): ProjectileStepResult {
  if (!projectile.active) return { expired: true, hitTile: false };

  projectile.lifeSeconds -= dtSeconds;
  projectile.position.x += projectile.velocity.x * dtSeconds;
  projectile.position.y += projectile.velocity.y * dtSeconds;

  // World bounds (level edges are solid via tileAt policy anyway).
  if (
    projectile.position.x < -TILE_SIZE ||
    projectile.position.y < -TILE_SIZE ||
    projectile.position.x > level.pixelWidth ||
    projectile.position.y > level.pixelHeight
  ) {
    deactivate(projectile);
    return { expired: true, hitTile: false };
  }

  if (projectile.lifeSeconds <= 0) {
    deactivate(projectile);
    return { expired: true, hitTile: false };
  }

  const center = projectileCenter(projectile);
  if (level.isSolidAtWorld(center.x, center.y) || touchesHazard(level, projectileBox(projectile))) {
    deactivate(projectile);
    return { expired: true, hitTile: true };
  }

  return { expired: false, hitTile: false };
}

/** Spawn helper: positions the shot at `origin` moving along normalized dir. */
export function launchProjectile(
  projectile: Projectile,
  owner: ProjectileOwner,
  origin: Vec2,
  direction: Vec2,
  speedPxPerS: number,
  damage: number,
  lifetimeSeconds: number,
): void {
  projectile.active = true;
  projectile.owner = owner;
  projectile.damage = Math.max(1, Math.round(damage));
  projectile.lifeSeconds = Math.max(0.05, lifetimeSeconds);
  projectile.size.x = PROJECTILE_WIDTH;
  projectile.size.y = PROJECTILE_HEIGHT;
  projectile.position.x = origin.x - projectile.size.x / 2;
  projectile.position.y = origin.y - projectile.size.y / 2;
  projectile.velocity.x = direction.x * speedPxPerS;
  projectile.velocity.y = direction.y * speedPxPerS;
}

function deactivate(p: Projectile): void {
  p.active = false;
  p.velocity.x = 0;
  p.velocity.y = 0;
}

/** Convenience overlap test used by collision passes. */
export function projectileOverlaps(
  p: Projectile,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    p.active &&
    aabbOverlap(
      { x: p.position.x, y: p.position.y, width: p.size.x, height: p.size.y },
      box,
    )
  );
}

/** Projectile as an AABB for generic overlap helpers. */
export function projectileBox(p: Projectile): AABB {
  return { x: p.position.x, y: p.position.y, width: p.size.x, height: p.size.y };
}
