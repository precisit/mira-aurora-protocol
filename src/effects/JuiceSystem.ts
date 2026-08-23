import type { Rgba } from '../renderer/types';
import { BloomPulse, type BloomApplyFn, type BloomPulseOptions } from './BloomPulse';
import { HitFlash, ScreenFlash } from './HitFlash';
import { ParticleSystem, DEFAULT_PARTICLE_CAPACITY } from './Particles';
import { ScreenShake, type ScreenShakeOptions } from './ScreenShake';
import { SquashStretch, type SquashStretchOptions } from './SquashStretch';

/**
 * JuiceSystem (B1) — one typed façade over every arcade-feel effect so the
 * game layer (player/enemies being built in parallel) has a single object to
 * consume:
 *
 *   const juice = new JuiceSystem({ setBloom: p => renderer.setBloomOptions(p) });
 *   juice.update(dt);            // once per fixed step
 *   juice.enemyDeath(x, y);      // particles + shake + bloom in one call
 *   renderer.drawSprites('white', juice.particles.buildDraws());
 *
 * Individual subsystems stay public and independently usable. Everything is
 * pooled/simulated on the CPU; rendering is the caller's job.
 */
export class JuiceSystem {
  public readonly particles: ParticleSystem;
  public readonly shake: ScreenShake;
  public readonly hitFlash: HitFlash;
  public readonly screenFlash: ScreenFlash;
  /** Default squash & stretch instance for the player sprite. */
  public readonly playerSquash: SquashStretch;
  public readonly bloom: BloomPulse;

  public constructor(opts: JuiceSystemOptions = {}) {
    this.particles = new ParticleSystem(
      opts.capacity ?? DEFAULT_PARTICLE_CAPACITY,
      opts.seed ?? 0x600dc0de,
    );
    this.shake = new ScreenShake(opts.shake);
    this.hitFlash = new HitFlash();
    this.screenFlash = new ScreenFlash(0.14);
    this.playerSquash = new SquashStretch(opts.squash);
    this.bloom = new BloomPulse(opts.setBloom ?? null, opts.bloom);
  }

  /** Advance all envelopes/particles. Call once per fixed update step. */
  public update(dtSeconds: number): void {
    this.particles.update(dtSeconds);
    this.shake.update(dtSeconds);
    this.hitFlash.update(dtSeconds);
    this.screenFlash.update(dtSeconds);
    this.playerSquash.update(dtSeconds);
    this.bloom.update(dtSeconds);
  }

  // ------------------------------------------------- gameplay event recipes
  // Each wires together the subsystem calls a moment deserves, so gameplay
  // code stays declarative ("what happened") instead of mechanical
  // ("emit 19 particles, kick trauma 0.25…").

  /** Memory-fragment collected: sparkle + soft bloom blip. */
  public fragmentPickup(x: number, y: number): void {
    this.particles.fragmentPickup(x, y);
    this.bloom.pulse(0.18);
  }

  /** Enemy destroyed: neon burst, medium shake, bloom pump. */
  public enemyDeath(x: number, y: number): void {
    this.particles.enemyDeath(x, y);
    this.shake.addTrauma(0.28);
    this.bloom.pulse(0.4);
  }

  /** Player died: fragment explosion, heavy shake, red screen flash. */
  public playerDeath(x: number, y: number): void {
    this.particles.playerDeath(x, y);
    this.shake.addTrauma(0.85);
    this.screenFlash.flash(DEATH_FLASH, 0.5);
    this.bloom.pulse(1);
  }

  /** Weapon fired: muzzle flash + recoil micro-shake + bloom blip. */
  public shoot(x: number, y: number, angle: number): void {
    this.particles.muzzleFlash(x, y, angle);
    this.shake.addTrauma(0.07);
    this.bloom.pulse(0.14);
  }

  /** Player jumped: thruster puffs + stretch pose. */
  public jump(x: number, y: number): void {
    this.particles.jumpPuff(x, y);
    this.playerSquash.stretch(0.32);
  }

  /** Player landed: dust scaled by impact + squash pose + thud shake. */
  public land(x: number, y: number, impact = 1): void {
    this.particles.landingDust(x, y, impact);
    this.playerSquash.squash(Math.min(0.6, 0.22 + 0.22 * Math.max(0, impact)));
    this.shake.addTrauma(Math.min(0.2, 0.05 * Math.max(0, impact)));
  }

  /** Big boom (Nova weapon, barrels…): explosion preset + strong shake. */
  public explosion(x: number, y: number): void {
    this.particles.explosion(x, y);
    this.shake.addTrauma(0.55);
    this.screenFlash.flash([1, 0.85, 0.55, 1], 0.3);
    this.bloom.pulse(0.75);
  }

  /** Player took damage: white hit flash + hurt sparks + shake. */
  public hurt(x: number, y: number): void {
    this.hitFlash.flash();
    this.particles.burst({
      count: 8, x, y,
      speed: [120, 300], life: [0.2, 0.4],
      size: [2.5, 5], endSize: 0,
      color: [1, 0.35, 0.35, 1], endColor: [1, 0.35, 0.35, 0],
      gravity: 600, drag: 1, glow: 1.2,
    });
    this.shake.addTrauma(0.32);
  }

  /** Boss warning stinger: long bloom surge + ominous pink screen flash. */
  public bossWarning(): void {
    this.bloom.pulse(1);
    this.screenFlash.flash(WARNING_PINK, 0.4, 0.6);
    this.shake.addTrauma(0.2);
  }

  /**
   * One-line HUD/console summary, e.g. `"P 143/1024 · shake 32% · bloom 1.84"`.
   */
  public statsLine(): string {
    return [
      `P ${this.particles.aliveCount}/${this.particles.capacity}`,
      `shake ${Math.round(this.shake.trauma * 100)}%`,
      `bloom ${this.bloom.currentIntensity.toFixed(2)}`,
    ].join(' · ');
  }
}

export interface JuiceSystemOptions {
  /** Particle pool ceiling. Default {@link DEFAULT_PARTICLE_CAPACITY}. */
  capacity?: number;
  /** Seed for deterministic effect randomness. */
  seed?: number;
  shake?: ScreenShakeOptions;
  squash?: SquashStretchOptions;
  bloom?: BloomPulseOptions;
  /** Wire to `renderer.setBloomOptions`; omit for headless use. */
  setBloom?: BloomApplyFn;
}

const DEATH_FLASH: Rgba = [1, 0.3, 0.45, 1];
const WARNING_PINK: Rgba = [1, 0.25, 0.75, 1];
