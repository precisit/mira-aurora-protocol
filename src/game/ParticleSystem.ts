import type { Rgba, SpriteDraw } from '../renderer/types';

/**
 * Pooled particle system (PLAN.md §6 "Objektpooling"; juice arrives fully in
 * wave B1 — B0 ships the emission API gameplay hooks into): enemy death
 * fragment-bursts, projectile impacts, pickup sparkles, player death.
 *
 * Pure CPU simulation over typed data so it runs headless in tests; rendering
 * reads {@link ParticleSystem.buildDraws} which fills a preallocated,
 * stable-identity draw list (task C3: the render path never allocates).
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining lifetime in seconds. */
  lifeSeconds: number;
  /** Initial lifetime, for fade math. */
  maxLifeSeconds: number;
  sizePx: number;
  /** Gravity scale (0 = floats, 1 = normal gravity). */
  gravityScale: number;
  color: Rgba;
  active: boolean;
}

export interface EmitOptions {
  x: number;
  y: number;
  count?: number;
  speedMin?: number;
  speedMax?: number;
  angleMinRad?: number;
  angleMaxRad?: number;
  lifeSeconds?: number;
  sizePx?: number;
  gravityScale?: number;
  color: Rgba;
}

const DEFAULT_COUNT = 10;
const DEFAULT_SPEED_MIN = 40;
const DEFAULT_SPEED_MAX = 220;
const DEFAULT_LIFE_SECONDS = 0.55;
const DEFAULT_SIZE_PX = 5;
const DEFAULT_GRAVITY_SCALE = 0.6;

/** Hard cap keeps worst-case frames bounded; oldest particles recycle first. */
export const MAX_PARTICLES = 512;

/** Deterministic RNG interface (subset of SeededRng) for spawn jitter. */
export interface RandomSource {
  next(): number;
}

export class ParticleSystem {
  private readonly pool: Particle[] = [];
  private cursor = 0;
  // Preallocated draw records (task C3): buildDraws() only mutates fields, so
  // the render path performs zero allocations per frame. The view array is a
  // truncation-safe alias — shrinking it must never drop pooled records.
  private readonly draws: SpriteDraw[] = [];
  private readonly drawView: SpriteDraw[] = [];
  private readonly drawTints: Array<[number, number, number, number]> = [];

  public constructor(private readonly rng: RandomSource) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        lifeSeconds: 0,
        maxLifeSeconds: 1,
        sizePx: DEFAULT_SIZE_PX,
        gravityScale: DEFAULT_GRAVITY_SCALE,
        color: [1, 1, 1, 1],
        active: false,
      });
      this.drawTints.push([1, 1, 1, 1]);
      const record: SpriteDraw = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        tint: this.drawTints[i]!,
        blend: 'additive',
        glow: undefined,
      };
      this.draws.push(record);
      this.drawView.push(record);
    }
  }

  /**
   * Emit a radial burst. Deterministic given the injected RNG, so effects are
   * reproducible in tests.
   */
  public emit(options: EmitOptions): void {
    const count = Math.max(0, Math.floor(options.count ?? DEFAULT_COUNT));
    const speedMin = options.speedMin ?? DEFAULT_SPEED_MIN;
    const speedMax = options.speedMax ?? DEFAULT_SPEED_MAX;
    const angleMin = options.angleMinRad ?? 0;
    const angleMax = options.angleMaxRad ?? Math.PI * 2;
    const life = Math.max(0.05, options.lifeSeconds ?? DEFAULT_LIFE_SECONDS);
    const size = Math.max(1, options.sizePx ?? DEFAULT_SIZE_PX);
    const gravityScale = options.gravityScale ?? DEFAULT_GRAVITY_SCALE;

    for (let i = 0; i < count; i++) {
      const angle = angleMin + (angleMax - angleMin) * this.rng.next();
      const speed = speedMin + (speedMax - speedMin) * this.rng.next();
      const particle = this.nextFree();
      particle.x = options.x;
      particle.y = options.y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.maxLifeSeconds = life;
      particle.lifeSeconds = life * (0.7 + 0.3 * this.rng.next());
      particle.sizePx = size * (0.6 + 0.8 * this.rng.next());
      particle.gravityScale = gravityScale;
      particle.color = options.color;
      particle.active = true;
    }
  }

  /** Advance all live particles; deactivates expired ones. */
  public update(dtSeconds: number, gravityPxPerS2: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.lifeSeconds -= dtSeconds;
      if (p.lifeSeconds <= 0) {
        p.active = false;
        continue;
      }
      p.vy += gravityPxPerS2 * p.gravityScale * dtSeconds;
      p.x += p.vx * dtSeconds;
      p.y += p.vy * dtSeconds;
    }
  }

  /** Live particles (fade alpha derived from remaining life). */
  public get active(): readonly Particle[] {
    return this.pool.filter((p) => p.active);
  }

  public get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  /**
   * The preallocated backing pool (stable record identities for the system's
   * lifetime — the zero-allocation contract, assertable in tests).
   */
  public get poolView(): readonly Particle[] {
    return this.pool;
  }

  /**
   * Fill the reusable draw list with one additive quad per live particle and
   * return it (task C3). The returned view array and its records keep stable
   * identities for the system's lifetime — only field values change — so
   * callers can hand it straight to `renderer.drawSprites` every frame
   * without allocating. Truncating the *view* never drops pooled records.
   */
  public buildDraws(): readonly SpriteDraw[] {
    const draws = this.draws;
    const view = this.drawView;
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (!p.active) continue;
      const fade = Math.max(0, Math.min(1, p.lifeSeconds / p.maxLifeSeconds));
      const half = p.sizePx / 2;

      const d = draws[n]!;
      d.x = p.x - half;
      d.y = p.y - half;
      d.width = p.sizePx;
      d.height = p.sizePx;
      const tint = this.drawTints[n]!;
      tint[0] = p.color[0];
      tint[1] = p.color[1];
      tint[2] = p.color[2];
      tint[3] = fade;
      d.tint = tint;
      view[n] = d;
      n += 1;
    }
    view.length = n;
    return view;
  }

  public clear(): void {
    for (const p of this.pool) p.active = false;
  }

  /** Ring-buffer allocation so bursts never allocate mid-frame. */
  private nextFree(): Particle {
    for (let i = 0; i < this.pool.length; i++) {
      const candidate = this.pool[this.cursor] as Particle;
      this.cursor = (this.cursor + 1) % this.pool.length;
      if (!candidate.active) return candidate;
    }
    // Pool exhausted: overwrite the oldest slot at the cursor.
    const victim = this.pool[this.cursor] as Particle;
    this.cursor = (this.cursor + 1) % this.pool.length;
    return victim;
  }
}
