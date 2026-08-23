import { describe, expect, it } from 'vitest';
import { parseAsciiLevel } from '../src/levels/Level';
import { GameSession } from '../src/game/GameSession';
import { emptyPlayerInput, type PlayerInput } from '../src/game/Player';
import { WEAPONS } from '../src/game/weapons';
import { defaultSaveData, SaveStore } from '../src/save/SaveStore';
import {
  newlyUnlockedWeapons,
  WEAPON_UNLOCK_THRESHOLDS,
} from '../src/save/unlocks';

/**
 * B3 fire-behavior tests: real GameSession simulation on tiny ASCII levels.
 * Fixed 120 Hz steps keep everything deterministic (seeded RNG, no DOM).
 *
 * Purger enemies are the ideal dummies: they hover at their home X with a
 * slow vertical bob only, so shots fired along their row always connect.
 */

const STEP_MS = 1000 / 120;

/** 32-col open arena with a floor; extra rows are appended by callers. */
function pad(row: string, width = 32): string {
  return row.padEnd(width, '.').slice(0, width);
}

function makeSession(
  rows: string[],
  options: { unlockedWeapons?: string[]; onEvent?: (e: { type: string }) => void } = {},
): GameSession {
  const level = parseAsciiLevel(
    'weapon-behavior-test',
    'Weapon Behavior Test',
    rows.map((r) => pad(r)),
  );
  const events: Array<{ type: string }> = [];
  return new GameSession({
    levelData: level,
    seed: 0xbeef01,
    unlockedWeapons: options.unlockedWeapons ?? ['puls'],
    hooks: {
      onEvent: (event) => {
        events.push(event as { type: string });
        options.onEvent?.(event as { type: string });
      },
    },
  });
}

const shoot = (aim: PlayerInput['aim'] = { x: 1, y: 0 }): PlayerInput => ({
  ...emptyPlayerInput(),
  shootHeld: true,
  aim,
});
const idle = (): PlayerInput => emptyPlayerInput();

/** Step `steps` times without input. */
function settle(session: GameSession, steps: number): void {
  for (let i = 0; i < steps; i++) session.update(STEP_MS, idle());
}

/** Player shots currently in flight. */
function playerShots(session: GameSession) {
  return session.activeProjectiles.filter((p) => p.owner === 'player');
}

// ---------------------------------------------------------------------------
// Spread (Spridare)
// ---------------------------------------------------------------------------

describe('Spridare spread volley', () => {
  const FLOOR = ['S...............................', '################################'];

  it('fires exactly three pellets per trigger pull, fanned around the aim', () => {
    const session = makeSession(['S', FLOOR[1]!], { unlockedWeapons: ['puls', 'spridare'] });
    session.selectWeapon('spridare');

    session.update(STEP_MS, shoot({ x: 1, y: 0 }));
    const pellets = playerShots(session);
    expect(pellets).toHaveLength(3);

    const angles = pellets.map((p) =>
      Math.atan2(p.velocity.y, p.velocity.x) * (180 / Math.PI),
    );
    angles.sort((a, b) => a - b);
    const def = WEAPONS.spridare!;
    expect(angles[1]).toBeCloseTo(0, 5); // middle pellet rides the aim
    expect(angles[0]).toBeCloseTo(-def.spreadAngleDeg / 2, 4);
    expect(angles[2]).toBeCloseTo(def.spreadAngleDeg / 2, 4);
    // All pellets share the weapon's speed and damage.
    for (const p of pellets) {
      expect(p.damage).toBe(def.damage);
      expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(
        def.projectileSpeedPxPerS,
        4,
      );
    }
  });

  it('respects its own cooldown between volleys', () => {
    // Rate-limiting is observed via the shoot sfx: fireVolley plays exactly
    // one 'shoot' per trigger pull, independent of projectile survival
    // (angled pellets may die against walls/bounds in a cramped arena).
    const played: string[] = [];
    const level = parseAsciiLevel('spridare-cd', 'Spridare Cd', [
      pad('S'),
      pad('################################'),
    ]);
    const session = new GameSession({
      levelData: level,
      seed: 5,
      unlockedWeapons: ['puls', 'spridare'],
      hooks: { sfx: (name) => played.push(name) },
    });
    session.selectWeapon('spridare');
    const volleys = () => played.filter((n) => n === 'shoot').length;

    session.update(STEP_MS, shoot());
    expect(volleys()).toBe(1); // trigger pull #1 goes through
    session.update(STEP_MS, shoot());
    expect(volleys()).toBe(1); // still cooling down — blocked

    settle(session, 40); // ~333 ms > 280 ms cooldown
    session.update(STEP_MS, shoot());
    expect(volleys()).toBe(2); // ready again
  });

  it('Puls fires one straight shot instead', () => {
    const session = makeSession(['S', FLOOR[1]!]);
    session.update(STEP_MS, shoot());
    const shots = playerShots(session);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.velocity.y).toBe(0);
    expect(shots[0]!.weaponId).toBe('puls');
  });
});

