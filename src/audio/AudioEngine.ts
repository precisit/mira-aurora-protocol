/**
 * Audio engine (PLAN.md §6 "Ljud").
 *
 * Facade over two subsystems:
 *   - Procedural SFX synthesis (see {@link ./SfxSynth}) routed through a
 *     dedicated SFX bus (sfxGain → masterGain → destination).
 *   - Per-level looping mp3 music (see {@link ./MusicPlayer}); the mp3 files
 *     arrive in Fas 5, until then track lookups note once (info level) and
 *     stay silent.
 *
 * Autoplay policy: the AudioContext is created lazily inside {@link unlock},
 * which must run from a user gesture — {@link initOnInteraction} wires that
 * up from main on the first keydown/pointerdown/touchend.
 *
 * Volume model: master · SFX gains are WebAudio GainNodes; music loudness is
 * the product master·music pushed onto the media element (it bypasses the
 * graph by design). All three are persisted through the SaveStore settings
 * hook ({@link applySettings} / {@link captureVolumesInto}).
 *
 * Everything degrades gracefully: without WebAudio support, before unlock,
 * or after dispose the engine simply stays silent instead of throwing.
 */

import { MusicPlayer, type TrackUrlResolver } from './MusicPlayer';
import { ALL_SFX_NAMES, createNoiseBuffer, SFX_SYNTHS } from './SfxSynth';
import type { SfxName, SfxOptions } from './SfxSynth';
import type {
  AudioBufferLike,
  AudioContextFactory,
  AudioContextLike,
  GainNodeLike,
  InteractionTargetLike,
  MediaElementFactory,
} from './WebAudioTypes';
import { type GameSettings, type SaveData } from '../save/SaveStore';

export { ALL_SFX_NAMES };
export type { SfxName, SfxOptions };

export interface AudioEngineOptions {
  /** Context factory; defaults to `new window.AudioContext()`. Inject a fake for tests. */
  createContext?: AudioContextFactory;
  /** Media-element factory for music; defaults to `new Audio(src)`. */
  createMediaElement?: MediaElementFactory;
  /** Track-id → URL resolver; defaults to Vite's bundled assets/music map. */
  resolveTrackUrl?: TrackUrlResolver;
  /** Warning sink; defaults to console.warn. */
  onError?: (message: string) => void;
  /** Info sink for expected/phase-related notices; defaults to console.info. */
  onInfo?: (message: string) => void;
}

export class AudioEngine {
  private readonly createContext: AudioContextFactory;
  private readonly errorSink: (message: string) => void;
  private readonly infoSink: (message: string) => void;

  private readonly music: MusicPlayer;

  private context: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private sfxGain: GainNodeLike | null = null;
  private noiseCache: AudioBufferLike | null = null;

  private masterVolumeValue = 0.8;
  private sfxVolumeValue = 0.9;
  private musicVolumeValue = 0.7;

  public constructor(options: AudioEngineOptions = {}) {
    this.createContext = options.createContext ?? defaultContextFactory;
    this.errorSink =
      options.onError ??
      ((message: string) => {
        console.warn(message);
      });
    this.infoSink = options.onInfo ?? ((message: string) => console.info(message));

    this.music = new MusicPlayer({
      createElement: options.createMediaElement,
      resolveTrackUrl: options.resolveTrackUrl,
      onError: (message) => this.reportError(message),
      onInfo: (message) => this.reportInfo(message),
    });
    this.syncMusicVolume();
  }

  /** True when a context exists and is running (i.e. SFX will be audible). */
  public get isUnlocked(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /**
   * Creates + resumes the audio context. MUST be triggered from a user-gesture
   * handler (autoplay policy). Idempotent; safe no-op when WebAudio is absent.
   */
  public async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.resumeQuietly(this.context);
      return;
    }

    const ctx = this.createContext();
    if (!ctx) {
      this.reportError('[audio] WebAudio unavailable in this environment — staying silent');
      return;
    }

    this.context = ctx;
    this.noiseCache = createNoiseBuffer(ctx);

    const master = ctx.createGain();
    master.gain.value = this.masterVolumeValue;
    master.connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.gain.value = this.sfxVolumeValue;
    sfx.connect(master);

    this.masterGain = master;
    this.sfxGain = sfx;

