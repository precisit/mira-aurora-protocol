import type {
  AbilityUnlockName,
  EnemyTypeName,
  FragmentTypeName,
  PowerupTypeName,
} from '../game/entities';
import { FRAGMENT_ORDER } from '../game/entities';
import type { BossId } from '../game/bosses';

/**
 * Tilemap level format (task A2, PLAN.md §6): tilemap-based levels with
 * 32 px tiles, authored as data-driven TS modules in src/levels. A level is
 *   1. a tile layer        — {@link LevelData.tiles},
 *   2. an entity spawn layer — {@link LevelData.spawns} (enemies, powerups,
 *      fragments, checkpoints, player spawn, exit), and
 *   3. metadata             — name/theme/intro/par time/fragment types.
 * Later waves may convert from Tiled into this same structure.
 */

/** Edge length of one tile, in world pixels. */
export const TILE_SIZE = 32;

export enum TileType {
  Empty = 0,
  /** Fully solid block — blocks movement from all sides. */
  Solid = 1,
  /** One-way platform — solid only when landing from above. */
  Platform = 2,
  /** Instant-death hazard (energy field / pit floor). */
  Hazard = 3,
  /**
   * Corrupt platform (level 6, task C2): flickers between solid and empty on
   * the fixed {@link GLITCH_CYCLE_MS} cycle (see {@link glitchSolidAt}).
   * Static analysis treats it as ground — a patient AURORA can always cross
   * by waiting out the pulse.
   */
  Glitch = 4,
}

// ------------------------------------------------------------ glitch tiles --

/** Length of one full solid↔empty corruption pulse, in ms. */
export const GLITCH_CYCLE_MS = 1900;
/** How long of each cycle a glitch tile holds solidity, in ms. */
export const GLITCH_SOLID_MS = 1050;

/**
 * Pure glitch-phase math shared by physics, validation and rendering:
 * true while glitch tiles are solid at `timeMs`. Deterministic so level
 * tests can step straight into either phase.
 */
export function glitchSolidAt(timeMs: number): boolean {
  const t = Math.max(0, timeMs) % GLITCH_CYCLE_MS;
  return t < GLITCH_SOLID_MS;
}

// ------------------------------------------------------------- spawn layer --

/**
 * One entry in the entity spawn layer. Structural spawns (player spawn,
 * checkpoint, exit) are unique/structural; the rest reference gameplay
 * entities by type name (see src/game/entities.ts descriptors).
 */
export type LevelSpawn =
  | { kind: 'playerSpawn'; tx: number; ty: number }
  | { kind: 'checkpoint'; tx: number; ty: number }
  | { kind: 'exit'; tx: number; ty: number }
  | { kind: 'unlock'; unlock: AbilityUnlockName; tx: number; ty: number }
  | { kind: 'powerup'; powerup: PowerupTypeName; tx: number; ty: number }
  | { kind: 'enemy'; enemy: EnemyTypeName; tx: number; ty: number }
  | { kind: 'fragment'; fragment: FragmentTypeName; tx: number; ty: number }
  /**
   * Boss room (task B2): inclusive tile rect of the arena. GameSession arms
   * the encounter when AURORA steps inside — the boss spawns, the camera
   * locks to these bounds and the exit stays sealed until the boss falls.
   */
  | { kind: 'boss'; boss: BossId; tx0: number; ty0: number; tx1: number; ty1: number }
  /**
   * Timed laser grid (task C2, level 4): an inclusive tile rect that pulses
   * on a fixed rhythm — off (with a telegraph before firing), then a damaging
   * beam for `onMs` every `periodMs`, shifted by `offsetMs`. Damage + visual
   * support lives in src/game/lasers.ts and GameSession.
   */
  | {
      kind: 'laser';
      tx0: number;
      ty0: number;
      tx1: number;
      ty1: number;
      periodMs: number;
      onMs: number;
      offsetMs: number;
    };

// ---------------------------------------------------------------- metadata --

export interface LevelData {
  id: string;
  /** 1-based campaign slot (1–7 per PLAN.md §4 level table). */
  index: number;
  name: string;
  theme: string;
  /** ECHO intro line shown at level start. */
  intro: string;
  /** Target completion time in seconds (speedrun reference). */
  parTimeSeconds: number;
  /** Archive themes featured by this level's memory fragments. */
  fragmentTypes: FragmentTypeName[];
  widthTiles: number;
  heightTiles: number;
  /**
   * Row-major grid: `tiles[y][x]`, values are {@link TileType}.
   * World origin is the top-left corner of tile (0,0); +Y points down.
   */
  tiles: TileType[][];
  spawns: LevelSpawn[];
}

// ------------------------------------------------------------ ASCII format --
//
// Hand-authored levels can also be written as ASCII rows (Tiled-export
// friendly): one character per tile.
//
//   Tiles     '.' empty · '#' solid · '=' platform · '^' hazard · '%' glitch
//   Structure 'S' player spawn · 'C' checkpoint · 'G' exit
//   Unlock    'J' double-jump unlock (permanent, story pickup)
//   Powerups  'O' Overcharge · 'V' Shield · 'M' Magnet · 'T' TripleJump · 'U' 1Up
//   Enemies   'd' Drone · 'w' TunnelWorm · 'g' Glitcher · 'p' Purger
//   Fragments '1'Music '2'Science '3'Language '4'Art '5'History '6'Medicine '7'Philosophy
//
// Rows are padded to equal length; unknown characters are treated as empty.

export const ASCII_TILES: Readonly<Record<string, TileType>> = {
  '#': TileType.Solid,
  '=': TileType.Platform,
  '^': TileType.Hazard,
  '%': TileType.Glitch,
};

/** ASCII char → spawn factory, shared by the parser and tooling. */
export const SPAWN_CHARS: Record<string, (tx: number, ty: number) => LevelSpawn> = {
  S: (tx, ty) => ({ kind: 'playerSpawn', tx, ty }),
  C: (tx, ty) => ({ kind: 'checkpoint', tx, ty }),
  G: (tx, ty) => ({ kind: 'exit', tx, ty }),
  J: (tx, ty) => ({ kind: 'unlock', unlock: 'DoubleJumpUnlock', tx, ty }),
  O: (tx, ty) => ({ kind: 'powerup', powerup: 'Overcharge', tx, ty }),
  V: (tx, ty) => ({ kind: 'powerup', powerup: 'Shield', tx, ty }),
  M: (tx, ty) => ({ kind: 'powerup', powerup: 'Magnet', tx, ty }),
  T: (tx, ty) => ({ kind: 'powerup', powerup: 'TripleJump', tx, ty }),
  U: (tx, ty) => ({ kind: 'powerup', powerup: 'OneUp', tx, ty }),
  d: (tx, ty) => ({ kind: 'enemy', enemy: 'Drone', tx, ty }),
  w: (tx, ty) => ({ kind: 'enemy', enemy: 'TunnelWorm', tx, ty }),
  g: (tx, ty) => ({ kind: 'enemy', enemy: 'Glitcher', tx, ty }),
  p: (tx, ty) => ({ kind: 'enemy', enemy: 'Purger', tx, ty }),
};

// Fragments '1'–'7' follow the archive-theme value order.
for (const [i, fragment] of FRAGMENT_ORDER.entries()) {
  SPAWN_CHARS[String(i + 1)] = (tx, ty) => ({ kind: 'fragment', fragment, tx, ty });
}
