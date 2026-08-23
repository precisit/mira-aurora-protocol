import type { Vec2 } from './entities';

/**
 * Weapon registry (PLAN.md §4 "Vapen"). B0 ships the starting weapon Puls;
 * the remaining five unlock by accumulated total score in later waves —
 * the descriptor shape below is what they will fill in.
 */

export type WeaponId = 'puls';

export interface WeaponDef {
  readonly id: WeaponId;
  /** Display name for the HUD. */
  readonly name: string;
  /** Minimum ms between shots (Overcharge halves this). */
  readonly cooldownMs: number;
  /** Muzzle speed in world px/s. */
  readonly projectileSpeedPxPerS: number;
  /** Damage per hit on enemies. */
  readonly damage: number;
  /** Projectile lifetime before despawn (seconds). */
  readonly lifetimeSeconds: number;
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  puls: {
    id: 'puls',
    name: 'PULS',
    cooldownMs: 170,
    projectileSpeedPxPerS: 720,
    damage: 1,
    lifetimeSeconds: 1.1,
  },
};

export const DEFAULT_WEAPON_ID: WeaponId = 'puls';

/** Unit direction for an 8-way normalized aim vector (defensive fallback). */
export function aimDirection(origin: Vec2, target: Vec2): Vec2 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.0001) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}
