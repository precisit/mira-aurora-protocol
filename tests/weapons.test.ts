import { describe, expect, it } from 'vitest';
import {
  DEG_TO_RAD,
  DEFAULT_WEAPON_ID,
  WEAPONS,
  WEAPON_ORDER,
  aimDirection,
  chargeFraction,
  normalizeDirection,
  reflectedVelocity,
  rotateDirection,
  spreadDirections,
  type WeaponDef,
  type WeaponId,
} from '../src/game/weapons';
import { WEAPON_UNLOCK_THRESHOLDS } from '../src/save/unlocks';

/** All six PLAN.md §4 weapons, keyed by id. */
const ALL_IDS: readonly WeaponId[] = [
  'puls',
  'spridare',
  'piercer',
  'studsare',
  'fragment',
  'nova',
];

describe('weapon registry (PLAN.md §4 vapentabell)', () => {
  it('defines exactly the six planned weapons', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual([...ALL_IDS].sort());
  });

  it('starts everyone with Puls', () => {
    expect(DEFAULT_WEAPON_ID).toBe('puls');
    expect(WEAPON_UNLOCK_THRESHOLDS[0]).toEqual({ weaponId: 'puls', requiredTotalScore: 0 });
  });

  it('cycle order follows the unlock-threshold order', () => {
    expect(WEAPON_ORDER).toEqual(ALL_IDS);
    expect(WEAPON_ORDER.map((id) => WEAPONS[id]!.name)).toEqual([
      'PULS',
      'SPRIDARE',
      'PIERCER',
      'STUDSARE',
      'FRAGMENT',
      'NOVA',
    ]);
  });

  it('keeps registry ids aligned with the B5 threshold table', () => {
    expect(WEAPON_UNLOCK_THRESHOLDS.map((t) => t.weaponId)).toEqual([...WEAPON_ORDER]);
  });
});

