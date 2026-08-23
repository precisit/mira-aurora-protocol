import type { Rgba, SpriteDraw } from './types';

/**
 * SpriteBatch (PLAN.md §6: "Sprite-batchning med instancing").
 *
 * A reusable instanced-quad batcher. Callers push quads (position, size, UV,
 * color); the batch packs them into a tightly laid-out Float32 staging array
 * and uploads them in a single `queue.writeBuffer`, after which each
 * (texture × blend-mode) group is drawn with exactly one instanced draw call.
 *
 * The pure packing/grouping helpers are exported so the math can be unit
 * tested without a GPU (see tests/spriteBatch.test.ts).
 */

/** Byte layout must match `VsIn` locations 1..7 in shaders.ts. */
export const INSTANCE_FLOATS_PER_SPRITE = 20;
export const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS_PER_SPRITE * 4; // 80

/** Starting capacity — comfortably above parallax + tile worst cases. */
export const INITIAL_BATCH_CAPACITY = 4096;

const WHITE_TINT: Rgba = [1, 1, 1, 1];
const NO_GLOW: Rgba = [0, 0, 0, 0];

/** Staging float offsets within one instance record. */
export const INSTANCE_LAYOUT = {
  pos: 0,
  size: 2,
  uv0: 4,
  uv1: 6,
  color: 8,
  glow: 12,
  params: 16,
} as const;

/** A quad tagged with the texture it should be drawn with. */
export interface TaggedQuad {
  readonly textureName: string;
  readonly quad: SpriteDraw;
}

/**
 * Sprites that share texture *and* blend mode can be drawn together in one
 * instanced draw call. Groups preserve first-appearance order so painter's-
 * order semantics hold as long as callers don't interleave dependent
 * z-order across different textures/blend modes mid-frame.
 */
export interface QuadGroup {
  readonly textureName: string;
  readonly additive: boolean;
  readonly quads: SpriteDraw[];
}

