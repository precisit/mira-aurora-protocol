import { TILE_SIZE, TileType, type LevelData } from './LevelData';

/**
 * Fas 0 test level ("Mnemosyne Overlook"): 64×23 tiles (2048×736 px).
 *
 * A simple hand-built layout used to exercise the renderer/loop skeleton:
 * ground segments with two hazard pits, floating one-way platforms at three
 * heights, a goal pedestal and checkpoints — enough geometry to make the
 * scrolling demo readable while the player entity arrives in wave A.
 */

const WIDTH_TILES = 64;
const HEIGHT_TILES = 23;

function emptyGrid(): TileType[][] {
  return Array.from({ length: HEIGHT_TILES }, () =>
    Array.from({ length: WIDTH_TILES }, () => TileType.Empty),
  );
}

/** Inclusive rect fill in tile coordinates. */
function fillRect(
  grid: TileType[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tile: TileType,
): void {
  for (let y = Math.max(0, y0); y <= Math.min(HEIGHT_TILES - 1, y1); y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = Math.max(0, x0); x <= Math.min(WIDTH_TILES - 1, x1); x++) {
      row[x] = tile;
    }
  }
}

export function createTestLevel(): LevelData {
  const tiles = emptyGrid();

  // --- Ground (rows 21–22) with two hazard pits ---
  fillRect(tiles, 0, 21, 15, 22, TileType.Solid); // left ground
  fillRect(tiles, 16, 22, 19, 22, TileType.Hazard); // pit 1 floor
  fillRect(tiles, 20, 21, 43, 22, TileType.Solid); // middle ground
  fillRect(tiles, 44, 22, 47, 22, TileType.Hazard); // pit 2 floor
  fillRect(tiles, 48, 21, 63, 22, TileType.Solid); // right ground

  // --- Low walls to hop over ---
  fillRect(tiles, 10, 20, 10, 20, TileType.Solid);
  fillRect(tiles, 38, 20, 39, 20, TileType.Solid);

  // --- Floating one-way platforms (three heights) ---
  fillRect(tiles, 5, 17, 8, 17, TileType.Platform);
  fillRect(tiles, 12, 14, 15, 14, TileType.Platform);
  fillRect(tiles, 24, 17, 28, 17, TileType.Platform);
  fillRect(tiles, 31, 13, 35, 13, TileType.Platform);
  fillRect(tiles, 40, 16, 44, 16, TileType.Platform);
  fillRect(tiles, 50, 17, 54, 17, TileType.Platform);
  fillRect(tiles, 55, 13, 58, 13, TileType.Platform);

  // --- Goal pedestal on the far right ---
  fillRect(tiles, 61, 18, 63, 20, TileType.Solid);

  return {
    id: 'test-00',
    name: 'Mnemosyne Overlook',
    widthTiles: WIDTH_TILES,
    heightTiles: HEIGHT_TILES,
    tiles,
    parTimeSeconds: 60,
    markers: [
      { kind: 'spawn', tx: 2, ty: 20 }, // standing on the left ground segment
      { kind: 'checkpoint', tx: 26, ty: 20 },
      { kind: 'checkpoint', tx: 52, ty: 20 },
      { kind: 'goal', tx: 62, ty: 17 }, // on top of the pedestal
    ],
  };
}

/** World-pixel size of the test level, handy for camera clamping. */
export const TEST_LEVEL_PIXEL_SIZE = {
  width: WIDTH_TILES * TILE_SIZE,
  height: HEIGHT_TILES * TILE_SIZE,
} as const;
