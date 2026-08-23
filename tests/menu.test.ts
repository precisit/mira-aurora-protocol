import { describe, expect, it } from 'vitest';
import {
  MenuModel,
  SETTINGS_VOLUME_STEP,
  archiveEntryParagraphs,
  archiveEntrySummaries,
  buildHighscoreRows,
  buildWeaponShopRows,
  formatThreshold,
  gameStateRequestFor,
  nextUnlockProgress,
  renderMenuHtml,
  sortHighscoreRows,
  type HighscoreRow,
} from '../src/ui/Menu';
import { ARCHIVE_ENTRIES } from '../src/ui/archive';
import { defaultSaveData } from '../src/save/SaveStore';
import {
  GameStateMachine,
  GameStateName,
  StateTransitionError,
} from '../src/core/GameState';

/* -------------------------------------------------------------------------- */
/* Menu model + state transitions                                              */
/* -------------------------------------------------------------------------- */

describe('MenuModel — main menu', () => {
  it('starts at the main root with the five C1 entries in order', () => {
    const model = new MenuModel('main');
    expect(model.screen).toBe('main');
    expect(model.atRoot).toBe(true);
    expect(model.items.map((item) => item.label)).toEqual([
      'PLAY',
      'WEAPONS',
      'SCORES',
      'ARCHIVE',
      'SETTINGS',
    ]);
    expect(model.selectedIndex).toBe(0);
  });

  it('PLAY activation asks the host to enter gameplay', () => {
    const model = new MenuModel('main');
    const command = model.activate();
    expect(command).toEqual({ kind: 'nav', action: 'start-game' });
    expect(gameStateRequestFor('start-game')).toBe(GameStateName.Playing);
  });

  it('wraps cursor navigation at both ends', () => {
    const model = new MenuModel('main');
    model.move(-1); // wraps up: 0 → last
    expect(model.selectedIndex).toBe(4);
    model.move(1); // wraps back down: last → 0
    expect(model.selectedIndex).toBe(0);
    model.move(1);
    model.move(1);
    expect(model.selectedIndex).toBe(2);
    expect(model.items[model.selectedIndex]?.label).toBe('SCORES');
  });

  it('selects by item id for pointer/touch input', () => {
    const model = new MenuModel('main');
    model.select('archive');
    expect(model.items[model.selectedIndex]?.action).toBe('open-archive');
    model.select('not-an-item');
    expect(model.selectedIndex).toBe(3); // unchanged by unknown ids
  });

  it('opens sub-screens onto a stack and back() pops them', () => {
    const model = new MenuModel('main');
    model.select('weapons');
    expect(model.activate()).toEqual({ kind: 'nav', action: 'open-weapons' });
    expect(model.screen).toBe('weapons');
    expect(model.atRoot).toBe(false);
    // Read-only screen: no activatable items, navigation is a no-op.
    expect(model.items).toHaveLength(0);
    model.move(1);
    expect(model.activate()).toBeNull();
    expect(model.back()).toBe(true);
    expect(model.screen).toBe('main');

    model.select('archive');
    model.activate();
    expect(model.screen).toBe('archive');
    expect(model.items.length).toBeGreaterThan(0);
    expect(model.back()).toBe(true);

    // Cursor resets when a screen pushes, so select settings from the root.
    expect(model.screen).toBe('main');
    model.select('settings');
    model.activate();
    expect(model.screen).toBe('settings');
    model.reset();
    expect(model.atRoot).toBe(true);
  });

  it('maps every gameplay nav action to its requested game state', () => {
    expect(gameStateRequestFor('resume')).toBe(GameStateName.Playing);
    expect(gameStateRequestFor('restart-level')).toBe(GameStateName.Playing);
    expect(gameStateRequestFor('quit-to-menu')).toBe(GameStateName.Menu);
    // Pure menu-layer actions never touch the state machine.
    expect(gameStateRequestFor('open-weapons')).toBeNull();
    expect(gameStateRequestFor('back')).toBeNull();
    expect(gameStateRequestFor('toggle-fps-cap')).toBeNull();
  });
});

