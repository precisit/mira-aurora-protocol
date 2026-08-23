import { aabbOverlap, type AABB, type Entity, type Vec2 } from './entities';
import { touchesHazard } from './collision';
import type { Level } from '../levels/Level';
import { TILE_SIZE } from '../levels/LevelData';
import type { WeaponColor, WeaponDef } from './weapons';

/**
 * Projectiles (PLAN.md §6 "Objektpooling"): pooled shots for both the player
 * and enemy shooters. They travel in a straight line, die on solid tiles,
 * world bounds or lifetime expiry, and are resolved against enemies/player by
 * GameSession (which owns those entity lists).
 *
 * B3 weapon behaviors ride along as plain fields:
 *   - pierce  (`pierceLeft`)   — survives N extra enemy hits (dedup via hitEnemies)
 *   - bounce  (`bounceLeft`)   — reflects off solid tiles instead of dying
 *   - split   (`splitChildrenLeft`) — GameSession spawns shards when it dies
 *   - explode (`explosionRadiusPx`) — GameSession AoEs when it dies
 * Movement/bounce is handled here; split/explosion/pierce resolution lives in
 * GameSession since it owns enemies + the projectile pool.
 */

export const PROJECTILE_WIDTH = 8;
export const PROJECTILE_HEIGHT = 8;

/** Neutral tint for non-weapon shots (enemy fire). */
export const ENEMY_SHOT_COLOR: WeaponColor = [1, 0.4, 0.4, 1];

export type ProjectileOwner = 'player' | 'enemy';

export interface Projectile extends Entity {
  owner: ProjectileOwner;
  damage: number;
  /** Remaining lifetime in seconds. */
  lifeSeconds: number;
  /**
   * NULL's "absence" shots (task B2): erase other sprites they touch and
   * render as void shards instead of glowing bolts.
   */
  eraser: boolean;
  /** Weapon that fired this shot; null for enemy shots and split children. */
  weaponId: string | null;
  color: WeaponColor;
  /** Extra enemies this shot may pass through after the first hit. */
  pierceLeft: number;
  /** Solid-tile reflections remaining before the shot dies on contact. */
  bounceLeft: number;
  /** Shards GameSession spawns when this shot dies (0 = none). */
  splitChildrenLeft: number;
  splitFanAngleDeg: number;
  splitChildDamage: number;
  splitChildSpeedPxPerS: number;
  splitChildLifetimeSeconds: number;
  /** > 0: GameSession detonates an area blast wherever this shot dies. */
  explosionRadiusPx: number;
  /** Enemy entity ids already damaged by this shot (pierce de-dup). */
  hitEnemies: number[];
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
    eraser: false,
    weaponId: null,
    color: ENEMY_SHOT_COLOR,
    pierceLeft: 0,
    bounceLeft: 0,
    splitChildrenLeft: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 0,
    hitEnemies: [],
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
  /** Reflected off a solid tile this step (Studsare). */
  bounced: boolean;
}

const NO_STEP: ProjectileStepResult = { expired: true, hitTile: false, bounced: false };

function expiredOnTile(): ProjectileStepResult {
  return { expired: true, hitTile: true, bounced: false };
}

/**
 * Move one projectile for `dtSeconds` and resolve it against the tilemap.
 * Axis-separated movement so bouncing shots reflect off the correct wall
 * face. Point-samples tiles — at fixed 120 Hz steps and arcade speeds
 * (< 10 px/step) tunneling is impossible for our 32 px tiles.
 */
export function updateProjectile(
  level: Level,
  projectile: Projectile,
  dtSeconds: number,
): ProjectileStepResult {
  if (!projectile.active) return NO_STEP;

  projectile.lifeSeconds -= dtSeconds;

  let bounced = false;

  // ---- horizontal axis ----
  const stepX = projectile.velocity.x * dtSeconds;
  projectile.position.x += stepX;
  if (level.isSolidAtWorld(...centerXY(projectile))) {
    if (projectile.bounceLeft > 0 && stepX !== 0) {
      projectile.position.x -= stepX;
      projectile.velocity.x = -projectile.velocity.x;
      projectile.bounceLeft -= 1;
      bounced = true;
    } else {
      deactivate(projectile);
      return expiredOnTile();
    }
  }

  // ---- vertical axis ----
  const stepY = projectile.velocity.y * dtSeconds;
  projectile.position.y += stepY;
  if (level.isSolidAtWorld(...centerXY(projectile))) {
    if (projectile.bounceLeft > 0 && stepY !== 0) {
      projectile.position.y -= stepY;
      projectile.velocity.y = -projectile.velocity.y;
      projectile.bounceLeft -= 1;
      bounced = true;
    } else {
      deactivate(projectile);
      return expiredOnTile();
    }
  }

  // World bounds (level edges are solid via tileAt policy anyway).
  if (
    projectile.position.x < -TILE_SIZE ||
    projectile.position.y < -TILE_SIZE ||
    projectile.position.x > level.pixelWidth ||
    projectile.position.y > level.pixelHeight
  ) {
    deactivate(projectile);
    return NO_STEP;
  }

  // Hazards eat every shot, even bouncing ones.
  if (touchesHazard(level, projectileBox(projectile))) {
    deactivate(projectile);
    return expiredOnTile();
  }

  if (projectile.lifeSeconds <= 0) {
    deactivate(projectile);
    return { expired: true, hitTile: false, bounced };
  }

  return { expired: false, hitTile: false, bounced };
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
  const length = Math.hypot(direction.x, direction.y);
  const nx = Number.isFinite(length) && length > 0.0001 ? direction.x / length : 1;
  const ny = Number.isFinite(length) && length > 0.0001 ? direction.y / length : 0;

  projectile.active = true;
  projectile.owner = owner;
  projectile.damage = Math.max(1, Math.round(damage));
  projectile.lifeSeconds = Math.max(0.05, lifetimeSeconds);
  projectile.eraser = false;
  resetBehaviorFields(projectile);
  projectile.size.x = PROJECTILE_WIDTH;
  projectile.size.y = PROJECTILE_HEIGHT;
  projectile.position.x = origin.x - projectile.size.x / 2;
  projectile.position.y = origin.y - projectile.size.y / 2;
  projectile.velocity.x = nx * speedPxPerS;
  projectile.velocity.y = ny * speedPxPerS;
}

