import type { Vec2 } from '../game/entities';
import {
  ASCII_MARKERS,
  ASCII_TILES,
  TILE_SIZE,
  TileType,
  type LevelData,
  type LevelMarker,
} from './LevelData';

/**
 * Runtime view over immutable {@link LevelData}: coordinate conversion and
 * tile queries. All conversions operate on world pixels (top-left origin,
 * +Y down) and tile indices.
 */
export class Level {
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
    return this.tileAt(tx, ty) === TileType.Solid;
  }

  /** Convenience: sample solidity at an arbitrary world-space point. */
  public isSolidAtWorld(worldX: number, worldY: number): boolean {
    return this.isSolidAtTile(Level.worldToTileX(worldX), Level.worldToTileY(worldY));
  }

  // -------------------------------------------------------------- markers --

  /** First marker of `kind` converted to world px, or undefined. */
  public markerWorld(kind: LevelMarker['kind']): Vec2 | undefined {
    const marker = this.data.markers.find((m) => m.kind === kind);
    if (!marker) return undefined;
    return Level.tileCenter(marker.tx, marker.ty);
  }
}

// ------------------------------------------------------------------ parsing --

/**
 * Build a {@link LevelData} from ASCII rows (see {@link ASCII_TILES}).
 * Rows are padded/truncated to the longest row; 'S'/'C'/'G' become markers.
 */
export function parseAsciiLevel(
  id: string,
  name: string,
  rows: readonly string[],
  parTimeSeconds?: number,
): LevelData {
  if (rows.length === 0) throw new Error(`Level "${id}": no rows`);
  const width = Math.max(...rows.map((r) => r.length));

  const tiles: TileType[][] = [];
  const markers: LevelMarker[] = [];

  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? '';
    const gridRow: TileType[] = [];
    for (let x = 0; x < width; x++) {
      const ch = x < row.length ? (row[x] ?? '.') : '.';
      const markerKind = ASCII_MARKERS[ch];
      if (markerKind) {
        markers.push({ kind: markerKind, tx: x, ty: y });
        gridRow.push(TileType.Empty);
        continue;
      }
      gridRow.push(ASCII_TILES[ch] ?? TileType.Empty);
    }
    tiles.push(gridRow);
  }

  return { id, name, widthTiles: width, heightTiles: tiles.length, tiles, markers, parTimeSeconds };
}
