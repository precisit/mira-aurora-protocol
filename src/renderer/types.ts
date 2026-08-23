/**
 * Shared renderer contracts (PLAN.md §6 "Teknisk specifikation").
 *
 * Kept free of WebGPU runtime objects so pure-math helpers in SpriteBatch /
 * ParallaxBackground can be unit-tested in a plain Node environment.
 */

/** Fixed virtual resolution: the gameplay area is always 1280×720. */
export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;

/** Battery-friendly devicePixelRatio cap (PLAN.md §6). */
export const MAX_DEVICE_PIXEL_RATIO = 2;

/** Linear RGBA color, components in 0..1. */
export type Rgba = readonly [number, number, number, number];

/**
 * How a sprite's pixels are blended into the target.
 * - `normal`   — standard alpha blending (src-alpha / one-minus-src-alpha).
 * - `additive` — premultiplied additive glow (one / one-minus-src-alpha);
 *                dark texels add nothing, bright texels light up what is
 *                already on screen. Ideal for neon lines, sparks, beams.
 */
export type SpriteBlendMode = 'normal' | 'additive';

/**
 * One instanced quad: position + size + UV rect + tint, plus optional
 * neon-glow and blend-mode overrides used by the A1 renderer wave.
 */
export interface SpriteDraw {
  /** Top-left corner in virtual pixels. May extend into side gutters. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Texture-space rect; defaults to the full texture. */
  u0?: number;
  v0?: number;
  u1?: number;
  v1?: number;
  /** RGBA tint over the sampled texture; defaults to opaque white. */
  tint?: Rgba;
  /** Blend mode; defaults to `'normal'`. */
  blend?: SpriteBlendMode;
  /**
   * Neon-glow emission: `rgb` = halo color, `a` = strength multiplier.
   * The halo term is weighted by the sprite's sampled luminance, so glowing
   * sprites bloom through the post-pass in their own hue. Default: none.
   */
  glow?: Rgba;
}

/** Visible virtual-space bounds of the current frame, including gutters. */
export interface ViewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