/**
 * Launch a player shot carrying all of `weapon`'s behavior data (volleys call
 * this once per spread direction; charge weapons only ever fire fully charged).
 */
export function launchWeaponProjectile(
  projectile: Projectile,
  weapon: WeaponDef,
  origin: Vec2,
  direction: Vec2,
): void {
  const length = Math.hypot(direction.x, direction.y);
  const nx = Number.isFinite(length) && length > 0.0001 ? direction.x / length : 1;
  const ny = Number.isFinite(length) && length > 0.0001 ? direction.y / length : 0;

  projectile.active = true;
  projectile.owner = 'player';
  projectile.damage = Math.max(1, Math.round(weapon.damage));
  projectile.lifeSeconds = Math.max(0.05, weapon.lifetimeSeconds);
  projectile.eraser = false;
  projectile.weaponId = weapon.id;
  projectile.color = weapon.color;
  projectile.pierceLeft = weapon.pierceHits;
  projectile.bounceLeft = weapon.maxBounces;
  projectile.splitChildrenLeft = weapon.splitChildren;
  projectile.splitFanAngleDeg = weapon.splitFanAngleDeg;
  projectile.splitChildDamage = weapon.splitChildDamage;
  projectile.splitChildSpeedPxPerS = weapon.splitChildSpeedPxPerS;
  projectile.splitChildLifetimeSeconds = weapon.splitChildLifetimeSeconds;
  projectile.explosionRadiusPx = weapon.explosionRadiusPx;
  projectile.hitEnemies.length = 0;
  projectile.size.x = weapon.sizePx;
  projectile.size.y = weapon.sizePx;
  projectile.position.x = origin.x - projectile.size.x / 2;
  projectile.position.y = origin.y - projectile.size.y / 2;
  projectile.velocity.x = nx * weapon.projectileSpeedPxPerS;
  projectile.velocity.y = ny * weapon.projectileSpeedPxPerS;
}

/** Immutable description of one split child, snapshotted from its parent. */
export interface SplitChildSpec {
  readonly owner: ProjectileOwner;
  readonly color: WeaponColor;
  readonly damage: number;
  readonly lifetimeSeconds: number;
  readonly speedPxPerS: number;
}

/**
 * Spawn a split child (Fragment shard) from a snapshotted spec. Taking a
 * spec instead of a live parent matters: the pool may hand back the parent's
 * own slot for the first child, which would otherwise clobber the source
 * data mid-burst.
 */
export function launchSplitChild(
  projectile: Projectile,
  spec: SplitChildSpec,
  origin: Vec2,
  direction: Vec2,
): void {
  projectile.active = true;
  projectile.owner = spec.owner;
  projectile.damage = Math.max(1, Math.round(spec.damage));
  projectile.lifeSeconds = Math.max(0.05, spec.lifetimeSeconds);
  projectile.eraser = false;
  projectile.weaponId = null;
  projectile.color = spec.color;
  projectile.pierceLeft = 0;
  projectile.bounceLeft = 0;
  projectile.splitChildrenLeft = 0;
  projectile.splitFanAngleDeg = 0;
  projectile.splitChildDamage = 0;
  projectile.splitChildSpeedPxPerS = 0;
  projectile.splitChildLifetimeSeconds = 0;
  projectile.explosionRadiusPx = 0;
  projectile.hitEnemies.length = 0;
  projectile.size.x = SPLIT_CHILD_SIZE_PX;
  projectile.size.y = SPLIT_CHILD_SIZE_PX;
  projectile.position.x = origin.x - projectile.size.x / 2;
  projectile.position.y = origin.y - projectile.size.y / 2;
  const length = Math.hypot(direction.x, direction.y) || 1;
  projectile.velocity.x = (direction.x / length) * spec.speedPxPerS;
  projectile.velocity.y = (direction.y / length) * spec.speedPxPerS;
}

/** Shard sprite edge length (smaller than any weapon's own shot). */
export const SPLIT_CHILD_SIZE_PX = 5;

function resetBehaviorFields(p: Projectile): void {
  p.eraser = false;
  p.weaponId = null;
  p.color = ENEMY_SHOT_COLOR;
  p.pierceLeft = 0;
  p.bounceLeft = 0;
  p.splitChildrenLeft = 0;
  p.splitFanAngleDeg = 0;
  p.splitChildDamage = 0;
  p.splitChildSpeedPxPerS = 0;
  p.splitChildLifetimeSeconds = 0;
  p.explosionRadiusPx = 0;
  p.hitEnemies.length = 0;
}

function centerXY(p: Projectile): [number, number] {
  return [p.position.x + p.size.x / 2, p.position.y + p.size.y / 2];
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
