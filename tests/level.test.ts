import { describe, expect, it } from 'vitest';
import { Level, parseAsciiLevel } from '../src/levels/Level';
import { ASCII_TILES, TILE_SIZE, TileType } from '../src/levels/LevelData';
import { createTestLevel, TEST_LEVEL_PIXEL_SIZE } from '../src/levels/TestLevel';

function requirePoint(point: { x: number; y: number } | undefined): { x: number; y: number } {
  if (!point) throw new Error('expected marker world position to exist');
  return point;
}

describe('tilemap coordinate conversion', () => {
  it('uses 32 px tiles', () => {
    expect(TILE_SIZE).toBe(32);
  });

  it('converts world px → tile index by floor division', () => {
    expect(Level.worldToTileX(0)).toBe(0);
    expect(Level.worldToTileX(31.9)).toBe(0);
    expect(Level.worldToTileX(32)).toBe(1);
    expect(Level.worldToTileX(64)).toBe(2);
    // Negative coordinates floor correctly (left of the level).
    expect(Level.worldToTileX(-1)).toBe(-1);
    expect(Level.worldToTileY(-33)).toBe(-2);
  });

  it('converts tile index → world px (top-left corner and center)', () => {
    expect(Level.tileToWorldX(3)).toBe(96);
    expect(Level.tileToWorldY(5)).toBe(160);
    expect(Level.tileCenter(0, 0)).toEqual({ x: 16, y: 16 });
    expect(Level.tileCenter(10, 7)).toEqual({ x: 10 * 32 + 16, y: 7 * 32 + 16 });
  });

  it('round-trips tile ↔ world', () => {
    for (const t of [0, 1, 17, 63]) {
      expect(Level.worldToTileX(Level.tileToWorldX(t))).toBe(t);
      const c = Level.tileCenter(t, t);
      expect(Level.worldToTileX(c.x)).toBe(t);
      expect(Level.worldToTileY(c.y)).toBe(t);
    }
  });

  it('treats out-of-bounds as solid except above the level (open sky)', () => {
    const level = new Level(createTestLevel());
    expect(level.tileAt(-1, 10)).toBe(TileType.Solid); // left wall
    expect(level.tileAt(level.widthTiles + 3, 10)).toBe(TileType.Solid); // right wall
    expect(level.tileAt(10, level.heightTiles + 2)).toBe(TileType.Solid); // below
    expect(level.tileAt(10, -4)).toBe(TileType.Empty); // sky above
  });
});

describe('ASCII level parsing', () => {
  const parsed = new Level(
    parseAsciiLevel(
      'test-parse',
      'Test Parse',
      [
        // Rows intentionally ragged — parser must pad to a rectangle.
        '.....',
        '.###.',
        '..S..',
        'C...G',
        '^^^..',
      ],
    ),
  );

  it('builds a rectangular grid from ragged rows', () => {
    expect(parsed.widthTiles).toBe(5);
    expect(parsed.heightTiles).toBe(5);
    expect(parsed.data.tiles.every((row) => row.length === 5)).toBe(true);
  });

  it('decodes tiles per the legend', () => {
    expect(parsed.tileAt(1, 1)).toBe(ASCII_TILES['#']);
    expect(parsed.tileAt(0, 4)).toBe(ASCII_TILES['^']);
  });

  it('turns S/C/G into markers on empty tiles', () => {
    expect(parsed.data.markers).toContainEqual({ kind: 'spawn', tx: 2, ty: 2 });
    expect(parsed.data.markers).toContainEqual({ kind: 'checkpoint', tx: 0, ty: 3 });
    expect(parsed.data.markers).toContainEqual({ kind: 'goal', tx: 4, ty: 3 });
    expect(parsed.tileAt(2, 2)).toBe(TileType.Empty); // markers are not solid
  });

  it('exposes marker world positions via the level helper', () => {
    expect(parsed.markerWorld('spawn')).toEqual(Level.tileCenter(2, 2));
    expect(parsed.markerWorld('checkpoint')).toBeDefined();
  });
});

describe('Fas 0 test level data', () => {
  const level = new Level(createTestLevel());

  it('has sane dimensions matching its declared size', () => {
    expect(level.pixelWidth).toBe(TEST_LEVEL_PIXEL_SIZE.width);
    expect(level.heightTiles).toBe(level.data.tiles.length);
    expect(level.data.tiles.every((row) => row.length === level.widthTiles)).toBe(true);
  });

  it('contains ground, platforms and hazards', () => {
    let solid = 0;
    let platform = 0;
    let hazard = 0;
    for (const row of level.data.tiles) {
      for (const tile of row) {
        if (tile === TileType.Solid) solid++;
        if (tile === TileType.Platform) platform++;
        if (tile === TileType.Hazard) hazard++;
      }
    }
    expect(solid).toBeGreaterThan(100);
    expect(platform).toBeGreaterThan(15);
    expect(hazard).toBeGreaterThan(5);
  });

  it('places spawn on safe ground with checkpoints and a goal', () => {
    const spawn = requirePoint(level.markerWorld('spawn'));
    // Spawn tile itself must be empty with solid ground directly beneath.
    expect(level.isSolidAtWorld(spawn.x, spawn.y)).toBe(false);
    expect(level.isSolidAtWorld(spawn.x, spawn.y + TILE_SIZE)).toBe(true);

    expect(level.data.markers.filter((m) => m.kind === 'checkpoint').length).toBeGreaterThanOrEqual(2);
    expect(level.markerWorld('goal')).toBeDefined();
  });
});
