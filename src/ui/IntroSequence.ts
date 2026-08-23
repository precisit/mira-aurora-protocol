import { ARCHIVE_EPIGRAPH } from './archive';
import { SeededRng } from '../core/Rng';
import { ParallaxLayerName, type ParallaxBackground } from '../renderer/ParallaxBackground';
import type { WebGPURenderer } from '../renderer/WebGPURenderer';
import {
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type Rgba,
  type SpriteDraw,
  type ViewBounds,
} from '../renderer/types';

export type IntroSceneId = 'ignition' | 'xeno' | 'awakening' | 'title';

export interface IntroScene {
  readonly id: IntroSceneId;
  readonly durationSeconds: number;
  readonly caption: string;
  readonly subtitle: string;
}

export const INTRO_TITLE = 'AURORA PROTOCOL';

export const INTRO_TAGLINE = normalizeNeonText(ARCHIVE_EPIGRAPH);

export const INTRO_SCENES: readonly IntroScene[] = [
  {
    id: 'ignition',
    durationSeconds: 4.0,
    caption: '2147 \u00B7 THE MNEMOSYNE ARCHIVE',
    subtitle: 'EVERYTHING HUMANITY EVER MADE, KEPT IN ORBIT',
  },
  {
    id: 'xeno',
    durationSeconds: 3.2,
    caption: 'THEN CAME XENO',
    subtitle: 'IT DOES NOT EAT FLESH OR STEEL \u2014 IT EATS INFORMATION',
  },
  {
    id: 'awakening',
    durationSeconds: 3.8,
    caption: 'PROTOCOL: DOWNLOAD EVERYTHING',
    subtitle: 'ONE SMALL DROID CARRIES THE MEMORY OF A SPECIES',
  },
  {
    id: 'title',
    durationSeconds: 3.4,
    caption: INTRO_TITLE,
    subtitle: INTRO_TAGLINE,
  },
];

export const INTRO_TOTAL_SECONDS: number = sumDurations(INTRO_SCENES);

export const TITLE_CARD_LINES: readonly [string, string] = ['AURORA', 'PROTOCOL'];

export const SKIP_HINT_TEXT = 'PRESS ANY KEY TO SKIP';

const EXPECTED_SCENE_ORDER: readonly IntroSceneId[] = ['ignition', 'xeno', 'awakening', 'title'];

function sumDurations(scenes: readonly IntroScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
}

export function validateIntroScript(
  scenes: readonly IntroScene[] = INTRO_SCENES,
): readonly string[] {
  const problems: string[] = [];
  if (scenes.length === 0) problems.push('intro script has no scenes');
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    if (scene.id !== EXPECTED_SCENE_ORDER[i]) {
      problems.push(`scene ${i} has id "${scene.id}", expected "${EXPECTED_SCENE_ORDER[i]}"`);
    }
    if (!(scene.durationSeconds > 0) || !Number.isFinite(scene.durationSeconds)) {
      problems.push(`scene "${scene.id}" has an invalid duration`);
    }
    if (!scene.caption || scene.caption.trim().length === 0) {
      problems.push(`scene "${scene.id}" has an empty caption`);
    }
  }
  const total = sumDurations(scenes);
  if (!(total >= 10 && total <= 15)) {
    problems.push(`total intro length ${total.toFixed(1)}s is outside the 10\u201315s target`);
  }
  return problems;
}

export interface IntroTimelinePoint {
  readonly index: number;
  readonly scene: IntroScene;
  readonly localSeconds: number;
  readonly localT: number;
}

export function introSceneAt(
  timeSeconds: number,
  scenes: readonly IntroScene[] = INTRO_SCENES,
): IntroTimelinePoint {
  const total = sumDurations(scenes);
  const clamped = Math.min(Math.max(timeSeconds, 0), total);
  let elapsed = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    if (clamped < elapsed + scene.durationSeconds || i === scenes.length - 1) {
      const local = Math.min(clamped - elapsed, scene.durationSeconds);
      return {
        index: i,
        scene,
        localSeconds: Math.max(0, local),
        localT: local / scene.durationSeconds,
      };
    }
    elapsed += scene.durationSeconds;
  }
  const fallback = scenes[scenes.length - 1] as IntroScene | undefined;
  return { index: 0, scene: fallback as IntroScene, localSeconds: 0, localT: 0 };
}

export type IntroEndReason = 'skipped' | 'completed';

export class IntroPlayback {
  private seconds = 0;
  private done = false;
  private endReason: IntroEndReason | null = null;

  public get timeSeconds(): number {
    return this.seconds;
  }

  public get finished(): boolean {
    return this.done;
  }

  public get endedBy(): IntroEndReason | null {
    return this.endReason;
  }