// ---------------------------------------------------------------------------
// Pierce (Piercer)
// ---------------------------------------------------------------------------

/**
 * Arena with two hovering Purgers at tiles 17/18 of row 1 (>480 px from the
 * player, so they never shoot back during the test; close enough together
 * that a Nova splash catches both).
 */
const GAUNTLET = [
  '',
  'S................pp.............#',
  '################################',
];

describe('Piercer penetration', () => {
  it('kills both inline enemies and keeps flying', () => {
    let kills = 0;
    const session = makeSession(GAUNTLET, {
      unlockedWeapons: ['puls', 'piercer'],
      onEvent: (e) => {
        if (e.type === 'enemy-killed') kills++;
      },
    });
    session.selectWeapon('piercer');

    session.update(STEP_MS, shoot());
    settle(session, 130); // ~1.08 s: enough to cross both purgers

    expect(kills).toBe(2); // 3 damage each vs 3 hp — both die to one shot
    expect(playerShots(session).length).toBeGreaterThanOrEqual(1); // survived both hits

    // No enemy was hit twice by the same projectile (dedup): total kills
    // stay at 2 even after letting everything settle.
    settle(session, 200);
    expect(kills).toBe(2);
  });

  it('Puls stops at the first enemy instead (and cannot one-shot it)', () => {
    const session = makeSession(GAUNTLET);

    session.update(STEP_MS, shoot());
    settle(session, 130);

    // Puls deals 1 damage: the first Purger (3 hp) is wounded, not killed,
    // and the shot died on impact so the second one is fully untouched.
    expect(session.kills).toBe(0);
    const enemies = [...session.activeEnemies];
    expect(enemies).toHaveLength(2);
    expect(enemies[0]!.hp).toBe(2); // 3 hp − 1 Puls damage
    expect(enemies[1]!.hp).toBe(3);
    expect(playerShots(session)).toHaveLength(0); // no punch-through
  });
});

// ---------------------------------------------------------------------------
// Bounce (Studsare)
// ---------------------------------------------------------------------------

const CORRIDOR = ['S......................#', '########################'];

describe('Studsare wall bounces', () => {
  function fireAtWall(): { session: GameSession; flips: number[] } {
    const session = makeSession(CORRIDOR, { unlockedWeapons: ['puls', 'studsare'] });
    session.selectWeapon('studsare');
    session.update(STEP_MS, shoot());

    const flips: number[] = [];
    let lastSign = 1;
    for (let i = 0; i < 400 && session.activeProjectiles.length > 0; i++) {
      session.update(STEP_MS, idle());
      const shot = playerShots(session)[0];
      if (!shot) break;
      const sign = Math.sign(shot.velocity.x);
      if (sign !== lastSign && sign !== 0) {
        flips.push(i);
        lastSign = sign;
      }
    }
    return { session, flips };
  }

  it('reflects off a solid wall, reversing vx and staying alive', () => {
    const { flips } = fireAtWall();
    expect(flips.length).toBeGreaterThanOrEqual(1); // bounced off the right wall
  });

  it('bounces at most maxBounces times, then dies', () => {
    const { session, flips } = fireAtWall();
    expect(flips.length).toBeLessThanOrEqual(WEAPONS.studsare!.maxBounces);
    // The corridor's far wall + solid edge policy give it targets for every
    // bounce; after the budget is spent the next contact kills the shot.
    settle(session, 10);
    expect(session.activeProjectiles.length).toBe(0);
  });

  it('keeps weapon metadata on the bouncing shot', () => {
    const session = makeSession(CORRIDOR, { unlockedWeapons: ['puls', 'studsare'] });
    session.selectWeapon('studsare');
    session.update(STEP_MS, shoot());
    const shot = playerShots(session)[0]!;
    expect(shot.weaponId).toBe('studsare');
    expect(shot.bounceLeft).toBe(WEAPONS.studsare!.maxBounces);
    expect(shot.damage).toBe(WEAPONS.studsare!.damage);
  });
});

