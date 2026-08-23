import { WEAPON_UNLOCK_THRESHOLDS } from '../save/unlocks';
import type { Vec2 } from './entities';

/**
 * Weapon registry (PLAN.md §4 "Vapen (6 st)"):
 *
 *   | Vapen    | Beteende                        | Lås (totalpoäng) |
 *   |----------|---------------------------------|------------------|
 *   | Puls     | Standard, snabb, svag           | Start            |
 *   | Spridare | 3 skott i vinkel                | 10 000           |
 *   | Piercer  | Genomträngande, långsammare     | 25 000           |
 *   | Studsare | Studsar mot väggar              | 50 000           |
 *   | Fragment | Kristaller som splittras        | 100 000          |
 *   | Nova     | Långsam laddning, stor explosion| 200 000          |
 *
 * Pure data + pure math so both gameplay and Node tests can consume it
 * without DOM/WebGPU/audio. Behavior execution lives in Projectile.ts
 * (movement/bounce) and GameSession.ts (volleys, pierce/split/explosion,
 * charging, switching).
 */

export type WeaponId = 'puls' | 'spridare' | 'piercer' | 'studsare' | 'fragment' | 'nova';

/** Neon tint used for the projectile sprite, glow and impact particles. */
export type WeaponColor = readonly [number, number, number, number];

export interface WeaponDef {
  readonly id: WeaponId;
  /** Display name for the HUD/toasts. */
  readonly name: string;
  /** One-line feel description (toasts, future menus). */
  readonly blurb: string;
  /** Minimum ms between shots (Overcharge halves this). */
  readonly cooldownMs: number;
  /** Muzzle speed in world px/s. */
  readonly projectileSpeedPxPerS: number;
  /** Damage per hit on enemies. */
  readonly damage: number;
  /** Projectile lifetime before despawn (seconds). */
  readonly lifetimeSeconds: number;
  /** Square projectile edge length in px. */
  readonly sizePx: number;
  /** Neon color [r, g, b, a]. */
  readonly color: WeaponColor;

  // ---- behavior flags (0 = disabled; PLAN.md §4 behaviors) -----------------

  /** Spridare: shots per trigger pull, fanned across `spreadAngleDeg`. */
  readonly spreadCount: number;
  /** Total cone width of the volley in degrees (0 = straight line). */
  readonly spreadAngleDeg: number;
  /** Piercer: extra enemies the shot passes through after the first hit. */
  readonly pierceHits: number;
  /** Studsare: solid-tile reflections before the shot dies. */
  readonly maxBounces: number;
  /** Fragment: shards spawned when the crystal dies (hit/wall/expiry). */
  readonly splitChildren: number;
  /** Fan width for split children, degrees, centered on travel direction. */
  readonly splitFanAngleDeg: number;
  readonly splitChildDamage: number;
  readonly splitChildSpeedPxPerS: number;
  readonly splitChildLifetimeSeconds: number;
  /** Nova: area-damage radius on any death, px (0 = no explosion). */
  readonly explosionRadiusPx: number;
  /** Nova: hold-to-charge duration in ms (0 = fires instantly). */
  readonly chargeMs: number;
}