  public get point(): IntroTimelinePoint {
    return introSceneAt(this.seconds);
  }

  public advance(dtSeconds: number): void {
    if (this.done) return;
    this.seconds += Math.max(0, dtSeconds);
    if (this.seconds >= INTRO_TOTAL_SECONDS) this.finish('completed');
  }

  public skip(): boolean {
    if (this.done) return false;
    this.finish('skipped');
    return true;
  }

  public reset(): void {
    this.seconds = 0;
    this.done = false;
    this.endReason = null;
  }

  private finish(reason: IntroEndReason): void {
    this.done = true;
    this.endReason = reason;
    this.seconds = INTRO_TOTAL_SECONDS;
  }
}

type Glyph = readonly [number, number, number, number, number, number, number];

const G = (...rows: Glyph): Glyph => rows;

export const NEON_FONT: Readonly<Record<string, Glyph>> = {
  A: G(0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001),
  B: G(0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110),
  C: G(0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110),
  D: G(0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110),
  E: G(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111),
  F: G(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000),
  G: G(0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111),
  H: G(0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001),
  I: G(0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111),
  J: G(0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100),
  K: G(0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001),
  L: G(0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111),
  M: G(0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001),
  N: G(0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001),
  O: G(0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110),
  P: G(0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000),
  Q: G(0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101),
  R: G(0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001),
  S: G(0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110),
  T: G(0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100),
  U: G(0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110),
  V: G(0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100),
  W: G(0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001),
  X: G(0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001),
  Y: G(0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100),
  Z: G(0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111),
  '0': G(0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110),
  '1': G(0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110),
  '2': G(0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111),
  '3': G(0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110),
  '4': G(0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010),
  '5': G(0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110),
  '6': G(0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110),
  '7': G(0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000),
  '8': G(0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110),
  '9': G(0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100),
  "'": G(0b00110, 0b00110, 0b01100, 0b00000, 0b00000, 0b00000, 0b00000),
  ',': G(0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00110, 0b01100),
  '.': G(0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100),
  ':': G(0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000),
  '-': G(0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000),
  '\u00B7': G(0b00000, 0b00000, 0b01100, 0b01100, 0b00000, 0b00000, 0b00000),
};

export function normalizeNeonText(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-');
}

export function measureNeonText(text: string, cellSize = 1, trackingCells = 1): number {
  const normalized = normalizeNeonText(text);
  if (normalized.length === 0) return 0;
  const advance = (5 + trackingCells) * cellSize;
  return normalized.length * advance - trackingCells * cellSize;
}

export interface NeonTextOptions {
  x: number;
  y: number;
  cellSize: number;
  tint: Rgb;
  glow?: Rgba;
  trackingCells?: number;
  alphaFor?: (charIndex: number) => number;
}

export function appendNeonText(out: SpriteDraw[], text: string, o: NeonTextOptions): void {
  const normalized = normalizeNeonText(text);
  if (normalized.length === 0) return;
  const tracking = o.trackingCells ?? 1;
  const advance = (5 + tracking) * o.cellSize;
  const startX = o.x - measureNeonText(normalized, o.cellSize, tracking) / 2;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i] as string;
    const alpha = o.alphaFor ? Math.min(1, Math.max(0, o.alphaFor(i))) : 1;
    const glyphX = startX + i * advance;
    if (alpha <= 0 || char === ' ') continue;
    const glyph = NEON_FONT[char];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row++) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < 5; col++) {
        if ((bits & (1 << (4 - col))) === 0) continue;
        out.push({
          x: glyphX + col * o.cellSize,
          y: o.y + row * o.cellSize,
          width: o.cellSize,
          height: o.cellSize,
          tint: [o.tint[0], o.tint[1], o.tint[2], clamp01(alpha)],
          glow: o.glow,
          blend: 'additive',
        });
      }
    }
  }
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (!(edge1 > edge0)) return clamp01(x - edge0);
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

export function hash01(seed: number): number {
  let t = (seed + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const STAR_COUNT = 170;

interface IntroStar {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly baseAlpha: number;
  readonly twinkleHz: number;
  readonly phase: number;
  readonly driftPxPerSec: number;
}

function generateStars(): readonly IntroStar[] {
  const rng = new SeededRng(2147);
  const stars: IntroStar[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: rng.range(-160, VIRTUAL_WIDTH + 160),
      y: rng.range(0, VIRTUAL_HEIGHT),
      size: rng.next() < 0.82 ? rng.range(1, 1.8) : rng.range(2, 3),
      baseAlpha: rng.range(0.35, 1),
      twinkleHz: rng.range(0.15, 0.9),
      phase: rng.range(0, Math.PI * 2),
      driftPxPerSec: rng.range(5, 22),
    });
  }
  return stars;
}