describe('menu ⇄ game state transitions (PLAN.md graph)', () => {
  it('walks menu→playing, pause→resume/restart/quit legally', () => {
    const machine = new GameStateMachine();
    machine.transition(GameStateName.Menu); // BOOT → MENU

    // menu → playing (PLAY)
    const main = new MenuModel('main');
    const startCommand = main.activate();
    expect(startCommand).toEqual({ kind: 'nav', action: 'start-game' });
    machine.transition(gameStateRequestFor('start-game') as GameStateName);
    expect(machine.current).toBe(GameStateName.Playing);

    // playing → paused (P)
    machine.transition(GameStateName.Paused);

    // paused → playing (RESUME)
    let pause = new MenuModel('pause');
    expect(pause.screen).toBe('pause');
    expect(pause.items.map((item) => item.label)).toEqual([
      'RESUME',
      'RESTART LEVEL',
      'SETTINGS',
      'QUIT TO MENU',
    ]);
    expect(pause.activate()).toEqual({ kind: 'nav', action: 'resume' });
    machine.transition(gameStateRequestFor('resume') as GameStateName);
    expect(machine.current).toBe(GameStateName.Playing);

    // paused → playing (RESTART LEVEL)
    machine.transition(GameStateName.Paused);
    pause = new MenuModel('pause');
    pause.move(1);
    expect(pause.activate()).toEqual({ kind: 'nav', action: 'restart-level' });
    machine.transition(gameStateRequestFor('restart-level') as GameStateName);
    expect(machine.current).toBe(GameStateName.Playing);

    // paused → menu (QUIT TO MENU)
    machine.transition(GameStateName.Paused);
    pause = new MenuModel('pause');
    pause.move(1);
    pause.move(1);
    pause.move(1);
    expect(pause.activate()).toEqual({ kind: 'nav', action: 'quit-to-menu' });
    machine.transition(gameStateRequestFor('quit-to-menu') as GameStateName);
    expect(machine.current).toBe(GameStateName.Menu);
  });

  it('rejects transitions the menu can never legitimately request', () => {
    const machine = new GameStateMachine();
    machine.transition(GameStateName.Menu);
    machine.transition(GameStateName.Playing);
    machine.transition(GameStateName.Paused);
    expect(machine.can(GameStateName.Win)).toBe(false);
    expect(machine.can(GameStateName.Boot)).toBe(false);
    expect(() => machine.transition(GameStateName.Win)).toThrow(StateTransitionError);
    // The machine is unchanged after a rejected move.
    expect(machine.current).toBe(GameStateName.Paused);
  });
});

/* -------------------------------------------------------------------------- */
/* Pause menu extras                                                           */
/* -------------------------------------------------------------------------- */

describe('MenuModel — pause menu', () => {
  it('keeps sub-screen stacks inside PAUSED; Esc pops before resuming', () => {
    const model = new MenuModel('pause');
    model.select('settings');
    model.activate();
    expect(model.screen).toBe('settings');
    // Esc on a sub-screen pops back to the pause root instead of resuming.
    expect(model.back()).toBe(true);
    expect(model.screen).toBe('pause');
    // Esc at the pause root does nothing here — main.ts resumes instead.
    expect(model.back()).toBe(false);
  });

  it('adjusts volumes and toggles the FPS cap from the settings screen', () => {
    const model = new MenuModel('pause');
    model.open('settings');
    expect(model.screen).toBe('settings');

    // Cursor starts on MASTER VOLUME: activate raises it one step.
    expect(model.selectedIndex).toBe(0);
    expect(model.activate()).toEqual({
      kind: 'setting-volume',
      channel: 'volume',
      delta: SETTINGS_VOLUME_STEP,
    });
    expect(model.adjustSelected(-2 * SETTINGS_VOLUME_STEP)).toEqual({
      kind: 'setting-volume',
      channel: 'volume',
      delta: -0.2,
    });

    model.move(1);
    expect(model.adjustSelected(-1)).toEqual({
      kind: 'setting-volume',
      channel: 'musicVolume',
      delta: -1,
    });
    model.move(1);
    expect(model.adjustSelected(0)).toEqual({
      kind: 'setting-volume',
      channel: 'sfxVolume',
      delta: 0,
    });

    model.move(1); // FPS LOCK
    expect(model.activate()).toEqual({ kind: 'toggle-fps-cap' });

    model.move(1); // BACK
    expect(model.activate()).toEqual({ kind: 'nav', action: 'back' });
    expect(model.screen).toBe('pause');
  });
});

/* -------------------------------------------------------------------------- */
/* Weapon shop                                                                 */
/* -------------------------------------------------------------------------- */

