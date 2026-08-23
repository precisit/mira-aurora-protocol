import { SeededRng } from '../core/Rng';
import { VIRTUAL_HEIGHT, type SpriteDraw } from './types';
import type { WebGPURenderer } from './WebGPURenderer';

/**
 * Parallax background (PLAN.md §6): 5 procedurally generated layers, drawn
 * strictly back-to-front in depth order:
 *
 *   nebula → starfield → celestial bodies → mid skyline → foreground decor
 *
 * Each layer is rendered once into an offscreen canvas (neon synthwave art
 * via Canvas2D), uploaded to a GPU texture, then tiled horizontally every
 * frame at its own scroll factor. A1 polish:
 *   - camera offsets are exponentially smoothed (no jitter on teleports),
 *   - tiling wraps seamlessly for any camera position,
 *   - layers carry explicit depth + a slow ambient drift so the sky feels
 *     alive even when the player stands still,
 *   - the foreground layer renders additively (neon glass over gameplay).
 *
 * Deterministic: all randomness comes from SeededRng, so the sky looks
 * identical on every device/run.
 */

export enum ParallaxLayerName {
  Nebula = 'parallax-nebula',
  Starfield = 'parallax-starfield',
  Celestial = 'parallax-celestial',
  Mid = 'parallax-mid',
  Foreground = 'parallax-foreground',
}

export interface ParallaxLayerSpec {
  name: ParallaxLayerName;
  /** Draw order: smaller depth = further back. Gameplay lives at ~50. */
  depth: number;
  /** World-px scrolled per world-px of camera movement (0 = static). */
  scrollFactor: number;
  /** Horizontal period in virtual px — one texture spans exactly this much. */
  tileWidth: number;
  /** Opacity of the whole layer. */
  alpha: number;
  /** Constant ambient drift in virtual px/s (adds life when standing still). */
  driftPxPerSec: number;
  /** Render with premultiplied additive blending. */
  additive?: boolean;
}

/** Depth-sorted layer table — PLAN.md's five bands, back to front. */
export const PARALLAX_LAYERS: readonly ParallaxLayerSpec[] = [
  { name: ParallaxLayerName.Nebula, depth: 10, scrollFactor: 0.05, tileWidth: 2048, alpha: 0.9, driftPxPerSec: 4 },
  { name: ParallaxLayerName.Starfield, depth: 20, scrollFactor: 0.12, tileWidth: 1536, alpha: 1, driftPxPerSec: 1.5 },
  { name: ParallaxLayerName.Celestial, depth: 30, scrollFactor: 0.22, tileWidth: 1920, alpha: 1, driftPxPerSec: 2.5 },
  { name: ParallaxLayerName.Mid, depth: 40, scrollFactor: 0.45, tileWidth: 1280, alpha: 1, driftPxPerSec: 0 },
  { name: ParallaxLayerName.Foreground, depth: 90, scrollFactor: 0.85, tileWidth: 960, alpha: 0.5, driftPxPerSec: 0, additive: true },
];

/** Camera smoothing response time in seconds (lower = snappier). */
const SMOOTHING_RESPONSE_SECONDS = 0.08;
/** Max simulated frame gap; guards against tab-switch time jumps. */
const MAX_FRAME_SECONDS = 0.1;

/**
 * Wrap `value` into [0, period) — handles negatives and non-finite input.
 * Guarantees seamless horizontal looping of parallax tiles.
 */
export function wrapPeriod(value: number, period: number): number {
  if (!Number.isFinite(value) || !(period > 0)) return 0;
  return ((value % period) + period) % period;
}

/**
 * X positions of tiles covering [left, right) given a tile width and the
 * wrapped scroll offset. Always returns enough tiles to cover the full view
 * (first tile starts at or left of `left`, last extends past `right`).
 */
export function computeTilePositions(
  left: number,
  right: number,
  tileWidth: number,
  offset: number,
): number[] {
  if (!(tileWidth > 0) || !Number.isFinite(left) || !Number.isFinite(right)) return [];
  if (!(right > left)) return [];
  const off = wrapPeriod(offset, tileWidth);
  const positions: number[] = [];
  for (let x = left - off; x < right; x += tileWidth) {
    positions.push(x);
  }
  return positions;
}

/**
 * Frame-rate-independent exponential smoothing toward a target.
 * Returns `current` unchanged for degenerate dt/response values.
 */
export function smoothTowards(
  current: number,
  target: number,
  dtSeconds: number,
  responseSeconds: number,
): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return current;
  if (!Number.isFinite(responseSeconds) || responseSeconds <= 0) return current;
  const alpha = 1 - Math.exp(-dtSeconds / responseSeconds);
  return current + (target - current) * alpha;
}

