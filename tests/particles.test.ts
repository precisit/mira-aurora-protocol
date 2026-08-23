import { describe, expect, it } from 'vitest';
import { ParticleSystem } from '../src/effects/Particles';
import type { SpriteDraw } from '../src/renderer/types';

/** Fixed step matching the game loop (120 Hz). */
const STEP = 1 / 120;

describe('ParticleSystem pool reuse (no allocation after warmup)', () => {
  it('keeps a fixed-capacity pool that never grows', () => {
    const ps = new ParticleSystem(64);
    expect(ps.capacity).toBe(64);

    // Far more emissions than capacity — must recycle, never grow.
    for (let i = 0; i < 100; i++) {
      ps.burst({ count: 20, x: i, y: 0, speed: 50, life: 0.1 });
      expect(ps.aliveCount).toBeLessThanOrEqual(64);
    }
    expect(ps.capacity).toBe(64);
  });

  it('reuses the same pool records and draw quads across frames', () => {
    const ps = new ParticleSystem(32);
    const poolBefore = ps.poolView;
    const firstRecord = poolBefore[0];

    ps.burst({ count: 10, x: 0, y: 0 });
    const drawsA = ps.buildDraws();
    ps.update(STEP);
    const drawsB = ps.buildDraws();

    expect(drawsA).toBe(drawsB); // stable backing array identity
    expect(ps.poolView).toBe(poolBefore); // same array object
    expect(firstRecord).toBeDefined();

    // Kill everything and refill — records are recycled objects, not clones.
    for (let i = 0; i < 60; i++) ps.update(0.2); // well past max life
    expect(ps.isEmpty).toBe(true);
    ps.burst({ count: 10, x: 5, y: 5 });
    expect(ps.aliveCount).toBe(10);
    let reused = false;
    for (const p of ps.poolView) if (p === firstRecord) reused = true;
    expect(reused).toBe(true);
  });

  it('caps over-capacity bursts at capacity without dropping below reuse', () => {
    const ps = new ParticleSystem(16);
    const emitted = ps.burst({ count: 100, x: 0, y: 0, life: 5 });
    expect(emitted).toBe(100); // burst reports requested count
    expect(ps.aliveCount).toBe(16); // but the pool stays capped
  });
});

describe('ParticleSystem buildDraws truncation regression (QA console crash)', () => {
  /**
   * Regression: buildDraws() used to truncate its pooled backing array to the
   * alive count. A later frame with more particles than the truncated length
   * hit `draws[n] === undefined` and threw
   * "Cannot set properties of undefined (setting x)" — hard-blocking gameplay.
   */
  it('survives a burst bigger than a previous (smaller) buildDraws frame', () => {
    const ps = new ParticleSystem(32);
    ps.burst({ count: 5, x: 0, y: 0, life: 5, speed: 0 });

    let draws: readonly SpriteDraw[] = [];
    expect(() => (draws = ps.buildDraws())).not.toThrow();
    expect(draws.length).toBe(5);

    ps.burst({ count: 20, x: 0, y: 0, life: 5, speed: 0 }); // 25 alive > 5 slots
    expect(() => (draws = ps.buildDraws())).not.toThrow(); // used to throw here
    expect(ps.aliveCount).toBe(25);
    expect(draws.length).toBe(ps.aliveCount); // exactly one quad per particle
  });

  it('keeps stable view identity and pooled records across mixed update/buildDraws cycles', () => {
    const ps = new ParticleSystem(32);
    const seenRecords = new Set<SpriteDraw>();
    let previousView: readonly SpriteDraw[] | null = null;

    ps.burst({ count: 32, x: 0, y: 0, life: 0.2 });
    for (let frame = 0; frame < 40; frame++) {
      let draws: readonly SpriteDraw[] = [];
      expect(() => (draws = ps.buildDraws())).not.toThrow();

      if (previousView !== null) expect(draws).toBe(previousView); // stable identity
      for (const d of draws) {
        expect(d).toBeDefined(); // never undefined after shrink→grow frames
        expect(Number.isFinite(d.x + d.y)).toBe(true);
        seenRecords.add(d);
      }
      previousView = draws;

      ps.update(STEP);
      if (!ps.isEmpty) ps.burst({ count: 3, x: 10, y: 10 }); // refill mid-cycle
    }

    // Records are pooled objects reused across frames, not fresh allocations.
    expect(seenRecords.size).toBeGreaterThan(0);
    expect(seenRecords.size).toBeLessThanOrEqual(32);
  });

  it('returns exactly the alive count every cycle even when counts fluctuate', () => {
    const ps = new ParticleSystem(32);
    const pattern = [1, 30, 2, 17, 32, 0, 8];
    for (const count of pattern) {
      if (count > 0) ps.burst({ count, x: 0, y: 0, life: 5, speed: 0 });
      else for (let i = 60; i > 0; i--) ps.update(1); // drain everything
      expect(ps.buildDraws().length).toBe(ps.aliveCount);
    }
  });
});

