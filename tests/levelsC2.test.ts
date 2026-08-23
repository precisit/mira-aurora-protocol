import { describe, expect, it } from 'vitest';
import { GameSession, STARTING_LIVES } from '../src/game/GameSession';
import { emptyPlayerInput } from '../src/game/Player';
import {
  glitchSolidAt,
  GLITCH_CYCLE_MS,
  GLITCH_SOLID_MS,
  TileType,
  type LevelData,
  type LevelSpawn,
} from '../src/levels/LevelData';
import { parseAsciiLevel } from '../src/levels/Level';
import { LevelBuilder } from '../src/levels/LevelBuilder';
import { DOUBLE_JUMP_PROFILE, isReachable } from '../src/levels/Reachability';
import {
  CAMPAIGN_LEVELS,
  GHOST_LEVEL,
  PLAYABLE_LEVELS,
  playableLevelsForTotalScore,
} from '../src/levels/levels';
import { validateLevelData } from '../src/levels/validate';
import {
  GHOST_LEVEL_UNLOCK_SCORE,
  isGhostLevelUnlocked,
  newlyUnlockedGhostLevel,
} from '../src/save/unlocks';
import { laserPhaseAt, laserGridFromSpawn } from '../src/game/lasers';

/**
 * Task C2 tests: levels 4–7 + the ghost level. Validation and reachability
 * for the new slots, boss-arena preservation in 5 and 7, ghost gating at
 * 150k, and parsing/gameplay for the two new hazard kinds (laser, glitch).
 */

function spawnsOfKind<K extends LevelSpawn['kind']>(
  data: LevelData,
  kind: K,
): Extract<LevelSpawn, { kind: K }>[] {
  return data.spawns.filter((s): s is Extract<LevelSpawn, { kind: K }> => s.kind === kind);
}

const L04 = CAMPAIGN_LEVELS[3]!;
const L05 = CAMPAIGN_LEVELS[4]!;
const L06 = CAMPAIGN_LEVELS[5]!;
const L07 = CAMPAIGN_LEVELS[6]!;

describe('C2: levels 4–7 join the campaign', () => {
  it('every new level passes static validation', () => {
    for (const data of [L04, L05, L06, L07, GHOST_LEVEL]) {
      expect(validateLevelData(data), data.id).toEqual([]);
    }
  });

  it('checkpoints are in bounds, ordered left→right and ahead of the spawn', () => {
    for (const data of [L04, L05, L06, L07, GHOST_LEVEL]) {
      const spawn = spawnsOfKind(data, 'playerSpawn')[0]!;
      const checkpoints = spawnsOfKind(data, 'checkpoint');
      let previous = spawn.tx;
      for (const c of checkpoints) {
        expect(c.tx).toBeGreaterThan(previous);
        expect(c.tx).toBeGreaterThan(0);
        expect(c.tx).toBeLessThan(data.widthTiles - 1);
        expect(c.ty).toBeGreaterThanOrEqual(0);
        expect(c.ty).toBeLessThan(data.heightTiles);
        previous = c.tx;
      }
    }
  });

  it('exits and checkpoints are reachable with the double jump (4–7 can assume it)', () => {
    for (const data of [L04, L05, L06, L07, GHOST_LEVEL]) {
      const exit = spawnsOfKind(data, 'exit')[0]!;
      expect(isReachable(data, DOUBLE_JUMP_PROFILE, exit.tx, exit.ty), `${data.id} exit`).toBe(
        true,
      );
      for (const c of spawnsOfKind(data, 'checkpoint')) {
        expect(
          isReachable(data, DOUBLE_JUMP_PROFILE, c.tx, c.ty),
          `${data.id} checkpoint (${c.tx},${c.ty})`,
        ).toBe(true);
      }
    }
  });

  it('par times follow the task table', () => {
    expect(L04.parTimeSeconds).toBe(105);
    expect(L05.parTimeSeconds).toBe(110);
    expect(L06.parTimeSeconds).toBe(100);
    expect(L07.parTimeSeconds).toBe(115);
  });

  it('checkpoint counts follow the task table (4: three, 5: three, 6: four, 7: three)', () => {
    expect(spawnsOfKind(L04, 'checkpoint')).toHaveLength(3);
    expect(spawnsOfKind(L05, 'checkpoint')).toHaveLength(3);
    expect(spawnsOfKind(L06, 'checkpoint')).toHaveLength(4);
    expect(spawnsOfKind(L07, 'checkpoint')).toHaveLength(3);
  });
});