describe('weapon shop display logic', () => {
  it('lists all six PLAN.md weapons in threshold order with their gates', () => {
    const rows = buildWeaponShopRows(0);
    expect(rows.map((row) => row.weaponId)).toEqual([
      'puls',
      'spridare',
      'piercer',
      'studsare',
      'fragment',
      'nova',
    ]);
    expect(rows.map((row) => row.requiredTotalScore)).toEqual([
      0, 10_000, 25_000, 50_000, 100_000, 200_000,
    ]);
    expect(rows.every((row) => row.name.length > 0 && row.blurb.length > 0)).toBe(true);
  });

  it('flags unlocked/locked strictly by total score', () => {
    const fresh = buildWeaponShopRows(0);
    expect(fresh[0]?.unlocked).toBe(true);
    expect(fresh.slice(1).every((row) => !row.unlocked)).toBe(true);

    const mid = buildWeaponShopRows(10_000);
    expect(mid.map((row) => row.unlocked)).toEqual([true, true, false, false, false, false]);

    const late = buildWeaponShopRows(199_999);
    expect(late.map((row) => row.unlocked)).toEqual([true, true, true, true, true, false]);

    const all = buildWeaponShopRows(200_000);
    expect(all.every((row) => row.unlocked)).toBe(true);
  });

  it('labels START for the free weapon and grouped numbers otherwise', () => {
    const rows = buildWeaponShopRows(0);
    expect(rows[0]?.unlockLabel).toBe('START');
    expect(rows[1]?.unlockLabel).toBe(`10${'\u2009'}000`);
    expect(rows[5]?.unlockLabel).toBe(`200${'\u2009'}000`);
    expect(formatThreshold(1234567)).toBe(`1${'\u2009'}234${'\u2009'}567`);
    expect(formatThreshold(-5)).toBe('0');
  });

  it('shows NEXT UNLOCK progress toward the next locked weapon', () => {
    const early = nextUnlockProgress(5_000);
    expect(early?.weaponId).toBe('spridare');
    expect(early?.remaining).toBe(5_000);
    expect(early?.fraction).toBeCloseTo(0.5, 5);

    // Exactly at 25k the piercer unlocks; the bar moves on to studsare.
    const atThreshold = nextUnlockProgress(25_001);
    expect(atThreshold?.weaponId).toBe('studsare');
    expect(atThreshold?.remaining).toBe(24_999);
    expect(atThreshold?.fraction).toBeCloseTo(25_001 / 50_000, 5);

    expect(nextUnlockProgress(999_999_999)).toBeNull(); // everything open
  });
});

/* -------------------------------------------------------------------------- */
/* Highscore table                                                             */
/* -------------------------------------------------------------------------- */

function row(overrides: Partial<HighscoreRow>): HighscoreRow {
  return {
    index: 1,
    title: 'The Fall of Mnemosyne',
    levelId: 'lvl-01-mnemosynes-fall',
    bestScore: null,
    bestTimeMs: null,
    ...overrides,
  };
}

describe('highscore table', () => {
  it('builds one row per campaign slot with real save keys for built levels', () => {
    const rows = buildHighscoreRows({});
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Built levels use their real data id; unbuilt slots keep the stable key.
    expect(rows[0]?.levelId).toBe('lvl-01-mnemosynes-fall');
    expect(rows[4]?.levelId).toBe('lvl-05-vessels-valv');
    expect(rows[3]?.levelId).toBe('lvl-04');
    expect(rows[5]?.levelId).toBe('lvl-06');
    expect(rows.every((r) => r.bestScore === null && r.bestTimeMs === null)).toBe(true);
  });

  it('reads per-level best score AND best time from SaveStore data', () => {
    const save = defaultSaveData();
    save.highscores['lvl-01-mnemosynes-fall'] = { score: 1200, timeMs: 74_320 };
    save.highscores['lvl-02-datastormen'] = { score: 900, timeMs: 51_010 };
    const rows = buildHighscoreRows(save.highscores);
    expect(rows[0]).toMatchObject({ bestScore: 1200, bestTimeMs: 74_320 });
    expect(rows[1]).toMatchObject({ bestScore: 900, bestTimeMs: 51_010 });
    expect(rows[2]?.bestScore).toBeNull();
  });

  it('sorts by best score descending, nulls sinking to the bottom', () => {
    const rows = [
      row({ index: 2, title: 'B', bestScore: 500 }),
      row({ index: 1, bestScore: 900 }),
      row({ index: 3, title: 'C', bestScore: null }),
      row({ index: 4, title: 'D', bestScore: 900 }),
    ];
    expect(sortHighscoreRows(rows, 'score').map((r) => r.index)).toEqual([1, 4, 2, 3]);
  });

  it('sorts by best time ascending, missing times last, ties in level order', () => {
    const rows = [
      row({ index: 3, title: 'C', bestTimeMs: 40_000 }),
      row({ index: 1, bestTimeMs: 61_000 }),
      row({ index: 2, title: 'B', bestTimeMs: null }),
      row({ index: 4, title: 'D', bestTimeMs: 40_000 }),
    ];
    expect(sortHighscoreRows(rows, 'time').map((r) => r.index)).toEqual([3, 4, 1, 2]);
  });

  it('defaults to campaign order regardless of input order', () => {
    const rows = [row({ index: 3 }), row({ index: 1 }), row({ index: 2 })];
    expect(sortHighscoreRows(rows).map((r) => r.index)).toEqual([1, 2, 3]);
    expect(sortHighscoreRows(rows, 'level').map((r) => r.index)).toEqual([1, 2, 3]);
  });
});

