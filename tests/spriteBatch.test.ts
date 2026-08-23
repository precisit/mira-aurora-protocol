import { describe, expect, it } from 'vitest';
import {
  INITIAL_BATCH_CAPACITY,
  INSTANCE_FLOATS_PER_SPRITE,
  INSTANCE_LAYOUT,
  INSTANCE_STRIDE_BYTES,
  groupQuads,
  nextCapacity,
  packSpriteInstance,
} from '../src/renderer/SpriteBatch';
import type { SpriteDraw } from '../src/renderer/types';

function pack(quad: SpriteDraw): Float32Array {
  const out = new Float32Array(INSTANCE_FLOATS_PER_SPRITE);
  packSpriteInstance(out, 0, quad);
  return out;
}

describe('SpriteBatch instance packing', () => {
  it('uses a stride of 20 floats / 80 bytes', () => {
    expect(INSTANCE_FLOATS_PER_SPRITE).toBe(20);
    expect(INSTANCE_STRIDE_BYTES).toBe(80);
  });

  it('fills defaults for a bare quad (white tint, full UVs, no glow, normal blend)', () => {
    const q = pack({ x: 10, y: 20, width: 30, height: 40 });
    expect(q[INSTANCE_LAYOUT.pos]).toBe(10);
    expect(q[INSTANCE_LAYOUT.pos + 1]).toBe(20);
    expect(q[INSTANCE_LAYOUT.size]).toBe(30);
    expect(q[INSTANCE_LAYOUT.size + 1]).toBe(40);

    expect(q[INSTANCE_LAYOUT.uv0]).toBe(0);
    expect(q[INSTANCE_LAYOUT.uv0 + 1]).toBe(0);
    expect(q[INSTANCE_LAYOUT.uv1]).toBe(1);
    expect(q[INSTANCE_LAYOUT.uv1 + 1]).toBe(1);

    expect(q[INSTANCE_LAYOUT.color]).toBe(1);
    expect(q[INSTANCE_LAYOUT.color + 1]).toBe(1);
    expect(q[INSTANCE_LAYOUT.color + 2]).toBe(1);
    expect(q[INSTANCE_LAYOUT.color + 3]).toBe(1);

    for (let i = INSTANCE_LAYOUT.glow; i < INSTANCE_FLOATS_PER_SPRITE; i++) {
      expect(q[i]).toBe(0);
    }
    expect(q[INSTANCE_LAYOUT.params]).toBe(0); // normal blend
  });

  it('writes explicit uv/tint/glow/blend values at the documented offsets', () => {
    const q = pack({
      x: -5.5,
      y: 100,
      width: 64,
      height: 32,
      u0: 0.25,
      v0: 0.5,
      u1: 0.75,
      v1: 1,
      tint: [0.1, 0.2, 0.3, 0.4],
      glow: [0.9, 0.8, 0.7, 2],
      blend: 'additive',
    });
    expect(q[INSTANCE_LAYOUT.uv0]).toBeCloseTo(0.25);
    expect(q[INSTANCE_LAYOUT.uv0 + 1]).toBeCloseTo(0.5);
    expect(q[INSTANCE_LAYOUT.uv1]).toBeCloseTo(0.75);
    expect(q[INSTANCE_LAYOUT.uv1 + 1]).toBe(1);
    expect(q[INSTANCE_LAYOUT.color]).toBeCloseTo(0.1);
    expect(q[INSTANCE_LAYOUT.color + 1]).toBeCloseTo(0.2);
    expect(q[INSTANCE_LAYOUT.color + 2]).toBeCloseTo(0.3);
    expect(q[INSTANCE_LAYOUT.color + 3]).toBeCloseTo(0.4);
    expect(q[INSTANCE_LAYOUT.glow]).toBeCloseTo(0.9);
    expect(q[INSTANCE_LAYOUT.glow + 3]).toBe(2);
    expect(q[INSTANCE_LAYOUT.params]).toBe(1); // additive
  });

  it('sanitizes non-finite game data instead of poisoning the GPU buffer', () => {
    const bad = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      width: Number.NEGATIVE_INFINITY,
      height: Number.NaN,
      tint: [Number.NaN, 0.5, 0.5, 0.5],
      glow: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    } as SpriteDraw;
    const q = pack(bad);
    expect(q[INSTANCE_LAYOUT.pos]).toBe(0);
    expect(q[INSTANCE_LAYOUT.pos + 1]).toBe(0);
    expect(q[INSTANCE_LAYOUT.size]).toBe(0);
    expect(q[INSTANCE_LAYOUT.size + 1]).toBe(0);
    // Non-finite tint channels fall back to the white default's components.
    expect(q[INSTANCE_LAYOUT.color]).toBe(1);
    expect(q[INSTANCE_LAYOUT.color + 1]).toBe(0.5);
    for (let i = INSTANCE_LAYOUT.glow; i < INSTANCE_FLOATS_PER_SPRITE; i++) {
      expect(Number.isFinite(q[i] as number)).toBe(true);
    }
  });

  it('packs multiple quads at consecutive strides without overlap', () => {
    const out = new Float32Array(INSTANCE_FLOATS_PER_SPRITE * 2);
    packSpriteInstance(out, 0, { x: 1, y: 2, width: 3, height: 4 });
    packSpriteInstance(out, INSTANCE_FLOATS_PER_SPRITE, { x: 5, y: 6, width: 7, height: 8 });
    expect(out[INSTANCE_LAYOUT.pos]).toBe(1);
    expect(out[INSTANCE_FLOATS_PER_SPRITE + INSTANCE_LAYOUT.pos]).toBe(5);
  });
});