describe('ParticleSystem emission & lifetime', () => {
  it('presets spawn their documented counts and report what they emitted', () => {
    const ps = new ParticleSystem(1024);
    const presetCount = (fn: () => number): number => {
      const before = ps.aliveCount;
      const reported = fn();
      expect(ps.aliveCount - before).toBe(reported);
      return reported;
    };
    expect(presetCount(() => ps.fragmentPickup(0, 0))).toBe(10);
    expect(presetCount(() => ps.enemyDeath(0, 0))).toBe(19);
    expect(presetCount(() => ps.playerDeath(0, 0))).toBe(43);
    expect(presetCount(() => ps.jumpPuff(0, 0))).toBe(7);
    expect(presetCount(() => ps.muzzleFlash(0, 0, Math.PI / 2))).toBe(7);
    expect(presetCount(() => ps.explosion(0, 0))).toBe(35);
  });

  it('gives every particle a finite positive life ≤ its maxLife', () => {
    const ps = new ParticleSystem();
    ps.burst({ count: 25, x: 0, y: 0, life: [0.3, 0.8] });
    for (let i = 0; i < ps.aliveCount; i++) {
      const p = ps.poolView[i]!;
      expect(p.life).toBeGreaterThan(0);
      expect(p.life).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });

  it('kills all particles once their life has elapsed', () => {
    const ps = new ParticleSystem();
    ps.burst({ count: 30, x: 0, y: 0, life: [0.4, 0.6] });

    // Simulate just under the minimum life → still alive.
    for (let i = 0; i < Math.floor(0.39 / STEP); i++) ps.update(STEP);
    expect(ps.aliveCount).toBeGreaterThan(0);

    // Simulate past the maximum life → all dead.
    for (let i = 0; i < Math.ceil(0.3 / STEP) + 2; i++) ps.update(STEP);
    expect(ps.isEmpty).toBe(true);
  });

  it('applies gravity and drag deterministically for a fixed seed', () => {
    const make = (): ParticleSystem => new ParticleSystem(128, 12345);
    const a = make();
    const b = make();

    for (const ps of [a, b]) {
      ps.burst({ count: 12, x: 0, y: 0, gravity: 900, drag: 2, speed: [100, 300], life: 1 });
      for (let i = 0; i < 60; i++) ps.update(STEP);
    }

    expect(a.aliveCount).toBe(b.aliveCount);
    for (let i = 0; i < a.aliveCount; i++) {
      expect(a.poolView[i]!.x).toBeCloseTo(b.poolView[i]!.x, 9);
      expect(a.poolView[i]!.y).toBeCloseTo(b.poolView[i]!.y, 9);
    }
  });

  it('builds one additive quad per particle centered on its position', () => {
    const ps = new ParticleSystem();
    ps.burst({ count: 5, x: 100, y: 200, size: 8, speed: 0, glow: 1.5 });
    const draws = ps.buildDraws();

    expect(draws.length).toBe(5);
    for (const d of draws) {
      expect(d.blend).toBe('additive');
      expect(d.width).toBeLessThanOrEqual(8);
      expect(d.x + d.width / 2).toBeGreaterThanOrEqual(96); // jitter ±0 at speed 0
      expect(d.glow).toBeDefined();
      expect(d.glow![3]).toBeGreaterThan(0);
    }
  });

  it('landing dust scales with impact', () => {
    const light = new ParticleSystem();
    const heavy = new ParticleSystem(1024, 99);
    expect(light.landingDust(0, 0, 0)).toBeLessThan(heavy.landingDust(0, 0, 2));
  });
});
