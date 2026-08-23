/**
 * Procedural SFX synthesis (PLAN.md §6 "Ljud").
 *
 * Every game event sound is a tiny synth function built from a handful of
 * WebAudio primitives (oscillator blips, filtered noise bursts, sirens,
 * arpeggios) with tunable parameters — no external audio files.
 *
 * All voices schedule against an injected {@link SynthKit} so headless tests
 * can supply a fake context. Exponential ramps are guarded to stay > 0 (the
 * real spec throws RangeError otherwise) and every voice self-cleans via
 * osc.stop().
 */

import type { AudioBufferLike, AudioContextLike, AudioNodeLike } from './WebAudioTypes';

/** Every procedural sound effect in the game. */
export type SfxName =
  | 'shoot'
  | 'jump'
  | 'double-jump'
  | 'pickup'
  | 'damage'
  | 'death'
  | 'weapon-switch'
  | 'checkpoint'
  | 'boss-warning'
  | 'ui-click'
  | 'combo-tick';

/** Optional per-call tweaks (e.g. combo pitch ladder step). */
export interface SfxOptions {
  /** Combo counter position — raises combo-tick pitch up the pentatonic scale. */
  step?: number;
}

/** Context handed to each synth function by the engine. */
export interface SynthKit {
  readonly ctx: AudioContextLike;
  /** Lazily-created shared white-noise buffer (cached per audio context). */
  noise(): AudioBufferLike;
}

export type SfxSynthFn = (
  kit: SynthKit,
  out: AudioNodeLike,
  when: number,
  options: SfxOptions,
) => void;

const EPS = 0.0001; // smallest audible-safe value for exponential ramps

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface BlipParams {
  type: OscillatorType;
  /** Start frequency in Hz. */
  fromFreq: number;
  /** End frequency in Hz (exponential sweep). */
  toFreq: number;
  durationMs: number;
  gain: number;
  /** Linear fade-in before the exponential decay; default 3 ms. */
  attackMs?: number;
  /** Schedule offset from `when`; lets one synth stack several voices. */
  delayMs?: number;
}

/** Pitch-swept oscillator with a fast attack / exponential decay envelope. */
function blip(kit: SynthKit, out: AudioNodeLike, when: number, params: BlipParams): void {
  const { ctx } = kit;
  const t0 = when + Math.max(0, params.delayMs ?? 0) / 1000;
  const duration = Math.max(10, params.durationMs) / 1000;
  const tEnd = t0 + duration;

  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.type = params.type;
  osc.frequency.setValueAtTime(Math.max(1, params.fromFreq), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, params.toFreq), tEnd);

  const attack = Math.min(duration / 2, Math.max(0.001, (params.attackMs ?? 3) / 1000));
  env.gain.setValueAtTime(EPS, t0);
  env.gain.linearRampToValueAtTime(Math.max(EPS, params.gain), t0 + attack);
  env.gain.exponentialRampToValueAtTime(EPS, tEnd);

  osc.connect(env);
  env.connect(out);
  osc.start(t0);
  osc.stop(tEnd + 0.03);
}

export interface NoiseBurstParams {
  durationMs: number;
  gain: number;
  filterType: BiquadFilterType;
  /** Filter start frequency in Hz. */
  fromFreq: number;
  /** Optional filter sweep end frequency in Hz. */
  toFreq?: number;
  q?: number;
  delayMs?: number;
}

/** Filtered white-noise burst — impacts, explosions, clicks, thrusters. */
function noiseBurst(kit: SynthKit, out: AudioNodeLike, when: number, params: NoiseBurstParams): void {
  const { ctx } = kit;
  const t0 = when + Math.max(0, params.delayMs ?? 0) / 1000;
  const duration = Math.max(10, params.durationMs) / 1000;
  const tEnd = t0 + duration;

  const source = ctx.createBufferSource();
  source.buffer = kit.noise();

  const filter = ctx.createBiquadFilter();
  filter.type = params.filterType;
  filter.Q.value = params.q ?? 1;
  filter.frequency.setValueAtTime(Math.max(1, params.fromFreq), t0);
  if (params.toFreq !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, params.toFreq), tEnd);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(EPS, params.gain), t0);
  env.gain.exponentialRampToValueAtTime(EPS, tEnd);

  source.connect(filter);
  filter.connect(env);
  env.connect(out);
  source.start(t0);
  source.stop(tEnd + 0.02);
}

// ---------------------------------------------------------------------------
// Per-event synth functions (tuned neon-arcade defaults; tweak freely)
// ---------------------------------------------------------------------------

/** Puls laser: short square zap with a high click transient. */
const shootSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'square', fromFreq: 880, toFreq: 220, durationMs: 80, gain: 0.05 });
  noiseBurst(kit, out, when, { durationMs: 30, gain: 0.018, filterType: 'highpass', fromFreq: 2400 });
};

/** Jump: rising sine whoosh. */
const jumpSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'sine', fromFreq: 240, toFreq: 660, durationMs: 120, gain: 0.09 });
};

/** Double jump: higher sweep plus delayed sparkle for the second thruster. */
const doubleJumpSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'sine', fromFreq: 420, toFreq: 990, durationMs: 130, gain: 0.08 });
  blip(kit, out, when, {
    type: 'triangle',
    fromFreq: 990,
    toFreq: 1568,
    durationMs: 70,
    gain: 0.04,
    delayMs: 55,
  });
};