describe('weapon data validity', () => {
  const defs = Object.values(WEAPONS) as readonly WeaponDef[];

  it('has sane positive core stats everywhere', () => {
    for (const def of defs) {
      expect(def.cooldownMs, def.id).toBeGreaterThan(0);
      expect(def.projectileSpeedPxPerS, def.id).toBeGreaterThan(0);
      expect(def.damage, def.id).toBeGreaterThanOrEqual(1);
      expect(def.lifetimeSeconds, def.id).toBeGreaterThan(0);
      expect(def.sizePx, def.id).toBeGreaterThanOrEqual(4);
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.blurb.length, def.id).toBeGreaterThan(0);
    }
  });

  it('has valid neon colors (rgba within 0..1)', () => {
    for (const def of defs) {
      expect(def.color, def.id).toHaveLength(4);
      for (const channel of def.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never enables contradictory special behaviors', () => {
    for (const def of defs) {
      expect(Number.isInteger(def.spreadCount), def.id).toBe(true);
      expect(def.spreadCount, def.id).toBeGreaterThanOrEqual(1);
      expect(def.spreadAngleDeg, def.id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(def.pierceHits), def.id).toBe(true);
      expect(def.pierceHits, def.id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(def.maxBounces), def.id).toBe(true);
      expect(def.maxBounces, def.id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(def.splitChildren), def.id).toBe(true);
      expect(def.splitChildren, def.id).toBeGreaterThanOrEqual(0);
      expect(def.explosionRadiusPx, def.id).toBeGreaterThanOrEqual(0);
      expect(def.chargeMs, def.id).toBeGreaterThanOrEqual(0);
      if (def.splitChildren > 0) {
        // Splitting crystals carry shard data for their children.
        expect(def.splitChildDamage, def.id).toBeGreaterThanOrEqual(1);
        expect(def.splitChildSpeedPxPerS, def.id).toBeGreaterThan(0);
        expect(def.splitChildLifetimeSeconds, def.id).toBeGreaterThan(0);
      }
    }
  });

  it('gives each planned behavior to exactly its weapon', () => {
    expect(WEAPONS.puls!.spreadCount).toBe(1); // plain fast weak shot
    expect(WEAPONS.spridare!.spreadCount).toBe(3); // 3 skott i vinkel
    expect(WEAPONS.spridare!.spreadAngleDeg).toBeGreaterThan(0);
    expect(WEAPONS.piercer!.pierceHits).toBeGreaterThanOrEqual(1); // genomträngande
    expect(WEAPONS.studsare!.maxBounces).toBeGreaterThanOrEqual(1); // studsar
    expect(WEAPONS.fragment!.splitChildren).toBeGreaterThanOrEqual(2); // splittras
    expect(WEAPONS.nova!.chargeMs).toBeGreaterThan(0); // långsam laddning
    expect(WEAPONS.nova!.explosionRadiusPx).toBeGreaterThan(0); // stor explosion
    for (const id of ALL_IDS) {
      if (id !== 'spridare') expect(WEAPONS[id]!.spreadCount, id).toBe(1);
      if (id !== 'piercer') expect(WEAPONS[id]!.pierceHits, id).toBe(0);
      if (id !== 'studsare') expect(WEAPONS[id]!.maxBounces, id).toBe(0);
      if (id !== 'fragment') expect(WEAPONS[id]!.splitChildren, id).toBe(0);
      if (id !== 'nova') {
        expect(WEAPONS[id]!.chargeMs, id).toBe(0);
        expect(WEAPONS[id]!.explosionRadiusPx, id).toBe(0);
      }
    }
  });
});

describe('balance curve (task B3.5)', () => {
  it('Puls is the weakest gun but fires fastest', () => {
    const puls = WEAPONS.puls!;
    for (const def of Object.values(WEAPONS) as readonly WeaponDef[]) {
      expect(puls.cooldownMs, `vs ${def.id}`).toBeLessThanOrEqual(def.cooldownMs);
    }
    expect(puls.damage).toBe(1);
  });

  it('Piercer and Nova hit harder than Puls but much slower', () => {
    const puls = WEAPONS.puls!;
    expect(WEAPONS.piercer!.damage).toBeGreaterThan(puls.damage);
    expect(WEAPONS.piercer!.cooldownMs).toBeGreaterThan(puls.cooldownMs * 2);
    expect(WEAPONS.nova!.damage).toBeGreaterThan(puls.damage * 2);
    expect(WEAPONS.nova!.cooldownMs).toBeGreaterThan(puls.cooldownMs * 4);
  });

  it('Spridare trades fire rate for volley width', () => {
    expect(WEAPONS.spridare!.cooldownMs).toBeGreaterThan(WEAPONS.puls!.cooldownMs);
    expect(WEAPONS.spridare!.lifetimeSeconds).toBeLessThan(WEAPONS.puls!.lifetimeSeconds);
  });
});

// ---------------------------------------------------------------------------
// Pure fire-behavior math
// ---------------------------------------------------------------------------

const angleDeg = (v: { x: number; y: number }): number =>
  Math.atan2(v.y, v.x) / DEG_TO_RAD;

describe('spreadDirections', () => {
  it('returns a single normalized direction for count 1', () => {
    const dirs = spreadDirections({ x: 3, y: 4 }, 1, 90);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.x).toBeCloseTo(0.6, 10);
    expect(dirs[0]!.y).toBeCloseTo(0.8, 10);
  });

  it('fans odd counts symmetrically around the aim (middle = aim)', () => {
    const dirs = spreadDirections({ x: 1, y: 0 }, 3, 90);
    expect(angleDeg(dirs[0]!)).toBeCloseTo(-45, 6);
    expect(angleDeg(dirs[1]!)).toBeCloseTo(0, 6);
    expect(angleDeg(dirs[2]!)).toBeCloseTo(45, 6);
  });

  it('straddles the aim symmetrically for even counts', () => {
    const dirs = spreadDirections({ x: 1, y: 0 }, 2, 30);
    expect(angleDeg(dirs[0]!)).toBeCloseTo(-15, 6);
    expect(angleDeg(dirs[1]!)).toBeCloseTo(15, 6);
  });

  it('rotates with the base aim direction', () => {
    const dirs = spreadDirections({ x: 0, y: 1 }, 3, 26); // Spridare straight down
    expect(angleDeg(dirs[1]!)).toBeCloseTo(90, 6);
    expect(angleDeg(dirs[0]!)).toBeCloseTo(90 - 13, 6);
    expect(angleDeg(dirs[2]!)).toBeCloseTo(90 + 13, 6);
  });

  it('produces unit vectors and clamps bad input', () => {
    for (const dir of spreadDirections({ x: 0.3, y: -0.9 }, 5, 120)) {
      expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 10);
    }
    expect(spreadDirections({ x: 0, y: 0 }, 3, 26)[1]).toEqual({ x: 1, y: 0 });
    expect(spreadDirections({ x: 1, y: 0 }, 0, 26)).toHaveLength(1);
    expect(spreadDirections({ x: 1, y: 0 }, -4, 26)).toHaveLength(1);
  });

  it('matches the Spridare def: 3 pellets across its cone', () => {
    const def = WEAPONS.spridare!;
    const dirs = spreadDirections({ x: 1, y: 0 }, def.spreadCount, def.spreadAngleDeg);
    expect(dirs).toHaveLength(3);
    const outer = Math.abs(angleDeg(dirs[0]!));
    expect(outer).toBeCloseTo(def.spreadAngleDeg / 2, 6);
  });
});