describe('C2: level 4 — Kolonin Tystnad (laser grids)', () => {
  it('introduces laser grids: several timed beams across the colony', () => {
    const lasers = spawnsOfKind(L04, 'laser');
    expect(lasers.length).toBeGreaterThanOrEqual(6);
    // Rhythm variety: staggered offsets so grids interleave.
    expect(new Set(lasers.map((l) => l.offsetMs)).size).toBeGreaterThan(1);
  });

  it('keeps structural spawns out of every beam rect', () => {
    const lasers = spawnsOfKind(L04, 'laser');
    for (const s of L04.spawns) {
      if (s.kind !== 'playerSpawn' && s.kind !== 'checkpoint' && s.kind !== 'exit') continue;
      for (const l of lasers) {
        const covered =
          s.tx >= Math.min(l.tx0, l.tx1) &&
          s.tx <= Math.max(l.tx0, l.tx1) &&
          s.ty >= Math.min(l.ty0, l.ty1) &&
          s.ty <= Math.max(l.ty0, l.ty1);
        expect(covered, `structural ${s.kind}@(${s.tx},${s.ty}) inside beam`).toBe(false);
      }
    }
  });

  it('the colony fights back: purgers patrol among the lasers', () => {
    expect(spawnsOfKind(L04, 'enemy').map((e) => e.enemy)).toContain('Purger');
  });
});

describe('C2: level 5 — VESSEL:s valv keeps the B2 arena contract', () => {
  it('hosts VESSEL in the unchanged 40×16 arena rect', () => {
    const arena = spawnsOfKind(L05, 'boss')[0]!;
    expect(arena.boss).toBe('VESSEL');
    expect([arena.tx0, arena.ty0, arena.tx1, arena.ty1]).toEqual([36, 5, 75, 20]);
  });

  it('keeps the sealed exit inside the vault at its tested position', () => {
    const exit = spawnsOfKind(L05, 'exit')[0]!;
    expect([exit.tx, exit.ty]).toEqual([72, 20]);
  });

  it('is now a full approach: checkpoints, vault defenses and a route into the arena', () => {
    expect(validateLevelData(L05)).toEqual([]);
    expect(spawnsOfKind(L05, 'laser').length).toBeGreaterThanOrEqual(2); // valvförsvar
    expect(spawnsOfKind(L05, 'fragment').length).toBeGreaterThanOrEqual(10);
    // The approach leads in: ground route reaches the arena's left edge.
    expect(isReachable(L05, DOUBLE_JUMP_PROFILE, 36, 20)).toBe(true);
  });
});

describe('C2: level 6 — Glitchskeppet mirrors level 1, corrupted', () => {
  it('reuses the level-1 skeleton (same dimensions and exit column)', () => {
    const l1 = CAMPAIGN_LEVELS[0]!;
    expect(L06.widthTiles).toBe(l1.widthTiles);
    expect(L06.heightTiles).toBe(l1.heightTiles);
    expect(spawnsOfKind(L06, 'exit')[0]!.tx).toBe(spawnsOfKind(l1, 'exit')[0]!.tx);
  });

  it('corrupts platforms with flickering glitch tiles', () => {
    let glitchTiles = 0;
    for (const row of L06.tiles) {
      for (const tile of row) {
        if (tile === TileType.Glitch) glitchTiles += 1;
      }
    }
    expect(glitchTiles).toBeGreaterThanOrEqual(8);
  });

  it('is the harder mirror: all enemy types, denser than level 1', () => {
    const kinds = new Set(spawnsOfKind(L06, 'enemy').map((e) => e.enemy));
    expect(kinds.has('Drone')).toBe(true);
    expect(kinds.has('TunnelWorm')).toBe(true);
    expect(kinds.has('Glitcher')).toBe(true);
    expect(kinds.has('Purger')).toBe(true);
    expect(spawnsOfKind(L06, 'enemy').length).toBeGreaterThan(
      spawnsOfKind(CAMPAIGN_LEVELS[0]!, 'enemy').length,
    );
  });
});