type GenCanvas = OffscreenCanvas | HTMLCanvasElement;
type GenCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createGenCanvas(width: number, height: number): GenCanvas {
  // OffscreenCanvas is available on every WebGPU-capable target; the DOM
  // fallback keeps older Safari from hard-crashing during init.
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function ctx2d(canvas: GenCanvas): GenCtx {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context during parallax generation');
  return ctx;
}

// ------------------------------------------------------------ generators ---
// Every generator paints one horizontally tileable strip of `width`×720.
// "Tileable" is achieved by drawing wrapped copies (x ± width) of anything
// that would cross the left/right edge.

/** Soft additive radial blob; the workhorse of the nebula layer. */
function paintBlob(
  g: GenCtx,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');
  g.globalAlpha = alpha;
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

function generateNebula(width: number, height: number): GenCanvas {
  const canvas = createGenCanvas(width, height);
  const g = ctx2d(canvas);
  const rng = new SeededRng(20260823);

  const colors = ['#ff2fd6', '#7a2fff', '#2f6bff', '#ff6a3d'];
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, width);
    const y = rng.range(height * 0.05, height * 0.8);
    const radius = rng.range(140, 420);
    const color = rng.pick(colors);
    // Paint three times, shifted by ±width, so blobs wrap seamlessly.
    for (const dx of [-width, 0, width]) paintBlob(g, x + dx, y, radius, color, 0.16);
  }
  return canvas;
}

function generateStarfield(width: number, height: number): GenCanvas {
  const canvas = createGenCanvas(width, height);
  const g = ctx2d(canvas);
  const rng = new SeededRng(1337);

  for (let i = 0; i < 340; i++) {
    const x = rng.range(0, width);
    const y = rng.range(0, height);
    const size = rng.next() < 0.85 ? rng.range(0.6, 1.4) : rng.range(1.6, 2.6);
    const color = rng.pick(['#ffffff', '#bfefff', '#ffd9f9', '#9fd0ff']);
    const glow = size > 1.5;

    if (glow) paintBlob(g, x, y, size * 6, color, 0.35);
    g.globalAlpha = rng.range(0.45, 1);
    g.fillStyle = color;
    g.fillRect(x, y, size, size);
    g.globalAlpha = 1;
  }
  return canvas;
}

/** Classic striped synthwave sun with horizontal slits cut from its lower half. */
function drawSynthwaveSun(g: GenCtx, cx: number, cy: number, radius: number): void {
  const sky = g.createLinearGradient(cx, cy - radius, cx, cy + radius);
  sky.addColorStop(0, '#ffe259');
  sky.addColorStop(0.55, '#ff7a59');
  sky.addColorStop(1, '#ff2fd6');
  g.fillStyle = sky;
  g.globalAlpha = 0.95;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  let slitY = cy + radius * 0.15;
  let slitHeight = 2;
  while (slitY < cy + radius) {
    g.fillRect(cx - radius, slitY, radius * 2, slitHeight);
    slitY += slitHeight + radius * 0.16;
    slitHeight += 2.5;
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
}

function generateCelestial(width: number, height: number): GenCanvas {
  const canvas = createGenCanvas(width, height);
  const g = ctx2d(canvas);

  // Distant moon, upper-left area.
  paintBlob(g, width * 0.18, height * 0.24, 26, '#cfe8ff', 0.9);
  g.fillStyle = '#cfe8ff';
  g.beginPath();
  g.arc(width * 0.18, height * 0.24, 14, 0, Math.PI * 2);
  g.fill();

  // Big striped sun rising behind the mid-layer skyline.
  drawSynthwaveSun(g, width * 0.62, height * 0.52, 150);

  // Ringed planet, right side.
  const px = width * 0.86;
  const py = height * 0.2;
  const pr = 34;
  const body = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr);
  body.addColorStop(0, '#9f7bff');
  body.addColorStop(1, '#2a1055');
  g.fillStyle = body;
  g.beginPath();
  g.arc(px, py, pr, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(120, 240, 255, 0.75)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(px, py, pr * 1.7, pr * 0.5, -0.35, 0, Math.PI * 2);
  g.stroke();

  // A few faint pin stars so this band isn't empty between bodies.
  const rng = new SeededRng(90210);
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = rng.range(0.2, 0.7);
    g.fillStyle = '#ffffff';
    g.fillRect(rng.range(0, width), rng.range(0, height), 1.4, 1.4);
  }
  g.globalAlpha = 1;
  return canvas;
}

function generateMidLayer(width: number, height: number): GenCanvas {
  const canvas = createGenCanvas(width, height);
  const g = ctx2d(canvas);
  const rng = new SeededRng(777007);

  const groundY = height;
  // Rolling skyline: overlapping dark towers with neon top edges.
  let x = -40;
  while (x < width + 40) {
    const w = rng.range(50, 130);
    const h = rng.range(height * 0.12, height * 0.42);
    const top = groundY - h;
    g.fillStyle = '#12062b';
    g.fillRect(x, top, w, h);

    const neon = g.createLinearGradient(x, top, x + w, top);
    neon.addColorStop(0, '#ff2fd6');
    neon.addColorStop(1, '#41f6ff');
    g.strokeStyle = neon;
    g.lineWidth = 2;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + w, top);
    g.stroke();
    g.globalAlpha = 1;

    // Sparse lit windows.
    const windows = rng.int(0, 5);
    for (let i = 0; i < windows; i++) {
      g.fillStyle = rng.next() < 0.5 ? 'rgba(65,246,255,0.8)' : 'rgba(255,47,214,0.8)';
      g.fillRect(x + rng.range(6, Math.max(7, w - 10)), top + rng.range(10, Math.max(11, h - 14)), 3, 4);
    }
    x += w + rng.range(-8, 18);
  }
  return canvas;
}

