import { describe, expect, it } from 'vitest';
import { Level, parseAsciiLevel } from '../src/levels/Level';
import { TILE_SIZE } from '../src/levels/LevelData';
import {
  moveAndCollide,
  touchesHazard,
  type PhysicsBody,
} from '../src/game/collision';

/**
 * Tilemap collision tests on tiny ASCII levels (B0):
 * solid blocking, one-way platforms, hazards and world bounds.
 */

function body(x: number, y: number, width = 20, height = 26): PhysicsBody {
  return { x, y, width, height, vx: 0, vy: 0 };
}

function makeLevel(rows: string[]): Level {
  return new Level(parseAsciiLevel('collision-test', 'Collision Test', rows));
}

const STEP = 1 / 120;

/** Step a body until `predicate` holds or `maxSteps` elapse; returns flags of the final step. */
function stepUntil(
  level: Level,
  b: PhysicsBody,
  predicate: (flags: ReturnType<typeof moveAndCollide>) => boolean,
  maxSteps = 600,
): ReturnType<typeof moveAndCollide> {
  let flags = moveAndCollide(level, b, STEP);
  for (let i = 0; i < maxSteps && !predicate(flags); i++) {
    flags = moveAndCollide(level, b, STEP);
  }
  return flags;
}

describe('solid tile collision', () => {
  it('lands a falling body on top of a solid floor', () => {
    const level = makeLevel([
      '............',
      '....S.......',
      '############',
    ]);
    const b = body(5 * TILE_SIZE + 6, TILE_SIZE - 20); // starts mid-air above floor
    b.vy = 200;

    const flags = stepUntil(level, b, (f) => f.onGround);

    expect(flags.onGround).toBe(true);
    expect(b.vy).toBe(0);
    // Feet rest exactly on the floor surface (row 2 top).
    const surfaceY = 2 * TILE_SIZE;
    expect(b.y + b.height).toBeCloseTo(surfaceY - 0.01, 1);
  });

  it('blocks horizontal movement against a solid wall', () => {
    const level = makeLevel([
      '..........',
      'S...#.....',
      '##########',
    ]);
    const b = body(TILE_SIZE + 4, TILE_SIZE + 3, 20, 26);
    b.vy = 400; // drop onto the floor first
    stepUntil(level, b, (f) => f.onGround);

    b.vx = 300;
    const flags = stepUntil(level, b, (f) => f.hitWallRight || b.vx === 0);

    expect(flags.hitWallRight).toBe(true);
    expect(b.vx).toBe(0);
    // Right edge must sit flush against the wall column.
    const wallX = 4 * TILE_SIZE;
    expect(b.x + b.width).toBeLessThanOrEqual(wallX + 1);
  });

  it('bonks the head on a solid ceiling when rising', () => {
    const level = makeLevel([
      '############',
      '............',
      '.....S......',
      '############',
    ]);
    const b = body(5 * TILE_SIZE + 6, 2 * TILE_SIZE + 2);
    b.vy = -500;

    const flags = stepUntil(level, b, (f) => f.hitCeiling);

    expect(flags.hitCeiling).toBe(true);
    expect(b.vy).toBe(0);
    expect(b.y).toBeGreaterThanOrEqual(TILE_SIZE); // never inside row 0
  });
});

describe('one-way platform collision', () => {
  it('supports a body landing from above', () => {
    const level = makeLevel([
      '............',
      '............',
      '====........',
      '............',
      '....S.......',
      '############',
    ]);
    const b = body(TILE_SIZE + 6, TILE_SIZE - 24);
    b.vy = 150;

    const flags = stepUntil(level, b, (f) => f.onGround, 240);

    expect(flags.onGround).toBe(true);
    const platformTop = 2 * TILE_SIZE;
    expect(b.y + b.height).toBeCloseTo(platformTop - 0.01, 1);
  });

  it('lets a rising body pass through from below', () => {
    const level = makeLevel([
      '............',
      '............',
      '====........',
      '............',
      '....S.......',
      '############',
    ]);
    // Start just below the platform and jump up through it.
    const b = body(TILE_SIZE + 6, 2 * TILE_SIZE + 8);

    for (let i = 0; i < 60; i++) {
      moveAndCollide(level, b, STEP); // gravity pulls down; simulate upward via vy
      b.vy = -420;
    }
    // Body rose past the platform band without any ceiling stop.
    expect(b.y).toBeLessThan(2 * TILE_SIZE);
  });

  it('does not treat a platform as ground when walking beneath it', () => {
    const level = makeLevel([
      '====........',
      '............',
      '....S.......',
      '############',
    ]);
    const b = body(TILE_SIZE + 6, 2 * TILE_SIZE + 2);
    b.vy = 100;

    const flags = stepUntil(level, b, (f) => f.onGround, 120);

    expect(flags.onGround).toBe(true);
    // Landed on the real floor (row 3), not on the floating platform.
    expect(b.y + b.height).toBeCloseTo(3 * TILE_SIZE - 0.01, 1);
  });
});

describe('hazards and world bounds', () => {
  it('reports hazard overlap without blocking movement', () => {
    const level = makeLevel([
      '............',
      '....S....^^.',
      '############',
    ]);

    const overlapping = body(9 * TILE_SIZE + 8, TILE_SIZE + 10);
    expect(touchesHazard(level, overlapping)).toBe(true);

    const b = body(4 * TILE_SIZE, TILE_SIZE + 3);
    b.vx = 220;
    b.vy = 260; // settle to floor then run right into the hazard strip
    const flags = stepUntil(level, b, (f) => f.touchedHazard, 300);

    expect(flags.touchedHazard).toBe(true);
    // Hazard did not block: the body kept moving into the strip.
    expect(b.x).toBeGreaterThan(7 * TILE_SIZE);
  });

  it('treats the left world edge as a solid wall', () => {
    const level = makeLevel([
      '..S.........',
      '############',
    ]);
    const b = body(TILE_SIZE + 2, TILE_SIZE + 3);
    b.vy = 300;
    stepUntil(level, b, (f) => f.onGround);

    b.vx = -500;
    const flags = stepUntil(level, b, (f) => f.hitWallLeft || b.vx === 0, 120);

    expect(flags.hitWallLeft).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(-0.01);
  });
});
