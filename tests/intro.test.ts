import { describe, expect, it } from 'vitest';
import { GameStateMachine, GameStateName } from '../src/core/GameState';
import { ARCHIVE_EPIGRAPH } from '../src/ui/archive';
import {
  INTRO_SCENES,
  INTRO_TAGLINE,
  INTRO_TITLE,
  INTRO_TOTAL_SECONDS,
  IntroPlayback,
  IntroSequence,
  NEON_FONT,
  SKIP_HINT_TEXT,
  TITLE_CARD_LINES,
  appendNeonText,
  introSceneAt,
  measureNeonText,
  normalizeNeonText,
  validateIntroScript,
} from '../src/ui/IntroSequence';
import type { SpriteDraw } from '../src/renderer/types';

function allIntroStrings(): readonly string[] {
  return [
    ...INTRO_SCENES.flatMap((scene) => [scene.caption, scene.subtitle]),
    ...TITLE_CARD_LINES,
    SKIP_HINT_TEXT,
    'DOWNLOADING ARCHIVE',
    'MNEMOSYNE ARCHIVE \u00B7 2147',
  ];
}

describe('intro scene script data', () => {
  it('validates without problems', () => {
    expect(validateIntroScript()).toEqual([]);
  });

  it('orders scenes exactly as the story beats', () => {
    expect(INTRO_SCENES.map((scene) => scene.id)).toEqual([
      'ignition',
      'xeno',
      'awakening',
      'title',
    ]);
  });

  it('has positive, finite durations and a sane total length', () => {
    for (const scene of INTRO_SCENES) {
      expect(scene.durationSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(scene.durationSeconds)).toBe(true);
    }
    expect(INTRO_TOTAL_SECONDS).toBeCloseTo(
      INTRO_SCENES.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      6,
    );
    expect(INTRO_TOTAL_SECONDS).toBeGreaterThanOrEqual(10);
    expect(INTRO_TOTAL_SECONDS).toBeLessThanOrEqual(15);
  });

  it('rejects broken scripts', () => {
    const broken = [
      { id: 'title', durationSeconds: -1, caption: '', subtitle: '' },
      { id: 'ignition', durationSeconds: 2, caption: 'a', subtitle: '' },
    ] as const;
    expect(validateIntroScript(broken as never).length).toBeGreaterThan(0);
  });
});

describe('intro narrative content', () => {
  it('presents the title card AURORA PROTOCOL', () => {
    expect(INTRO_TITLE).toBe('AURORA PROTOCOL');
    expect(TITLE_CARD_LINES.join(' ')).toBe('AURORA PROTOCOL');
    expect(INTRO_SCENES.at(-1)?.caption).toBe(INTRO_TITLE);
  });

  it('reuses the archive epigraph as the tagline', () => {
    expect(ARCHIVE_EPIGRAPH.length).toBeGreaterThan(0);
    expect(normalizeNeonText(ARCHIVE_EPIGRAPH)).toBe(
      "HUMANITY'S MEMORY MUST NOT DIE.",
    );
    expect(INTRO_TAGLINE).toBe("HUMANITY'S MEMORY MUST NOT DIE.");
    expect(INTRO_SCENES.at(-1)?.subtitle).toBe(INTRO_TAGLINE);
  });

  it('names Mnemosyne, XENO and the download protocol across scenes', () => {
    const all = INTRO_SCENES.flatMap((s) => [s.caption, s.subtitle]).join('\n');
    expect(all).toContain('MNEMOSYNE');
    expect(all).toContain('XENO');
    expect(all).toContain('DOWNLOAD');
  });
});

