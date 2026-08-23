import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_STEP_MS,
  GameLoop,
  LONG_FRAME_THRESHOLD_MS,
} from '../src/core/GameLoop';
import {
  clampDevicePixelRatio,
  FPS_CAP_CHOICES,
  frameIntervalMs,
  HARD_MAX_DEVICE_PIXEL_RATIO,
  LongFrameMonitor,
  sanitizeFpsCap,
  shouldPresentFrame,
  type FpsCap,
} from '../src/core/Perf';
import {
  defaultSaveData,
  MemoryStorage,
  SAVE_KEY,
  SaveStore,
} from '../src/save/SaveStore';
import { createEntity, EntityPool } from '../src/game/entities';
import { ParticleSystem } from '../src/game/ParticleSystem';
import { copyRgba, setRgba, SpriteDrawPool } from '../src/renderer/SpriteDrawPool';
import { parseAsciiLevel } from '../src/levels/Level';
import { GameSession } from '../src/game/GameSession';
import { emptyPlayerInput } from '../src/game/Player';
import { measureGzipKb } from '../scripts/check-bundle-size.mjs';

// ---------------------------------------------------------------------------
// DPR cap math (task C3: render at most 2×, respect a setting)
// ---------------------------------------------------------------------------

describe('clampDevicePixelRatio', () => {
  it('caps iPhone-class 3× displays at the hard maximum', () => {
    expect(HARD_MAX_DEVICE_PIXEL_RATIO).toBe(2);
    expect(clampDevicePixelRatio(3)).toBe(2);
    expect(clampDevicePixelRatio(2.75)).toBe(2);
    expect(clampDevicePixelRatio(2)).toBe(2);
  });

  it('keeps sub-cap ratios untouched', () => {
    expect(clampDevicePixelRatio(1)).toBe(1);
    expect(clampDevicePixelRatio(1.5)).toBe(1.5);
  });

  it('honours a lower user setting (battery saver)', () => {
    expect(clampDevicePixelRatio(3, 1)).toBe(1);
    expect(clampDevicePixelRatio(3, 1.5)).toBe(1.5);
    expect(clampDevicePixelRatio(0.8, 2)).toBe(1); // never below the CSS grid
  });

  it('never lets a hostile setting exceed the hard cap', () => {
    expect(clampDevicePixelRatio(4, 4)).toBe(2);
    expect(clampDevicePixelRatio(9, 100)).toBe(2);
  });

  it('degrades junk to 1 (never scales below CSS pixels)', () => {
    for (const junk of [Number.NaN, Infinity, -Infinity, 0, -2]) {
      expect(clampDevicePixelRatio(junk)).toBe(1);
      expect(clampDevicePixelRatio(junk, junk)).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// FPS-lock policy helpers (task C3: 60 FPS lock option; logic stays 120 Hz)
// ---------------------------------------------------------------------------

describe('FPS lock policy helpers', () => {
  it('snaps persisted settings to the allowed cap choices', () => {
    expect(FPS_CAP_CHOICES).toEqual([30, 60, 120]);
    expect(sanitizeFpsCap(null)).toBeNull();
    expect(sanitizeFpsCap(undefined)).toBeNull();
    expect(sanitizeFpsCap(Number.NaN)).toBeNull();
    expect(sanitizeFpsCap('90')).toBeNull(); // junk type → uncapped
    for (const choice of FPS_CAP_CHOICES) {
      expect(sanitizeFpsCap(choice)).toBe(choice);
    }
  });

  it('snaps out-of-range values to the nearest allowed cap', () => {
    expect(sanitizeFpsCap(29.9)).toBe(30);
    expect(sanitizeFpsCap(31)).toBe(30);
    expect(sanitizeFpsCap(75)).toBe(60);
    expect(sanitizeFpsCap(90)).toBe(60); // exact tie favours the lower cap
    expect(sanitizeFpsCap(121)).toBe(120);
    expect(sanitizeFpsCap(240)).toBe(120);
  });

  it('computes present intervals', () => {
    expect(frameIntervalMs(null)).toBeNull();
    expect(frameIntervalMs(60)).toBeCloseTo(16.6667, 3);
    expect(frameIntervalMs(120)).toBeCloseTo(8.3333, 3);
  });

  it('skips too-early frames but tolerates rAF jitter (~2 %)', () => {
    const cap = 60;
    expect(shouldPresentFrame(0, cap)).toBe(false);
    expect(shouldPresentFrame(8.33, cap)).toBe(false); // 120 Hz display tick
    expect(shouldPresentFrame(16.0, cap)).toBe(false); // just under interval…
    expect(shouldPresentFrame(16.34, cap)).toBe(true); // …but inside tolerance
    expect(shouldPresentFrame(33, cap)).toBe(true);
  });

  it('always presents when uncapped', () => {
    for (const elapsed of [0, 1, 5, 16.6]) {
      expect(shouldPresentFrame(elapsed, null)).toBe(true);
    }
  });
});

describe('GameLoop FPS lock (simulation stays 120 Hz)', () => {
  interface Harness {
    loop: GameLoop;
    fire: (now: number) => void;
    updates: () => number;
    renders: () => number;
    cleanup: () => void;
  }

  function makeHarness(fpsCap: FpsCap | undefined = undefined): Harness {
    let updates = 0;
    let renders = 0;
    const loop = new GameLoop({
      update: () => {
        updates += 1;
      },
      render: () => {
        renders += 1;
      },
      fpsCap,
    });
    let cb: ((now: number) => void) | null = null;
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((fn: (now: number) => void) => {
      cb = fn;
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

    return {
      loop,
      fire: (now) => cb?.(now),
      updates: () => updates,
      renders: () => renders,
      cleanup: () => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCaf;
      },
    };
  }

  let harness: Harness | null = null;
  afterEach(() => {
    harness?.loop.stop();
    harness?.cleanup();
    harness = null;
  });

  it('skips some presents under a 60 FPS cap but simulates every millisecond', () => {
    // 5 ms rAF cadence (≈200 Hz stress display): far from the 16.33 ms
    // decision boundary so drift-correction keeps the pattern predictable.
    harness = makeHarness(60);
    const { loop } = harness;
    loop.start(0);

    const TICKS = 120; // 600 ms of display frames
    for (let i = 1; i <= TICKS; i++) harness!.fire(i * 5);

    const presented = harness.renders();
    expect(presented).toBeGreaterThan(20); // the lock is not a total stall
    expect(presented).toBeLessThan(TICKS); // …nor uncapped

    // Flush the remaining accumulator with one final uncapped frame.
    loop.setFpsCap(null);
    harness.fire(601);

    // Every ms of wall time was simulated as fixed steps — none lost to skips.
    expect(harness.updates()).toBe(Math.floor(601 / FIXED_STEP_MS));
  });

  it('presents every frame when uncapped (default)', () => {
    harness = makeHarness(null);
    harness.loop.start(0);
    for (let i = 1; i <= 5; i++) harness.fire(i * 8.33);
    expect(harness.renders()).toBe(5);
  });

  it('switching the cap at runtime takes effect immediately', () => {
    harness = makeHarness(null);
    harness.loop.start(0);
    harness.fire(8.33);
    expect(harness.renders()).toBe(1);

    harness.loop.setFpsCap(60);
    harness.fire(16.67); // only ~8.3 ms since last present → skipped
    expect(harness.renders()).toBe(1);

    harness.loop.setFpsCap(null);
    harness.fire(25); // uncapped again → presents despite short delta
    expect(harness.renders()).toBe(2);
  });

  it(`logs long frames (≥${LONG_FRAME_THRESHOLD_MS} ms) once per stall episode`, () => {
    const longFrames: number[] = [];
    let updates = 0;
    let renders = 0;
    let callback: ((now: number) => void) | null = null;
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((fn: (now: number) => void) => {
      callback = fn;
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

    try {
      const loop = new GameLoop({
        update: () => {
          updates += 1;
        },
        render: () => {
          renders += 1;
        },
        onLongFrame: (ms) => longFrames.push(ms),
      });
      const fire = (now: number): void => callback?.(now);
      loop.start(0);

      fire(40); // healthy frame
      fire(130); // 90 ms — stall begins → logged once
      fire(220); // 90 ms — sustained stall → suppressed
      fire(275); // 55 ms — still long → suppressed
      fire(291); // 16 ms — recovery resets the episode
      fire(361); // 70 ms — new episode → logged again

      expect(renders).toBe(6);
      expect(updates).toBeGreaterThan(0);
      expect(longFrames).toEqual([90, 70]);
      loop.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
    }
  });
});

describe('LongFrameMonitor', () => {
  it('reports transitions only and tracks worst frame + episodes', () => {
    const monitor = new LongFrameMonitor(50);
    expect(monitor.observe(49.9)).toBe(false);
    expect(monitor.observe(62)).toBe(true);
    expect(monitor.observe(120)).toBe(false); // same episode
    expect(monitor.observe(10)).toBe(false); // recovery resets
    expect(monitor.observe(55)).toBe(true);
    expect(monitor.episodes).toBe(2);
    expect(monitor.worstMs).toBe(120);
  });

  it('ignores non-finite/non-positive deltas', () => {
    const monitor = new LongFrameMonitor(50);
    expect(monitor.observe(Number.NaN)).toBe(false);
    expect(monitor.observe(0)).toBe(false);
    expect(monitor.observe(-5)).toBe(false);
    expect(monitor.episodes).toBe(0);
  });

  it('reset() clears telemetry', () => {
    const monitor = new LongFrameMonitor();
    monitor.observe(500);
    monitor.reset();
    expect(monitor.episodes).toBe(0);
    expect(monitor.worstMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Settings persistence (DPR cap + FPS lock round-trip)
// ---------------------------------------------------------------------------

describe('SaveStore perf settings', () => {
  it('persists dprCap and fpsCap', () => {
    const store = new SaveStore(new MemoryStorage());
    const data = defaultSaveData();
    data.settings.dprCap = 1.5;
    data.settings.fpsCap = 60;
    expect(store.save(data)).toBe(true);

    const loaded = store.load();
    expect(loaded.settings.dprCap).toBe(1.5);
    expect(loaded.settings.fpsCap).toBe(60);
  });

  it('repairs corrupt caps instead of crashing boot', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        settings: { volume: 0.5, sfxVolume: 0.5, musicVolume: 0.5, fpsCap: 75, dprCap: 5 },
      }),
    );
    const loaded = new SaveStore(storage).load();
    expect(loaded.settings.fpsCap).toBe(60); // snapped to nearest choice
    expect(loaded.settings.dprCap).toBe(2); // clamped to hard max
  });

  it('defaults old blobs without a dprCap field (additive setting)', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 1, settings: { volume: 1, sfxVolume: 1, musicVolume: 1 } }),
    );
    const loaded = new SaveStore(storage).load();
    expect(loaded.settings.dprCap).toBe(defaultSaveData().settings.dprCap);
    expect(loaded.settings.fpsCap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pool reuse assertions (task C3: stable identities in hot paths)
// ---------------------------------------------------------------------------

describe('EntityPool identity stability', () => {
  it('reuses released slots instead of allocating new entities', () => {
    const pool = new EntityPool((id) => createEntity({ x: id, y: 0 }, { x: 1, y: 1 }));
    const first = pool.spawn();
    const second = pool.spawn();
    expect(first).not.toBe(second);

    pool.release(first);
    expect(pool.activeCount).toBe(1);

    const third = pool.spawn();
    expect(third).toBe(first); // stable identity across release/reuse cycles
    expect(third.active).toBe(true);
    expect(pool.itemsView).toHaveLength(2); // no growth
  });

  it('activeCount tracks active entries without allocating', () => {
    const pool = new EntityPool((_id) => createEntity({ x: 0, y: 0 }, { x: 1, y: 1 }));
    const items = [pool.spawn(), pool.spawn(), pool.spawn()];
    expect(pool.activeCount).toBe(3);
    items[1]!.active = false;
    expect(pool.activeCount).toBe(2);
    items[2]!.active = false;
    expect(pool.activeCount).toBe(1);
  });
});

describe('game ParticleSystem zero-allocation draw path', () => {
  const stepRng = { next: () => 0.5 };

  it('recycles particle objects with stable identities', () => {
    const system = new ParticleSystem(stepRng);
    const known = new Set(system.poolView); // preallocated pool records

    system.emit({ x: 0, y: 0, count: 4, color: [1, 1, 1, 1] });
    expect(system.activeCount).toBe(4);
    for (const particle of system.poolView.slice(0, 4)) {
      expect(known.has(particle)).toBe(true); // never a fresh allocation
    }

    // Burn the particles down, then emit again — slots must come from the pool.
    system.update(10, 0);
    expect(system.activeCount).toBe(0);
    system.emit({ x: 5, y: 5, count: 2, color: [1, 1, 1, 1] });
    for (const particle of system.poolView.filter((p) => p.active)) {
      expect(known.has(particle)).toBe(true);
    }
  });

  it('buildDraws returns a stable array + record identities across frames', () => {
    const system = new ParticleSystem(stepRng);
    const drawsA = system.buildDraws();

    system.emit({ x: 0, y: 0, count: 3, lifeSeconds: 0.5, color: [1, 0.5, 0.5, 1] });
    const drawsB = system.buildDraws();
    expect(drawsB).toBe(drawsA); // same array object every frame
    expect(drawsB.length).toBe(3);
    const recordZero = drawsB[0];

    system.update(10, 0); // kill everything
    expect(system.buildDraws().length).toBe(0);

    system.emit({ x: 1, y: 1, count: 1, color: [1, 1, 1, 1] });
    const drawsC = system.buildDraws();
    expect(drawsC).toBe(drawsA);
    expect(drawsC.length).toBe(1);
    expect(drawsC[0]).toBe(recordZero); // record reused even after shrink
  });
});

describe('SpriteDrawPool', () => {
  it('hands out pooled records with owned tint tuples', () => {
    const pool = new SpriteDrawPool(2);
    const a = pool.next();
    const b = pool.next();
    setRgba(a.tint, 1, 2, 3, 4);
    expect(a.tint).not.toBe(b.tint); // per-record color slot
    expect(a.tint).toEqual([1, 2, 3, 4]);
  });

  it('grows past capacity without dropping earlier records', () => {
    const pool = new SpriteDrawPool(2);
    const a = pool.next();
    pool.next();
    const c = pool.next(); // triggers growth
    expect(c).not.toBe(a);
    expect(pool.view().length).toBe(3);
  });

  it('reset + next reuses exact record identities; view stays stable', () => {
    const pool = new SpriteDrawPool(4);
    const first = pool.next();
    first.blend = 'additive';
    first.glow = [1, 1, 1, 1];
    pool.next();
    pool.reset();
    expect(pool.view()).toHaveLength(0);

    const reused = pool.next();
    expect(reused).toBe(first); // stable identity across frames
    expect(reused.blend).toBe('normal'); // fields reset by next()
    expect(reused.glow).toBeUndefined();

    const viewOne = pool.view();
    pool.next();
    const viewTwo = pool.view();
    expect(viewTwo).toBe(viewOne); // view array identity is stable too
    expect(viewTwo.length).toBe(2);
  });

  it('copyRgba writes readonly palettes into mutable slots', () => {
    const slot: [number, number, number, number] = [0, 0, 0, 0];
    copyRgba(slot, [0.25, 0.5, 0.75, 1]);
    expect(slot).toEqual([0.25, 0.5, 0.75, 1]);
  });
});

describe('bundle-size smoke math (CI gate)', () => {
  const encoder = new TextEncoder();
  const fakeRead = (path: string): Uint8Array =>
    encoder.encode(`content-of-${path}`.repeat(10));
  const fakeStat = (path: string): { size: number } => ({
    size: encoder.encode(`content-of-${path}`.repeat(10)).length,
  });

  it('sums gzip weight of js/css/html only and reports per-file rows', () => {
    const { rows, totalKiB } = measureGzipKb(
      ['dist/a.js', 'dist/b.css', 'dist/c.html', 'dist/music.mp3', 'dist/logo.png'],
      fakeRead,
      fakeStat,
    );
    expect(rows.map((r: { path: string }) => r.path)).toEqual([
      'dist/a.js',
      'dist/b.css',
      'dist/c.html',
    ]);
    const sum: number = rows.reduce(
      (acc: number, r: { gzipKiB: number }) => acc + r.gzipKiB,
      0,
    );
    expect(totalKiB).toBeCloseTo(sum, 6);
    expect(totalKiB).toBeGreaterThan(0);
  });

  it('gzip output is deterministic and compresses repetitive content', () => {
    const again = measureGzipKb(['x.js'], fakeRead, fakeStat);
    expect(again.totalKiB).toBeGreaterThan(0);
    expect(again.totalKiB).toBeLessThan(fakeStat('x.js').size / 1024);
  });
});

describe('GameSession projectile pooling under real simulation', () => {
  const STEP_MS = 1000 / 120;

  function makeSession(): GameSession {
    return new GameSession({
      levelData: parseAsciiLevel('perf-pool-test', 'Perf Pool Test', [
        'S...............................',
        '................................',
        '################################',
      ]),
      seed: 0xc3001,
      unlockedWeapons: ['puls'],
    });
  }

  function settle(session: GameSession, steps: number): void {
    const idle = emptyPlayerInput();
    for (let i = 0; i < steps; i++) session.update(STEP_MS, idle);
  }

  it('reuses the same projectile objects across volleys (no churn)', () => {
    const session = makeSession();
    const shoot = { ...emptyPlayerInput(), shootHeld: true, aim: { x: 1, y: 0 } };

    session.update(STEP_MS, shoot);
    const firstVolley = [...session.projectilesView].filter((p) => p.active);
    expect(firstVolley.length).toBeGreaterThan(0);

    // Let shots expire, then fire again.
    settle(session, 400);
    expect(session.projectileCount).toBe(0);

    session.update(STEP_MS, shoot);
    const secondVolley = [...session.projectilesView].filter((p) => p.active);
    expect(secondVolley.length).toBeGreaterThan(0);
    for (const shot of secondVolley) {
      expect(firstVolley.includes(shot)).toBe(true); // recycled, not reallocated
    }
  });

  it('projectileCount agrees with the filtered view (cheap hot read)', () => {
    const session = makeSession();
    const shoot = { ...emptyPlayerInput(), shootHeld: true, aim: { x: 1, y: 0 } };
    session.update(STEP_MS, shoot);
    expect(session.projectileCount).toBe(session.activeProjectiles.length);
  });
});