    await this.resumeQuietly(ctx);
  }

  /**
   * Registers one-shot unlock listeners for the first user interaction
   * (keydown/pointerdown/touchend). `onUnlocked` fires once when the context
   * actually starts running (e.g. for an "audio ready" confirmation blip).
   * Returns a detach function for cleanup.
   */
  public initOnInteraction(
    target: InteractionTargetLike = defaultInteractionTarget(),
    onUnlocked?: () => void,
  ): () => void {
    const events = ['keydown', 'pointerdown', 'touchend'] as const;
    const detach = (): void => {
      for (const event of events) target.removeEventListener(event, handler);
    };
    const handler = (): void => {
      detach();
      void this.unlock().then(() => {
        if (this.isUnlocked) onUnlocked?.();
      });
    };
    for (const event of events) target.addEventListener(event, handler);
    return detach;
  }

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------

  /**
   * Plays a procedural sound effect. Safe to call any time: before unlock,
   * while muted, or with an unknown name it simply does nothing.
   */
  public playSfx(name: SfxName, options: SfxOptions = {}): void {
    const ctx = this.context;
    const out = this.sfxGain;
    if (!ctx || !out || ctx.state !== 'running' || this.masterVolumeValue <= 0 || this.sfxVolumeValue <= 0) {
      return;
    }
    const synth = SFX_SYNTHS[name];
    if (!synth) return;

    const noiseCache = this.noiseCache;
    try {
      synth({ ctx, noise: () => this.requireNoise(noiseCache) }, out, ctx.currentTime, options);
    } catch (error) {
      this.reportError(`[audio] SFX "${name}" failed: ${String(error)}`);
    }
  }

  /** Convenience for iterating all effects (tests, settings UI demos). */
  public get sfxNames(): readonly SfxName[] {
    return ALL_SFX_NAMES;
  }

  private requireNoise(cached: AudioBufferLike | null): AudioBufferLike {
    if (!cached) throw new Error('noise buffer missing — was the engine unlocked?');
    return cached;
  }

  // ---------------------------------------------------------------------------
  // Volume control & persistence hooks
  // ---------------------------------------------------------------------------

  public get masterVolume(): number {
    return this.masterVolumeValue;
  }

  public get sfxVolume(): number {
    return this.sfxVolumeValue;
  }

  public get musicVolume(): number {
    return this.musicVolumeValue;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolumeValue = clamp01(volume);
    if (this.masterGain) this.masterGain.gain.value = this.masterVolumeValue;
    this.syncMusicVolume();
  }

  public setSfxVolume(volume: number): void {
    this.sfxVolumeValue = clamp01(volume);
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolumeValue;
  }

  public setMusicVolume(volume: number): void {
    this.musicVolumeValue = clamp01(volume);
    this.syncMusicVolume();
  }

  /** Loads volumes from persisted settings (SaveStore.saveData.settings). */
  public applySettings(settings: GameSettings): void {
    this.setMasterVolume(settings.volume);
    this.setSfxVolume(settings.sfxVolume);
    this.setMusicVolume(settings.musicVolume);
  }

  /** Writes current volumes into a SaveData blob so callers can persist it. */
  public captureVolumesInto(data: SaveData): SaveData {
    data.settings.volume = this.masterVolumeValue;
    data.settings.sfxVolume = this.sfxVolumeValue;
    data.settings.musicVolume = this.musicVolumeValue;
    return data;
  }

  private syncMusicVolume(): void {
    this.music.setVolume(this.masterVolumeValue * this.musicVolumeValue);
  }

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------

  /**
   * Starts looping the level track. Returns false (with a one-time warning)
   * when the mp3 is missing from assets/music/ — expected until Fas 5.
   */
  public async playMusic(trackId: string): Promise<boolean> {
    return this.music.play(trackId);
  }

  /** Pauses music keeping position (e.g. game paused). */
  public pauseMusic(): void {
    this.music.pause();
  }

  /** Resumes paused music; returns true when a resume was initiated. */
  public resumeMusic(): boolean {
    return this.music.resume();
  }

  /** Stops and unloads the current track. */
  public stopMusic(): void {
    this.music.stop();
  }

  public get currentMusicTrack(): string | null {
    return this.music.currentTrackId;
  }

  public get musicIsPlaying(): boolean {
    return this.music.isPlaying;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Stops music and closes the context. The engine stays reusable after. */
  public dispose(): void {
    this.music.stop();
    const ctx = this.context;
    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.noiseCache = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  private async resumeQuietly(ctx: AudioContextLike): Promise<void> {
    try {
      await ctx.resume();
    } catch (error) {
      // Autoplay policy blocks resume() until the first user gesture — an
      // expected, by-design state (unlock-on-first-gesture retries later), so
      // it must stay silent rather than spamming the QA console.
      if (isAutoplayBlock(error)) return;
      this.reportError(`[audio] could not resume audio context: ${String(error)}`);
    }
  }

  private reportError(message: string): void {
    this.errorSink(message);
  }

  private reportInfo(message: string): void {
    this.infoSink(message);
  }
}

/**
 * True when a resume() failure is just the browser autoplay policy refusing
 * to start audio before a user gesture. Chrome rejects with a DOMException
 * named NotAllowedError ("The AudioContext was not allowed to start.");
 * message matching keeps the check portable for non-DOM environments.
 */
function isAutoplayBlock(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && name === 'NotAllowedError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not allowed|autoplay/i.test(message);
}

// ---------------------------------------------------------------------------
// Defaults (browser-only, guarded so importing this module never throws in Node)
// ---------------------------------------------------------------------------

function defaultContextFactory(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  return new Ctor();
}

function defaultInteractionTarget(): InteractionTargetLike {
  if (typeof window !== 'undefined') return window;
  return { addEventListener: () => undefined, removeEventListener: () => undefined };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
