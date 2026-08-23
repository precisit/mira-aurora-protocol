import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import type { TrackUrlResolver } from '../src/audio/MusicPlayer';
import { ALL_SFX_NAMES } from '../src/audio/SfxSynth';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  InteractionTargetLike,
  MediaElementFactory,
  MediaElementLike,
  OscillatorNodeLike,
} from '../src/audio/WebAudioTypes';
import { defaultSaveData, MemoryStorage, SAVE_KEY, SaveStore } from '../src/save/SaveStore';

// ---------------------------------------------------------------------------
// Headless fakes. Close enough to the real WebAudio spec to catch real bugs:
// e.g. exponential ramps to ≤ 0 throw RangeError, exactly like browsers do.
// ---------------------------------------------------------------------------

type ParamOp = { op: 'set' | 'linear' | 'exp' | 'cancel'; value: number; time: number };

class FakeParam {
  public readonly ops: ParamOp[] = [];

  public constructor(public value: number) {}

  public setValueAtTime(value: number, startTime: number): this {
    this.ops.push({ op: 'set', value, time: startTime });
    return this;
  }

  public linearRampToValueAtTime(value: number, endTime: number): this {
    this.ops.push({ op: 'linear', value, time: endTime });
    return this;
  }

  public exponentialRampToValueAtTime(value: number, endTime: number): this {
    if (value <= 0) throw new RangeError('exponential ramp target must be > 0'); // real spec
    this.ops.push({ op: 'exp', value, time: endTime });
    return this;
  }

  public cancelScheduledValues(cancelTime: number): this {
    this.ops.push({ op: 'cancel', value: 0, time: cancelTime });
    return this;
  }
}

class FakeNode {
  public readonly connections: unknown[] = [];

  public connect(destination: unknown): void {
    this.connections.push(destination);
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  public readonly gain = new FakeParam(1);
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  public type: OscillatorType = 'sine';
  public readonly frequency = new FakeParam(440);
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;

  public start(when?: number): void {
    this.startedAt = when ?? null;
  }

  public stop(when?: number): void {
    this.stoppedAt = when ?? null;
  }
}

class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency = new FakeParam(350);
  public readonly Q = new FakeParam(1);
}

class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  public buffer: AudioBufferLike | null = null;
  public loop = false;

  public start(_when?: number, _offset?: number, _duration?: number): void {
    void _when;
  }

  public stop(_when?: number): void {
    void _when;
  }
}

class FakeBuffer implements AudioBufferLike {
  public constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number,
  ) {}

  public getChannelData(channel: number): Float32Array {
    if (channel < 0 || channel >= this.numberOfChannels) throw new RangeError('bad channel');
    return new Float32Array(this.length);
  }
}

class FakeAudioContext implements AudioContextLike {
  public currentTime = 0;
  public state: 'running' | 'suspended' | 'closed' = 'suspended'; // browsers start suspended
  public readonly sampleRate = 44_100;
  public readonly destination = new FakeNode();

  public resumeCount = 0;
  public closeCount = 0;
  public readonly oscillators: FakeOscillator[] = [];
  public readonly gains: FakeGain[] = [];
  public readonly filters: FakeFilter[] = [];
  public readonly sources: FakeBufferSource[] = [];

  public async resume(): Promise<void> {
    this.resumeCount++;
    this.state = 'running';
  }

  public async close(): Promise<void> {
    this.closeCount++;
    this.state = 'closed';
  }

  public createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  public createOscillator(): OscillatorNodeLike {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  public createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }

  public createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  public createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }
}

class FakeMediaElement implements MediaElementLike {
  public src = '';
  public loop = false;
  public volume = 1;
  public playCount = 0;
  public pauseCount = 0;
  public failNextPlay: Error | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  public play(): Promise<void> {
    this.playCount++;
    if (this.failNextPlay) return Promise.reject(this.failNextPlay);
    return Promise.resolve();
  }

  public pause(): void {
    this.pauseCount++;
  }

  public addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  public emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

class FakeInteractionTarget implements InteractionTargetLike {
  public readonly registered = new Map<string, Array<() => void>>();

  public addEventListener(type: string, listener: () => void): void {
    const list = this.registered.get(type) ?? [];
    list.push(listener);
    this.registered.set(type, list);
  }

  public removeEventListener(type: string, listener: () => void): void {
    const index = this.registered.get(type)?.indexOf(listener) ?? -1;
    if (index >= 0) this.registered.get(type)?.splice(index, 1);
  }

