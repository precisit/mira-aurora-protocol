/**
 * Minimal structural types for the WebAudio surface the audio engine touches
 * (PLAN.md §6 "Ljud").
 *
 * The real DOM AudioContext/GainNode/… classes structurally satisfy these
 * interfaces, so production code uses real WebAudio unchanged — while tests
 * can run headless in Node by injecting tiny fakes (see tests/audio.test.ts).
 * This mirrors the injection style of `SaveStore` (StorageLike).
 */

/** Subset of AudioParam used by the synth voices. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

/** Anything that can receive a connection (gains, filters, destination). */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** Mirrors AudioContextState; includes Safari's non-standard "interrupted". */
export type AudioContextState = 'running' | 'suspended' | 'closed' | 'interrupted';

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
}

/** Creates the (real or fake) context; returning null = no WebAudio support. */
export type AudioContextFactory = () => AudioContextLike | null;

/** Subset of HTMLMediaElement used by the music player. */
export interface MediaElementLike {
  src: string;
  loop: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
}

export type MediaElementFactory = (src: string) => MediaElementLike | null;

/** Minimal event-target surface for the autoplay unlock listeners. */
export interface InteractionTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