// ---------------------------------------------------------------------------
// Split (Fragment)
// ---------------------------------------------------------------------------

/** Wide empty level so the crystal dies by lifetime expiry mid-air. */
const WIDE = [
  'S...............................................',
  '#################################################',
];

describe('Fragment crystal split', () => {
  /** Step until exactly `count` player shots exist (the shard burst). */
  function stepToBurst(session: GameSession, count: number): void {
    for (let i = 0; i < 300; i++) {
      settle(session, 1);
      if (playerShots(session).length === count) return;
    }
  }

  it('flies as one crystal, then bursts into behavior-stripped shards', () => {
    const session = makeSession(WIDE, { unlockedWeapons: ['puls', 'fragment'] });
    session.selectWeapon('fragment');
    const def = WEAPONS.fragment!;
    session.update(STEP_MS, shoot());

    // Snapshot the pooled crystal's primitives before it is reused by a shard.
    const crystal = playerShots(session)[0]!;
    expect(crystal.splitChildrenLeft).toBe(def.splitChildren);
    const crystalSize = crystal.size.x;

    settle(session, 100); // not yet expired (0.95 s life)
    expect(playerShots(session)).toHaveLength(1);

    stepToBurst(session, def.splitChildren); // lifetime expiry → air burst
    const shards = playerShots(session);
    expect(shards).toHaveLength(def.splitChildren);
    for (const shard of shards) {
      expect(shard.weaponId).toBeNull(); // shards don't re-split
      expect(shard.splitChildrenLeft).toBe(0);
      expect(shard.explosionRadiusPx).toBe(0);
      expect(shard.damage).toBe(def.splitChildDamage);
      expect(shard.size.x).toBeLessThan(crystalSize);
      expect(Math.hypot(shard.velocity.x, shard.velocity.y)).toBeCloseTo(
        def.splitChildSpeedPxPerS,
        4,
      );
    }
  });

  it('shards fan forward within the configured cone', () => {
    const session = makeSession(WIDE, { unlockedWeapons: ['puls', 'fragment'] });
    session.selectWeapon('fragment');
    session.update(STEP_MS, shoot());

    const def = WEAPONS.fragment!;
    stepToBurst(session, def.splitChildren);

    for (const shard of playerShots(session)) {
      const angle = Math.abs(Math.atan2(shard.velocity.y, shard.velocity.x));
      expect(angle).toBeLessThanOrEqual((def.splitFanAngleDeg / 2) * (Math.PI / 180) + 0.001);
      expect(shard.velocity.x).toBeGreaterThan(0); // all shards fly forward
    }
  });
});

// ---------------------------------------------------------------------------
// Charge + explosion (Nova)
// ---------------------------------------------------------------------------

