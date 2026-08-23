import type { Vec2 } from '../game/entities';
import type { FragmentTypeName } from '../game/entities';
import {
  ASCII_TILES,
  SPAWN_CHARS,
  TILE_SIZE,
  TileType,
  glitchSolidAt,
  type LevelData,
  type LevelSpawn,
} from './LevelData';

/**
 * Runtime view over immutable {@link LevelData}: coordinate conversion and
 * tile queries. All conversions operate on world pixels (top-left origin,
 * +Y down) and tile indices.
 *
 * Glitch tiles (task C2) are the one mutable wrinkle: the session syncs the
 * corruption clock each step via {@link syncGlitchTiles} and solidity /
 * standing queries then answer per {@link glitchSolidAt}. Raw tile data is
 * never modified — validation, reachability and rendering keep seeing it.
 */
export class Level {
  /** Current corruption phase: true while glitch tiles behave as solid. */
  private glitchPhaseSolid = true;

  public constructor(public readonly data: LevelData) {}

  public get widthTiles(): number {
    return this.data.widthTiles;
  }

  public get heightTiles(): number {
    return this.data.heightTiles;
  }

  /** Level size in world pixels. */
  public get pixelWidth(): number {
    return this.data.widthTiles * TILE_SIZE;
  }

  public get pixelHeight(): number {
    return this.data.heightTiles * TILE_SIZE;
  }

  // -------------------------------------------------------- conversions --

  /** World X (px) → tile column via floor division (handles negatives). */
  public static worldToTileX(worldX: number): number {
    return Math.floor(worldX / TILE_SIZE);
  }

  /** World Y (px) → tile row via floor division (handles negatives). */
  public static worldToTileY(worldY: number): number {
    return Math.floor(worldY / TILE_SIZE);
  }

  /** Tile column → left edge of that tile in world px. */
  public static tileToWorldX(tx: number): number {
    return tx * TILE_SIZE;
  }

  /** Tile row → top edge of that tile in world px. */
  public static tileToWorldY(ty: number): number {
    return ty * TILE_SIZE;
  }

  /** Center point of the given tile in world px. */
  public static tileCenter(tx: number, ty: number): Vec2 {
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
  }

  // ------------------------------------------------------------- queries --

  /** Advance the corruption clock (called once per fixed step by GameSession). */
  public syncGlitchTiles(timeMs: number): void {
    this.glitchPhaseSolid = glitchSolidAt(timeMs);
  }

  /** True while glitch tiles currently behave as solid (rendering/debug). */
  public get glitchTilesSolid(): boolean {
    return this.glitchPhaseSolid;
  }

  /** True when the tile blocks movement right now (glitch honors its phase). */
  public blocksMovementAtTile(tx: number, ty: number): boolean {
    const tile = this.tileAt(tx, ty);
    if (tile === TileType.Solid) return true;
    return tile === TileType.Glitch && this.glitchPhaseSolid;
  }

  /** True when AURORA could stand on this tile position right now. */
  public supportsStandingAtTile(tx: number, ty: number): boolean {
    const tile = this.tileAt(tx, ty);
    if (tile === TileType.Solid || tile === TileType.Platform) return true;
    return tile === TileType.Glitch && this.glitchPhaseSolid;
  }

  /**
   * Tile at (tx, ty). Out-of-bounds policy: left/right/below the level is
   * Solid (invisible walls and floor); above the level is open sky.
   */
  public tileAt(tx: number, ty: number): TileType {
    if (tx < 0 || tx >= this.data.widthTiles || ty >= this.data.heightTiles) {
      return TileType.Solid;
    }
    if (ty < 0) return TileType.Empty; // sky above
    const row = this.data.tiles[ty];
    const tile = row?.[tx];
    return tile ?? TileType.Empty;
  }

  /** True for tiles that block movement on all sides. */
  public isSolidAtTile(tx: number, ty: number): boolean {
    return this.blocksMovementAtTile(tx, ty);
  }

  /** Convenience: sample solidity at an arbitrary world-space point. */
  public isSolidAtWorld(worldX: number, worldY: number): boolean {
    return this.isSolidAtTile(Level.worldToTileX(worldX), Level.worldToTileY(worldY));
  }

  // -------------------------------------------------------------- spawns --

  /** All spawns of a given kind, in authoring order. */
  public spawnsOf<K extends LevelSpawn['kind']>(kind: K): Extract<LevelSpawn, { kind: K }>[] {
    return this.data.spawns.filter((s): s is Extract<LevelSpawn, { kind: K }> => s.kind === kind);
  }

  /** Player spawn as world px (tile center), or undefined if missing. */
  public spawnPoint(): Vec2 | undefined {
    const spawn = this.data.spawns.find((s) => s.kind === 'playerSpawn');
    return spawn ? Level.tileCenter(spawn.tx, spawn.ty) : undefined;
  }

  /** First checkpoint world position, or undefined. */
  public firstCheckpointWorld(): Vec2 | undefined {
    const checkpoint = this.data.spawns.find((s) => s.kind === 'checkpoint');
    return checkpoint ? Level.tileCenter(checkpoint.tx, checkpoint.ty) : undefined;
  }

  /** Exit world position, or undefined. */
  public exitPoint(): Vec2 | undefined {
    const exit = this.data.spawns.find((s) => s.kind === 'exit');
    return exit ? Level.tileCenter(exit.tx, exit.ty) : undefined;
  }
}

// ------------------------------------------------------------------ parsing --

/** Optional metadata for {@link parseAsciiLevel} (defaults keep it cheap for tests/tools). */
export interface AsciiLevelMeta {
  index?: number;
  theme?: string;
  intro?: string;
  parTimeSeconds?: number;
  fragmentTypes?: FragmentTypeName[];
}

/**
 * Build a {@link LevelData} from ASCII rows (see legend in LevelData.ts).
 * Rows are padded/truncated to the longest row; tile characters become tiles
 * and every other legend character becomes an entry on the spawn layer.
 */
export function parseAsciiLevel(
  id: string,
  name: string,
  rows: readonly string[],
  meta: AsciiLevelMeta = {},
): LevelData {
  if (rows.length === 0) throw new Error(`Level "${id}": no rows`);
  const width = Math.max(...rows.map((r) => r.length));

  const tiles: TileType[][] = [];
  const spawns: LevelSpawn[] = [];

  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? '';
    const gridRow: TileType[] = [];
    for (let x = 0; x < width; x++) {
      const ch = x < row.length ? (row[x] ?? '.') : '.';
      const spawnFactory = SPAWN_CHARS[ch];
      if (spawnFactory) {
        spawns.push(spawnFactory(x, y));
        gridRow.push(TileType.Empty);
        continue;
      }
      gridRow.push(ASCII_TILES[ch] ?? TileType.Empty);
    }
    tiles.push(gridRow);
  }

  return {
    id,
    index: meta.index ?? 0,
    name,
    theme: meta.theme ?? '',
    intro: meta.intro ?? '',
    parTimeSeconds: meta.parTimeSeconds ?? 60,
    fragmentTypes: meta.fragmentTypes ?? [],
    widthTiles: width,
    heightTiles: tiles.length,
    tiles,
    spawns,
  };
}