/**
 * Balance (task B3.5): early game stays tight — Puls is weak-but-fast and
 * Spridare lands at 10k within a few levels; later weapons trade raw DPS
 * for utility (pierce/bounce) or burst (split/Nova AoE).
 */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  puls: {
    id: 'puls',
    name: 'PULS',
    blurb: 'Standard — snabb och svag',
    cooldownMs: 170,
    projectileSpeedPxPerS: 720,
    damage: 1,
    lifetimeSeconds: 1.15,
    sizePx: 8,
    color: [0.55, 1, 1, 1],
    spreadCount: 1,
    spreadAngleDeg: 0,
    pierceHits: 0,
    maxBounces: 0,
    splitChildren: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 0,
    chargeMs: 0,
  },
  spridare: {
    id: 'spridare',
    name: 'SPRIDARE',
    blurb: '3 skott i vinkel',
    cooldownMs: 280,
    projectileSpeedPxPerS: 620,
    damage: 1,
    lifetimeSeconds: 0.72,
    sizePx: 6,
    color: [1, 0.45, 0.85, 1],
    spreadCount: 3,
    spreadAngleDeg: 26,
    pierceHits: 0,
    maxBounces: 0,
    splitChildren: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 0,
    chargeMs: 0,
  },
  piercer: {
    id: 'piercer',
    name: 'PIERCER',
    blurb: 'Genomträngande — långsam, kraftfull',
    cooldownMs: 430,
    projectileSpeedPxPerS: 560,
    damage: 3,
    lifetimeSeconds: 1.35,
    sizePx: 10,
    color: [0.72, 0.5, 1, 1],
    spreadCount: 1,
    spreadAngleDeg: 0,
    pierceHits: 2,
    maxBounces: 0,
    splitChildren: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 0,
    chargeMs: 0,
  },
  studsare: {
    id: 'studsare',
    name: 'STUDSARE',
    blurb: 'Studsar mot väggar',
    cooldownMs: 300,
    projectileSpeedPxPerS: 500,
    damage: 2,
    lifetimeSeconds: 2.6,
    sizePx: 9,
    color: [1, 0.66, 0.28, 1],
    spreadCount: 1,
    spreadAngleDeg: 0,
    pierceHits: 0,
    maxBounces: 4,
    splitChildren: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 0,
    chargeMs: 0,
  },
  fragment: {
    id: 'fragment',
    name: 'FRAGMENT',
    blurb: 'Kristaller som splittras i skärvor',
    cooldownMs: 330,
    projectileSpeedPxPerS: 600,
    damage: 2,
    lifetimeSeconds: 0.95,
    sizePx: 8,
    color: [0.45, 1, 0.65, 1],
    spreadCount: 1,
    spreadAngleDeg: 0,
    pierceHits: 0,
    maxBounces: 0,
    splitChildren: 3,
    splitFanAngleDeg: 150,
    splitChildDamage: 1,
    splitChildSpeedPxPerS: 380,
    splitChildLifetimeSeconds: 0.5,
    explosionRadiusPx: 0,
    chargeMs: 0,
  },
  nova: {
    id: 'nova',
    name: 'NOVA',
    blurb: 'Ladda — stor explosion',
    cooldownMs: 900,
    projectileSpeedPxPerS: 460,
    damage: 9,
    lifetimeSeconds: 1.7,
    sizePx: 18,
    color: [1, 0.93, 0.55, 1],
    spreadCount: 1,
    spreadAngleDeg: 0,
    pierceHits: 0,
    maxBounces: 0,
    splitChildren: 0,
    splitFanAngleDeg: 0,
    splitChildDamage: 0,
    splitChildSpeedPxPerS: 0,
    splitChildLifetimeSeconds: 0,
    explosionRadiusPx: 88,
    chargeMs: 750,
  },
};

export const DEFAULT_WEAPON_ID: WeaponId = 'puls';

function isWeaponId(value: string): value is WeaponId {
  return Object.prototype.hasOwnProperty.call(WEAPONS, value);
}

/**
 * Cycle order = unlock-threshold order (PLAN.md table), restricted to
 * registered weapons so a threshold/save mismatch can never break switching.
 */
export const WEAPON_ORDER: readonly WeaponId[] = WEAPON_UNLOCK_THRESHOLDS.map(
  (t) => t.weaponId,
).filter(isWeaponId);

// ---------------------------------------------------------------------------
// Pure math shared by fire behavior + tests
// ---------------------------------------------------------------------------

export const DEG_TO_RAD = Math.PI / 180;

/** Unit-length copy of `v` (falls back to +X for degenerate input). */
export function normalizeDirection(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (!Number.isFinite(length) || length < 0.0001) return { x: 1, y: 0 };
  return { x: v.x / length, y: v.y / length };
}

/** Rotate a unit vector by `radians` (positive = clockwise in screen space). */
export function rotateDirection(dir: Vec2, radians: number): Vec2 {
  const base = normalizeDirection(dir);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalizeDirection({ x: base.x * cos - base.y * sin, y: base.x * sin + base.y * cos });
}

/**
 * Fan of `count` unit directions spanning `totalAngleDeg`, centered on
 * `dir`. Odd counts keep the middle shot exactly on the aim direction;
 * even counts straddle it symmetrically.
 */
export function spreadDirections(dir: Vec2, count: number, totalAngleDeg: number): Vec2[] {
  const n = Math.max(1, Math.floor(count));
  const base = normalizeDirection(dir);
  if (n === 1) return [base];
  const total = Math.max(0, totalAngleDeg) * DEG_TO_RAD;
  const directions: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const offset = i / (n - 1) - 0.5; // -0.5 .. +0.5 across the cone
    directions.push(rotateDirection(base, offset * total));
  }
  return directions;
}

/**
 * Mirror a velocity off an axis-aligned surface ('x' = vertical wall flips
 * the x component, 'y' = horizontal floor/ceiling flips y). Pure helper for
 * tests; the live bounce mutates the projectile directly.
 */
export function reflectedVelocity(
  velocity: Vec2,
  axis: 'x' | 'y',
): Vec2 {
  return axis === 'x'
    ? { x: -velocity.x, y: velocity.y }
    : { x: velocity.x, y: -velocity.y };
}

/** Charge progress 0..1 for hold-to-charge weapons (clamped). */
export function chargeFraction(chargeMs: number, fullChargeMs: number): number {
  if (!(fullChargeMs > 0)) return 1;
  if (!Number.isFinite(chargeMs) || chargeMs <= 0) return 0;
  return Math.min(1, chargeMs / fullChargeMs);
}

/** Unit direction for an 8-way normalized aim vector (defensive fallback). */
export function aimDirection(origin: Vec2, target: Vec2): Vec2 {
  return normalizeDirection({ x: target.x - origin.x, y: target.y - origin.y });
}