describe('bounce reflection helpers', () => {
  it('reflects off vertical walls (flip x) and floors (flip y)', () => {
    expect(reflectedVelocity({ x: 500, y: 0 }, 'x')).toEqual({ x: -500, y: 0 });
    expect(reflectedVelocity({ x: 120, y: -300 }, 'y')).toEqual({ x: 120, y: 300 });
  });

  it('preserves speed (elastic reflection)', () => {
    const v = { x: 320, y: -240 };
    const before = Math.hypot(v.x, v.y);
    for (const axis of ['x', 'y'] as const) {
      const r = reflectedVelocity(v, axis);
      expect(Math.hypot(r.x, r.y)).toBeCloseTo(before, 10);
    }
  });

  it('rotateDirection/normalizeDirection stay unit-length', () => {
    for (const angle of [-75, -13, 0, 13, 75, 179]) {
      const rotated = rotateDirection({ x: 1, y: 0 }, angle * DEG_TO_RAD);
      expect(angleDeg(rotated)).toBeCloseTo(angle, 6);
      expect(Math.hypot(rotated.x, rotated.y)).toBeCloseTo(1, 10);
    }
    expect(normalizeDirection({ x: 1e-9, y: -1e-9 })).toEqual({ x: 1, y: 0 });
  });
});

describe('chargeFraction (Nova hold-to-charge)', () => {
  const nova = WEAPONS.nova!;

  it('is 0 before charging and grows linearly', () => {
    expect(chargeFraction(0, nova.chargeMs)).toBe(0);
    expect(chargeFraction(nova.chargeMs / 4, nova.chargeMs)).toBeCloseTo(0.25, 10);
    expect(chargeFraction(nova.chargeMs / 2, nova.chargeMs)).toBeCloseTo(0.5, 10);
  });

  it('reaches 1 exactly at the full charge time and clamps beyond', () => {
    expect(chargeFraction(nova.chargeMs - 1, nova.chargeMs)).toBeLessThan(1);
    expect(chargeFraction(nova.chargeMs, nova.chargeMs)).toBe(1);
    expect(chargeFraction(nova.chargeMs * 3, nova.chargeMs)).toBe(1);
  });

  it('handles instant-fire weapons and garbage input', () => {
    expect(chargeFraction(0, 0)).toBe(1);
    expect(chargeFraction(100, 0)).toBe(1);
    expect(chargeFraction(Number.NaN, nova.chargeMs)).toBe(0);
    expect(chargeFraction(-5, nova.chargeMs)).toBe(0);
  });
});

describe('aimDirection (unchanged contract)', () => {
  it('normalizes and falls back to +X', () => {
    expect(aimDirection({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(aimDirection({ x: 0, y: 0 }, { x: 0, y: -5 })).toEqual({ x: 0, y: -1 });
    expect(aimDirection({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual({ x: 1, y: 0 });
  });
});