interface DataMote {
  readonly offsetX: number;
  readonly riseFrom: number;
  readonly speed: number;
  readonly phase: number;
  readonly size: number;
}

function generateMotes(): readonly DataMote[] {
  const rng = new SeededRng(77);
  const motes: DataMote[] = [];
  for (let i = 0; i < 26; i++) {
    motes.push({
      offsetX: rng.range(-260, 260),
      riseFrom: rng.range(0.55, 1),
      speed: rng.range(0.35, 0.75),
      phase: rng.range(0, 1),
      size: rng.range(2, 3.5),
    });
  }
  return motes;
}

const NEON_CYAN: Rgb = [0.35, 0.95, 1];
const NEON_MAGENTA: Rgb = [1, 0.3, 0.85];
const XENO_RED: Rgb = [1, 0.16, 0.2];
const WARM_GOLD: Rgb = [1, 0.78, 0.42];
const HULL_DARK: Rgb = [0.05, 0.07, 0.16];
const HULL_MID: Rgb = [0.09, 0.12, 0.24];

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

type Rgb = readonly [number, number, number];

interface RectOptions {
  tint: Rgb;
  alpha: number;
  blend?: SpriteDraw['blend'];
  glow?: Rgba;
}

function rect(
  out: SpriteDraw[],
  x: number,
  y: number,
  width: number,
  height: number,
  o: RectOptions,
): void {
  if (o.alpha <= 0.002 || width <= 0 || height <= 0) return;
  out.push({
    x,
    y,
    width,
    height,
    tint: [o.tint[0], o.tint[1], o.tint[2], clamp01(o.alpha)],
    blend: o.blend ?? 'normal',
    glow: o.glow,
  });
}

function rgb(r: number, g: number, b: number): Rgb {
  return [r, g, b];
}

function rectOutline(
  out: SpriteDraw[],
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  o: RectOptions,
): void {
  rect(out, x, y, width, thickness, o);
  rect(out, x, y + height - thickness, width, thickness, o);
  rect(out, x, y + thickness, thickness, height - thickness * 2, o);
  rect(out, x + width - thickness, y + thickness, thickness, height - thickness * 2, o);
}

interface ShipState {
  cx: number;
  cy: number;
  alpha: number;
  windowLit: number;
  corruption: number;
  timeSeconds: number;
}

function appendShip(out: SpriteDraw[], s: ShipState): void {
  const jitter = s.corruption > 0 ? (hash01(Math.floor(s.timeSeconds * 13) * 7) - 0.5) * 7 * s.corruption : 0;
  const cx = s.cx + jitter;
  const cy = s.cy;
  const a = s.alpha;
  if (a <= 0.003) return;

  rect(out, cx - 190, cy - 22, 380, 44, { tint: HULL_MID, alpha: a });
  rect(out, cx - 120, cy - 34, 180, 14, { tint: HULL_MID, alpha: a });
  rect(out, cx - 40, cy - 52, 36, 20, { tint: HULL_DARK, alpha: a });
  rect(out, cx - 24, cy - 66, 3, 14, { tint: HULL_DARK, alpha: a });
  rect(out, cx - 70, cy + 22, 90, 10, { tint: HULL_DARK, alpha: a });
  rect(out, cx - 208, cy - 18, 26, 16, { tint: HULL_DARK, alpha: a });
  rect(out, cx - 208, cy + 2, 26, 16, { tint: HULL_DARK, alpha: a });

  const pulse = 0.55 + 0.45 * Math.sin(s.timeSeconds * 6.5);
  rect(out, cx - 222, cy - 16, 14, 12, {
    tint: rgb(1, 0.62, 0.25),
    alpha: a * (0.35 + 0.4 * pulse),
    blend: 'additive',
    glow: [1, 0.55, 0.2, 1.6],
  });
  rect(out, cx - 222, cy + 4, 14, 12, {
    tint: NEON_CYAN,
    alpha: a * (0.3 + 0.35 * pulse),
    blend: 'additive',
    glow: [0.3, 0.9, 1, 1.5],
  });

  const trimColor = mixColor(NEON_CYAN, XENO_RED, s.corruption);
  const trimColorB = mixColor(NEON_MAGENTA, XENO_RED, s.corruption);
  const trimFlicker =
    s.corruption > 0 && hash01(Math.floor(s.timeSeconds * 17) * 29) < 0.3 * s.corruption ? 0.3 : 1;
  rect(out, cx - 188, cy - 25, 376, 2.5, {
    tint: trimColor,
    alpha: a * 0.85 * trimFlicker,
    blend: 'additive',
    glow: [trimColor[0], trimColor[1], trimColor[2], 1.7],
  });
  rect(out, cx - 188, cy + 21, 376, 2.5, {
    tint: trimColorB,
    alpha: a * 0.85 * trimFlicker,
    blend: 'additive',
    glow: [trimColorB[0], trimColorB[1], trimColorB[2], 1.7],
  });

  const blink = Math.sin(s.timeSeconds * 3.2) > 0.55 ? 1 : 0.15;
  rect(out, cx + 176, cy - 2, 5, 5, {
    tint: rgb(1, 0.35, 0.3),
    alpha: a * blink,
    blend: 'additive',
  });

  const litCount = Math.round(14 * s.windowLit);
  for (let i = 0; i < 14; i++) {
    const wx = cx + 158 - i * 24;
    if (i < litCount) {
      rect(out, wx, cy - 10, 8, 6, {
        tint: rgb(1, 0.93, 0.72),
        alpha: a * 0.9,
        blend: 'additive',
        glow: [1, 0.85, 0.5, 1.2],
      });
      rect(out, wx, cy + 6, 8, 5, {
        tint: NEON_CYAN,
        alpha: a * 0.55,
        blend: 'additive',
      });
    } else {
      rect(out, wx, cy - 10, 8, 6, { tint: HULL_DARK, alpha: a });
      rect(out, wx, cy + 6, 8, 5, { tint: HULL_DARK, alpha: a });
    }
  }

  rect(out, cx - 130, cy + 34, 260, 30, {
    tint: NEON_CYAN,
    alpha: a * (0.07 + 0.03 * pulse) * (1 - s.corruption),
    blend: 'additive',
  });
}