function generateForeground(width: number, height: number): GenCanvas {
  const canvas = createGenCanvas(width, height);
  const g = ctx2d(canvas);
  const rng = new SeededRng(424242);

  // Perspective floor grid, fading out above the playfield bottom.
  g.strokeStyle = 'rgba(255, 47, 214, 0.35)';
  g.lineWidth = 1.5;
  for (let y = height - 10; y > height * 0.55; y -= (height - y) * 0.06 + 6) {
    g.globalAlpha = Math.min(1, (y - height * 0.55) / (height * 0.45));
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Occasional glowing data-pillar silhouettes.
  const pillars = rng.int(2, 4);
  for (let i = 0; i < pillars; i++) {
    const px = rng.range(0, width);
    const pw = rng.range(10, 26);
    const ph = rng.range(height * 0.18, height * 0.5);
    const grad = g.createLinearGradient(px, height, px, height - ph);
    grad.addColorStop(0, 'rgba(65,246,255,0.5)');
    grad.addColorStop(1, 'rgba(65,246,255,0)');
    g.fillStyle = grad;
    g.fillRect(px, height - ph, pw, ph);
  }
  return canvas;
}

const GENERATORS: ReadonlyArray<(width: number, height: number) => GenCanvas> = [
  generateNebula,
  generateStarfield,
  generateCelestial,
  generateMidLayer,
  generateForeground,
];

// --------------------------------------------------------------- component ---

export class ParallaxBackground {
  private readonly renderer: WebGPURenderer;
  private generated = false;

  /** Smoothed camera position actually used for scrolling. */
  private smoothedCameraX = 0;
  private lastFrameMs: number | null = null;
  /** Accumulated ambient drift phase per layer (virtual px). */
  private driftPhases = PARALLAX_LAYERS.map(() => 0);

  public constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
  }

  /**
   * Procedurally generate all five layers as offscreen canvases and upload
   * them to GPU textures. Call once during bootstrap, before the first frame.
   */
  public async generate(): Promise<void> {
    if (this.generated) return;

    // Yield to the event loop between uploads so first paint stays responsive.
    for (let i = 0; i < PARALLAX_LAYERS.length; i++) {
      const layer = PARALLAX_LAYERS[i];
      const generate = GENERATORS[i];
      if (!layer || !generate) continue;
      await Promise.resolve();
      this.renderer.createTextureFromCanvas(layer.name, generate(layer.tileWidth, VIRTUAL_HEIGHT));
    }

    this.generated = true;
    this.lastFrameMs = null; // don't integrate a giant dt on the first frame
  }

  /**
   * Draw every layer across the current view bounds (which include side
   * gutters on wider screens), back-to-front in depth order.
   *
   * `cameraX` is the gameplay camera's world position; it is treated as the
   * smoothing *target*, and each layer advances by
   * `smoothedCameraX * scrollFactor + ambientDriftPhase`.
   */
  public draw(cameraX?: number): void {
    if (!this.generated) return;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let frameSeconds = 1 / 60;
    if (this.lastFrameMs !== null) {
      frameSeconds = Math.min(Math.max((nowMs - this.lastFrameMs) / 1000, 0), MAX_FRAME_SECONDS);
    }
    this.lastFrameMs = nowMs;

    const target = typeof cameraX === 'number' && Number.isFinite(cameraX) ? cameraX : this.smoothedCameraX;
    this.smoothedCameraX = smoothTowards(
      this.smoothedCameraX,
      target,
      frameSeconds,
      SMOOTHING_RESPONSE_SECONDS,
    );

    const bounds = this.renderer.viewBounds;
    const viewHeight = bounds.bottom - bounds.top;

    for (let i = 0; i < PARALLAX_LAYERS.length; i++) {
      const layer = PARALLAX_LAYERS[i];
      if (!layer) continue;
      const size = this.renderer.textureSize(layer.name);
      if (!size) continue;

      this.driftPhases[i] = (this.driftPhases[i] ?? 0) + layer.driftPxPerSec * frameSeconds;
      const rawOffset = this.smoothedCameraX * layer.scrollFactor + (this.driftPhases[i] ?? 0);
      const offset = wrapPeriod(rawOffset, layer.tileWidth);

      const xs = computeTilePositions(bounds.left, bounds.right, layer.tileWidth, offset);
      if (xs.length === 0) continue;

      const blend: SpriteDraw['blend'] = layer.additive ? 'additive' : 'normal';
      const tiles: SpriteDraw[] = xs.map((x) => ({
        x,
        y: bounds.top,
        width: layer.tileWidth,
        height: viewHeight,
        tint: [1, 1, 1, layer.alpha],
        blend,
      }));
      this.renderer.drawSprites(layer.name, tiles);
    }
  }
}
