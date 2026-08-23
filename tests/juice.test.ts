import { describe, expect, it } from 'vitest';
import { BloomPulse } from '../src/effects/BloomPulse';
import { HitFlash, ScreenFlash, mixToWhite } from '../src/effects/HitFlash';
import { JuiceSystem } from '../src/effects/JuiceSystem';

const STEP = 1 / 120;

describe('mixToWhite (sprite hit-flash tint)', () => {
  it('is identity at 0 and full white at 1 (alpha preserved)', () => {
    const base = [0.2, 0.5, 0.8, 0.9] as const;
    const zero = mixToWhite(base, 0);
    expect(zero).toEqual([0.2, 0.5, 0.8, 0.9]);
    const full = mixToWhite(base, 1);
    expect(full).toEqual([1, 1, 1, 0.9]);
  });

  it('interpolates linearly and clamps out-of-range amounts', () => {
    const base = [0, 0, 0, 1] as const;
    const half = mixToWhite(base, 0.5);
    expect(half).toEqual([0.5, 0.5, 0.5, 1]);
    expect(mixToWhite(base, 42)[0]).toBe(1);
    expect(mixToWhite(base, -3)[0]).toBe(0);
  });

  it('writes into a caller-supplied tuple (allocation-free path)', () => {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    const result = mixToWhite([0.5, 0.5, 0.5, 1], 0.5, out);
    expect(result).toBe(out);
    expect(out[0]).toBeCloseTo(0.75, 12);
  });
});

describe('HitFlash envelope', () => {
  it('peaks at flash time and decays linearly to zero', () => {
    const hf = new HitFlash(0.09);
    expect(hf.amount).toBe(0);
    hf.flash();
    expect(hf.amount).toBeCloseTo(1, 9);

    hf.update(0.045); // half the duration
    expect(hf.amount).toBeCloseTo(0.5, 9);

    for (let i = 0; i < 40; i++) hf.update(STEP); // well past duration
    expect(hf.amount).toBe(0);
    expect(hf.isActive).toBe(false);
  });

  it('tints sprites toward white by the current amount', () => {
    const hf = new HitFlash(0.1);
    const base = [0.25, 0.25, 0.25, 1] as const;
    hf.flash(0.8);
    const tinted = hf.tint(base);
    expect(tinted[0]).toBeGreaterThan(0.25); // pulled toward white
    for (let i = 0; i < 30; i++) hf.update(STEP);
    expect(hf.tint(base)).toEqual([0.25, 0.25, 0.25, 1]); // back to base
  });
});

describe('ScreenFlash envelope', () => {
  it('fades from peak alpha to zero over its duration', () => {
    const sf = new ScreenFlash(0.14);
    sf.flash([1, 0, 0, 1], 0.5);
    expect(sf.amount).toBeCloseTo(0.5, 9);
    expect(sf.color[0]).toBe(1);

    sf.update(0.07);
    expect(sf.amount).toBeCloseTo(0.25, 9);
    sf.update(0.07);
    expect(sf.amount).toBe(0);
  });

  it('keeps the strongest running flash instead of restarting weak ones', () => {
    const sf = new ScreenFlash(0.6);
    sf.flash([1, 1, 1, 1], 0.9);
    sf.update(0.1);
    const before = sf.amount;
    sf.flash([0, 1, 0, 1], 0.2); // weaker + shorter than what remains
    expect(sf.amount).toBe(before);
    expect(sf.color[0]).toBe(1); // original color kept
  });

  it('currentColor writes rgb + animated alpha into an out tuple', () => {
    const sf = new ScreenFlash();
    sf.flash([0.2, 0.4, 0.9, 1], 0.5);
    const out: [number, number, number, number] = [0, 0, 0, 0];
    const c = sf.currentColor(out);
    expect(c).toBe(out);
    expect(out[0]).toBeCloseTo(0.2, 12);
    expect(out[3]).toBeCloseTo(0.5, 9);
  });
});

