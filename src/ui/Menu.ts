/**
 * C1 meta layer (PLAN.md Fas 4 / §8 wave C1): main menu, weapon shop,
 * highscore table (poäng + tid), the Archive reader, settings and the pause
 * menu.
 *
 * Split in two halves so everything that matters is node-testable:
 *
 *   - Pure: {@link MenuModel} (screen stack + selection + commands),
 *     {@link buildWeaponShopRows} / {@link nextUnlockProgress} (unlock shop),
 *     {@link buildHighscoreRows} / {@link sortHighscoreRows} (scores),
 *     {@link archiveEntrySummaries} (the Archive), {@link gameStateRequestFor}
 *     (menu action → requested GameStateName) and {@link renderMenuHtml}
 *     (neon markup). No DOM access at module scope — importing this file in
 *     Vitest's node environment is safe.
 *
 *   - DOM: {@link DomMenu} mounts the markup, routes pointer clicks/hovers to
 *     the model and emits {@link MenuCommand}s for main.ts to execute
 *     (state transitions, settings persistence). Keyboard navigation arrives
 *     via InputManager's MenuUp/MenuDown/MenuBack actions, driven from the
 *     game loop.
 *
 * The menu lives *inside* GameStateName.Menu / .Paused — sub-screens are the
 * model's own screen stack, so the global state machine graph is untouched.
 */

import { ARCHIVE_EPIGRAPH, ARCHIVE_ENTRIES, getArchiveEntry } from './archive';
import type { StoryEntry } from './story';
import { LEVEL_INTROS } from './story';
import { LEVEL_COUNT, PLAYABLE_LEVELS } from '../levels/levels';
import {
  WEAPON_UNLOCK_THRESHOLDS,
  nextWeaponUnlock,
  unlockedWeaponsFor,
} from '../save/unlocks';
import { WEAPONS, type WeaponId } from '../game/weapons';
import type { SaveData, HighscoreEntry } from '../save/SaveStore';
import { GameStateName } from '../core/GameState';
import { formatTimeMs } from '../core/Timer';

/* -------------------------------------------------------------------------- */
/* Weapon shop (PLAN.md §4 "Vapen" unlock table)                               */
/* -------------------------------------------------------------------------- */

export interface WeaponShopRow {
  weaponId: string;
  /** Display name, e.g. "PULS". */
  name: string;
  blurb: string;
  requiredTotalScore: number;
  /** Human threshold label: "START" or grouped number ("10 000"). */
  unlockLabel: string;
  unlocked: boolean;
}

