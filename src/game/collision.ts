import type { AABB } from './entities';
import { TILE_SIZE } from '../levels/LevelData';
import { TileType } from '../levels/LevelData';
import { Level } from '../levels/Level';

/**
 * Tilemap collision (PLAN.md §6: "AABB-kollision, tilemap-baserade nivåer").
 *
 * Bodies move in two axis-separated passes (X then Y). Solids block on all
 * sides; one-way platforms only arrest downward motion onto their top edge;
 * hazards never block — they are reported as overlaps so the caller decides
 * the consequence (instant death per PLAN.md §4).
 *
 * All positions/sizes are world pixels; a body's position is its top-left
 * corner. Velocity fields live on {@link PhysicsBody}.
 */

/** A movable AABB whose position is mutated by {@link moveAndCollide}. */
export interface PhysicsBody extends AABB {
  vx: number;
  vy: number;
}

export interface CollisionFlags {
  /** Body is resting on a solid tile or one-way platform after this move. */
  onGround: boolean;
  hitCeiling: boolean;
  hitWallLeft: boolean;
  hitWallRight: boolean;
  /** Overlapped at least one hazard tile during this move. */
  touchedHazard: boolean;
}

export function noCollisionFlags(): CollisionFlags {
  return {
    onGround: false,
    hitCeiling: false,
    hitWallLeft: false,
    hitWallRight: false,
    touchedHazard: false,
  };
}

/** Skin width keeping bodies numerically outside tiles they merely touch. */
export const COLLISION_EPSILON = 0.01;

function spanTiles(min: number, max: number): { from: number; to: number } {
  return { from: Level.worldToTileX(min), to: Level.worldToTileX(max) };
}

/** True when the AABB intersects any Solid tile it spans. */
export function intersectsSolid(level: Level, box: AABB): boolean {
  const { from: tx0, to: tx1 } = spanTiles(box.x, box.x + box.width - COLLISION_EPSILON);
  const ty0 = Level.worldToTileY(box.y);
  const ty1 = Level.worldToTileY(box.y + box.height - COLLISION_EPSILON);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (level.isSolidAtTile(tx, ty)) return true;
    }
  }
  return false;
}

/**
 * True when `box` overlaps any Hazard tile. Collision uses a small inset so
 * grazing hazard pixels with a corner is forgiving.
 */
export function touchesHazard(level: Level, box: AABB): boolean {
  const xInset = 4;
  const yInset = 6;
  const x0 = box.x + xInset;
  const x1 = box.x + box.width - xInset;
  const y0 = box.y + yInset;
  const y1 = box.y + box.height - yInset;
  if (x1 <= x0 || y1 <= y0) return false;

  const { from: tx0, to: tx1 } = spanTiles(x0, x1);
  const ty0 = Level.worldToTileY(y0);
  const ty1 = Level.worldToTileY(y1);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (level.tileAt(tx, ty) === TileType.Hazard) return true;
    }
  }
  return false;
}

/**
 * Move `body` by its velocity over `dtSeconds`, resolving against the tilemap.
 * Mutates body.x/body.y (and zeroes vy on ground/ceiling contact); returns
 * per-axis contact flags for the step.
 */
export function moveAndCollide(level: Level, body: PhysicsBody, dtSeconds: number): CollisionFlags {
  const flags = noCollisionFlags();
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0 || !Number.isFinite(body.x)) return flags;

  // ---- horizontal pass ----
  const dx = body.vx * dtSeconds;
  if (dx !== 0) {
    body.x += dx;
    const hits = resolveHorizontal(level, body, dx);
    flags.hitWallLeft = hits.left;
    flags.hitWallRight = hits.right;
    if (hits.left || hits.right) body.vx = 0;
  }

  // ---- vertical pass ----
  const dy = body.vy * dtSeconds;
  if (dy !== 0) {
    body.y += dy;
    if (dy > 0) {
      if (resolveDownward(level, body)) flags.onGround = true;
    } else if (resolveUpward(level, body)) {
      flags.hitCeiling = true;
    }
  }

  // Standing probe even without vertical motion this step.
  if (!flags.onGround && body.vy >= 0 && restingOnSurface(level, body)) {
    flags.onGround = true;
  }

  if (touchesHazard(level, body)) flags.touchedHazard = true;

  return flags;
}