/** Memory fragment pickup: bright two-note coin chime. */
const pickupSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'triangle', fromFreq: 987.77, toFreq: 987.77, durationMs: 60, gain: 0.06 });
  blip(kit, out, when, {
    type: 'triangle',
    fromFreq: 1318.51,
    toFreq: 1318.51,
    durationMs: 150,
    gain: 0.06,
    delayMs: 62,
  });
};

/** Damage: harsh falling saw plus mid-band impact crunch. */
const damageSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'sawtooth', fromFreq: 300, toFreq: 60, durationMs: 160, gain: 0.1 });
  noiseBurst(kit, out, when, {
    durationMs: 120,
    gain: 0.06,
    filterType: 'bandpass',
    fromFreq: 500,
    toFreq: 150,
    q: 1.2,
  });
};

/** Death: long descending fall with sub drop and noise wash. */
const deathSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'sawtooth', fromFreq: 440, toFreq: 40, durationMs: 420, gain: 0.11 });
  blip(kit, out, when, {
    type: 'sine',
    fromFreq: 220,
    toFreq: 50,
    durationMs: 330,
    gain: 0.07,
    delayMs: 40,
  });
  noiseBurst(kit, out, when, {
    durationMs: 380,
    gain: 0.05,
    filterType: 'lowpass',
    fromFreq: 1400,
    toFreq: 120,
  });
};

/** Weapon switch: mechanical double clack. */
const weaponSwitchSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'square', fromFreq: 520, toFreq: 520, durationMs: 35, gain: 0.05 });
  blip(kit, out, when, {
    type: 'square',
    fromFreq: 784,
    toFreq: 784,
    durationMs: 45,
    gain: 0.05,
    delayMs: 50,
  });
  noiseBurst(kit, out, when, {
    durationMs: 25,
    gain: 0.014,
    filterType: 'highpass',
    fromFreq: 3000,
    delayMs: 50,
  });
};

/** Checkpoint: rising C-major triad fanfare. */
const checkpointSfx: SfxSynthFn = (kit, out, when) => {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, index) => {
    blip(kit, out, when, {
      type: 'triangle',
      fromFreq: freq,
      toFreq: freq,
      durationMs: 140,
      gain: 0.06,
      delayMs: index * 85,
    });
  });
};

/** Boss warning: ominous two-tone siren over a low rumble. */
const bossWarningSfx: SfxSynthFn = (kit, out, when) => {
  const { ctx } = kit;
  const freqA = 392; // G4
  const freqB = 493.88; // B4
  const halfCycleSeconds = 0.12;
  const halves = 6; // three full A/B sweeps ≈ 0.72 s
  const total = halves * halfCycleSeconds;

  const osc = ctx.createOscillator();
  osc.type = 'square';
  for (let i = 0; i < halves; i++) {
    osc.frequency.setValueAtTime(i % 2 === 0 ? freqA : freqB, when + i * halfCycleSeconds);
  }

  const env = ctx.createGain();
  env.gain.setValueAtTime(EPS, when);
  env.gain.linearRampToValueAtTime(0.07, when + 0.02);
  env.gain.setValueAtTime(0.07, when + total - 0.08);
  env.gain.exponentialRampToValueAtTime(EPS, when + total);

  osc.connect(env);
  env.connect(out);
  osc.start(when);
  osc.stop(when + total + 0.03);

  noiseBurst(kit, out, when, { durationMs: total * 1000, gain: 0.035, filterType: 'lowpass', fromFreq: 260 });
};

/** UI click: tiny neutral tick. */
const uiClickSfx: SfxSynthFn = (kit, out, when) => {
  blip(kit, out, when, { type: 'square', fromFreq: 700, toFreq: 700, durationMs: 40, gain: 0.04 });
};

/** Pentatonic ladder for escalating combos (semitone offsets). */
const COMBO_SCALE_SEMITONES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** Combo tick: short blip whose pitch climbs the pentatonic scale per step. */
const comboTickSfx: SfxSynthFn = (kit, out, when, options) => {
  const requested = Math.max(0, Math.floor(options.step ?? 0));
  const index = Math.min(requested, COMBO_SCALE_SEMITONES.length - 1);
  const semitones = COMBO_SCALE_SEMITONES[index] ?? 0;
  const freq = 587.33 * Math.pow(2, semitones / 12); // D5 base
  blip(kit, out, when, { type: 'sine', fromFreq: freq, toFreq: freq, durationMs: 45, gain: 0.05 });
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SFX_SYNTHS: Readonly<Record<SfxName, SfxSynthFn>> = {
  shoot: shootSfx,
  jump: jumpSfx,
  'double-jump': doubleJumpSfx,
  pickup: pickupSfx,
  damage: damageSfx,
  death: deathSfx,
  'weapon-switch': weaponSwitchSfx,
  checkpoint: checkpointSfx,
  'boss-warning': bossWarningSfx,
  'ui-click': uiClickSfx,
  'combo-tick': comboTickSfx,
};

export const ALL_SFX_NAMES: readonly SfxName[] = Object.keys(SFX_SYNTHS) as SfxName[];

/** Builds the shared mono white-noise buffer used by all noise bursts. */
export function createNoiseBuffer(ctx: AudioContextLike): AudioBufferLike {
  const seconds = 0.5;
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
