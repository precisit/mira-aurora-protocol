import { describe, expect, it } from 'vitest';
import {
  DOUBLE_JUMP_PROFILE,
  SINGLE_JUMP_PROFILE,
  isReachable,
  reachableFrom,
} from '../src/levels/Reachability';
import { CAMPAIGN_LEVELS, LEVEL_COUNT, getLevel } from '../src/levels/levels';
import { validateLevelData } from '../src/levels/validate';
import { type LevelData, type LevelSpawn, TileType } from '../src/levels/LevelData';
import {
  ENEMIES,
  FRAGMENT_ORDER,
  FRAGMENT_POINT_VALUES,
  POWERUPS,
} from '../src/game/entities';

const levels = CAMPAIGN_LEVELS.map((data) => ({ data }));

function spawnsOfKind<K extends LevelSpawn['kind']>(
  data: LevelData,
  kind: K,
): Extract<LevelSpawn, { kind: K }>[] {
  return data.spawns.filter(
    (s): s is Extract<LevelSpawn, { kind: K }> => s.kind === kind,
  );
}

describe('A1: campaign registry', () => {
  it('ships the first three of seven planned levels', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(3);
    expect(LEVEL_COUNT).toBe(7);
    expect(CAMPAIGN_LEVELS.map((l) => l.index)).toEqual([1, 2, 3]);
  });

  it('matches the PLAN.md level table for 1–3', () => {
    const [l1, l2, l3] = CAMPAIGN_LEVELS;
    expect(l1?.name).toBe('Mnemosynes fall');
    expect(l1?.theme).toBe('Rymdstationsruin');
    expect(l2?.name).toBe('Datastormen');
    expect(l2?.theme).toBe('Korrupt datastorm');
    expect(l3?.name).toBe('XENO-tunneln');
    expect(l3?.theme).toBe('Svärmens tunnel');
  });

  it('resolves levels by index and rejects unknown ones', () => {
    expect(getLevel(2)?.id).toBe('lvl-02-datastormen');
    expect(() => getLevel(4)).toThrow(/no level with index 4/);
    expect(() => getLevel(0)).toThrow();
  });

  it('gives every level unique ids and non-empty ECHO intros', () => {
    const ids = new Set(CAMPAIGN_LEVELS.map((l) => l.id));
    expect(ids.size).toBe(3);
    for (const level of CAMPAIGN_LEVELS) {
      expect(level.intro.length).toBeGreaterThan(10);
      expect(level.intro).toContain('ECHO:');
    }
  });
});

describe('A2: all levels parse and pass static validation', () => {
  for (const { data } of levels) {
    it(`"${data.name}" is well-formed`, () => {
      expect(validateLevelData(data)).toEqual([]);
    });

    it(`"${data.name}" has a rectangular tile layer`, () => {
      expect(data.tiles).toHaveLength(data.heightTiles);
      for (const row of data.tiles) {
        expect(row).toHaveLength(data.widthTiles);
        for (const tile of row) {
          expect(Object.values(TileType)).toContain(tile);
        }
      }
    });

    it(`"${data.name}" has spawn + exit and sane metadata`, () => {
      expect(spawnsOfKind(data, 'playerSpawn')).toHaveLength(1);
      expect(spawnsOfKind(data, 'exit')).toHaveLength(1);
      expect(data.parTimeSeconds).toBeGreaterThan(30);
      expect(data.parTimeSeconds).toBeLessThan(180); // 1–2 min per PLAN.md
      expect(data.fragmentTypes.length).toBeGreaterThan(0);
      for (const t of data.fragmentTypes) {
        expect(FRAGMENT_ORDER).toContain(t);
      }
    });

    it(`"${data.name}" has 2–4 checkpoints ahead of the spawn, in bounds`, () => {
      const checkpoints = spawnsOfKind(data, 'checkpoint');
      const spawn = spawnsOfKind(data, 'playerSpawn')[0];
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(checkpoints.length).toBeLessThanOrEqual(4);
      for (const c of checkpoints) {
        expect(c.tx).toBeGreaterThan(0);
        expect(c.tx).toBeLessThan(data.widthTiles - 1);
        expect(c.ty).toBeGreaterThanOrEqual(0);
        expect(c.ty).toBeLessThan(data.heightTiles);
        if (spawn) expect(c.tx).toBeGreaterThan(spawn.tx);
      }
      const xs = checkpoints.map((c) => c.tx);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    });

    it(`"${data.name}" keeps every spawn inside bounds on a free tile`, () => {
      for (const s of data.spawns) {
        if (s.kind === 'boss') continue; // tile-rect arena, checked in bosses tests
        expect(s.tx).toBeGreaterThanOrEqual(0);
        expect(s.tx).toBeLessThan(data.widthTiles);
        expect(s.ty).toBeGreaterThanOrEqual(0);
        expect(s.ty).toBeLessThan(data.heightTiles);
        const tile = data.tiles[s.ty]?.[s.tx];
        expect(tile).not.toBe(TileType.Solid);
        expect(tile).not.toBe(TileType.Hazard);
      }
    });

    it(`"${data.name}" only references defined entity types with PLAN.md values`, () => {
      for (const s of data.spawns) {
        if (s.kind === 'enemy') expect(Object.keys(ENEMIES)).toContain(s.enemy);
        if (s.kind === 'powerup') expect(Object.keys(POWERUPS)).toContain(s.powerup);
        if (s.kind === 'fragment') {
          expect(Object.keys(FRAGMENT_POINT_VALUES)).toContain(s.fragment);
          expect(FRAGMENT_POINT_VALUES[s.fragment]).toBeDefined();
        }
      }
    });

    it(`"${data.name}" features its declared fragment themes`, () => {
      const placed = new Set(spawnsOfKind(data, 'fragment').map((s) => s.fragment));
      expect(placed.size).toBeGreaterThan(0);
      for (const theme of placed) {
        expect(data.fragmentTypes).toContain(theme);
      }
    });
  }

  it('uses the documented point values', () => {
    expect(FRAGMENT_POINT_VALUES).toEqual({
      Music: 10,
      Science: 25,
      Language: 40,
      Art: 50,
      History: 60,
      Medicine: 75,
      Philosophy: 100,
    });
  });
});

