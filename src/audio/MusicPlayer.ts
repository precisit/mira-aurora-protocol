/**
 * Music player framework (PLAN.md §6 "Ljud").
 *
 * One looping mp3 per level from `assets/music/`. The mp3 files themselves
 * arrive in Fas 5 (generated music), so the whole player is built around
 * *graceful absence*: an unknown or unloadable track logs a single console
 * warning and stays silent — gameplay never crashes on audio.
 *
 * Tracks are discovered by Vite's `import.meta.glob` over `assets/music/*.mp3`,
 * so dropping files into that folder later requires zero code changes here.
 * Both the media-element factory and the URL resolver are injectable for
 * headless tests.
 */

import type { MediaElementFactory, MediaElementLike } from './WebAudioTypes';

/** Maps a track id (level id, e.g. "level-1") to its resolved asset URL. */
export type TrackUrlResolver = (trackId: string) => string | null;

/**
 * Bundles every mp3 under assets/music/ as a hashed asset URL, keyed by
 * filename without extension. Empty until Fas 5 adds the actual files.
 */
const BUNDLED_TRACK_URLS: Readonly<Record<string, string>> = (() => {
  const modules = import.meta.glob('/assets/music/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;

  const byId: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const fileName = path.split('/').pop();
    if (!fileName) continue;
    byId[fileName.replace(/\.mp3$/i, '')] = url;
  }
  return byId;
})();

/** Default resolver: looks up the Vite-bundled assets/music/*.mp3 registry. */
export function bundledTrackResolver(trackId: string): string | null {
  return BUNDLED_TRACK_URLS[trackId] ?? null;
}

function defaultMediaElement(src: string): MediaElementLike | null {
  if (typeof Audio === 'undefined') return null; // headless/node: stay silent
  return new Audio(src);
}

export interface MusicPlayerOptions {
  /** Creates the underlying media element; defaults to `new Audio(src)`. */
  createElement?: MediaElementFactory;
  /** Resolves track ids to URLs; defaults to the bundled assets/music map. */
  resolveTrackUrl?: TrackUrlResolver;
  /** Warning sink; defaults to console.warn. */
  onError?: (message: string) => void;
  /** Initial music volume, 0..1. */
  initialVolume?: number;
}

/**
 * Single-track looping music player with pause/resume and volume control.
 *
 * The element deliberately bypasses the WebAudio graph (no CORS/media-source
 * complexity); effective loudness is managed by the owner pushing
 * master·music volume products into {@link setVolume}.
 */
export class MusicPlayer {
  private readonly createElement: MediaElementFactory;
  private readonly resolveTrackUrl: TrackUrlResolver;
  private readonly onError: (message: string) => void;

  private element: MediaElementLike | null = null;
  private currentId: string | null = null;
  private playing = false;
  private volume: number;
  private playToken = 0;
  /** Tracks already warned about (missing/unloadable) to avoid log spam. */
  private readonly warnedTracks = new Set<string>();

  public constructor(options: MusicPlayerOptions = {}) {
    this.createElement = options.createElement ?? defaultMediaElement;
    this.resolveTrackUrl = options.resolveTrackUrl ?? bundledTrackResolver;
    this.onError = options.onError ?? ((message) => console.warn(message));
    this.volume = clamp01(options.initialVolume ?? 0.8);
  }

  /** Currently loaded track id, or null when silent. */
  public get currentTrackId(): string | null {
    return this.currentId;
  }

  public get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Switches to `trackId`, looping it. Returns true when playback actually
   * started; false means the track is missing/broken (warned once, silent).
   */
  public async play(trackId: string): Promise<boolean> {
    if (!trackId) return false;
    if (trackId === this.currentId && this.playing) return true;

    const token = ++this.playToken;
    const url = this.resolveTrackUrl(trackId);
    if (!url) {
      this.warnOnce(trackId, `[audio] music track "${trackId}" not found in assets/music/ — staying silent`);
      this.stopInternal();
      return false;
    }

    this.stopInternal();

    const element = this.createElement(url);
    if (!element) {
      this.warnOnce(trackId, `[audio] cannot create audio element for "${trackId}" — staying silent`);
      return false;
    }

    element.src = url;
    element.loop = true;
    element.volume = this.volume;
    element.addEventListener('error', () => {
      // Fires for 404s / decode failures after .play() resolved optimistically.
      if (this.element !== element || token !== this.playToken) return;
      this.handleBroken(trackId, `[audio] music track "${trackId}" failed to load — staying silent`);
    });

    this.element = element;
    try {
      await element.play();
    } catch (error) {
      if (token === this.playToken) {
        this.handleBroken(
          trackId,
          `[audio] could not play music track "${trackId}": ${String(error)} — staying silent`,
        );
      }
      return false;
    }
    if (token !== this.playToken) return false; // superseded by a newer call

    this.currentId = trackId;
    this.playing = true;
    return true;
  }

  /** Pauses while keeping position and track, so resume() continues it. */
  public pause(): void {
    if (!this.element || !this.playing) return;
    this.element.pause();
    this.playing = false;
  }

  /** Resumes a paused track. Returns true when a resume was initiated. */
  public resume(): boolean {
    const element = this.element;
    if (!element || this.playing || !this.currentId) return false;
    void element
      .play()
      .then(() => {
        this.playing = true;
      })
      .catch((error: unknown) => {
        this.handleBroken(
          this.currentId ?? 'unknown',
          `[audio] could not resume music: ${String(error)} — staying silent`,
        );
      });
    return true;
  }

  /** Fully stops playback and unloads the current track. */
  public stop(): void {
    this.stopInternal();
  }

  public setVolume(volume: number): void {
    this.volume = clamp01(volume);
    if (this.element) this.element.volume = this.volume;
  }

  public get volumeValue(): number {
    return this.volume;
  }

  private handleBroken(trackId: string, message: string): void {
    this.stopInternal();
    this.warnOnce(trackId, message);
  }

  private stopInternal(): void {
    this.playing = false;
    this.element?.pause();
    this.element = null;
    this.currentId = null;
  }

  private warnOnce(trackId: string, message: string): void {
    if (this.warnedTracks.has(trackId)) return;
    this.warnedTracks.add(trackId);
    this.onError(message);
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