/** Groups digits by thousands, e.g. 200000 → "200 000". */
export function formatThreshold(total: number): string {
  const rounded = Math.max(0, Math.round(total));
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

function weaponName(weaponId: string): string {
  return WEAPONS[weaponId as WeaponId]?.name ?? weaponId.toUpperCase();
}

function weaponBlurb(weaponId: string): string {
  return WEAPONS[weaponId as WeaponId]?.blurb ?? '';
}

/** One row per weapon, in threshold order, flagged unlocked at `totalScore`. */
export function buildWeaponShopRows(totalScore: number): WeaponShopRow[] {
  const unlocked = new Set(unlockedWeaponsFor(totalScore));
  return WEAPON_UNLOCK_THRESHOLDS.map((threshold) => ({
    weaponId: threshold.weaponId,
    name: weaponName(threshold.weaponId),
    blurb: weaponBlurb(threshold.weaponId),
    requiredTotalScore: threshold.requiredTotalScore,
    unlockLabel:
      threshold.requiredTotalScore === 0 ? 'START' : formatThreshold(threshold.requiredTotalScore),
    unlocked: unlocked.has(threshold.weaponId),
  }));
}

export interface NextUnlockProgress {
  weaponId: string;
  name: string;
  requiredTotalScore: number;
  /** Points still missing (0 when the threshold is exactly met elsewhere). */
  remaining: number;
  /** 0..1 progress toward the threshold. */
  fraction: number;
}

/** Progress toward the next locked weapon, or null once everything is open. */
export function nextUnlockProgress(totalScore: number): NextUnlockProgress | null {
  const next = nextWeaponUnlock(totalScore);
  if (!next) return null;
  const base = next.requiredTotalScore;
  const fraction = base > 0 ? Math.min(1, Math.max(0, totalScore / base)) : 1;
  return {
    weaponId: next.weaponId,
    name: weaponName(next.weaponId),
    requiredTotalScore: base,
    remaining: Math.max(0, base - totalScore),
    fraction,
  };
}

/* -------------------------------------------------------------------------- */
/* Highscore table (PLAN.md §4 "Poäng & highscore" — poäng OCH tid per bana)   */
/* -------------------------------------------------------------------------- */

export interface HighscoreRow {
  /** Campaign slot, 1-based (1..LEVEL_COUNT). */
  index: number;
  title: string;
  /** Save key: real level id when built, stable synthetic fallback otherwise. */
  levelId: string;
  bestScore: number | null;
  bestTimeMs: number | null;
}

function campaignTitle(index: number): string {
  return LEVEL_INTROS.find((intro) => intro.level === index)?.title ?? `Level ${index}`;
}

/** All seven campaign slots with best score AND best time from the save. */
export function buildHighscoreRows(
  highscores: Readonly<Record<string, HighscoreEntry>>,
): HighscoreRow[] {
  const rows: HighscoreRow[] = [];
  for (let index = 1; index <= LEVEL_COUNT; index++) {
    const built = PLAYABLE_LEVELS.find((l) => l.index === index);
    const levelId = built?.id ?? `lvl-${String(index).padStart(2, '0')}`;
    const best = highscores[levelId];
    rows.push({
      index,
      title: campaignTitle(index),
      levelId,
      bestScore: best?.score ?? null,
      bestTimeMs: best?.timeMs ?? null,
    });
  }
  return rows;
}

export type HighscoreSortKey = 'level' | 'score' | 'time';

/**
 * Sorting for the scores screen: campaign order (default), best score
 * descending, or best time ascending. Rows without a result always sink to
 * the bottom; ties fall back to campaign order.
 */
export function sortHighscoreRows(
  rows: readonly HighscoreRow[],
  key: HighscoreSortKey = 'level',
): HighscoreRow[] {
  const copy = [...rows];
  const byLevel = (a: HighscoreRow, b: HighscoreRow): number => a.index - b.index;
  switch (key) {
    case 'score':
      copy.sort((a, b) => {
        const av = a.bestScore ?? -1;
        const bv = b.bestScore ?? -1;
        return bv - av || byLevel(a, b);
      });
      break;
    case 'time':
      copy.sort((a, b) => {
        // Missing times count as infinitely slow; 0/negative treated likewise.
        const av = a.bestTimeMs !== null && a.bestTimeMs > 0 ? a.bestTimeMs : Number.MAX_SAFE_INTEGER;
        const bv = b.bestTimeMs !== null && b.bestTimeMs > 0 ? b.bestTimeMs : Number.MAX_SAFE_INTEGER;
        return av - bv || byLevel(a, b);
      });
      break;
    default:
      copy.sort(byLevel);
      break;
  }
  return copy;
}

/* -------------------------------------------------------------------------- */
/* The Archive (skippable backstory reader, PLAN.md §3)                        */
/* -------------------------------------------------------------------------- */

export interface ArchiveIndexRow {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
}

/** List view model for the Archive index — all entries, in reading order. */
export function archiveEntrySummaries(): readonly ArchiveIndexRow[] {
  return ARCHIVE_ENTRIES.map((entry) => ({
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    summary: entry.summary,
  }));
}

/** Full paragraphs for one Archive entry, or undefined for unknown ids. */
export function archiveEntryParagraphs(id: string): readonly string[] | undefined {
  return getArchiveEntry(id)?.paragraphs;
}

/* -------------------------------------------------------------------------- */
/* Pure navigation model                                                       */
/* -------------------------------------------------------------------------- */

export type MenuScreenId =
  | 'main'
  | 'pause'
  | 'weapons'
  | 'scores'
  | 'archive'
  | 'archive-entry'
  | 'settings';

export type MenuActionId =
  | 'start-game'
  | 'resume'
  | 'restart-level'
  | 'quit-to-menu'
  | 'open-weapons'
  | 'open-scores'
  | 'open-archive'
  | 'open-archive-entry'
  | 'open-settings'
  | 'back'
  | 'adjust-volume-master'
  | 'adjust-volume-music'
  | 'adjust-volume-sfx'
  | 'toggle-fps-cap';

export interface MenuItem {
  id: string;
  label: string;
  action: MenuActionId;
  /** Entry id for archive-list items. */
  entryId?: string;
  hint?: string;
}

/** A command the menu asks the host (main.ts) to execute. */
export type MenuCommand =
  | { kind: 'nav'; action: MenuActionId }
  | { kind: 'setting-volume'; channel: 'volume' | 'musicVolume' | 'sfxVolume'; delta: number }
  | { kind: 'toggle-fps-cap' };

/** Which GameStateName a nav action requests; null = stay in the menu layer. */
export function gameStateRequestFor(action: MenuActionId): GameStateName | null {
  switch (action) {
    case 'start-game':
    case 'resume':
    case 'restart-level':
      return GameStateName.Playing;
    case 'quit-to-menu':
      return GameStateName.Menu;
    default:
      return null;
  }
}

export type MenuMode = 'main' | 'pause';

const MAIN_ROOT_ITEMS: readonly MenuItem[] = [
  { id: 'play', label: 'PLAY', action: 'start-game', hint: 'START THE RUN — LEVEL 1' },
  { id: 'weapons', label: 'WEAPONS', action: 'open-weapons', hint: 'UNLOCK SHOP' },
  { id: 'scores', label: 'SCORES', action: 'open-scores', hint: 'BEST SCORE & TIME' },
  { id: 'archive', label: 'ARCHIVE', action: 'open-archive', hint: 'THE BACKSTORY' },
  { id: 'settings', label: 'SETTINGS', action: 'open-settings', hint: 'VOLUME · FPS LOCK' },
];

const PAUSE_ROOT_ITEMS: readonly MenuItem[] = [
  { id: 'resume', label: 'RESUME', action: 'resume', hint: 'BACK TO THE RUN' },
  { id: 'restart', label: 'RESTART LEVEL', action: 'restart-level', hint: 'FRESH ATTEMPT' },
  { id: 'settings', label: 'SETTINGS', action: 'open-settings', hint: 'VOLUME · FPS LOCK' },
  { id: 'quit', label: 'QUIT TO MENU', action: 'quit-to-menu', hint: 'ABANDON THIS RUN' },
];

const SETTINGS_ITEMS: readonly MenuItem[] = [
  { id: 'volume-master', label: 'MASTER VOLUME', action: 'adjust-volume-master' },
  { id: 'volume-music', label: 'MUSIC VOLUME', action: 'adjust-volume-music' },
  { id: 'volume-sfx', label: 'SFX VOLUME', action: 'adjust-volume-sfx' },
  { id: 'fps-cap', label: 'FPS LOCK', action: 'toggle-fps-cap' },
  { id: 'settings-back', label: 'BACK', action: 'back' },
];

export const SETTINGS_VOLUME_STEP = 0.1;

/**
 * Screen stack + cursor for the menu layer. Root screen depends on the mode:
 * `main` (title screen) or `pause` (in-run overlay). Sub-screens push onto a
 * stack; `back()` pops. Pure — no DOM, fully node-testable.
 */
export class MenuModel {
  private readonly stack: MenuScreenId[];
  private cursor = 0;
  private entryId: string | null = null;

  public constructor(public readonly mode: MenuMode) {
    this.stack = [mode === 'pause' ? 'pause' : 'main'];
  }

  public get screen(): MenuScreenId {
    return this.stack[this.stack.length - 1] ?? (this.mode === 'pause' ? 'pause' : 'main');
  }

  /** True while sitting on the mode's root screen (main list / pause list). */
  public get atRoot(): boolean {
    return this.stack.length === 1;
  }

  public get selectedArchiveEntryId(): string | null {
    return this.entryId;
  }

  public get selectedArchiveEntry(): StoryEntry | undefined {
    return this.entryId ? getArchiveEntry(this.entryId) : undefined;
  }

  /** Activatable items for the current screen (empty on read-only screens). */
  public get items(): readonly MenuItem[] {
    switch (this.screen) {
      case 'main':
        return MAIN_ROOT_ITEMS;
      case 'pause':
        return PAUSE_ROOT_ITEMS;
      case 'settings':
        return SETTINGS_ITEMS;
      case 'archive':
        return archiveEntrySummaries().map(
          (row): MenuItem => ({
            id: `archive-${row.id}`,
            label: row.title,
            action: 'open-archive-entry',
            entryId: row.id,
            hint: row.summary,
          }),
        );
      default:
        return [];
    }
  }

  public get selectedIndex(): number {
    return this.cursor;
  }

  /** Moves the cursor with wrap-around; no-op on read-only screens. */
  public move(delta: number): void {
    const count = this.items.length;
    if (count === 0) return;
    const step = delta < 0 ? -1 : delta > 0 ? 1 : 0;
    if (step === 0) return;
    this.cursor = (((this.cursor + step) % count) + count) % count;
  }

  /** Selects by item id (pointer hover/click); ignores unknown ids. */
  public select(itemId: string): void {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index >= 0) this.cursor = index;
  }

  /**
   * Activates the selected item: pushes sub-screens internally and returns
   * the resulting command for the host to execute (null = pure navigation
   * with nothing to do, e.g. an empty screen).
   */
  public activate(): MenuCommand | null {
    const item = this.items[this.cursor];
    if (!item) return null;
    switch (item.action) {
      case 'open-weapons':
      case 'open-scores':
      case 'open-archive':
      case 'open-settings':
        this.push(item.action === 'open-archive' ? 'archive' : item.action.slice(5) as MenuScreenId);
        return { kind: 'nav', action: item.action };
      case 'open-archive-entry':
        if (!item.entryId) return null;
        this.entryId = item.entryId;
        this.push('archive-entry');
        return { kind: 'nav', action: 'open-archive-entry' };
      case 'adjust-volume-master':
        return { kind: 'setting-volume', channel: 'volume', delta: SETTINGS_VOLUME_STEP };
      case 'adjust-volume-music':
        return { kind: 'setting-volume', channel: 'musicVolume', delta: SETTINGS_VOLUME_STEP };
      case 'adjust-volume-sfx':
        return { kind: 'setting-volume', channel: 'sfxVolume', delta: SETTINGS_VOLUME_STEP };
      case 'toggle-fps-cap':
        return { kind: 'toggle-fps-cap' };
      case 'back':
        this.back();
        return { kind: 'nav', action: 'back' };
      default:
        // start-game / resume / restart-level / quit-to-menu go to the host.
        return { kind: 'nav', action: item.action };
    }
  }

  /** Left/right nudges the selected setting (volume rows only). */
  public adjustSelected(delta: number): MenuCommand | null {
    const item = this.items[this.cursor];
    if (!item) return null;
    const channel =
      item.action === 'adjust-volume-master'
        ? 'volume'
        : item.action === 'adjust-volume-music'
          ? 'musicVolume'
          : item.action === 'adjust-volume-sfx'
            ? 'sfxVolume'
            : null;
    return channel ? { kind: 'setting-volume', channel, delta } : null;
  }

  /**
   * Pops one screen. Returns true when the stack actually popped; false
   * means we were already at the root (host decides what Esc means there).
   */
  public back(): boolean {
    if (this.atRoot) return false;
    this.stack.pop();
    if (this.screen === 'archive') this.entryId = null;
    this.cursor = 0;
    return true;
  }

  /** Direct navigation helper (touch buttons, programmatic opens). */
  public open(screen: MenuScreenId, entryId?: string): void {
    if (entryId !== undefined) this.entryId = entryId;
    if (screen === this.screen) return;
    this.push(screen);
  }

  /** Clears any open sub-screens (used when switching modes/states). */
  public reset(): void {
    while (!this.atRoot) this.stack.pop();
    this.entryId = null;
    this.cursor = 0;
  }

  private push(screen: MenuScreenId): void {
    this.stack.push(screen);
    this.cursor = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Markup renderer (pure string builder — node-testable)                       */
/* -------------------------------------------------------------------------- */

export interface MenuRenderOptions {
  /** Extra footer line (e.g. control hints). */
  hints?: readonly string[];
}

const SELECTED_MARKER = '\u25B8'; // ▸

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function screenTitle(model: MenuModel): { title: string; subtitle: string } {
  switch (model.screen) {
    case 'main':
      return { title: 'AURORA PROTOCOL', subtitle: ARCHIVE_EPIGRAPH.toUpperCase() };
    case 'pause':
      return { title: 'PAUSED', subtitle: 'THE ARCHIVE WAITS WITH YOU' };
    case 'weapons':
      return { title: 'WEAPON LAB', subtitle: 'UNLOCKS SCALE WITH LIFETIME TOTAL SCORE' };
    case 'scores':
      return { title: 'HIGHSCORES', subtitle: 'BEST SCORE AND BEST TIME PER LEVEL' };
    case 'archive':
      return { title: 'THE ARCHIVE', subtitle: 'OPTIONAL READING \u00B7 SKIP ANYTIME' };
    case 'archive-entry': {
      const entry = model.selectedArchiveEntry;
      return { title: entry?.title ?? 'THE ARCHIVE', subtitle: entry?.subtitle ?? '' };
    }
    case 'settings':
      return { title: 'SETTINGS', subtitle: 'SAVED INSTANTLY TO THIS DEVICE' };
  }
}

function backButton(label = 'BACK'): string {
  return (
    `<button class="menu-btn" type="button" data-menu-action="back"` +
    ` aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`
  );
}

function hintsFooter(hints: readonly string[] | undefined): string {
  if (!hints || hints.length === 0) return '';
  return `<div class="menu-hints">${hints.map(escapeHtml).join(' \u00B7 ')}</div>`;
}

function listItem(item: MenuItem, selected: boolean, extraAttrs = ''): string {
  const classes = `menu-item${selected ? ' selected' : ''}`;
  return (
    `<li><button type="button" class="${classes}" data-menu-id="${escapeHtml(item.id)}"${extraAttrs}>` +
    `<span class="menu-item-label">${selected ? `${SELECTED_MARKER} ` : ''}${escapeHtml(item.label)}</span>` +
    (item.hint ? `<span class="menu-item-hint">${escapeHtml(item.hint)}</span>` : '') +
    `</button></li>`
  );
}

function weaponsHtml(save: SaveData): string {
  const rows = buildWeaponShopRows(save.totalScore);
  const next = nextUnlockProgress(save.totalScore);
  const nextHtml = next
    ? `<p class="unlock-next">NEXT UNLOCK — ${escapeHtml(next.name)} ` +
      `${formatThreshold(next.remaining)} TO GO</p>` +
      `<div class="unlock-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"` +
      ` aria-valuenow="${Math.round(next.fraction * 100)}">` +
      `<span style="width:${(next.fraction * 100).toFixed(1)}%"></span></div>`
    : '<p class="unlock-next">ALL SIX WEAPONS UNLOCKED — THE LAB IS YOURS</p>';
  const list = rows
    .map(
      (row) =>
        `<li class="shop-row${row.unlocked ? ' unlocked' : ' locked'}">` +
        `<span class="shop-name">${escapeHtml(row.name)}</span>` +
        `<span class="shop-blurb">${escapeHtml(row.blurb)}</span>` +
        `<span class="shop-state">${
          row.unlocked ? 'UNLOCKED' : `LOCKED \u00B7 ${escapeHtml(row.unlockLabel)}`
        }</span></li>`,
    )
    .join('');
  return (
    `<p class="menu-total">TOTAL SCORE <strong>${formatThreshold(save.totalScore)}</strong></p>` +
    nextHtml +
    `<ul class="shop-list">${list}</ul>` +
    backButton()
  );
}

function scoresHtml(save: SaveData): string {
  const rows = sortHighscoreRows(buildHighscoreRows(save.highscores), 'level');
  const body = rows
    .map((row) => {
      const score = row.bestScore === null ? '\u2014' : formatThreshold(row.bestScore);
      const time = row.bestTimeMs === null ? '\u2014' : formatTimeMs(row.bestTimeMs);
      return (
        `<tr><td>${row.index}</td><td>${escapeHtml(row.title)}</td>` +
        `<td>${score}</td><td>${time}</td></tr>`
      );
    })
    .join('');
  const bestRun =
    save.bestRunTimeMs !== null
      ? `BEST FULL RUN ${formatTimeMs(save.bestRunTimeMs)}`
      : 'NO COMPLETE RUN YET';
  return (
    `<p class="menu-total">TOTAL SCORE <strong>${formatThreshold(save.totalScore)}</strong>` +
    ` \u00B7 ${bestRun}</p>` +
    '<table class="menu-table"><thead><tr>' +
    '<th>#</th><th>LEVEL</th><th>BEST SCORE</th><th>BEST TIME</th>' +
    `</tr></thead><tbody>${body}</tbody></table>` +
    backButton()
  );
}

function archiveListHtml(model: MenuModel): string {
  const items = model.items;
  const list = items.map((item, i) => listItem(item, i === model.selectedIndex)).join('');
  return (
    `<p class="archive-epigraph">\u201C${escapeHtml(ARCHIVE_EPIGRAPH)}\u201D</p>` +
    `<ul class="menu-list archive-list">${list}</ul>` +
    backButton('CLOSE')
  );
}

function archiveEntryHtml(model: MenuModel): string {
  const entry = model.selectedArchiveEntry;
  if (!entry) return '<p class="archive-prose">Entry missing.</p>' + backButton();
  const paragraphs = entry.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return `<div class="archive-prose">${paragraphs}</div>` + backButton('CLOSE');
}

function settingsHtml(model: MenuModel, save: SaveData): string {
  const percent = (value: number): string => `${Math.round(value * 100)}%`;
  const valueFor = (item: MenuItem): string => {
    switch (item.action) {
      case 'adjust-volume-master':
        return percent(save.settings.volume);
      case 'adjust-volume-music':
        return percent(save.settings.musicVolume);
      case 'adjust-volume-sfx':
        return percent(save.settings.sfxVolume);
      case 'toggle-fps-cap':
        return save.settings.fpsCap === null ? 'OFF' : `${save.settings.fpsCap} FPS`;
      default:
        return '';
    }
  };
  const rows = model.items
    .map((item, i) => {
      const selected = i === model.selectedIndex;
      const classes = `menu-item setting-row${selected ? ' selected' : ''}`;
      const adjustable =
        item.action.startsWith('adjust-volume') || item.action === 'toggle-fps-cap';
      const controls = adjustable
        ? `<span class="setting-controls">` +
          (item.action.startsWith('adjust-volume')
            ? `<button type="button" class="menu-btn tiny" data-menu-action="vol-down:${volumeChannelOf(item.action)}" aria-label="decrease">\u2212</button>` +
              `<button type="button" class="menu-btn tiny" data-menu-action="vol-up:${volumeChannelOf(item.action)}" aria-label="increase">+</button>`
            : `<button type="button" class="menu-btn tiny" data-menu-action="fps" aria-label="toggle fps lock">TOGGLE</button>`) +
          `</span>`
        : '';
      return (
        `<li><button type="button" class="${classes}" data-menu-id="${escapeHtml(item.id)}">` +
        `<span class="menu-item-label">${selected ? `${SELECTED_MARKER} ` : ''}${escapeHtml(item.label)}</span>` +
        `<span class="setting-value">${escapeHtml(valueFor(item))}</span>${controls}` +
        `</button></li>`
      );
    })
    .join('');
  return `<ul class="menu-list settings-list">${rows}</ul>`;
}

function volumeChannelOf(action: MenuActionId): string {
  switch (action) {
    case 'adjust-volume-music':
      return 'musicVolume';
    case 'adjust-volume-sfx':
      return 'sfxVolume';
    default:
      return 'volume';
  }
}

/**
 * Renders the current menu screen as neon markup. Pure — takes the model and
 * the save snapshot, returns HTML. DomMenu diffs the string to avoid layout
 * churn.
 */
export function renderMenuHtml(model: MenuModel, save: SaveData): string {
  const { title, subtitle } = screenTitle(model);
  let body: string;
  switch (model.screen) {
    case 'weapons':
      body = weaponsHtml(save);
      break;
    case 'scores':
      body = scoresHtml(save);
      break;
    case 'archive':
      body = archiveListHtml(model);
      break;
    case 'archive-entry':
      body = archiveEntryHtml(model);
      break;
    case 'settings':
      body = settingsHtml(model, save);
      break;
    default: {
      const items = model.items;
      const list = items.map((item, i) => listItem(item, i === model.selectedIndex)).join('');
      body = `<ul class="menu-list root-list">${list}</ul>`;
      break;
    }
  }
  return (
    `<div class="menu-panel menu-${model.screen}" role="dialog" aria-label="${escapeHtml(title)}">` +
    `<h2 class="menu-title">${escapeHtml(title)}</h2>` +
    (subtitle ? `<p class="menu-subtitle">${escapeHtml(subtitle)}</p>` : '') +
    body +
    '</div>'
  );
}

/* -------------------------------------------------------------------------- */
/* DOM shell                                                                   */
/* -------------------------------------------------------------------------- */

export interface DomMenuOptions {
  /** Receives every command produced by pointer or keyboard activation. */
  onCommand: (command: MenuCommand) => void;
  /** Static footer hints rendered under the panel. */
  hints?: readonly string[];
}

export class DomMenu {
  /** Active pure model — swapped when the mode changes (main ⇄ pause). */
  public model: MenuModel;

  private readonly root: HTMLDivElement;
  private readonly hints: readonly string[];
  private readonly onCommand: (command: MenuCommand) => void;
  private lastJson = '';
  private isVisible = false;
  private detachInput: () => void;

  public constructor(host: HTMLElement, options: DomMenuOptions, mode: MenuMode = 'main') {
    this.model = new MenuModel(mode);
    this.onCommand = options.onCommand;
    this.hints = options.hints ?? [];

    this.root = document.createElement('div');
    this.root.className = 'menu-overlay';
    this.root.hidden = true;
    host.appendChild(this.root);

    const onPointerDown = (event: Event): void => this.handlePointerDown(event);
    const onPointerOver = (event: Event): void => this.handlePointerOver(event);
    this.root.addEventListener('pointerdown', onPointerDown);
    this.root.addEventListener('pointerover', onPointerOver);
    this.detachInput = (): void => {
      this.root.removeEventListener('pointerdown', onPointerDown);
      this.root.removeEventListener('pointerover', onPointerOver);
    };
  }

  /** Switches between the title-screen and pause-menu item sets. */
  public setMode(mode: MenuMode): void {
    if (this.model.mode === mode) return;
    this.model = new MenuModel(mode);
    this.lastJson = '';
  }

  public get visible(): boolean {
    return this.isVisible;
  }

  public show(): void {
    this.isVisible = true;
    this.root.hidden = false;
  }

  public hide(): void {
    this.isVisible = false;
    this.root.hidden = true;
  }

  /**
   * Re-renders from the model + save snapshot. Cheap when nothing changed
   * (string-diffed, same trick as the HUD).
   */
  public sync(save: SaveData, options: MenuRenderOptions = {}): void {
    if (!this.isVisible) return;
    const html = renderMenuHtml(this.model, save);
    const json = html + JSON.stringify(options.hints ?? this.hints);
    if (json === this.lastJson) return;
    this.lastJson = json;
    const hints = options.hints ?? this.hints;
    this.root.innerHTML = html + (hints.length > 0 ? hintsFooter(hints) : '');
  }

  /** Emits a command on behalf of the host (keyboard paths). */
  public dispatch(command: MenuCommand | null): void {
    if (command) this.onCommand(command);
  }

  /** True if Esc/P should pop a sub-screen instead of leaving PAUSED. */
  public handleBack(): boolean {
    const popped = this.model.back();
    return popped;
  }

  private handlePointerOver(event: Event): void {
    const target = (event.target as HTMLElement | null)?.closest('[data-menu-id]');
    if (!(target instanceof HTMLElement)) return;
    const id = target.dataset.menuId;
    if (id) {
      const before = this.model.selectedIndex;
      this.model.select(id);
      if (before !== this.model.selectedIndex) this.lastJson = ''; // force redraw
    }
  }

  private handlePointerDown(event: Event): void {
    const element = event.target as HTMLElement | null;
    if (!element) return;

    const actionEl = element.closest('[data-menu-action]') as HTMLElement | null;
    if (actionEl) {
      const raw = actionEl.dataset.menuAction ?? '';
      if (raw === 'back') {
        this.model.back();
        this.dispatch({ kind: 'nav', action: 'back' });
        this.invalidate();
        return;
      }
      if (raw === 'fps') {
        this.dispatch({ kind: 'toggle-fps-cap' });
        this.invalidate();
        return;
      }
      const volMatch = /^(vol-(up|down)):(.+)$/.exec(raw);
      if (volMatch) {
        const delta = volMatch[1] === 'vol-up' ? SETTINGS_VOLUME_STEP : -SETTINGS_VOLUME_STEP;
        const channel = volMatch[3];
        if (channel === 'volume' || channel === 'musicVolume' || channel === 'sfxVolume') {
          this.dispatch({ kind: 'setting-volume', channel, delta });
          this.invalidate();
          return;
        }
      }
    }

    const itemEl = element.closest('[data-menu-id]');
    if (!(itemEl instanceof HTMLElement)) return;
    const id = itemEl.dataset.menuId;
    if (!id) return;
    this.model.select(id);
    this.dispatch(this.model.activate());
    this.invalidate();
  }

  private invalidate(): void {
    this.lastJson = '';
  }

  public destroy(): void {
    this.detachInput();
    this.root.remove();
  }
}