  public emit(type: string): void {
    for (const listener of [...(this.registered.get(type) ?? [])]) listener();
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  ctx: FakeAudioContext;
  elements: FakeMediaElement[];
  engine: AudioEngine;
  warnings: string[];
  contextCreations: () => number;
}

function makeHarness(options?: {
  resolveTrackUrl?: TrackUrlResolver;
  failAllPlayback?: boolean;
}): Harness {
  const ctx = new FakeAudioContext();
  const elements: FakeMediaElement[] = [];
  const warnings: string[] = [];
  let creations = 0;

  const createElement: MediaElementFactory = () => {
    creations++;
    const element = new FakeMediaElement();
    if (options?.failAllPlayback) element.failNextPlay = new Error('MEDIA_ERR_SRC_NOT_SUPPORTED');
    elements.push(element);
    return element;
  };

  const engine = new AudioEngine({
    createContext: () => {
      creations++;
      return ctx;
    },
    createMediaElement: createElement,
    resolveTrackUrl: options?.resolveTrackUrl ?? ((trackId) => `/music/${trackId}.mp3`),
    onError: (message) => warnings.push(message),
  });

  return { ctx, elements, engine, warnings, contextCreations: () => creations };
}

async function unlockedHarness(options?: Parameters<typeof makeHarness>[0]): Promise<Harness> {
  const harness = makeHarness(options);
  await harness.engine.unlock();
  return harness;
}

/** Deterministic poll for async engine state; always yields ≥1 macrotask so
 * promise continuations (.then callbacks) get to run before checking. */
async function until(condition: () => boolean, timeoutMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, 2));
  } while (!condition());
}


// ---------------------------------------------------------------------------
// SFX synthesis
// ---------------------------------------------------------------------------