describe('BloomPulse (renderer.setBloomOptions wiring)', () => {
  it('pumps intensity toward the peak then restores the baseline exactly once', () => {
    const patches: Array<Record<string, unknown>> = [];
    const bloom = new BloomPulse((patch) => patches.push({ ...patch }), {
      baseIntensity: 0.95,
      peakIntensity: 2.6,
      decaySeconds: 0.4,
    });

    bloom.pulse(1);
    bloom.update(STEP);
    const active = patches.at(-1) as { intensity?: number } | undefined;
    expect(active?.intensity).toBeGreaterThan(2.5); // near-peak right after pulse

    // Drain fully → last patch must restore the baseline.
    for (let i = 0; i < Math.ceil(0.5 / STEP); i++) bloom.update(STEP);
    expect(bloom.isActive).toBe(false);
    const last = patches.at(-1) as { intensity?: number } | undefined;
    expect(last?.intensity).toBe(0.95);
    // Baseline emitted exactly once at settle.
    const baselineCount = patches.filter((p) => (p as { intensity?: number }).intensity === 0.95).length;
    expect(baselineCount).toBe(1);
  });

  it('stacks pulses up to full energy and scales with strength', () => {
    const small = new BloomPulse(null);
    small.pulse(0.1);
    expect(small.energyLevel).toBeLessThan(0.5);

    const big = new BloomPulse(null);
    big.pulse(1);
    expect(big.energyLevel).toBeCloseTo(1, 9);
    big.pulse(1); // capped at 1
    expect(big.energyLevel).toBeLessThanOrEqual(1);
  });

  it('works headless without an apply callback', () => {
    const bloom = new BloomPulse(null);
    bloom.pulse(0.8);
    bloom.update(10);
    expect(bloom.isActive).toBe(false);
    expect(bloom.currentIntensity).toBeCloseTo(0.95, 9);
  });
});

describe('JuiceSystem facade (headless integration)', () => {
  function makeSystem(): { juice: JuiceSystem; patches: Array<{ intensity?: number }> } {
    const patches: Array<{ intensity?: number }> = [];
    const juice = new JuiceSystem({
      setBloom: (patch) => patches.push({ ...patch }),
      capacity: 512,
    });
    return { juice, patches };
  }

  it('routes gameplay events into particles/shake/bloom in one call', () => {
    const { juice } = makeSystem();

    juice.enemyDeath(100, 200);
    expect(juice.particles.aliveCount).toBeGreaterThan(0);
    expect(juice.shake.trauma).toBeGreaterThan(0);
    expect(juice.bloom.isActive).toBe(true);

    const before = juice.particles.aliveCount;
    juice.playerDeath(100, 200);
    expect(juice.particles.aliveCount).toBeGreaterThan(before);
    expect(juice.screenFlash.isActive).toBe(true);
    expect(juice.shake.trauma).toBeGreaterThan(0.5);
  });

  it('jump/land drive the shared squash & stretch component', () => {
    const { juice } = makeSystem();
    juice.jump(50, 50);
    expect(juice.playerSquash.scaleY).toBeGreaterThan(1); // stretched

    for (let i = 0; i < 60; i++) juice.update(STEP); // settle mid-air pose
    juice.land(50, 50, 1.5);
    expect(juice.playerSquash.scaleX).toBeGreaterThan(1); // squashed wide
    expect(juice.playerSquash.scaleY).toBeLessThan(1);

    for (let i = 0; i < Math.round(3 / STEP); i++) juice.update(STEP);
    expect(juice.playerSquash.isAtRest).toBe(true);
    expect(juice.particles.isEmpty).toBe(true); // dust settled too
  });

  it('hurt() raises the sprite-level hit-flash and decays it', () => {
    const { juice } = makeSystem();
    juice.hurt(0, 0);
    expect(juice.hitFlash.amount).toBeGreaterThan(0);
    for (let i = 0; i < Math.round(0.5 / STEP); i++) juice.update(STEP);
    expect(juice.hitFlash.amount).toBe(0);
  });

  it('update() drains everything to idle; statsLine reports live state', () => {
    const { juice, patches } = makeSystem();
    juice.explosion(320, 240);
    const line = juice.statsLine();
    expect(line).toMatch(/P \d+\/\d+/);
    expect(line).toMatch(/shake \d+%/);
    expect(line).toMatch(/bloom [\d.]+/);

    for (let i = 0; i < Math.round(4 / STEP); i++) juice.update(STEP);
    expect(juice.particles.isEmpty).toBe(true);
    expect(juice.shake.trauma).toBe(0);
    expect(juice.screenFlash.isActive).toBe(false);
    expect(juice.bloom.isActive).toBe(false);
    // Bloom was restored to baseline at settle.
    expect(patches.at(-1)?.intensity).toBeDefined();
  });

  it('bossWarning produces a long bloom surge', () => {
    const patches: Array<{ intensity?: number }> = [];
    const juice = new JuiceSystem({
      setBloom: (patch) => patches.push({ ...patch }),
      capacity: 512,
      bloom: { decaySeconds: 1 }, // boss warnings surge longer than combat blips
    });
    juice.bossWarning();
    let activeFrames = 0;
    for (let i = 0; i < Math.round(2 / STEP); i++) {
      juice.update(STEP);
      if (juice.bloom.isActive) activeFrames++;
    }
    // Full-energy pulse drains over decaySeconds: active for ~1 s of steps
    // (settling exactly when dt covers the remaining energy).
    expect(activeFrames).toBeGreaterThanOrEqual(115);
    expect(activeFrames).toBeLessThanOrEqual(125);
  });
});