describe('Nova charge & blast', () => {
  function novaSession(): { session: GameSession; blasts: number[]; explosions: number } {
    let explosions = 0;
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'nova'],
      onEvent: (e) => {
        if (e.type === 'explosion') explosions++;
      },
    });
    session.selectWeapon('nova');

    const input = shoot();
    const seenIds = new Set<number>();
    const blasts: number[] = [];
    for (let step = 0; step < 400; step++) {
      session.update(STEP_MS, input);
      for (const shot of playerShots(session)) {
        if (shot.weaponId === 'nova' && !seenIds.has(shot.id)) {
          seenIds.add(shot.id);
          blasts.push(step);
        }
      }
    }
    return { session, blasts, explosions };
  }

  it('does nothing before the full charge time', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'nova'],
    });
    session.selectWeapon('nova');

    for (let i = 0; i < 50; i++) session.update(STEP_MS, shoot());
    expect(playerShots(session)).toHaveLength(0);
    expect(session.chargeFraction).toBeGreaterThan(0.5);
    expect(session.chargeFraction).toBeLessThan(1);
  });

  it('auto-fires exactly at full charge, then waits out cooldown + recharge', () => {
    const { blasts } = novaSession();
    const stepMs = STEP_MS;
    const chargeSteps = Math.ceil(WEAPONS.nova!.chargeMs / stepMs); // 90
    const cooldownSteps = Math.ceil(WEAPONS.nova!.cooldownMs / stepMs); // 108

    expect(blasts.length).toBeGreaterThanOrEqual(2); // keeps cycling while held
    expect(blasts[0]).toBe(chargeSteps - 1); // fires on the exact crossing step
    // Second blast after cooldown AND a fresh full recharge. The cooldown
    // ticker zeroes the timer on the same step the gun becomes ready again,
    // so charging resumes immediately (−1 step vs the naive sum).
    expect(blasts[1]).toBe(blasts[0]! + cooldownSteps + chargeSteps - 1);
  });

  it('drops the charge when the trigger is released mid-charge', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'nova'],
    });
    session.selectWeapon('nova');

    for (let i = 0; i < 60; i++) session.update(STEP_MS, shoot());
    expect(session.chargeFraction).toBeGreaterThan(0);

    settle(session, 30); // release
    expect(session.chargeFraction).toBe(0);

    for (let i = 0; i < 80; i++) session.update(STEP_MS, shoot()); // restarted, not full
    expect(playerShots(session)).toHaveLength(0);
    expect(session.chargeFraction).toBeLessThan(1);
  });

  it('releasing the trigger never fires a partial shot', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'nova'],
    });
    session.selectWeapon('nova');
    for (let i = 0; i < 80; i++) session.update(STEP_MS, shoot());
    settle(session, 200);
    expect(playerShots(session)).toHaveLength(0);
  });

  it('the blast detonates an area attack that hits grouped enemies', () => {
    let explosions = 0;
    let kills = 0;
    // Two purgers 2 tiles apart: the direct hit detonates and the radius
    // catches the neighbour.
    const session = makeSession(GAUNTLET, {
      unlockedWeapons: ['puls', 'nova'],
      onEvent: (e) => {
        if (e.type === 'explosion') explosions++;
        if (e.type === 'enemy-killed') kills++;
      },
    });
    session.selectWeapon('nova');

    for (let step = 0; step < 260 && session.activeEnemies.length > 0; step++) {
      session.update(STEP_MS, shoot());
    }

    expect(explosions).toBe(1);
    expect(kills).toBe(2); // direct hit + splash, no double-dips
    expect(session.activeEnemies).toHaveLength(0);
    expect(session.kills).toBe(2);
  });

  it('blast damage respects the pierce-dedup list (no double dips)', () => {
    // One purger takes the direct hit; the splash must not damage it twice.
    const single = ['S...............p...............', '################################'];
    let kills = 0;
    const session = makeSession(single, {
      unlockedWeapons: ['puls', 'nova'],
      onEvent: (e) => {
        if (e.type === 'enemy-killed') kills++;
      },
    });
    session.selectWeapon('nova');
    for (let step = 0; step < 260 && session.activeEnemies.length > 0; step++) {
      session.update(STEP_MS, shoot());
    }
    expect(kills).toBe(1);
    expect(session.kills).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Weapon switching respects unlocks
// ---------------------------------------------------------------------------

describe('weapon switching (K/C behaviour)', () => {
  it('refuses to cycle with only the starting weapon', () => {
    const session = makeSession(['S', '################################']);
    expect(session.weaponId).toBe('puls');
    expect(session.cycleWeapon()).toBe(false);
    expect(session.cycleWeapon(-1)).toBe(false);
    expect(session.weaponId).toBe('puls');
  });

  it('cycles unlocked weapons in threshold order and wraps around', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'spridare', 'piercer'],
    });

    expect(session.cycleWeapon(1)).toBe(true);
    expect(session.weaponId).toBe('spridare');
    expect(session.cycleWeapon(1)).toBe(true);
    expect(session.weaponId).toBe('piercer');
    expect(session.cycleWeapon(1)).toBe(true);
    expect(session.weaponId).toBe('puls'); // wraps
    expect(session.cycleWeapon(-1)).toBe(true);
    expect(session.weaponId).toBe('piercer'); // …and backwards
  });

  it('selectWeapon refuses locked weapons', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: ['puls', 'spridare'],
    });
    expect(session.selectWeapon('nova')).toBe(false);
    expect(session.weaponId).toBe('puls');
    expect(session.selectWeapon('spridare')).toBe(true);
    expect(session.weaponId).toBe('spridare');
  });

  it('ignores unknown ids in setUnlockedWeapons and stays additive', () => {
    const session = makeSession(['S', '################################']);
    session.setUnlockedWeapons(['garbage', 'nova']);
    expect(session.unlockedWeapons).toEqual(['puls', 'nova']);
    expect(session.cycleWeapon()).toBe(true);
    expect(session.weaponId).toBe('nova');
  });

  it('plays the weapon-switch sfx on real changes only', () => {
    const played: string[] = [];
    const build = (unlocked: string[]) =>
      new GameSession({
        levelData: parseAsciiLevel('switch-sfx', 'Switch Sfx', [pad('S'), pad('################################')]),
        seed: 7,
        unlockedWeapons: unlocked,
        hooks: { sfx: (name) => played.push(name) },
      });

    const locked = build(['puls']);
    expect(locked.cycleWeapon()).toBe(false);
    expect(played).toHaveLength(0);

    const armed = build(['puls', 'spridare']);
    expect(armed.cycleWeapon()).toBe(true);
    expect(played.filter((n) => n === 'weapon-switch')).toHaveLength(1);
  });

  it('fired projectiles carry the equipped weapon at trigger time', () => {
    const session = makeSession(['S', '################################'], {
      unlockedWeapons: [...WEAPON_UNLOCK_THRESHOLDS.map((t) => t.weaponId)],
    });
    session.cycleWeapon(); // spridare
    session.update(STEP_MS, shoot());
    expect(playerShots(session).every((s) => s.weaponId === 'spridare')).toBe(true);

    settle(session, 40); // outlast the 280 ms volley cooldown
    session.cycleWeapon(); // piercer
    session.update(STEP_MS, shoot());
    expect(playerShots(session).some((s) => s.weaponId === 'piercer')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unlock integration (thresholds × SaveStore)
// ---------------------------------------------------------------------------

describe('newlyUnlockedWeapons (live unlock watcher)', () => {
  it('returns nothing while below thresholds', () => {
    expect(newlyUnlockedWeapons(0, 9_999)).toEqual([]);
  });

  it('is inclusive at the threshold boundary', () => {
    expect(newlyUnlockedWeapons(9_999, 10_000)).toEqual(['spridare']);
    expect(newlyUnlockedWeapons(24_999, 25_000)).toEqual(['piercer']);
  });

  it('returns multiple crossings in threshold order', () => {
    expect(newlyUnlockedWeapons(0, 200_000)).toEqual([
      'spridare',
      'piercer',
      'studsare',
      'fragment',
      'nova',
    ]);
    expect(newlyUnlockedWeapons(49_000, 120_000)).toEqual(['studsare', 'fragment']);
  });

  it('never unlocks backwards when the score goes down', () => {
    expect(newlyUnlockedWeapons(30_000, 5_000)).toEqual([]);
    expect(newlyUnlockedWeapons(250_000, 0)).toEqual([]);
  });
});

describe('SaveStore unlock flow (B3 integration)', () => {
  it('banks score at level end and grants weapons automatically', () => {
    const store = new SaveStore();
    const data = defaultSaveData();

    store.recordLevelResult(data, 'level-01', 12_500, 61_000);
    expect(data.totalScore).toBe(12_500);
    expect(newlyUnlockedWeapons(0, data.totalScore)).toEqual(['spridare']);

    for (const id of newlyUnlockedWeapons(0, data.totalScore)) store.unlockWeapon(data, id);
    expect(data.unlockedWeapons).toEqual(['puls', 'spridare']);
  });

  it('unlocks survive game-over score resets (never go backwards)', () => {
    const store = new SaveStore();
    const data = defaultSaveData();
    data.totalScore = 55_000;
    data.unlockedWeapons.push('spridare', 'piercer', 'studsare');

    // A terrible retry earns nothing — nothing gets revoked.
    store.recordLevelResult(data, 'level-02', 0, 45_000);
    expect(data.totalScore).toBe(55_000);
    expect(newlyUnlockedWeapons(55_000, data.totalScore)).toEqual([]);
    expect(data.unlockedWeapons).toContain('studsare');
  });

  it('unlockWeapon is idempotent and persists via save/load round-trip', () => {
    const storage = new Map<string, string>();
    const store = new SaveStore({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
    });
    const data = defaultSaveData();

    expect(store.unlockWeapon(data, 'piercer')).toBe(true);
    expect(store.unlockWeapon(data, 'piercer')).toBe(false);
    store.save(data);

    const reloaded = store.load();
    expect(reloaded.unlockedWeapons).toEqual(['puls', 'piercer']);
  });
});
