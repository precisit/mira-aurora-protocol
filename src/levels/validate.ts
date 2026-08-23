import type { LevelData, LevelSpawn } from './LevelData';
import { TileType } from './LevelData';

/**
 * Static authoring validation for {@link LevelData} (task A2). Returns a list
 * of human-readable issues; an empty list means the level is well-formed.
 * Tests run this over every campaign level; tooling can reuse it in-editor.
 */

/** Structural spawns that must rest on standable ground. */
const STRUCTURAL_KINDS: ReadonlySet<LevelSpawn['kind']> = new Set([
  'playerSpawn',
  'checkpoint',
  'exit',
]);

export function tileAt(data: LevelData, tx: number, ty: number): TileType {
  if (tx < 0 || tx >= data.widthTiles || ty < 0 || ty >= data.heightTiles) return TileType.Empty;
  return data.tiles[ty]?.[tx] ?? TileType.Empty;
}

export function inBounds(data: LevelData, tx: number, ty: number): boolean {
  return tx >= 0 && tx < data.widthTiles && ty >= 0 && ty < data.heightTiles;
}

/**
 * A cell is "standable" when it is empty and has solid ground or a one-way
 * platform directly beneath it — where AURORA can stand.
 */
export function isStandableCell(data: LevelData, tx: number, ty: number): boolean {
  if (!inBounds(data, tx, ty)) return false;
  if (tileAt(data, tx, ty) !== TileType.Empty) return false;
  const below = ty + 1 >= data.heightTiles ? TileType.Solid : tileAt(data, tx, ty + 1);
  return below === TileType.Solid || below === TileType.Platform;
}

export function validateLevelData(data: LevelData): string[] {
  const issues: string[] = [];
  const where = `level "${data.id}"`;

  // --- metadata ------------------------------------------------------------
  if (!data.name.trim()) issues.push(`${where}: missing name`);
  if (!data.theme.trim()) issues.push(`${where}: missing theme`);
  if (!data.intro.trim()) issues.push(`${where}: missing ECHO intro`);
  if (!(data.parTimeSeconds > 0)) issues.push(`${where}: par time must be > 0`);
  if (!Number.isInteger(data.index) || data.index < 1) {
    issues.push(`${where}: campaign index must be a positive integer`);
  }
  if (data.fragmentTypes.length === 0) issues.push(`${where}: no fragment types listed`);

  // --- tile layer ------------------------------------------------------------
  if (data.tiles.length !== data.heightTiles) {
    issues.push(`${where}: tiles has ${data.tiles.length} rows, expected ${data.heightTiles}`);
  }
  data.tiles.forEach((row, y) => {
    if (row.length !== data.widthTiles) {
      issues.push(`${where}: row ${y} has ${row.length} columns, expected ${data.widthTiles}`);
    }
  });

  // --- spawn layer -----------------------------------------------------------
  const count = (kind: LevelSpawn['kind']): number =>
    data.spawns.filter((s) => s.kind === kind).length;

  if (count('playerSpawn') !== 1) issues.push(`${where}: needs exactly 1 playerSpawn`);
  if (count('exit') !== 1) issues.push(`${where}: needs exactly 1 exit`);
  const checkpoints = data.spawns.filter((s) => s.kind === 'checkpoint');
  if (checkpoints.length < 2 || checkpoints.length > 4) {
    issues.push(`${where}: needs 2–4 checkpoints, found ${checkpoints.length}`);
  }

  for (const spawn of data.spawns) {
    // Boss arenas are tile rects with their own checks below.
    if (spawn.kind === 'boss') continue;
    const label = `${spawn.kind}@(${spawn.tx},${spawn.ty})`;
    if (!inBounds(data, spawn.tx, spawn.ty)) {
      issues.push(`${where}: spawn ${label} out of bounds`);
      continue;
    }
    if (tileAt(data, spawn.tx, spawn.ty) === TileType.Hazard) {
      issues.push(`${where}: spawn ${label} sits inside hazard`);
      continue;
    }
    const structural = STRUCTURAL_KINDS.has(spawn.kind);
    if (structural && !isStandableCell(data, spawn.tx, spawn.ty)) {
      issues.push(`${where}: spawn ${label} is not standable (needs floor below)`);
    }
    if (!structural && tileAt(data, spawn.tx, spawn.ty) === TileType.Solid) {
      issues.push(`${where}: spawn ${label} embedded inside solid tile`);
    }
  }

  // --- boss arenas (task B2): at most one, sane rect, open interior ---------
  const arenas = data.spawns.filter((s): s is Extract<LevelSpawn, { kind: 'boss' }> => s.kind === 'boss');
  if (arenas.length > 1) issues.push(`${where}: more than one boss arena`);
  for (const arena of arenas) {
    const label = `boss arena "${arena.boss}"`;
    const cornersInBounds =
      inBounds(data, arena.tx0, arena.ty0) &&
      inBounds(data, arena.tx1, arena.ty1) &&
      arena.tx1 >= arena.tx0 &&
      arena.ty1 >= arena.ty0;
    if (!cornersInBounds) {
      issues.push(`${where}: ${label} rect out of bounds or inverted`);
      continue;
    }
    const widthTiles = arena.tx1 - arena.tx0 + 1;
    const heightTiles = arena.ty1 - arena.ty0 + 1;
    if (widthTiles < MIN_ARENA_TILES || heightTiles < MIN_ARENA_TILES) {
      issues.push(
        `${where}: ${label} is ${widthTiles}×${heightTiles} tiles, needs ≥${MIN_ARENA_TILES} per side`,
      );
    }
    let solidTiles = 0;
    for (let ty = arena.ty0; ty <= arena.ty1; ty++) {
      for (let tx = arena.tx0; tx <= arena.tx1; tx++) {
        if (tileAt(data, tx, ty) === TileType.Solid) solidTiles += 1;
      }
    }
    if (solidTiles > 0) {
      issues.push(`${where}: ${label} contains ${solidTiles} solid tiles (keep the fight open)`);
    }
  }

  // Checkpoints must lie ahead of the spawn and be ordered left→right.
  const spawnEntry = data.spawns.find((s) => s.kind === 'playerSpawn');
  const checkpointXs = checkpoints.map((c) => c.tx).sort((a, b) => a - b);
  if (spawnEntry) {
    for (const cx of checkpointXs) {
      if (cx <= spawnEntry.tx) issues.push(`${where}: checkpoint at x=${cx} not ahead of spawn`);
    }
  }

  return issues;
}

/** Smallest allowed arena side, in tiles (a fight needs room to dodge). */
const MIN_ARENA_TILES = 12;