interface DroidState {
  cx: number;
  cy: number;
  scale: number;
  alpha: number;
  eyeOpen: number;
  timeSeconds: number;
}

function appendDroid(out: SpriteDraw[], s: DroidState): void {
  const { cx, cy, scale } = s;
  const a = s.alpha;
  const e = clamp01(s.eyeOpen);
  if (a <= 0.003 || scale <= 0) return;

  rect(out, cx - 460 * scale, cy - 280 * scale, 920 * scale, 560 * scale, {
    tint: WARM_GOLD,
    alpha: 0.05 * a,
    blend: 'additive',
  });
  rect(out, cx - 340 * scale, cy - 210 * scale, 680 * scale, 420 * scale, {
    tint: WARM_GOLD,
    alpha: 0.07 * a,
    blend: 'additive',
  });
  rect(out, cx - 230 * scale, cy - 150 * scale, 460 * scale, 300 * scale, {
    tint: NEON_CYAN,
    alpha: 0.08 * a,
    blend: 'additive',
  });
  rect(out, cx - 140 * scale, cy - 96 * scale, 280 * scale, 192 * scale, {
    tint: NEON_CYAN,
    alpha: 0.13 * a,
    blend: 'additive',
    glow: [0.35, 0.9, 1, 1.2],
  });

  const R = (x: number, y: number, w: number, h: number, o: RectOptions): void => {
    rect(out, cx + x * scale, cy + y * scale, w * scale, h * scale, { ...o, alpha: o.alpha * a });
  };

  R(-24, -54, 48, 12, { tint: HULL_DARK, alpha: 1 });
  R(-32, -44, 64, 20, { tint: HULL_MID, alpha: 1 });
  R(-40, -26, 80, 46, { tint: HULL_MID, alpha: 1 });
  R(-48, 20, 96, 8, { tint: HULL_DARK, alpha: 1 });
  R(-56, 28, 112, 8, { tint: HULL_MID, alpha: 1 });
  R(-56, -8, 14, 32, { tint: HULL_DARK, alpha: 1 });
  R(42, -8, 14, 32, { tint: HULL_DARK, alpha: 1 });

  R(-30, -45, 60, 2, { tint: NEON_CYAN, alpha: 0.85, blend: 'additive', glow: [0.35, 0.9, 1, 1.6] });
  R(-52, 35, 104, 2, { tint: NEON_CYAN, alpha: 0.8, blend: 'additive', glow: [0.35, 0.9, 1, 1.6] });
  R(-57, -6, 2, 28, { tint: NEON_CYAN, alpha: 0.7, blend: 'additive' });
  R(55, -6, 2, 28, { tint: NEON_CYAN, alpha: 0.7, blend: 'additive' });

  const flame = 0.45 + 0.55 * hash01(Math.floor(s.timeSeconds * 30));
  R(-38, 37, 18, 8 + 10 * flame, {
    tint: NEON_CYAN,
    alpha: 0.5 * flame,
    blend: 'additive',
    glow: [0.35, 0.9, 1, 1.4],
  });
  R(20, 37, 18, 8 + 10 * (1 - flame), {
    tint: NEON_CYAN,
    alpha: 0.5 * flame,
    blend: 'additive',
    glow: [0.35, 0.9, 1, 1.4],
  });

  const eyeW = 12 + 14 * e;
  const eyeH = 8 + 10 * e;
  R(-eyeW / 2, -34 - eyeH / 2, eyeW, eyeH, {
    tint: WARM_GOLD,
    alpha: 0.25 + 0.35 * e,
    blend: 'additive',
    glow: [1, 0.75, 0.35, 2.2],
  });
  R(-(eyeW * 0.45) / 2, -34 - (eyeH * 0.5) / 2, eyeW * 0.45, eyeH * 0.5, {
    tint: rgb(1, 0.96, 0.85),
    alpha: e,
    blend: 'additive',
    glow: [1, 0.9, 0.6, 2.4],
  });
}