describe('AudioEngine — procedural SFX synthesis (headless)', () => {
  it('unlock builds the bus graph (sfx → master → destination) and resumes', async () => {
    const { ctx, engine } = makeHarness();
    expect(engine.isUnlocked).toBe(false);

    await engine.unlock();

    expect(engine.isUnlocked).toBe(true);
    expect(ctx.resumeCount).toBe(1);
    expect(ctx.gains).toHaveLength(2);
    expect(ctx.gains[0]?.connections).toContain(ctx.destination); // master out
    expect(ctx.gains[1]?.connections).toContain(ctx.gains[0]); // sfx into master
  });

  it('unlock is idempotent (one context, no duplicate buses)', async () => {
    const harness = makeHarness();
    await harness.engine.unlock();
    await harness.engine.unlock();
    expect(harness.contextCreations()).toBe(1);
    expect(harness.ctx.resumeCount).toBe(1);
    expect(harness.ctx.gains).toHaveLength(2);
  });

  it('plays every registered SFX without throwing and schedules voices', async () => {
    const { ctx, engine } = await unlockedHarness();
    expect([...ALL_SFX_NAMES].sort()).toEqual(
      [
        'shoot',
        'jump',
        'double-jump',
        'pickup',
        'damage',
        'death',
        'weapon-switch',
        'checkpoint',
        'boss-warning',
        'ui-click',
        'combo-tick',
        'intro-sting',
      ].sort(),
    );

    for (const name of ALL_SFX_NAMES) {
      expect(() => engine.playSfx(name)).not.toThrow();
    }
    for (const step of [0, 3, 7, 99]) {
      expect(() => engine.playSfx('combo-tick', { step })).not.toThrow();
    }

    // oscillators everywhere, plus noise bursts + filters for impact sounds
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(ALL_SFX_NAMES.length);
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.filters.length).toBeGreaterThan(0);
    for (const osc of ctx.oscillators) {
      expect(osc.stoppedAt).not.toBeNull(); // every voice self-cleans
    }
  });

  it('never schedules an exponential ramp to zero (real WebAudio throws)', async () => {
    const { ctx, engine } = await unlockedHarness();
    for (const name of ALL_SFX_NAMES) engine.playSfx(name);
    for (const gain of ctx.gains) {
      for (const operation of gain.gain.ops) {
        if (operation.op === 'exp') expect(operation.value).toBeGreaterThan(0);
      }
    }
    for (const osc of ctx.oscillators) {
      for (const operation of osc.frequency.ops) {
        if (operation.op === 'exp') expect(operation.value).toBeGreaterThan(0);
      }
    }
  });

  it('raises combo-tick pitch per step and caps at the top of the scale', async () => {
    const { ctx, engine } = await unlockedHarness();

    engine.playSfx('combo-tick', { step: 0 });
    const baseFreq = ctx.oscillators[ctx.oscillators.length - 1]?.frequency.ops[0]?.value ?? 0;

    engine.playSfx('combo-tick', { step: 6 });
    const midFreq = ctx.oscillators[ctx.oscillators.length - 1]?.frequency.ops[0]?.value ?? 0;
    expect(midFreq).toBeGreaterThan(baseFreq);

    engine.playSfx('combo-tick', { step: 999 }); // far past the ladder end
    const cappedFreq = ctx.oscillators[ctx.oscillators.length - 1]?.frequency.ops[0]?.value ?? 0;

    engine.playSfx('combo-tick', { step: 10 }); // exactly the last rung
    const topFreq = ctx.oscillators[ctx.oscillators.length - 1]?.frequency.ops[0]?.value ?? 0;
    expect(cappedFreq).toBe(topFreq);
  });

  it('stays silent before unlock without throwing', () => {
    const { ctx, engine } = makeHarness();
    expect(() => engine.playSfx('shoot')).not.toThrow();
    expect(ctx.oscillators).toHaveLength(0);
    expect(engine.isUnlocked).toBe(false);
  });

  it('stays silent without throwing when WebAudio is unavailable', async () => {
    const warnings: string[] = [];
    const engine = new AudioEngine({ createContext: () => null, onError: (m) => warnings.push(m) });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.isUnlocked).toBe(false);
    expect(() => engine.playSfx('jump')).not.toThrow();
    expect(warnings.some((message) => message.includes('WebAudio unavailable'))).toBe(true);
  });

  it('clamps volume setters to [0, 1]', async () => {
    const { ctx, engine } = await unlockedHarness();
    engine.setMasterVolume(5);
    expect(engine.masterVolume).toBe(1);
    engine.setMasterVolume(-3);
    expect(engine.masterVolume).toBe(0);
    engine.setSfxVolume(42);
    expect(engine.sfxVolume).toBe(1);
    engine.setMusicVolume(Number.NaN);
    expect(engine.musicVolume).toBe(0);

    engine.setMasterVolume(0.7);
    engine.setSfxVolume(0.3);
    expect(ctx.gains[0]?.gain.value).toBe(0.7);
    expect(ctx.gains[1]?.gain.value).toBe(0.3);
  });

  it('unlocks via initOnInteraction on first gesture and detaches listeners', async () => {
    const { engine } = makeHarness();
    const target = new FakeInteractionTarget();
    const onReady = vi.fn();

    const detach = engine.initOnInteraction(target, onReady);
    expect(typeof detach).toBe('function');
    expect(target.registered.get('keydown')?.length).toBe(1);
    expect(target.registered.get('pointerdown')?.length).toBe(1);
    expect(target.registered.get('touchend')?.length).toBe(1);

    target.emit('keydown');
    await until(() => engine.isUnlocked);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(target.registered.get('pointerdown')?.length).toBe(0); // auto-detached

    target.emit('pointerdown'); // no listeners left → no-op
    expect(onReady).toHaveBeenCalledTimes(1);

    detach(); // cleanup path must not throw even when already detached
  });

  it('dispose closes the context and keeps the engine silent afterwards', async () => {
    const { ctx, engine } = await unlockedHarness();
    engine.dispose();
    expect(ctx.closeCount).toBe(1);
    expect(() => engine.playSfx('death')).not.toThrow();
    expect(() => engine.dispose()).not.toThrow(); // double dispose safe
  });
});

// ---------------------------------------------------------------------------
// Music player framework
// ---------------------------------------------------------------------------