/** Snap-resolution against solids after horizontal motion. */
function resolveHorizontal(
  level: Level,
  body: PhysicsBody,
  dx: number,
): { left: boolean; right: boolean } {
  if (!intersectsSolid(level, body)) return { left: false, right: false };

  if (dx > 0) {
    const rightEdge = body.x + body.width;
    const collidedColumn = Level.worldToTileX(rightEdge - COLLISION_EPSILON);
    body.x = Level.tileToWorldX(collidedColumn) - body.width - COLLISION_EPSILON;
    return { left: false, right: true };
  }
  const collidedColumn = Level.worldToTileX(body.x);
  body.x = Level.tileToWorldX(collidedColumn + 1) + COLLISION_EPSILON;
  return { left: true, right: false };
}

/** Land on solids or one-way platforms when falling; returns true on landing. */
function resolveDownward(level: Level, body: PhysicsBody): boolean {
  const bottom = body.y + body.height;
  const footRow = Level.worldToTileY(bottom - COLLISION_EPSILON);
  const { from: tx0, to: tx1 } = spanTiles(body.x, body.x + body.width - COLLISION_EPSILON);

  let landed = false;
  let bestSurfaceY = Number.POSITIVE_INFINITY;
  for (let tx = tx0; tx <= tx1; tx++) {
    const tile = level.tileAt(tx, footRow);
    if (tile !== TileType.Solid && tile !== TileType.Platform) continue;
    const surfaceY = Level.tileToWorldY(footRow);
    // Only arrest feet that entered this tile band during the step.
    if (bottom >= surfaceY && bottom <= surfaceY + TILE_SIZE + MAX_PENETRATION_PX) {
      if (surfaceY < bestSurfaceY) bestSurfaceY = surfaceY;
      landed = true;
    }
  }
  if (landed) {
    body.y = bestSurfaceY - body.height - COLLISION_EPSILON;
    body.vy = 0;
  }
  return landed;
}

/** Bonk against solids when rising; returns true on contact. */
function resolveUpward(level: Level, body: PhysicsBody): boolean {
  if (!intersectsSolid(level, body)) return false;
  const headRow = Level.worldToTileY(body.y);
  body.y = Level.tileToWorldY(headRow + 1) + COLLISION_EPSILON;
  body.vy = 0;
  return true;
}

/**
 * True when the body's feet rest on a blocking surface — distinguishes
 * "standing" from "still falling towards it". Accepts feet exactly at the
 * surface (minus the standing skin epsilon) or sunk a probe-window into it.
 */
export function restingOnSurface(level: Level, body: AABB): boolean {
  const footY = body.y + body.height;
  const probeRow = Level.worldToTileY(footY + GROUND_PROBE_PX);
  const rowTop = Level.tileToWorldY(probeRow);
  // Feet must be at the surface (within skin epsilon) or already touching it.
  if (footY < rowTop - STANDING_SKIN_PX || footY > rowTop + GROUND_PROBE_PX) return false;

  const { from: tx0, to: tx1 } = spanTiles(
    body.x + COLLISION_EPSILON,
    body.x + body.width - COLLISION_EPSILON,
  );
  for (let tx = tx0; tx <= tx1; tx++) {
    const tile = level.tileAt(tx, probeRow);
    if (tile === TileType.Solid || tile === TileType.Platform) return true;
  }
  return false;
}

/** Max downward penetration corrected per step before snapping. */
const MAX_PENETRATION_PX = 12;
/** Downward ground-probe distance beyond the feet. */
const GROUND_PROBE_PX = 2;
/** Skin tolerance around an exact-surface foot position. */
const STANDING_SKIN_PX = 0.06;