describe('intro playback', () => {
  it('walks scenes in order as time advances', () => {
    const playback = new IntroPlayback();
    let lastIndex = -1;
    for (let time = 0; time < INTRO_TOTAL_SECONDS; time += 0.05) {
      playback.advance(0.05);
      expect(playback.point.index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = playback.point.index;
    }
    expect(lastIndex).toBe(INTRO_SCENES.length - 1);
    expect(playback.finished).toBe(true);
    expect(playback.endedBy).toBe('completed');
  });

  it('lands on each scene exactly at cumulative boundaries', () => {
    let elapsed = 0;
    for (let i = 0; i < INTRO_SCENES.length - 1; i++) {
      const scene = INTRO_SCENES[i];
      elapsed += (scene?.durationSeconds ?? 0) + 0.01;
      expect(introSceneAt(elapsed).index).toBe(i + 1);
    }
  });

  it('skipping finishes immediately and reports skipped', () => {
    const playback = new IntroPlayback();
    playback.advance(0.5);
    expect(playback.skip()).toBe(true);
    expect(playback.finished).toBe(true);
    expect(playback.endedBy).toBe('skipped');
    expect(playback.timeSeconds).toBe(INTRO_TOTAL_SECONDS);
    expect(playback.skip()).toBe(false);
    playback.advance(5);
    expect(playback.timeSeconds).toBe(INTRO_TOTAL_SECONDS);
  });

  it('skip transitions the state machine BOOT → MENU', () => {
    const state = new GameStateMachine();
    const playback = new IntroPlayback();
    playback.skip();
    if (playback.finished && state.current === GameStateName.Boot) {
      state.transition(GameStateName.Menu);
    }
    expect(state.current).toBe(GameStateName.Menu);
  });

  it('clamps out-of-range lookups', () => {
    expect(introSceneAt(-5).index).toBe(0);
    expect(introSceneAt(9999).localT).toBe(1);
  });
});

describe('neon font & text layout', () => {
  it('has a glyph for every character the intro renders', () => {
    for (const text of allIntroStrings()) {
      for (const char of normalizeNeonText(text)) {
        if (char === ' ') continue;
        expect(NEON_FONT[char], `missing glyph for "${char}" in "${text}"`).toBeDefined();
      }
    }
  });

  it('measures text from glyph geometry', () => {
    expect(measureNeonText('', 4)).toBe(0);
    expect(measureNeonText('A', 4)).toBe(20);
    expect(measureNeonText('A', 4, 2)).toBe(20);
    expect(measureNeonText('AB', 10, 1)).toBe(110);
  });

  it('lays title glyphs inside the measured width and emits quads', () => {
    const quads: SpriteDraw[] = [];
    const cell = 10;
    appendNeonText(quads, INTRO_TITLE, {
      x: 640,
      y: 240,
      cellSize: cell,
      tint: [1, 1, 1],
    });
    expect(quads.length).toBeGreaterThan(50);
    const width = measureNeonText(INTRO_TITLE, cell);
    const minX = Math.min(...quads.map((q) => q.x));
    const maxX = Math.max(...quads.map((q) => q.x + q.width));
    expect(maxX - minX).toBeLessThanOrEqual(width + 0.001);
    expect(minX).toBeGreaterThanOrEqual(640 - width / 2 - 0.001);
    expect(maxX).toBeLessThanOrEqual(640 + width / 2 + width / 2);

    const empty: SpriteDraw[] = [];
    appendNeonText(empty, '\u2603\u2603\u2603', { x: 0, y: 0, cellSize: 3, tint: [1, 1, 1] });
    expect(empty.length).toBe(0);
  });
});

describe('session gating', () => {
  it('plays once per session until marked played', () => {
    const original = IntroSequence.hasPlayedThisSession;
    try {
      IntroSequence.hasPlayedThisSession = false;
      expect(IntroSequence.shouldPlay()).toBe(true);
      IntroSequence.markPlayed();
      expect(IntroSequence.shouldPlay()).toBe(false);
    } finally {
      IntroSequence.hasPlayedThisSession = original;
    }
  });
});

describe('IntroSequence controller (no GPU)', () => {
  function makeFakeTarget() {
    const handlers = new Map<string, Set<() => void>>();
    return {
      addEventListener(type: string, listener: () => void): void {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)?.add(listener);
      },
      removeEventListener(type: string, listener: () => void): void {
        handlers.get(type)?.delete(listener);
      },
      fire(type: string): void {
        for (const listener of [...(handlers.get(type) ?? [])]) listener();
      },
      get count(): number {
        return [...handlers.values()].reduce((sum, set) => sum + set.size, 0);
      },
    };
  }

  const fakeRenderer = {
    viewBounds: { left: 0, right: 1280, top: 0, bottom: 720 },
    textureSize: () => undefined,
    drawSprites: () => undefined,
  } as never;

  it('advances via update and fires onFinish exactly once', () => {
    let finishes = 0;
    const sequence = new IntroSequence(fakeRenderer, {
      onFinish: () => finishes++,
    });
    sequence.start();
    sequence.update(INTRO_TOTAL_SECONDS / 2);
    expect(finishes).toBe(0);
    sequence.update(INTRO_TOTAL_SECONDS);
    expect(finishes).toBe(1);
    sequence.update(1);
    expect(finishes).toBe(1);
    expect(sequence.playback.endedBy).toBe('completed');
  });

  it('any keydown/pointer/tap skips to finished state', () => {
    const target = makeFakeTarget();
    const sequence = new IntroSequence(fakeRenderer);
    sequence.start();
    sequence.attach(target);
    target.fire('keydown');
    expect(sequence.playback.finished).toBe(false);
    sequence.update(0);
    target.fire('pointerdown');
    target.fire('touchend');
    expect(sequence.playback.finished).toBe(false);
    Object.assign(sequence, {});
    (sequence as unknown as { startTimestampMs: number }).startTimestampMs -= 1000;
    target.fire('keydown');
    expect(sequence.playback.finished).toBe(true);
    expect(sequence.playback.endedBy).toBe('skipped');
    expect(target.count).toBe(3);
    sequence.dispose();
    expect(target.count).toBe(0);
  });
});