/* -------------------------------------------------------------------------- */
/* The Archive                                                                 */
/* -------------------------------------------------------------------------- */

describe('the Archive screen data', () => {
  it('exposes all seven backstory entries, uniquely identified', () => {
    expect(ARCHIVE_ENTRIES).toHaveLength(7);
    const summaries = archiveEntrySummaries();
    expect(summaries).toHaveLength(7);
    const ids = summaries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('gives every entry readable title, subtitle, summary and prose', () => {
    for (const summary of archiveEntrySummaries()) {
      expect(summary.title.trim().length).toBeGreaterThan(0);
      expect(summary.subtitle.trim().length).toBeGreaterThan(0);
      expect(summary.summary.trim().length).toBeGreaterThan(0);
    }
    for (const entry of ARCHIVE_ENTRIES) {
      expect(entry.paragraphs.length).toBeGreaterThanOrEqual(2);
      for (const paragraph of entry.paragraphs) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves full entries by id and rejects unknown ids', () => {
    const aurora = ARCHIVE_ENTRIES.find((e) => e.id === 'aurora');
    expect(aurora).toBeDefined();
    expect(archiveEntryParagraphs('aurora')).toEqual(aurora?.paragraphs);
    expect(archiveEntryParagraphs('mnemosyne')?.length).toBeGreaterThan(0);
    expect(archiveEntryParagraphs('does-not-exist')).toBeUndefined();
  });

  it('opens entries through the menu model and closes them again', () => {
    const model = new MenuModel('main');
    model.select('archive');
    model.activate();
    expect(model.items.map((item) => item.entryId)).toEqual(
      ARCHIVE_ENTRIES.map((entry) => entry.id),
    );

    model.select('archive-xeno');
    expect(model.activate()).toEqual({ kind: 'nav', action: 'open-archive-entry' });
    expect(model.screen).toBe('archive-entry');
    expect(model.selectedArchiveEntry?.title).toBe('XENO');

    expect(model.back()).toBe(true); // entry → list
    expect(model.screen).toBe('archive');
    expect(model.selectedArchiveEntryId).toBeNull();
    expect(model.back()).toBe(true); // list → main
    expect(model.back()).toBe(false); // already at root: skippable, not stuck
  });
});

/* -------------------------------------------------------------------------- */
/* Markup rendering                                                            */
/* -------------------------------------------------------------------------- */

describe('renderMenuHtml', () => {
  it('renders the main list with selection markers and hints of the story', () => {
    const html = renderMenuHtml(new MenuModel('main'), defaultSaveData());
    expect(html).toContain('AURORA PROTOCOL');
    expect(html).toContain('data-menu-id="play"');
    expect(html).toContain('PLAY'); // selected row carries a ▸ marker
    expect(html).toContain('>WEAPONS<'); // unselected rows render bare labels
    expect(html).toContain('selected');
  });

  it('renders the weapon shop with locks, blurbs and the next-unlock bar', () => {
    const save = defaultSaveData();
    save.totalScore = 30_000;
    const model = new MenuModel('main');
    model.open('weapons');
    const html = renderMenuHtml(model, save);
    expect(html).toContain('TOTAL SCORE');
    expect(html).toContain('NEXT UNLOCK');
    expect(html).toContain('unlock-bar');
    expect(html).toContain('PULS');
    expect(html).toContain('UNLOCKED');
    expect(html).toContain('LOCKED'); // nova still gated at 200k
  });

  it('renders the highscore table with score AND time columns plus totals', () => {
    const save = defaultSaveData();
    save.totalScore = 42_000;
    save.highscores['lvl-01-mnemosynes-fall'] = { score: 1200, timeMs: 74_320 };
    const model = new MenuModel('main');
    model.open('scores');
    const html = renderMenuHtml(model, save);
    expect(html).toContain('BEST SCORE');
    expect(html).toContain('BEST TIME');
    expect(html).toContain('01:14.32'); // 74 320 ms formatted
    expect(html).toContain('42\u2009000');
  });

  it('renders an Archive entry as skippable readable prose', () => {
    const model = new MenuModel('main');
    model.open('archive-entry', 'xeno');
    const html = renderMenuHtml(model, defaultSaveData());
    expect(html).toContain('XENO');
    expect(html).toContain('<p>');
    expect(html).toContain('CLOSE'); // explicit skip affordance
  });

  it('renders settings with live values from the save blob', () => {
    const save = defaultSaveData();
    const model = new MenuModel('main');
    model.open('settings');
    const html = renderMenuHtml(model, save);
    expect(html).toContain('MASTER VOLUME');
    expect(html).toContain('80%'); // default volume 0.8
    expect(html).toContain('OFF'); // fps cap unset by default
  });
});