describe('C2: level 7 — Utpost Aurora keeps the NULL contract', () => {
  it('hosts NULL in the unchanged arena rect behind the sealed exit', () => {
    const arena = spawnsOfKind(L07, 'boss')[0]!;
    expect(arena.boss).toBe('NULL');
    expect([arena.tx0, arena.ty0, arena.tx1, arena.ty1]).toEqual([36, 5, 75, 20]);
    const exit = spawnsOfKind(L07, 'exit')[0]!;
    expect([exit.tx, exit.ty]).toEqual([72, 20]);
  });

  it('gives a hopeful bright ending: gifts before the last fight', () => {
    const powerups = spawnsOfKind(L07, 'powerup').map((p) => p.powerup);
    expect(powerups).toContain('OneUp'); // extra liv på utsikten
    expect(powerups).toContain('TripleJump'); // trippelhopp inför sista hoppet
    expect(spawnsOfKind(L07, 'fragment').map((f) => f.fragment)).toContain('Philosophy');
  });
});

describe('C2: ghost level — gated at 150k total score', () => {
  it('lives outside the campaign flow so the win screen still lands after slot 7', () => {
    expect(GHOST_LEVEL.index).toBe(8);
    expect(CAMPAIGN_LEVELS.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PLAYABLE_LEVELS.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('unlocks exactly at the 150k threshold (inclusive)', () => {
    expect(GHOST_LEVEL_UNLOCK_SCORE).toBe(150_000);
    expect(isGhostLevelUnlocked(149_999)).toBe(false);
    expect(isGhostLevelUnlocked(150_000)).toBe(true);
    expect(newlyUnlockedGhostLevel(149_999, 150_000)).toBe(true);
    expect(newlyUnlockedGhostLayerGuard());
  });

  /** Monotonic guard: a decreasing total never (re-)grants the ghost level. */
  function newlyUnlockedGhostLayerGuard(): boolean {
    expect(newlyUnlockedGhostLevel(160_000, 100)).toBe(false);
    return true;
  }

  it('joins the playable list only once earned', () => {
    const before = playableLevelsForTotalScore(149_999);
    const after = playableLevelsForTotalScore(150_000);
    expect(before.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(after.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(after.at(-1)?.id).toBe(GHOST_LEVEL.id);
  });

  it('is a short hidden challenge that validates and is completable', () => {
    expect(validateLevelData(GHOST_LEVEL)).toEqual([]);
    expect(GHOST_LEVEL.parTimeSeconds).toBeLessThan(60);
    const exit = spawnsOfKind(GHOST_LEVEL, 'exit')[0]!;
    expect(isReachable(GHOST_LEVEL, DOUBLE_JUMP_PROFILE, exit.tx, exit.ty)).toBe(true);
  });
});

// ------------------------------------------------------------- hazards --

describe('C2: laser hazard kind parses and validates', () => {
  it('builder-produced laser grids pass validation with sane timings', () => {
    const b = new LevelBuilder(40, 12);
    b.ground(0, 39);
    b.laserGrid(10, 8, 14, 8, { periodMs: 2400, onMs: 700, offsetMs: 300 });
    b.spawn({ kind: 'playerSpawn', tx: 2, ty: 8 });
    b.spawn({ kind: 'exit', tx: 36, ty: 8 });
    b.spawn({ kind: 'checkpoint', tx: 20, ty: 8 });
    b.spawn({ kind: 'checkpoint', tx: 30, ty: 8 });
    const data = b.build({
      id: 'test-laser-parse',
      index: 1,
      name: 'Laser parse',
      theme: 'test',
      intro: 'ECHO: test.',
      parTimeSeconds: 45,
      fragmentTypes: ['Music'],
    });
    expect(validateLevelData(data)).toEqual([]);
    const laser = spawnsOfKind(data, 'laser')[0]!;
    expect(laser.periodMs).toBe(2400);
    expect(laser.onMs).toBe(700);
    expect(laser.offsetMs).toBe(300);
  });

  it('rejects inverted rects, bad rhythms and beams covering structural spawns', () => {
    const base = (): { b: LevelBuilder; build: () => LevelData } => {
      const b = new LevelBuilder(40, 12);
      b.ground(0, 39);
      b.spawn({ kind: 'playerSpawn', tx: 2, ty: 8 });
      b.spawn({ kind: 'exit', tx: 36, ty: 8 });
      b.spawn({ kind: 'checkpoint', tx: 20, ty: 8 });
      b.spawn({ kind: 'checkpoint', tx: 30, ty: 8 });
      return { b, build: () =>
        b.build({
          id: 'test-laser-bad',
          index: 1,
          name: 'Laser bad',
          theme: 'test',
          intro: 'ECHO: test.',
          parTimeSeconds: 45,
          fragmentTypes: ['Music'],
        }) };
    };

    const inverted = base();
    inverted.b.spawn({ kind: 'laser', tx0: 14, ty0: 8, tx1: 10, ty1: 8, periodMs: 1000, onMs: 400, offsetMs: 0 });
    expect(validateLevelData(inverted.build()).join(' ')).toMatch(/out of bounds or inverted/);

    const zeroPeriod = base();
    zeroPeriod.b.spawn({ kind: 'laser', tx0: 10, ty0: 8, tx1: 14, ty1: 8, periodMs: 0, onMs: 400, offsetMs: 0 });
    expect(validateLevelData(zeroPeriod.build()).join(' ')).toMatch(/periodMs > 0/);

    const alwaysOn = base();
    alwaysOn.b.spawn({ kind: 'laser', tx0: 10, ty0: 8, tx1: 14, ty1: 8, periodMs: 1000, onMs: 1000, offsetMs: 0 });
    expect(validateLevelData(alwaysOn.build()).join(' ')).toMatch(/0 < onMs < periodMs/);

    const unfair = base();
    unfair.b.spawn({ kind: 'laser', tx0: 19, ty0: 8, tx1: 21, ty1: 8, periodMs: 1000, onMs: 400, offsetMs: 0 });
    expect(validateLevelData(unfair.build()).join(' ')).toMatch(/covers checkpoint/);
  });

  it('maps phase math across the pulse: idle → telegraph → firing', () => {
    const grid = laserGridFromSpawn({
      kind: 'laser',
      tx0: 0,
      ty0: 0,
      tx1: 3,
      ty1: 0,
      periodMs: 2000,
      onMs: 500,
      offsetMs: 0,
    });
    expect(laserPhaseAt(grid, 0)).toBe('idle');
    expect(laserPhaseAt(grid, 1000)).toBe('telegraph'); // 1500−620 → warning window
    expect(laserPhaseAt(grid, 1800)).toBe('firing');
    expect(laserPhaseAt(grid, 2100)).toBe('idle'); // wrapped past the period edge
    // Offset shifts the whole rhythm: local t' = (t − offset) mod period.
    expect(laserPhaseAt({ ...grid, offsetMs: 750 }, 1750)).toBe('telegraph'); // t' = 1000
    expect(laserPhaseAt({ ...grid, offsetMs: 750 }, 2350)).toBe('firing'); // t' = 1600
    // Negative time wraps safely into the pre-offset rhythm.
    expect(laserPhaseAt(grid, -200)).toBe('firing');
  });
});

describe('C2: glitch tile kind parses and pulses deterministically', () => {
  it("the ASCII parser maps '%' to glitch tiles", () => {
    const data = parseAsciiLevel('test-glitch', 'Glitch parse', ['=====',
      '..%..'], { index: 1, fragmentTypes: ['Music'] });
    expect(data.tiles[1]?.[2]).toBe(TileType.Glitch);
  });

  it('holds solid for GLITCH_SOLID_MS of every GLITCH_CYCLE_MS', () => {
    expect(glitchSolidAt(0)).toBe(true);
    expect(glitchSolidAt(GLITCH_SOLID_MS - 1)).toBe(true);
    expect(glitchSolidAt(GLITCH_SOLID_MS)).toBe(false);
    expect(glitchSolidAt(GLITCH_CYCLE_MS - 1)).toBe(false);
    expect(glitchSolidAt(GLITCH_CYCLE_MS)).toBe(true); // cycle repeats
  });

  it('carries AURORA while solid and drops her when the pulse turns empty', () => {
    const session = makeMiniGlitchSession();
    const stepMs = 1000 / 120;

    // Park her on the glitch bridge during the solid phase.
    session.player.x = 7 * 32 + 16 - session.player.width / 2;
    session.player.y = 9 * 32 - session.player.height;
    let sawGroundedWhileSolid = false;
    let fellWhenEmpty = false;
    for (let steps = 0; steps < 260 && session.status === 'playing'; steps++) {
      session.update(stepMs, emptyPlayerInput());
      if (session.level.glitchTilesSolid && session.timeMs < GLITCH_SOLID_MS) {
        sawGroundedWhileSolid ||= session.player.grounded;
      }
      if (session.timeMs > GLITCH_SOLID_MS + 120) {
        fellWhenEmpty = !session.player.grounded || session.lives < STARTING_LIVES;
      }
    }
    expect(sawGroundedWhileSolid).toBe(true);
    expect(fellWhenEmpty).toBe(true);
  });
});

// --------------------------------------------------- gameplay: damage --

describe('C2: laser grids damage AURORA while firing', () => {
  it('hurts only during the firing window (i-frames respected)', () => {
    const session = makeMiniLaserSession();
    const beam = session.lasers[0]!;
    // Park on the ground inside the beam's column span.
    session.player.x = beam.x + beam.width / 2 - session.player.width / 2;
    session.player.y = 9 * 32 - session.player.height;

    // Idle phase: stepping through the first 500ms must be safe.
    while (session.timeMs < 500 && session.status === 'playing') {
      session.update(1000 / 120, emptyPlayerInput());
    }
    expect(session.lives).toBe(STARTING_LIVES);
    expect(session.firingLaserBoxes().length).toBe(0);

    // Ride out the telegraph into the firing window: she takes the hit.
    // (The first firing instant can coincide with the tail of spawn
    // i-frames — the hit lands on the next pulse either way.)
    let sawFiringBeam = false;
    const stepMs = 1000 / 120;
    for (let steps = 0; steps < 500 && session.status === 'playing'; steps++) {
      session.update(stepMs, emptyPlayerInput());
      const centerY = session.player.centerY;
      sawFiringBeam ||= session
        .firingLaserBoxes()
        .some((b) => b.y <= centerY && centerY <= b.y + b.height);
      if (session.lives < STARTING_LIVES) break;
    }
    expect(sawFiringBeam).toBe(true);
    expect(session.lives).toBeLessThan(STARTING_LIVES);
  });

  it('is harmless when AURORA stays clear of the beam rect', () => {
    const session = makeMiniLaserSession();
    session.player.x = 30 * 32;
    session.player.y = 9 * 32 - session.player.height;
    for (let steps = 0; steps < 360 && session.status === 'playing'; steps++) {
      session.update(1000 / 120, emptyPlayerInput());
    }
    expect(session.lives).toBe(STARTING_LIVES);
    expect(session.status).toBe('playing');
  });
});

// ------------------------------------------------------------ helpers --

/** Flat test level with one timed horizontal beam at walk height. */
function makeMiniLaserSession(): GameSession {
  const b = new LevelBuilder(40, 12);
  b.ground(0, 39);
  b.spawn({ kind: 'playerSpawn', tx: 2, ty: 8 });
  b.spawn({ kind: 'exit', tx: 36, ty: 8 });
  b.spawn({ kind: 'checkpoint', tx: 24, ty: 8 });
  b.spawn({ kind: 'checkpoint', tx: 33, ty: 8 });
  // Beam parked away from the checkpoints: cols 12–16 at walk height.
  b.spawn({ kind: 'laser', tx0: 12, ty0: 8, tx1: 16, ty1: 8, periodMs: 1000, onMs: 400, offsetMs: 0 });
  return new GameSession({ levelData: finish(b), seed: 0xc2c2 });
}

/** Test level with a glitch bridge over a hazard pit. */
function makeMiniGlitchSession(): GameSession {
  const b = new LevelBuilder(24, 12);
  b.ground(0, 4);
  b.hazardPit(5, 10);
  b.set(6, 9, TileType.Glitch);
  b.set(7, 9, TileType.Glitch);
  b.set(8, 9, TileType.Glitch);
  b.ground(11, 23);
  b.spawn({ kind: 'playerSpawn', tx: 2, ty: 8 });
  b.spawn({ kind: 'exit', tx: 20, ty: 8 });
  b.spawn({ kind: 'checkpoint', tx: 13, ty: 8 });
  b.spawn({ kind: 'checkpoint', tx: 17, ty: 8 });
  return new GameSession({ levelData: finish(b), seed: 0xc2c2 });
}

function finish(b: LevelBuilder): LevelData {
  return b.build({
    id: 'test-hazard-mini',
    index: 1,
    name: 'Hazard mini',
    theme: 'test',
    intro: 'ECHO: test.',
    parTimeSeconds: 45,
    fragmentTypes: ['Music'],
  });
}