describe('AudioEngine — music player framework', () => {
  it('missing mp3 warns once and stays silent (Fas 5 readiness)', async () => {
    const harness = makeHarness({ resolveTrackUrl: () => null });

    await expect(harness.engine.playMusic('level-1')).resolves.toBe(false);
    expect(harness.elements).toHaveLength(0);
    expect(harness.warnings.filter((message) => message.includes('level-1'))).toHaveLength(1);
    expect(harness.engine.currentMusicTrack).toBeNull();
    expect(harness.engine.musicIsPlaying).toBe(false);

    await harness.engine.playMusic('level-1'); // retry must not spam warnings
    expect(harness.warnings.filter((message) => message.includes('level-1'))).toHaveLength(1);
  });

  it('plays an injected track looping at the effective volume (master·music)', async () => {
    const { engine, elements } = makeHarness();
    engine.setMasterVolume(1);
    engine.setMusicVolume(0.5);

    await expect(engine.playMusic('level-2')).resolves.toBe(true);

    const element = elements[0];
    expect(element?.src).toBe('/music/level-2.mp3');
    expect(element?.loop).toBe(true);
    expect(element?.volume).toBeCloseTo(0.5);
    expect(element?.playCount).toBe(1);
    expect(engine.musicIsPlaying).toBe(true);
    expect(engine.currentMusicTrack).toBe('level-2');

    engine.setMasterVolume(0.2); // volume changes apply live
    expect(element?.volume).toBeCloseTo(0.1);
  });

  it('switching level tracks stops the previous one', async () => {
    const { engine, elements } = makeHarness();
    await engine.playMusic('level-1');
    await engine.playMusic('level-3');

    expect(elements[0]?.pauseCount).toBeGreaterThanOrEqual(1);
    expect(elements[1]?.src).toBe('/music/level-3.mp3');
    expect(engine.currentMusicTrack).toBe('level-3');

    await engine.playMusic('level-3'); // same track while playing → no restart
    expect(elements).toHaveLength(2);
    expect(elements[1]?.playCount).toBe(1);
  });

  it('pause/resume keeps the track; stop unloads it', async () => {
    vi.useFakeTimers();
    try {
      const { engine, elements } = makeHarness();
      await engine.playMusic('pause-test');

      engine.pauseMusic();
      expect(engine.musicIsPlaying).toBe(false);
      expect(elements[0]?.pauseCount).toBe(1);
      expect(elements[0]?.src).toBe('/music/pause-test.mp3'); // kept for resume

      expect(engine.resumeMusic()).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(elements[0]?.playCount).toBe(2);
      expect(engine.musicIsPlaying).toBe(true);

      engine.stopMusic();
      expect(engine.currentMusicTrack).toBeNull();
      expect(engine.resumeMusic()).toBe(false); // nothing left to resume
    } finally {
      vi.useRealTimers();
    }
  });

  it('element error events (404 / decode failure) degrade to silence', async () => {
    const { engine, elements, warnings } = makeHarness();
    await engine.playMusic('broken-track');

    elements[0]?.emit('error');

    expect(engine.musicIsPlaying).toBe(false);
    expect(engine.currentMusicTrack).toBeNull();
    expect(warnings.some((message) => message.includes('failed to load'))).toBe(true);
  });

  it('rejected play() calls are caught, warned, and stay silent', async () => {
    const harness = makeHarness({ failAllPlayback: true });
    await expect(harness.engine.playMusic('nope')).resolves.toBe(false);
    expect(harness.engine.currentMusicTrack).toBeNull();
    expect(harness.warnings.some((message) => message.includes('could not play'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings persistence hook (SaveStore)
// ---------------------------------------------------------------------------

describe('AudioEngine — settings persistence hook', () => {
  it('round-trips volumes through SaveStore', () => {
    const { engine } = makeHarness();
    const data = defaultSaveData();

    engine.applySettings(data.settings); // persisted → engine
    expect(engine.masterVolume).toBe(data.settings.volume);
    expect(engine.sfxVolume).toBe(data.settings.sfxVolume);
    expect(engine.musicVolume).toBe(data.settings.musicVolume);

    engine.setMasterVolume(0.33);
    engine.setSfxVolume(0.44);
    engine.setMusicVolume(0.55);
    engine.captureVolumesInto(data); // engine → persistable blob

    const storage = new MemoryStorage();
    new SaveStore(storage).save(data);
    const reloaded = new SaveStore(storage).load();
    expect(reloaded.settings.volume).toBeCloseTo(0.33);
    expect(reloaded.settings.sfxVolume).toBeCloseTo(0.44);
    expect(reloaded.settings.musicVolume).toBeCloseTo(0.55);
  });

  it('repairs old saves that predate sfx/music volume fields', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, totalScore: 10 }));
    const settings = new SaveStore(storage).load().settings;
    expect(settings.sfxVolume).toBe(defaultSaveData().settings.sfxVolume);
    expect(settings.musicVolume).toBe(defaultSaveData().settings.musicVolume);
  });
});
