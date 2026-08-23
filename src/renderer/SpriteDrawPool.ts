import type { Rgba, SpriteDraw } from './types';

/**
 * SpriteDrawPool (task C3: "avoid re-creating arrays/objects per frame in
 * render paths").
 *
 * A grow-only pool of `SpriteDraw` quads with owned tint tuples. Each frame
 * the caller {@link SpriteDrawPool.reset}s, takes records via
 * {@link SpriteDrawPool.next} and hands the stable {@link SpriteDrawPool.view}
 * to `renderer.drawSprites`. After warmup, building a whole gameplay frame
 * allocates nothing — records, arrays and color tuples are all reused
 * (mirrors the effects/Particles.ts buildDraws contract).
 *
 * Colors: every record's `tint` is its own mutable tuple — write it with
 * {@link setRgba}/{@link copyRgba}. Static palette tuples can also be shared
 * directly as `glow` values (packing never mutates them).
 *
 * Node-testable: no GPU/DOM types beyond the plain SpriteDraw shape.
 */

/** Mutable RGBA tuple (what pooled records expose for in-place writes). */
export type MutRgba = [number, number, number, number];

/** A pooled draw record: `tint` is always this record's owned tuple. */
export interface PooledSpriteDraw extends SpriteDraw {
  /** Owned, reusable color slot — mutate in place, never replace. */
  tint: MutRgba;
}

export class SpriteDrawPool {
  private readonly draws: PooledSpriteDraw[] = [];
  /** Stable alias of {@link draws} that gets truncated per frame. */
  private readonly viewArray: SpriteDraw[] = [];
  private used = 0;

  public constructor(capacity = 1024) {
    const cap = Math.max(1, Math.floor(capacity));
    for (let i = 0; i < cap; i++) this.grow();
  }

  /** Records handed out since the last {@link reset}. */
  public get length(): number {
    return this.used;
  }

  /** Drop all records from the previous frame (identity stays stable). */
  public reset(): void {
    this.used = 0;
  }

  /**
   * Take the next draw record. The returned object (and its tint tuple) is
   * reused across frames — callers must set every field they care about;
   * `blend` resets to `'normal'`, `glow` to `undefined`. Grows geometrically
   * past the initial capacity.
   */
  public next(): PooledSpriteDraw {
    if (this.used >= this.draws.length) this.grow();
    const record = this.draws[this.used++]!;
    this.viewArray[this.used - 1] = record;
    // Reset per-frame fields so reused records never leak last frame's state.
    record.x = 0;
    record.y = 0;
    record.width = 0;
    record.height = 0;
    record.u0 = undefined;
    record.v0 = undefined;
    record.u1 = undefined;
    record.v1 = undefined;
    record.blend = 'normal';
    record.glow = undefined;
    return record;
  }

  /**
   * The stable, length-truncated view of taken records — pass straight to
   * `renderer.drawSprites('white', pool.view())`. Truncating the view never
   * drops pooled records.
   */
  public view(): readonly SpriteDraw[] {
    this.viewArray.length = this.used;
    return this.viewArray;
  }

  private grow(): void {
    const record: PooledSpriteDraw = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      tint: [1, 1, 1, 1],
      blend: 'normal',
      glow: undefined,
    };
    this.viewArray.push(record);
    this.draws.push(record);
  }
}

/** Write component values into a mutable RGBA slot (no allocation). */
export function setRgba(
  out: MutRgba,
  r: number,
  g: number,
  b: number,
  a: number,
): MutRgba {
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
  return out;
}

/** Copy a (possibly readonly) RGBA into a mutable slot (no allocation). */
export function copyRgba(out: MutRgba, src: Rgba): MutRgba {
  out[0] = src[0];
  out[1] = src[1];
  out[2] = src[2];
  out[3] = src[3];
  return out;
}
