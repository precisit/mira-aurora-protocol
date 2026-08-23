/**
 * Level data model (PLAN.md §6): tilemap-based levels with 32 px tiles,
 * authored as TS modules in src/levels (later waves may export from Tiled).
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
}

/** Marker entities stored separately from the tile grid. */
export type LevelMarkerKind = 'spawn' | 'checkpoint' | 'goal';

export interface LevelMarker {
  kind: LevelMarkerKind;
  /** Tile coordinates. */
  tx: number;
  ty: number;
}

export interface LevelData {
  id: string;
  name: string;
  widthTiles: number;
  heightTiles: number;
  /**
   * Row-major grid: `tiles[y][x]`, values are {@link TileType}.
   * World origin is the top-left corner of tile (0,0); +Y points down.
   */
  tiles: TileType[][];
  markers: LevelMarker[];
  /** Target completion time in seconds (speedrun reference). */
  parTimeSeconds?: number;
}

/**
 * ASCII authoring format for hand-made levels:
 *   '.' empty · '#' solid · '=' platform · '^' hazard
 *   'S' spawn · 'C' checkpoint · 'G' goal
 * Rows are padded to equal length; unknown characters are treated as empty.
 */
export const ASCII_TILES: Readonly<Record<string, TileType>> = {
  '#': TileType.Solid,
  '=': TileType.Platform,
  '^': TileType.Hazard,
};

export const ASCII_MARKERS: Readonly<Record<string, Extract<LevelMarkerKind, 'spawn' | 'checkpoint' | 'goal'>>> = {
  S: 'spawn',
  C: 'checkpoint',
  G: 'goal',
};
