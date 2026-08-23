import { SeededRng } from '../core/Rng';
import type { Rgba, SpriteDraw } from '../renderer/types';

/**
 * ParticleSystem (PLAN.md §4 "Juice & effekter", B1).
 *
 * Object-pooled particle simulation for the arcade-feel layer: fragments,
 * sparks, dust, flashes and explosions. The pool is fully preallocated at
 * construction — after warmup, emit/burst/update/buildDraws perform **zero
 * allocations** (dead particles are recycled, draw quads are reused objects),
 * which keeps GC pressure off the 120 Hz fixed-timestep loop (PLAN.md §6
 * "Objektpooling").
 *
 * buildDraws() returns a truncation-safe *view* over the preallocated draw
 * records: shrinking the view never drops pooled quads (mirrors
 * game/ParticleSystem.ts), so a small frame can never leave `draws[n]`
 * undefined on a later bigger one.
 *
 * Rendering integrates through SpriteBatch: each live particle becomes one
 * `SpriteDraw` quad; glow particles use `'additive'` blending so they light
 * up the frame and feed the bloom post-pass.
 *
 * All randomness flows through a seeded {@link SeededRng}, so effect tests
 * and replays are deterministic (repo convention: no `Math.random()`).
 */

/** Default maximum simultaneous particles. */
export const DEFAULT_PARTICLE_CAPACITY = 1024;

/**
 * A number, or an inclusive `[min, max)` range rolled per particle.
 * Ranges give bursts organic variety without extra API surface.
 */
export type NumOrRange = number | readonly [number, number];

export interface EmitOptions {
  /** Spawn position, world pixels. */
  x: number;
  y: number;
  /** Initial velocity, px/s. Defaults to 0. */
  vx?: number;
  vy?: number;
  /** Downward acceleration, px/s². Positive = falls. Defaults to 0. */
  gravity?: number;
  /**
   * Exponential velocity damping coefficient (1/s). Higher = punchier stops.
   * Defaults to 0 (undamped).
   */
  drag?: number;
  /** Lifetime in seconds. Defaults to 0.5. */
  life?: NumOrRange;
  /** Start size in px (quads are square). Defaults to 6. */
  size?: NumOrRange;
  /** End size in px; interpolated linearly over life. Defaults to start size. */
  endSize?: NumOrRange;
  /** Start color. Defaults to opaque white. */
  color?: Rgba;
  /** End color (lerped over life); presets typically fade alpha → 0. Defaults to `color`. */
  endColor?: Rgba;
  /**
   * Neon-glow strength fed to the sprite glow channel (bloom fuel).
   * 0 disables the halo. Defaults to 0.
   */
  glow?: number;
  /** Blend mode. Defaults to `'additive'` (glow sparks read best lit up). */
  additive?: boolean;
}

export interface BurstOptions extends Omit<EmitOptions, 'vx' | 'vy'> {
  /** Number of particles to spawn (recycles the oldest when at capacity). */
  count: number;
  /** Center aim angle in radians; screen space is y-down so `-π/2` is up. */
  angle?: number;
  /** Total angular spread in radians (`2π` = omni, `0` = laser-straight). */
  spread?: number;
  /** Launch speed in px/s — scalar or range. Defaults to 120. */
  speed?: NumOrRange;
  /** Radial positional jitter in px. Defaults to 0. */
  jitter?: number;
}