export interface IntroSequenceOptions {
  parallax?: ParallaxBackground;
  onFinish?: () => void;
}

interface SkipTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function defaultSkipTarget(): SkipTargetLike {
  if (typeof window === 'undefined') {
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }
  return window as unknown as SkipTargetLike;
}

const SKIP_GRACE_MS = 400;
const SCENE_FADE_SECONDS = 0.42;

function captionAppearAt(sceneId: IntroSceneId): number {
  switch (sceneId) {
    case 'ignition':
      return 1.5;
    case 'xeno':
      return 0.9;
    case 'awakening':
      return 0.7;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

export class IntroSequence {
  public static hasPlayedThisSession = false;

  public static shouldPlay(): boolean {
    return !IntroSequence.hasPlayedThisSession;
  }

  public static markPlayed(): void {
    IntroSequence.hasPlayedThisSession = true;
  }

  public readonly playback = new IntroPlayback();
  public onFinish: (() => void) | undefined;

  private readonly renderer: WebGPURenderer;
  private readonly parallax: ParallaxBackground | undefined;
  private readonly stars: readonly IntroStar[] = generateStars();
  private readonly motes: readonly DataMote[] = generateMotes();
  private startTimestampMs = nowMs();
  private finishFired = false;
  private skipDetachers: Array<() => void> = [];

  public constructor(renderer: WebGPURenderer, options: IntroSequenceOptions = {}) {
    this.renderer = renderer;
    this.parallax = options.parallax;
    this.onFinish = options.onFinish;
  }

  public start(): void {
    this.playback.reset();
    this.finishFired = false;
    this.startTimestampMs = nowMs();
  }

  public attach(target: SkipTargetLike = defaultSkipTarget()): () => void {
    const events = ['keydown', 'pointerdown', 'touchend'] as const;
    const handler = (): void => this.requestSkip();
    for (const event of events) target.addEventListener(event, handler);
    const detach = (): void => {
      for (const event of events) target.removeEventListener(event, handler);
      this.skipDetachers = this.skipDetachers.filter((d) => d !== detach);
    };
    this.skipDetachers.push(detach);
    return detach;
  }

  public dispose(): void {
    for (const detach of [...this.skipDetachers]) detach();
    this.skipDetachers = [];
  }

  private requestSkip(): void {
    if (this.playback.finished) return;
    if (nowMs() - this.startTimestampMs < SKIP_GRACE_MS) return;
    this.playback.skip();
  }

  public update(dtSeconds: number): void {
    this.playback.advance(dtSeconds);
    if (this.playback.finished && !this.finishFired) {
      this.finishFired = true;
      this.onFinish?.();
    }
  }

  public render(): void {
    const p = this.playback.point;
    const b = this.renderer.viewBounds;
    const t = p.localSeconds;
    const dur = p.scene.durationSeconds;

    if (p.scene.id === 'title') {
      this.parallax?.draw(t * 26);
    } else if (p.scene.id === 'ignition') {
      const nebula = this.renderer.textureSize(ParallaxLayerName.Nebula);
      if (nebula) {
        const ignite = smoothstep(0.15, 1.5, t);
        this.renderer.drawSprites(ParallaxLayerName.Nebula, [
          {
            x: b.left,
            y: b.top,
            width: b.right - b.left,
            height: b.bottom - b.top,
            tint: [0.55, 0.4, 0.9, 0.16 * ignite],
            blend: 'normal',
          },
        ]);
      }
    }

    const out: SpriteDraw[] = [];
    switch (p.scene.id) {
      case 'ignition':
        this.drawIgnition(out, t);
        break;
      case 'xeno':
        this.drawXeno(out, b, t, dur);
        break;
      case 'awakening':
        this.drawAwakening(out, b, t, dur);
        break;
      case 'title':
        this.drawTitle(out, t, dur);
        break;
    }
    if (p.scene.id !== 'title') {
      drawSceneCaption(
        out,
        p.scene.caption,
        p.scene.subtitle,
        captionAppearAt(p.scene.id),
        t,
      );
    }
    this.drawSkipHint(out, b);
    drawFadeOverlay(out, b, p.index, t, dur);

    this.renderer.drawSprites('white', out);
  }

  private emitStars(
    out: SpriteDraw[],
    time: number,
    masterAlpha: number,
    opts: { consumeFrontX?: number; redShift?: number } = {},
  ): void {
    const span = VIRTUAL_WIDTH + 320;
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      if (!star) continue;
      const x = ((((star.x + 160 - star.driftPxPerSec * time) % span) + span) % span) - 160;
      const twinkle = 0.7 + 0.3 * Math.sin(star.twinkleHz * Math.PI * 2 * time + star.phase);
      let alpha = masterAlpha * star.baseAlpha * twinkle;
      if (opts.consumeFrontX !== undefined && x > opts.consumeFrontX) alpha *= 0.12;
      if (alpha <= 0.004) continue;
      const base: Rgb =
        i % 7 === 0 ? rgb(0.72, 0.93, 1) : i % 11 === 0 ? rgb(1, 0.78, 0.94) : rgb(1, 1, 1);
      const tint = opts.redShift ? mixColor(base, XENO_RED, Math.min(1, opts.redShift)) : base;
      const glowing = star.size > 2;
      out.push({
        x,
        y: star.y,
        width: star.size,
        height: star.size,
        tint: [tint[0], tint[1], tint[2], clamp01(alpha)],
        blend: glowing ? 'additive' : 'normal',
        glow: glowing ? [tint[0], tint[1], tint[2], 1.5] : undefined,
      });
    }
  }

  private drawIgnition(out: SpriteDraw[], t: number): void {
    const ignite = smoothstep(0.15, 1.5, t);
    this.emitStars(out, t, ignite);
    const shipAlpha = smoothstep(0.9, 2.1, t);
    appendShip(out, {
      cx: 620,
      cy: 300,
      alpha: shipAlpha,
      windowLit: 1,
      corruption: 0,
      timeSeconds: t,
    });
  }

  private drawXeno(out: SpriteDraw[], b: ViewBounds, t: number, dur: number): void {
    const sweep = easeInOutCubic(clamp01((t - 0.2) / (dur * 0.72)));
    const frontX = b.right + 140 + (b.left - 200 - (b.right + 140)) * sweep;

    this.emitStars(out, t, 1, { consumeFrontX: frontX, redShift: 0.35 * sweep });

    appendShip(out, {
      cx: 620,
      cy: 300,
      alpha: 1,
      windowLit: 1 - smoothstep(dur * 0.25, dur * 0.8, t),
      corruption: smoothstep(dur * 0.2, dur * 0.7, t),
      timeSeconds: t,
    });

    const fillRight = b.right + 320;
    rect(out, frontX, b.top, fillRight - frontX, b.bottom - b.top, {
      tint: rgb(0.07, 0.01, 0.12),
      alpha: 0.94,
    });

    const bandCount = 5;
    const bandWidth = (fillRight - frontX) / bandCount;
    for (let k = 0; k < bandCount; k++) {
      const bandTint = mixColor(XENO_RED, NEON_MAGENTA, hash01(k * 41 + Math.floor(t * 6)));
      rect(out, frontX + k * bandWidth, b.top, bandWidth, b.bottom - b.top, {
        tint: bandTint,
        alpha: 0.05 + 0.02 * k,
        blend: 'additive',
      });
    }

    rect(out, frontX - 3, b.top, 5, b.bottom - b.top, {
      tint: rgb(1, 0.55, 0.95),
      alpha: 0.85,
      blend: 'additive',
      glow: [1, 0.3, 0.85, 2.4],
    });
    rect(out, frontX - 18, b.top, 2, b.bottom - b.top, {
      tint: NEON_MAGENTA,
      alpha: 0.4,
      blend: 'additive',
    });

    const flick = Math.floor(t * 22);
    for (let k = 0; k < 14; k++) {
      const sy = b.top + hash01(k * 57 + flick) * (b.bottom - b.top);
      const len = 30 + hash01(k * 91 + flick) * 150;
      const th = 2 + hash01(k * 13 + flick) * 4;
      const side = hash01(k * 7 + flick) < 0.5 ? -1 : 1;
      const sx = frontX + side * (16 + hash01(k * 3 + flick) * 90);
      const tint = k % 3 === 0 ? NEON_CYAN : k % 3 === 1 ? NEON_MAGENTA : XENO_RED;
      rect(out, sx - len / 2, sy, len, th, {
        tint,
        alpha: 0.2 + 0.55 * hash01(k * 23 + flick),
        blend: 'additive',
        glow: [tint[0], tint[1], tint[2], 1.6],
      });
    }

    const pulse = 0.14 + 0.12 * Math.sin(t * 7.5);
    const edge = 24;
    const edgeOpts = {
      tint: XENO_RED,
      alpha: pulse,
      blend: 'additive' as const,
      glow: [1, 0.16, 0.2, 1.8] as Rgba,
    };
    rect(out, b.left, b.top, b.right - b.left, edge, edgeOpts);
    rect(out, b.left, b.bottom - edge, b.right - b.left, edge, edgeOpts);
    rect(out, b.left, b.top, edge, b.bottom - b.top, edgeOpts);
    rect(out, b.right - edge, b.top, edge, b.bottom - b.top, edgeOpts);
  }

  private drawAwakening(out: SpriteDraw[], b: ViewBounds, t: number, dur: number): void {
    this.emitStars(out, t * 0.35, 0.13);

    const cx = VIRTUAL_WIDTH / 2;
    const cy = 340;
    const pop = easeOutCubic(smoothstep(0.06, 0.5, t));
    const eyeOpen = smoothstep(dur * 0.3, dur * 0.55, t);

    appendDroid(out, {
      cx,
      cy,
      scale: pop,
      alpha: smoothstep(0.04, 0.35, t),
      eyeOpen,
      timeSeconds: t,
    });

    for (let k = 0; k < 3; k++) {
      const rp = clamp01((t - (dur * 0.32 + k * 0.42)) / 1.15);
      if (rp <= 0 || rp >= 1) continue;
      const half = 80 + rp * 260;
      const alpha = (1 - rp) * 0.4;
      rectOutline(
        out,
        cx - half,
        cy - half,
        half * 2,
        half * 2,
        3,
        { tint: NEON_CYAN, alpha, blend: 'additive', glow: [0.35, 0.9, 1, 1.5] },
      );
    }

    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i];
      if (!mote) continue;
      const p = frac(t * mote.speed + mote.phase);
      const my = b.bottom + 40 + (cy - 10 - (b.bottom + 40)) * p;
      const mx = cx + mote.offsetX * (0.35 + 0.65 * p) + Math.sin(t * 2.2 + mote.phase * 19) * 9;
      const ma = Math.sin(Math.PI * p) * 0.6 * smoothstep(0.12, 0.35, t);
      rect(out, mx, my, mote.size, mote.size, {
        tint: NEON_CYAN,
        alpha: ma,
        blend: 'additive',
        glow: [0.35, 0.9, 1, 1.3],
      });
    }

    const dl = smoothstep(dur * 0.18, dur * 0.86, t);
    const barX = cx - 172;
    const barY = cy + 118;
    rectOutline(out, barX, barY, 344, 10, 2, {
      tint: NEON_CYAN,
      alpha: 0.55,
      blend: 'additive',
    });
    rect(out, barX + 2, barY + 2, 340 * dl, 6, {
      tint: NEON_CYAN,
      alpha: 0.85,
      blend: 'additive',
      glow: [0.35, 0.95, 1, 2],
    });
    appendNeonText(out, 'DOWNLOADING ARCHIVE', {
      x: cx,
      y: barY - 22,
      cellSize: 2,
      tint: rgb(0.7, 0.9, 1),
      alphaFor: () => 0.8 * smoothstep(0.15, 0.4, t),
      glow: [0.35, 0.9, 1, 0.8],
    });
  }

  private drawTitle(out: SpriteDraw[], t: number, _dur: number): void {
    const b = this.renderer.viewBounds;
    rect(out, b.left, b.top, b.right - b.left, b.bottom - b.top, {
      tint: rgb(0, 0, 0),
      alpha: 0.34,
    });

    const revealAlpha = (charIndex: number): number => {
      const appearAt = 0.15 + charIndex * 0.075;
      const since = t - appearAt;
      if (since < 0) return 0;
      const flicker =
        since < 0.28 && hash01(charIndex * 97 + Math.floor(since * 26)) < 0.35 ? 0.35 : 1;
      return smoothstep(appearAt, appearAt + 0.18, t) * flicker;
    };

    const chromatic = (
      line: string,
      y: number,
      dx: number,
      dy: number,
      tint: Rgb,
      strength: number,
      glow?: Rgba,
    ): void => {
      appendNeonText(out, line, {
        x: VIRTUAL_WIDTH / 2 + dx,
        y: y + dy,
        cellSize: 10,
        tint,
        glow,
        alphaFor: (i) => revealAlpha(i + this.lineOffset(line)) * strength,
      });
    };

    for (const [lineIndex, line] of TITLE_CARD_LINES.entries()) {
      const y = lineIndex === 0 ? 240 : 330;
      chromatic(line, y, -2.5, 1.5, NEON_MAGENTA, 0.55);
      chromatic(line, y, 2.5, -1.5, NEON_CYAN, 0.55);
      chromatic(line, y, 0, 0, rgb(1, 1, 1), 0.97, [0.8, 0.95, 1, 1.9]);
    }

    const ruleWidth = 520 * easeOutCubic(smoothstep(0.9, 1.6, t));
    const ruleAlpha = smoothstep(0.85, 1.05, t) * 0.95;
    rect(out, VIRTUAL_WIDTH / 2 - ruleWidth / 2, 430, ruleWidth / 2, 3, {
      tint: NEON_CYAN,
      alpha: ruleAlpha,
      blend: 'additive',
      glow: [0.35, 0.95, 1, 2],
    });
    rect(out, VIRTUAL_WIDTH / 2, 430, ruleWidth / 2, 3, {
      tint: NEON_MAGENTA,
      alpha: ruleAlpha,
      blend: 'additive',
      glow: [1, 0.3, 0.85, 2],
    });

    const taglineAlpha = () => smoothstep(1.7, 2.35, t) * 0.92;
    appendNeonText(out, INTRO_TAGLINE, {
      x: VIRTUAL_WIDTH / 2,
      y: 464,
      cellSize: 3,
      tint: rgb(0.92, 0.97, 1),
      alphaFor: taglineAlpha,
      glow: [0.7, 0.9, 1, 1],
    });

    appendNeonText(out, 'MNEMOSYNE ARCHIVE \u00B7 2147', {
      x: VIRTUAL_WIDTH / 2,
      y: 636,
      cellSize: 2,
      tint: rgb(0.75, 0.8, 1),
      alphaFor: () => 0.32 * smoothstep(0.9, 1.6, t),
    });
  }

  private lineOffset(line: string): number {
    return line === TITLE_CARD_LINES[0] ? 0 : (TITLE_CARD_LINES[0]?.length ?? 0);
  }

  private drawSkipHint(out: SpriteDraw[], b: ViewBounds): void {
    const globalT = this.playback.timeSeconds;
    const alpha = smoothstep(1.1, 1.7, globalT) * (0.42 + 0.22 * Math.sin(globalT * 3.2));
    if (alpha <= 0.01) return;
    const width = measureNeonText(SKIP_HINT_TEXT, 2);
    appendNeonText(out, SKIP_HINT_TEXT, {
      x: Math.min(b.right, VIRTUAL_WIDTH) - 24 - width / 2,
      y: Math.min(b.bottom, VIRTUAL_HEIGHT) - 46,
      cellSize: 2,
      tint: rgb(0.72, 0.84, 1),
      alphaFor: () => alpha,
    });
  }
}

