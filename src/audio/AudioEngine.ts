/**
 * Audio engine skeleton (PLAN.md §6 "Ljud").
 *
 * Fas 0 ships a *working* procedural SFX path (WebAudio oscillators + gain
 * envelopes) and the lifecycle plumbing:
 *   - the AudioContext is created lazily on the first user gesture
 *     (browser autoplay policy), via `unlock()`;
 *   - mp3 music per level arrives in Fas 5 — `playMusic` already validates
 *     its inputs so later waves can plug loaders in without API changes.
 */

export type SfxName =
  | 'shoot'
  | 'jump'
  | 'double-jump'
  | 'pickup'
  | 'hit'
  | 'death'
  | 'weapon-swap'
  | 'checkpoint'
  | 'ui-click';

interface SfxSpec {
  type: OscillatorType;
  fromFreq: number;
  toFreq: number;
  durationMs: number;
  gain: number;
}

const SFX_LIBRARY: Readonly<Record<SfxName, SfxSpec>> = {
  shoot: { type: 'square', fromFreq: 880, toFreq: 220, durationMs: 80, gain: 0.05 },
  jump: { type: 'sine', fromFreq: 240, toFreq: 660, durationMs: 120, gain: 0.08 },
  'double-jump': { type: 'sine', fromFreq: 420, toFreq: 990, durationMs: 130, gain: 0.08 },
  pickup: { type: 'triangle', fromFreq: 660, toFreq: 1320, durationMs: 90, gain: 0.07 },
  hit: { type: 'sawtooth', fromFreq: 300, toFreq: 60, durationMs: 160, gain: 0.1 },
  death: { type: 'sawtooth', fromFreq: 440, toFreq: 40, durationMs: 400, gain: 0.12 },
  'weapon-swap': { type: 'square', fromFreq: 520, toFreq: 780, durationMs: 70, gain: 0.05 },
  checkpoint: { type: 'triangle', fromFreq: 523, toFreq: 1046, durationMs: 200, gain: 0.08 },
  'ui-click': { type: 'square', fromFreq: 700, toFreq: 700, durationMs: 40, gain: 0.04 },
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.8;

  /** Must be called from a user-gesture handler (keydown/pointerdown). */
  public async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return; // No WebAudio (ancient browser): stay silent, never crash.
    this.context = new Ctor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.context.destination);
    await this.context.resume();
  }

  public setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    this.volume = clamped;
    if (this.masterGain) this.masterGain.gain.value = clamped;
  }

  public get isUnlocked(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /**
   * Play a short synthesized effect. Safe to call before unlock()
   * (it simply does nothing until the context exists).
   */
  public playSfx(name: SfxName): void {
    const ctx = this.context;
    const master = this.masterGain;
    if (!ctx || !master || ctx.state !== 'running') return;

    const spec = SFX_LIBRARY[name];
    if (!spec) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.fromFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.toFreq), now + spec.durationMs / 1000);

    env.gain.setValueAtTime(spec.gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + spec.durationMs / 1000);

    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + spec.durationMs / 1000 + 0.02);
  }

  /**
   * Placeholder music hook with real validation semantics: Fas 5 will pass
   * per-level track ids backed by files in assets/music/. Unknown tracks are
   * ignored rather than thrown so gameplay never crashes on audio.
   */
  public playMusic(trackId: string): boolean {
    return typeof trackId === 'string' && trackId.length > 0;
  }

  public dispose(): void {
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
  }
}