/** Mutable pooled particle record — flat fields, no nested allocations. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  /** Seconds of life remaining. */
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  glowStrength: number;
  additive: boolean;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveRange(rng: SeededRng, value: NumOrRange | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const [lo, hi] = value;
  const min = finiteOr(lo, fallback);
  const max = finiteOr(hi, min);
  return max < min ? min : rng.range(min, max);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

const DEFAULT_LIFE_S = 0.5;
const DEFAULT_SIZE_PX = 6;
const DEFAULT_SPEED_PX_PER_S = 120;
const TWO_PI = Math.PI * 2;

export class ParticleSystem {
  private readonly rng: SeededRng;
  private readonly pool: Particle[];
  private alive = 0;
  private recycleCursor = 0;
  /** Pooled draw records — never truncated, stable identities for the lifetime. */
  private readonly draws: SpriteDraw[];
  /**
   * Truncation-safe alias of {@link draws} handed to callers each frame.
   * Shrinking this must never drop pooled records (see buildDraws).
   */
  private readonly drawView: SpriteDraw[];
  private readonly drawTints: Array<[number, number, number, number]>;
  private readonly drawGlows: Array<[number, number, number, number]>;
  /** Reused by burst() so per-particle emission never allocates. */
  private readonly scratchEmit: EmitOptions = { x: 0, y: 0 };

  public constructor(
    capacity: number = DEFAULT_PARTICLE_CAPACITY,
    seed: number = 0x600dc0de,
  ) {
    this.rng = new SeededRng(seed);
    const cap = Math.max(1, Math.floor(capacity));
    this.pool = new Array<Particle>(cap);
    this.draws = new Array<SpriteDraw>(cap);
    this.drawView = new Array<SpriteDraw>(cap);
    this.drawTints = new Array<[number, number, number, number]>(cap);
    this.drawGlows = new Array<[number, number, number, number]>(cap);
    for (let i = 0; i < cap; i++) {
      this.pool[i] = {
        x: 0, y: 0, vx: 0, vy: 0,
        gravity: 0, drag: 0,
        life: 0, maxLife: 1,
        size0: 0, size1: 0,
        r0: 1, g0: 1, b0: 1, a0: 1,
        r1: 1, g1: 1, b1: 1, a1: 1,
        glowStrength: 0,
        additive: true,
      };
      this.drawTints[i] = [1, 1, 1, 1];
      this.drawGlows[i] = [0, 0, 0, 0];
      this.draws[i] = {
        x: 0, y: 0, width: 0, height: 0,
        tint: this.drawTints[i],
        blend: 'additive',
        glow: undefined,
      };
      this.drawView[i] = this.draws[i]!;
    }
  }

  /** Hard ceiling on simultaneous particles (pool size). */
  public get capacity(): number {
    return this.pool.length;
  }

  /** Currently simulated particles. */
  public get aliveCount(): number {
    return this.alive;
  }

  public get isEmpty(): boolean {
    return this.alive === 0;
  }

  /**
   * The pooled particle backing array (alive particles occupy indices
   * `[0, aliveCount)`). The array and its records are never reallocated —
   * exposed so tests can assert the zero-allocation reuse contract.
   */
  public get poolView(): readonly Particle[] {
    return this.pool;
  }

  /**
   * Spawn one particle. When the pool is full the slot under the round-robin
   * cursor is overwritten (fair recycling; O(1), never grows).
   */
  public emit(options: EmitOptions): void {
    const p = this.alive < this.capacity
      ? this.pool[this.alive++]!
      : this.pool[this.recycleCursor++ % this.capacity]!;

    const color = options.color ?? WHITE;
    const endColor = options.endColor ?? color;
    const size0 = resolveRange(this.rng, options.size, DEFAULT_SIZE_PX);
    const life = resolveRange(this.rng, options.life, DEFAULT_LIFE_S);

    p.x = finiteOr(options.x, 0);
    p.y = finiteOr(options.y, 0);
    p.vx = finiteOr(options.vx, 0);
    p.vy = finiteOr(options.vy, 0);
    p.gravity = finiteOr(options.gravity, 0);
    p.drag = Math.max(0, finiteOr(options.drag, 0));
    p.maxLife = Math.max(1e-4, life);
    p.life = p.maxLife;
    p.size0 = size0;
    p.size1 = resolveRange(this.rng, options.endSize, size0);
    p.r0 = clamp01(color[0]);
    p.g0 = clamp01(color[1]);
    p.b0 = clamp01(color[2]);
    p.a0 = clamp01(color[3]);
    p.r1 = clamp01(endColor[0]);
    p.g1 = clamp01(endColor[1]);
    p.b1 = clamp01(endColor[2]);
    p.a1 = clamp01(endColor[3]);
    p.glowStrength = Math.max(0, finiteOr(options.glow, 0));
    p.additive = options.additive ?? true;
  }

  /**
   * Spawn `count` particles around `(x, y)` with randomized direction/speed.
   * Returns the number emitted (always `count`; over-capacity bursts recycle).
   *
   * Uses a preallocated scratch options record so bursts never allocate.
   */
  public burst(options: BurstOptions): number {
    const count = Math.max(0, Math.floor(finiteOr(options.count, 0)));
    if (count === 0) return 0;
    const angle = finiteOr(options.angle, 0);
    const spread = Math.min(TWO_PI, Math.abs(finiteOr(options.spread, TWO_PI)));
    const jitter = Math.max(0, finiteOr(options.jitter, 0));

    // Copy shared fields once into the scratch record (no per-particle alloc).
    const s = this.scratchEmit;
    s.gravity = options.gravity;
    s.drag = options.drag;
    s.life = options.life;
    s.size = options.size;
    s.endSize = options.endSize;
    s.color = options.color;
    s.endColor = options.endColor;
    s.glow = options.glow;
    s.additive = options.additive;

    for (let i = 0; i < count; i++) {
      const theta = spread >= TWO_PI
        ? this.rng.range(0, TWO_PI)
        : angle + this.rng.range(-spread / 2, spread / 2);
      const speed = resolveRange(this.rng, options.speed, DEFAULT_SPEED_PX_PER_S);
      s.x = options.x + (jitter > 0 ? this.rng.range(-jitter, jitter) : 0);
      s.y = options.y + (jitter > 0 ? this.rng.range(-jitter, jitter) : 0);
      s.vx = Math.cos(theta) * speed;
      s.vy = Math.sin(theta) * speed;
      this.emit(s);
    }
    return count;
  }

  /**
   * Advance the simulation by `dtSeconds`. Dead particles are removed with
   * swap-delete (order within the pool is not stable across frames).
   */
  public update(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    let i = 0;
    while (i < this.alive) {
      const p = this.pool[i]!;
      p.life -= dtSeconds;
      if (p.life <= 0) {
        // Swap with the last alive particle and shrink — no splice allocation.
        const last = this.pool[this.alive - 1]!;
        this.pool[i] = last;
        this.pool[this.alive - 1] = p;
        this.alive -= 1;
        continue; // re-process index i (now holds `last`)
      }
      const damp = Math.exp(-p.drag * dtSeconds);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dtSeconds;
      p.x += p.vx * dtSeconds;
      p.y += p.vy * dtSeconds;
      i += 1;
    }
  }

  /**
   * Fill the reusable draw list with one quad per alive particle and return
   * it. The returned array identity is stable for the lifetime of the system
   * (only contents change), so callers may pass it straight to
   * `renderer.drawSprites('white', …)` every frame without allocating.
   *
   * Only the returned *view* is truncated to the alive count — the pooled
   * records in {@link draws} keep their full capacity, so a small frame can
   * never leave `draws[n]` undefined on a later bigger one (regression:
   * "Cannot set properties of undefined (setting x)").
   */
  public buildDraws(): readonly SpriteDraw[] {
    const draws = this.draws;
    const view = this.drawView;
    const cap = this.capacity;

    // Restore any slots lost to truncation so a pooled quad exists for every
    // index below capacity. Steady state: draws.length === cap → the loop
    // body never runs → zero allocations after warmup.
    for (let i = draws.length; i < cap; i++) {
      const record: SpriteDraw = {
        x: 0, y: 0, width: 0, height: 0,
        tint: this.drawTints[i]!,
        blend: 'additive',
        glow: undefined,
      };
      draws[i] = record;
      view[i] = record;
    }

    let n = 0;
    for (let i = 0; i < this.alive; i++) {
      const p = this.pool[i]!;
      const t = 1 - p.life / p.maxLife; // age fraction 0→1
      const size = p.size0 + (p.size1 - p.size0) * t;
      if (size <= 0.05) continue;

      const half = size / 2;
      const d = draws[n]!;
      d.x = p.x - half;
      d.y = p.y - half;
      d.width = size;
      d.height = size;
      d.blend = p.additive ? 'additive' : 'normal';

      const tint = this.drawTints[n]!;
      tint[0] = p.r0 + (p.r1 - p.r0) * t;
      tint[1] = p.g0 + (p.g1 - p.g0) * t;
      tint[2] = p.b0 + (p.b1 - p.b0) * t;
      tint[3] = p.a0 + (p.a1 - p.a0) * t;
      d.tint = tint;

      if (p.glowStrength > 0 && p.additive) {
        const glow = this.drawGlows[n]!;
        glow[0] = tint[0];
        glow[1] = tint[1];
        glow[2] = tint[2];
        glow[3] = p.glowStrength;
        d.glow = glow;
      } else {
        d.glow = undefined;
      }
      view[n] = d;
      n += 1;
    }
    view.length = n; // truncate the view, never the pooled records
    return view;
  }

  // ------------------------------------------------------- scene presets --
  // Out-of-the-box recipes for the game layer's common moments. Each returns
  // the number of particles spawned so callers/tests can assert counts.

  /** Collectible sparkle: tight upward fan of cyan/pink glints. */
  public fragmentPickup(x: number, y: number): number {
    this.burst({
      count: 9, x, y,
      angle: -Math.PI / 2, spread: Math.PI * 0.9,
      speed: [70, 210], life: [0.25, 0.5],
      size: [3, 6], endSize: 0,
      color: CYAN, endColor: [0.4, 1, 1, 0],
      glow: 1.6, jitter: 4,
    });
    this.emit({
      x, y, life: 0.18, size: 14, endSize: 30,
      color: [1, 1, 1, 0.9], endColor: PINK_FADE,
      glow: 2,
    });
    return 10;
  }

  /** Enemy pop: neon shards plus a bright core flash. */
  public enemyDeath(x: number, y: number): number {
    this.burst({
      count: 12, x, y,
      speed: [90, 340], life: [0.35, 0.7],
      size: [3, 7], endSize: 0,
      color: MAGENTA, endColor: MAGENTA_FADE,
      gravity: 500, drag: 0.8, glow: 1.2, jitter: 6,
    });
    this.burst({
      count: 6, x, y,
      speed: [160, 420], life: [0.15, 0.3],
      size: [2, 4], endSize: 0,
      color: CYAN, endColor: CYAN_FADE,
      drag: 0.5, glow: 1.8,
    });
    this.emit({
      x, y, life: 0.14, size: 26, endSize: 52,
      color: [1, 1, 1, 1], endColor: MAGENTA_FADE,
      glow: 2.2,
    });
    return 19;
  }

  /**
   * Player death: the droid bursts into memory-fragments — white-hot flash,
   * shockwave ring, then glowing debris that tumbles down under gravity.
   */
  public playerDeath(x: number, y: number): number {
    this.emit({
      x, y, life: 0.22, size: 40, endSize: 110,
      color: [1, 1, 1, 1], endColor: [1, 0.4, 0.85, 0],
      glow: 2.5,
    });
    this.burst({
      count: 16, x, y,
      speed: [120, 380], life: [0.5, 0.9],
      size: [4, 9], endSize: [1, 3],
      color: PINK, endColor: PINK_FADE,
      gravity: 700, drag: 1.1, glow: 1.4, jitter: 8,
    });
    this.burst({
      count: 16, x, y,
      speed: [180, 520], life: [0.4, 0.8],
      size: [3, 6], endSize: 0,
      color: CYAN, endColor: CYAN_FADE,
      gravity: 850, drag: 0.7, glow: 2, jitter: 8,
    });
    this.burst({
      count: 10, x, y,
      speed: [260, 620], life: [0.25, 0.45],
      size: [2, 4], endSize: 0,
      color: WHITE_HOT, endColor: WHITE_FADE,
      drag: 0.4, glow: 2.4,
    });
    return 43;
  }

  /** Thruster kick at the feet on jump: soft non-additive puffs. */
  public jumpPuff(x: number, y: number): number {
    this.burst({
      count: 7, x, y,
      angle: Math.PI / 2, spread: Math.PI * 0.85,
      speed: [50, 150], life: [0.22, 0.42],
      size: [5, 9], endSize: [14, 20],
      color: PUFF, endColor: PUFF_FADE,
      drag: 3, additive: false,
    });
    return 7;
  }

  /** Ground dust kicked sideways on landing; `impact` (≥0) scales the kick. */
  public landingDust(x: number, y: number, impact = 1): number {
    const power = Math.min(3, Math.max(0, impact));
    const side = (dir: 1 | -1, count: number): void => {
      this.burst({
        count, x: x + dir * 6, y,
        angle: dir > 0 ? -0.35 : Math.PI + 0.35,
        spread: 1.1,
        speed: [60 + 70 * power, 140 + 130 * power], life: [0.28, 0.5],
        size: [5 + 2 * power, 9 + 3 * power], endSize: [16, 24],
        color: DUST, endColor: DUST_FADE,
        drag: 2.4, additive: false,
      });
    };
    const perSide = 4 + Math.round(3 * power);
    side(1, perSide);
    side(-1, perSide);
    return perSide * 2;
  }

  /** Weapon report: one hot flash plus directional spark cone. */
  public muzzleFlash(x: number, y: number, angle: number): number {
    this.emit({
      x, y, life: 0.06, size: 18, endSize: 6,
      color: WHITE_HOT, endColor: [1, 0.85, 0.4, 0.6],
      glow: 2.5,
    });
    this.burst({
      count: 6, x, y,
      angle, spread: 0.55,
      speed: [280, 520], life: [0.08, 0.16],
      size: [2, 3.5], endSize: 0,
      color: [1, 0.95, 0.6, 1], endColor: [1, 0.6, 0.15, 0],
      drag: 2, glow: 2,
    });
    return 7;
  }

  /** Big orange blast: core flash, fireball puff, fast debris. */
  public explosion(x: number, y: number): number {
    this.emit({
      x, y, life: 0.2, size: 60, endSize: 130,
      color: WHITE_HOT, endColor: [1, 0.55, 0.1, 0],
      glow: 2.6,
    });
    this.burst({
      count: 18, x, y,
      speed: [30, 240], life: [0.4, 0.75],
      size: [10, 22], endSize: [26, 44],
      color: [1, 0.62, 0.15, 0.9], endColor: [0.45, 0.08, 0.1, 0],
      gravity: -60, drag: 2.2, jitter: 10, additive: false,
    });
    this.burst({
      count: 16, x, y,
      speed: [200, 480], life: [0.3, 0.65],
      size: [2.5, 5], endSize: 0,
      color: [1, 0.8, 0.35, 1], endColor: EMBER_FADE,
      gravity: 900, drag: 0.6, glow: 2.2, jitter: 8,
    });
    return 35;
  }
}

const WHITE: Rgba = [1, 1, 1, 1];
const WHITE_HOT: Rgba = [1, 1, 1, 1];
const WHITE_FADE: Rgba = [1, 1, 1, 0];
const CYAN: Rgba = [0.35, 0.95, 1, 1];
const CYAN_FADE: Rgba = [0.35, 0.95, 1, 0];
const MAGENTA: Rgba = [1, 0.3, 0.85, 1];
const MAGENTA_FADE: Rgba = [0.6, 0.1, 0.5, 0];
const PINK: Rgba = [1, 0.42, 0.88, 1];
const PINK_FADE: Rgba = [1, 0.42, 0.88, 0];
const EMBER_FADE: Rgba = [0.9, 0.25, 0.05, 0];
const PUFF: Rgba = [0.75, 0.92, 1, 0.5];
const PUFF_FADE: Rgba = [0.75, 0.92, 1, 0];
const DUST: Rgba = [0.82, 0.85, 0.95, 0.45];
const DUST_FADE: Rgba = [0.82, 0.85, 0.95, 0];