describe('SpriteBatch capacity growth', () => {
  it('never goes below the initial capacity', () => {
    expect(nextCapacity(0, 0)).toBe(INITIAL_BATCH_CAPACITY);
    expect(nextCapacity(16, 1)).toBeGreaterThanOrEqual(INITIAL_BATCH_CAPACITY);
  });

  it('keeps capacity when the frame fits', () => {
    expect(nextCapacity(4096, 4096)).toBe(4096);
    expect(nextCapacity(8192, 100)).toBe(8192);
  });

  it('doubles when growing, but satisfies large frames outright', () => {
    expect(nextCapacity(4096, 4097)).toBe(8192);
    expect(nextCapacity(4096, 5000)).toBe(8192);
    expect(nextCapacity(4096, 20000)).toBe(20000);
  });
});

describe('groupQuads batching', () => {
  it('groups by texture and blend mode, preserving first-seen order', () => {
    const groups = groupQuads([
      { textureName: 'tiles', quad: { x: 0, y: 0, width: 1, height: 1 } },
      { textureName: 'sparks', quad: { x: 0, y: 0, width: 1, height: 1, blend: 'additive' } },
      { textureName: 'tiles', quad: { x: 1, y: 0, width: 1, height: 1 } },
      { textureName: 'tiles', quad: { x: 2, y: 0, width: 1, height: 1, blend: 'additive' } },
      { textureName: 'sparks', quad: { x: 1, y: 0, width: 1, height: 1, blend: 'additive' } },
    ]);

    expect(groups.map((g) => `${g.textureName}:${g.additive}`)).toEqual([
      'tiles:false',
      'sparks:true',
      'tiles:true',
    ]);
    expect(groups[0]?.quads.length).toBe(2);
    expect(groups[1]?.quads.length).toBe(2);
    expect(groups[2]?.quads.length).toBe(1);
  });

  it('treats missing blend as normal', () => {
    const groups = groupQuads([
      { textureName: 'a', quad: { x: 0, y: 0, width: 1, height: 1, blend: 'normal' } },
      { textureName: 'a', quad: { x: 1, y: 0, width: 1, height: 1 } },
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]?.additive).toBe(false);
  });

  it('returns no groups for empty input', () => {
    expect(groupQuads([])).toEqual([]);
  });
});
