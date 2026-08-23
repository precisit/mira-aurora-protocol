import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_ENTRIES,
  ARCHIVE_EPIGRAPH,
  ARCHIVE_TITLE,
  getArchiveEntry,
} from '../src/ui/archive';
import {
  ECHO_LINES,
  FRAGMENTS,
  LEVEL_COUNT,
  LEVEL_INTROS,
  echoLinesForLevel,
  getFragment,
  getLevelIntro,
} from '../src/ui/story';

describe('level intros', () => {
  it('has exactly one intro per level, covering 1..7', () => {
    expect(LEVEL_INTROS).toHaveLength(LEVEL_COUNT);
    expect([...LEVEL_INTROS].map((intro) => intro.level).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('gives every level a title, theme and poetic intro text', () => {
    for (const intro of LEVEL_INTROS) {
      expect(intro.title.trim().length).toBeGreaterThan(0);
      expect(intro.theme.trim().length).toBeGreaterThan(0);
      // Poetic, not just a label: at least a sentence per paragraph slot.
      expect(intro.text.length).toBeGreaterThan(80);
      expect(intro.text.split('\n').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('marks the tutorial (1) and the finale (7) mechanics per PLAN.md', () => {
    expect(getLevelIntro(1)?.newMechanic).toContain('Tutorial');
    expect(getLevelIntro(2)?.newMechanic).toContain('double jump');
    expect(getLevelIntro(5)?.newMechanic).toContain('VESSEL');
    expect(getLevelIntro(6)?.theme.toLowerCase()).toContain('mirror');
    expect(getLevelIntro(7)?.newMechanic).toContain('NULL');
  });

  it('returns undefined for unknown levels', () => {
    expect(getLevelIntro(0)).toBeUndefined();
    expect(getLevelIntro(8)).toBeUndefined();
  });
});

describe('ECHO dialogue lines', () => {
  it('has at least one line for every level 1..7', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const lines = echoLinesForLevel(level);
      expect(lines.length, `no ECHO lines for level ${level}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('never assigns lines outside levels 1..7', () => {
    for (const line of ECHO_LINES) {
      expect(line.level).toBeGreaterThanOrEqual(1);
      expect(line.level).toBeLessThanOrEqual(LEVEL_COUNT);
    }
  });

  it('uses only known line kinds with non-empty text', () => {
    const kinds = new Set(['tip', 'story', 'encouragement']);
    for (const line of ECHO_LINES) {
      expect(kinds.has(line.kind)).toBe(true);
      expect(line.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('mixes tips, story beats and encouragement across the campaign', () => {
    for (const kind of ['tip', 'story', 'encouragement'] as const) {
      expect(ECHO_LINES.some((line) => line.kind === kind)).toBe(true);
    }
  });
});

describe('fragment definitions', () => {
  it('defines all seven fragments with unique ids', () => {
    expect(FRAGMENTS).toHaveLength(7);
    expect(new Set(FRAGMENTS.map((f) => f.id)).size).toBe(7);
  });

  it('carries the point values from PLAN.md §4', () => {
    const values = Object.fromEntries(FRAGMENTS.map((f) => [f.id, f.value]));
    expect(values).toEqual({
      music: 10,
      science: 25,
      language: 40,
      art: 50,
      history: 60,
      medicine: 75,
      philosophy: 100,
    });
  });

  it('gives every fragment a name and flavor text', () => {
    for (const fragment of FRAGMENTS) {
      expect(fragment.name.trim().length).toBeGreaterThan(0);
      expect(fragment.flavor.trim().length).toBeGreaterThan(20);
    }
  });

  it('looks up fragments by id', () => {
    expect(getFragment('music')?.name).toBe('Music');
    expect(getFragment('philosophy')?.value).toBe(100);
    expect(getFragment('cuisine')).toBeUndefined();
  });
});

describe('the Archive', () => {
  it('is titled and carries the tagline epigraph', () => {
    expect(ARCHIVE_TITLE).toBe('The Archive');
    expect(ARCHIVE_EPIGRAPH.length).toBeGreaterThan(0);
  });

  it('contains the main entries', () => {
    const ids = new Set(ARCHIVE_ENTRIES.map((entry) => entry.id));
    for (const id of ['mnemosyne', 'aurora', 'echo', 'vessel', 'xeno', 'null', 'fragments']) {
      expect(ids.has(id), `missing archive entry: ${id}`).toBe(true);
    }
  });

  it('gives every entry a subtitle, summary and full text', () => {
    for (const entry of ARCHIVE_ENTRIES) {
      expect(entry.subtitle.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.summary.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.paragraphs.length, entry.id).toBeGreaterThanOrEqual(3);
      for (const paragraph of entry.paragraphs) {
        expect(paragraph.trim().length, entry.id).toBeGreaterThan(0);
      }
    }
  });

  it('names AURORA\u2019s origin: star Mira, chosen by Dr. Elara Voss', () => {
    const aurora = getArchiveEntry('aurora');
    expect(aurora?.paragraphs.join(' ')).toContain('Mira');
    expect(aurora?.paragraphs.join(' ')).toContain('Elara Voss');
  });

  it('looks up entries by id', () => {
    expect(getArchiveEntry('echo')?.title).toBe('ECHO');
    expect(getArchiveEntry('groceries')).toBeUndefined();
  });
});