describe('A3: reachability', () => {
  it('level 1 (tutorial) is completable with only a single jump', () => {
    const data = CAMPAIGN_LEVELS[0]!;
    const exit = spawnsOfKind(data, 'exit')[0]!;
    expect(isReachable(data, SINGLE_JUMP_PROFILE, exit.tx, exit.ty)).toBe(true);
  });

  it('level 1 needs no double-jump unlock', () => {
    expect(spawnsOfKind(CAMPAIGN_LEVELS[0]!, 'unlock')).toHaveLength(0);
  });

  it('every checkpoint in every level is reachable from spawn', () => {
    for (const data of CAMPAIGN_LEVELS) {
      const profile = data.index === 1 ? SINGLE_JUMP_PROFILE : DOUBLE_JUMP_PROFILE;
      const seen = reachableFrom(data, profile);
      for (const c of spawnsOfKind(data, 'checkpoint')) {
        expect(seen[c.ty]?.[c.tx], `${data.name}: checkpoint (${c.tx},${c.ty})`).toBe(true);
      }
    }
  });

  it('level 2 gates progress behind an early double-jump unlock', () => {
    const data = CAMPAIGN_LEVELS[1]!;
    const unlocks = spawnsOfKind(data, 'unlock');
    expect(unlocks).toHaveLength(1);
    const unlock = unlocks[0]!;
    // Near the start — well before the first double-jump wall at x=16.
    expect(unlock.unlock).toBe('DoubleJumpUnlock');
    expect(unlock.tx).toBeLessThanOrEqual(15);
    expect(unlock.ty).toBeGreaterThan(10); // standing height, not sky-high
  });

  it('level 2 exit requires double jump: unreachable single, reachable double', () => {
    const data = CAMPAIGN_LEVELS[1]!;
    const exit = spawnsOfKind(data, 'exit')[0]!;
    expect(isReachable(data, SINGLE_JUMP_PROFILE, exit.tx, exit.ty)).toBe(false);
    expect(isReachable(data, DOUBLE_JUMP_PROFILE, exit.tx, exit.ty)).toBe(true);
  });

  it('levels 2 and 3 are completable with the double jump', () => {
    for (const data of [CAMPAIGN_LEVELS[1]!, CAMPAIGN_LEVELS[2]!]) {
      const exit = spawnsOfKind(data, 'exit')[0]!;
      expect(isReachable(data, DOUBLE_JUMP_PROFILE, exit.tx, exit.ty)).toBe(true);
    }
  });
});

describe('A4: per-level design intent', () => {
  it('level 1 stays gentle: drones only, few enemies', () => {
    const data = CAMPAIGN_LEVELS[0]!;
    const enemies = spawnsOfKind(data, 'enemy');
    expect(enemies.length).toBeLessThanOrEqual(8);
    for (const e of enemies) {
      expect(e.enemy).toBe('Drone');
    }
    // Tutorial teaches collecting: plenty of cheap fragments.
    const fragments = spawnsOfKind(data, 'fragment');
    expect(fragments.length).toBeGreaterThanOrEqual(15);
  });

  it('level 2 introduces glitchers and rewards exploration', () => {
    const data = CAMPAIGN_LEVELS[1]!;
    const enemies = spawnsOfKind(data, 'enemy').map((e) => e.enemy);
    expect(enemies).toContain('Drone');
    expect(enemies).toContain('Glitcher');
    expect(spawnsOfKind(data, 'powerup').length).toBeGreaterThanOrEqual(3);
  });

  it('level 3 is the fast tunnel: all enemy types, dense pressure, 4 checkpoints', () => {
    const data = CAMPAIGN_LEVELS[2]!;
    const kinds = new Set(spawnsOfKind(data, 'enemy').map((e) => e.enemy));
    for (const type of Object.keys(ENEMIES)) {
      expect(kinds.has(type as keyof typeof ENEMIES), `missing ${type}`).toBe(true);
    }
    expect(spawnsOfKind(data, 'enemy').length).toBeGreaterThanOrEqual(20);
    expect(spawnsOfKind(data, 'checkpoint')).toHaveLength(4);
    // Faster pace → tighter par time than level 2.
    expect(data.parTimeSeconds).toBeLessThan(CAMPAIGN_LEVELS[1]!.parTimeSeconds);
    // The swarm hoards the most valuable memories.
    expect(data.fragmentTypes).toContain('Philosophy');
    expect(spawnsOfKind(data, 'powerup')).toHaveLength(2); // Shield + TripleJump
  });
});