/** Group tagged quads into drawable batches, preserving first-seen order. */
export function groupQuads(items: readonly TaggedQuad[]): QuadGroup[] {
  const order: string[] = [];
  const groups = new Map<string, QuadGroup>();
  for (const item of items) {
    const additive = item.quad.blend === 'additive';
    const key = `${item.textureName}|${additive ? 'additive' : 'normal'}`;
    let group = groups.get(key);
    if (!group) {
      group = { textureName: item.textureName, additive, quads: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.quads.push(item.quad);
  }
  const result: QuadGroup[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (group) result.push(group);
  }
  return result;
}

/**
 * Growth policy for the instance buffer: never below `minimum`, double when
 * growing, but always satisfy `needed` outright (one-shot large frames).
 */
export function nextCapacity(
  currentCapacity: number,
  neededSprites: number,
  minimum: number = INITIAL_BATCH_CAPACITY,
): number {
  const base = Math.max(currentCapacity, minimum, 1);
  if (neededSprites <= base) return base;
  return Math.max(base * 2, neededSprites);
}

/** Replace non-finite values with a safe fallback (defensive game data). */
function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Pack one quad into `out` at float offset `offset` (must be a multiple of
 * {@link INSTANCE_FLOATS_PER_SPRITE}). Non-finite position/size/UV/color
 * components are sanitized to 0 so malformed game data cannot poison the
 * GPU submission.
 */
export function packSpriteInstance(
  out: Float32Array,
  offset: number,
  quad: SpriteDraw,
): void {
  const tint = quad.tint ?? WHITE_TINT;
  const glow = quad.glow ?? NO_GLOW;
  const o = offset;
  out[o + INSTANCE_LAYOUT.pos] = num(quad.x, 0);
  out[o + INSTANCE_LAYOUT.pos + 1] = num(quad.y, 0);
  out[o + INSTANCE_LAYOUT.size] = num(quad.width, 0);
  out[o + INSTANCE_LAYOUT.size + 1] = num(quad.height, 0);
  out[o + INSTANCE_LAYOUT.uv0] = num(quad.u0 ?? 0, 0);
  out[o + INSTANCE_LAYOUT.uv0 + 1] = num(quad.v0 ?? 0, 0);
  out[o + INSTANCE_LAYOUT.uv1] = num(quad.u1 ?? 1, 0);
  out[o + INSTANCE_LAYOUT.uv1 + 1] = num(quad.v1 ?? 1, 0);
  out[o + INSTANCE_LAYOUT.color] = num(tint[0], 1);
  out[o + INSTANCE_LAYOUT.color + 1] = num(tint[1], 1);
  out[o + INSTANCE_LAYOUT.color + 2] = num(tint[2], 1);
  out[o + INSTANCE_LAYOUT.color + 3] = num(tint[3], 1);
  out[o + INSTANCE_LAYOUT.glow] = num(glow[0], 0);
  out[o + INSTANCE_LAYOUT.glow + 1] = num(glow[1], 0);
  out[o + INSTANCE_LAYOUT.glow + 2] = num(glow[2], 0);
  out[o + INSTANCE_LAYOUT.glow + 3] = num(glow[3], 0);
  out[o + INSTANCE_LAYOUT.params] = quad.blend === 'additive' ? 1 : 0;
  out[o + INSTANCE_LAYOUT.params + 1] = 0;
  out[o + INSTANCE_LAYOUT.params + 2] = 0;
  out[o + INSTANCE_LAYOUT.params + 3] = 0;
}

/**
 * Owns the instance buffer + CPU staging area for one renderer. The buffer
 * grows geometrically when a frame needs more room than currently allocated;
 * the old buffer is destroyed only after the replacement exists.
 */
export class SpriteBatch {
  private device: GPUDevice;
  private instanceBuffer: GPUBuffer;
  private staging: Float32Array;
  private capacitySprites: number;

  public constructor(device: GPUDevice, initialCapacity = INITIAL_BATCH_CAPACITY) {
    this.device = device;
    this.capacitySprites = nextCapacity(0, 0, initialCapacity);
    this.instanceBuffer = this.createBuffer(this.capacitySprites);
    this.staging = new Float32Array(this.capacitySprites * INSTANCE_FLOATS_PER_SPRITE);
  }

  /** Number of sprites the current GPU buffer can hold. */
  public get capacity(): number {
    return this.capacitySprites;
  }

  /** The vertex-format instance buffer to bind at slot 1. */
  public get gpuBuffer(): GPUBuffer {
    return this.instanceBuffer;
  }

  /** Grow the buffer up-front so `spriteCount` instances fit. */
  public ensureCapacity(spriteCount: number): void {
    if (spriteCount <= this.capacitySprites) return;
    this.reallocate(nextCapacity(this.capacitySprites, spriteCount));
  }

  /**
   * Pack `quads` starting at sprite index `firstSprite`. Returns the next
   * free sprite index. Grows the internal buffers if required.
   */
  public pack(firstSprite: number, quads: readonly SpriteDraw[]): number {
    this.ensureCapacity(firstSprite + quads.length);
    let cursor = firstSprite * INSTANCE_FLOATS_PER_SPRITE;
    for (const quad of quads) {
      packSpriteInstance(this.staging, cursor, quad);
      cursor += INSTANCE_FLOATS_PER_SPRITE;
    }
    return firstSprite + quads.length;
  }

  /** Upload the first `spriteCount` packed instances to the GPU buffer. */
  public upload(spriteCount: number): void {
    const count = Math.min(Math.max(0, Math.floor(spriteCount)), this.capacitySprites);
    if (count === 0) return;
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      this.staging.buffer,
      0,
      count * INSTANCE_STRIDE_BYTES,
    );
  }

  /** Release GPU resources (renderer teardown). */
  public dispose(): void {
    this.instanceBuffer.destroy();
  }

  private reallocate(newCapacity: number): void {
    this.capacitySprites = newCapacity;
    const oldBuffer = this.instanceBuffer;
    this.instanceBuffer = this.createBuffer(newCapacity);
    this.staging = new Float32Array(newCapacity * INSTANCE_FLOATS_PER_SPRITE);
    // Destroying a previously-submitted buffer is legal per the WebGPU spec;
    // the driver keeps it alive until in-flight work completes.
    oldBuffer.destroy();
  }

  private createBuffer(capacitySprites: number): GPUBuffer {
    return this.device.createBuffer({
      size: capacitySprites * INSTANCE_STRIDE_BYTES,
      usage: 0x0020 /* VERTEX */ | 0x0008 /* COPY_DST */,
    });
  }
}