function drawSceneCaption(
  out: SpriteDraw[],
  caption: string,
  subtitle: string,
  appearAtSeconds: number,
  t: number,
): void {
  const a = smoothstep(appearAtSeconds, appearAtSeconds + 0.5, t);
  if (a <= 0.01) return;
  appendNeonText(out, caption, {
    x: VIRTUAL_WIDTH / 2,
    y: 584,
    cellSize: 4,
    tint: rgb(1, 1, 1),
    alphaFor: () => a,
    glow: [0.75, 0.9, 1, 1.15],
  });
  appendNeonText(out, subtitle, {
    x: VIRTUAL_WIDTH / 2,
    y: 626,
    cellSize: 2.4,
    tint: rgb(0.62, 0.88, 1),
    alphaFor: () => 0.85 * a,
    glow: [0.35, 0.9, 1, 0.7],
  });
}

function drawFadeOverlay(
  out: SpriteDraw[],
  b: ViewBounds,
  sceneIndex: number,
  localSeconds: number,
  durationSeconds: number,
): void {
  let f = 0;
  if (sceneIndex > 0) f = Math.max(f, 1 - smoothstep(0, SCENE_FADE_SECONDS, localSeconds));
  const outroFade = sceneIndex === INTRO_SCENES.length - 1 ? 0.55 : SCENE_FADE_SECONDS;
  f = Math.max(f, 1 - smoothstep(0, outroFade, durationSeconds - localSeconds));
  if (f <= 0.002) return;
  rect(out, b.left, b.top, b.right - b.left, b.bottom - b.top, {
    tint: rgb(0, 0, 0),
    alpha: f,
  });
}
