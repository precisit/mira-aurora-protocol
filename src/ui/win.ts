/**
 * Win screen data + minimal renderer (task B5; PLAN.md §4 "Vinst & replay":
 * "vinstskärm med statistik (totalpoäng, totaltid, samlade fragment)").
 *
 * Shown after completing level 7 of 7. The data half is pure and node-testable;
 * {@link DomWinScreen} is a deliberately plain DOM fallback — the real menu UI
 * lands in wave C and can consume {@link WinSummary} directly.
 *
 * Rows cover all seven campaign slots (PLAN.md §4 level table), including
 * levels not yet shipped by wave A2 (levels 1–3 built today): their ids fall
 * back to a stable `lvl-0N` key until the real modules exist.
 */

import { LEVEL_COUNT } from '../levels/levels';
import { LEVEL_INTROS } from './story';
import type { FragmentTypeName } from '../game/entities';
import { FRAGMENT_LABELS } from '../game/entities';
import { formatTimeMs } from '../core/Timer';
import type { LevelResultSnapshot } from '../game/RunStats';
import type { SaveData } from '../save/SaveStore';

/** One per-level row of the win/highscore table (poäng och tid per bana). */
export interface WinLevelRow {
  index: number;
  title: string;
  /** Level id used for save lookups (synthetic for unbuilt levels). */
  levelId: string;
  bestScore: number | null;
  bestTimeMs: number | null;
}

export interface WinSummary {
  /** Score accumulated this run (completed levels only). */
  totalRunScore: number;
  /** Lifetime accumulated total score (drives weapon unlocks). */
  lifetimeTotalScore: number;
  /** Total PLAYING time of this run across all levels + retries. */
  totalRunTimeMs: number;
  formattedTotalRunTime: string;
  fragmentsCollected: number;
  fragmentsByType: Partial<Record<FragmentTypeName, number>>;
  checkpointsPassed: number;
  deaths: number;
  levels: WinLevelRow[];
  bestRunTimeMs: number | null;
  isNewBestRunTime: boolean;
  parTimeSecondsByLevel: Record<number, number>;
}

/** Stable save key for campaign slot `index` (1-based). */
export function campaignLevelId(index: number): string {
  return `lvl-${String(index).padStart(2, '0')}`;
}

function levelTitle(index: number): string {
  return LEVEL_INTROS.find((intro) => intro.level === index)?.title ?? `Level ${index}`;
}

/**
 * Assembles the win statistics from run results + persisted data.
 * `parTimes` maps level index → par seconds for speedrun comparison
 * ("bättre poäng eller snabbare tid" replay loop).
 */
export function buildWinSummary(
  results: readonly LevelResultSnapshot[],
  timerMs: { totalRunTimeMs: number },
  save: SaveData,
  options: { parTimes?: Record<number, number>; newRecord?: boolean } = {},
): WinSummary {
  const highscores = save.highscores;
  const levels: WinLevelRow[] = [];
  for (let index = 1; index <= LEVEL_COUNT; index++) {
    const levelId =
      results.find((r) => r.index === index)?.levelId ?? campaignLevelId(index);
    const best = highscores[levelId];
    levels.push({
      index,
      title: levelTitle(index),
      levelId,
      bestScore: best?.score ?? null,
      bestTimeMs: best?.timeMs ?? null,
    });
  }

  return {
    totalRunScore: results.reduce((sum, r) => sum + r.score, 0),
    lifetimeTotalScore: save.totalScore,
    totalRunTimeMs: timerMs.totalRunTimeMs,
    formattedTotalRunTime: formatTimeMs(timerMs.totalRunTimeMs),
    fragmentsCollected: results.reduce(
      (sum, r) => sum + Object.values(r.fragmentsByType).reduce((a, n) => a + (n ?? 0), 0),
      0,
    ),
    fragmentsByType: sumFragmentsByType(results),
    checkpointsPassed: results.reduce((sum, r) => sum + r.checkpointsPassed, 0),
    deaths: results.reduce((sum, r) => sum + r.deaths, 0),
    levels,
    bestRunTimeMs: save.bestRunTimeMs,
    isNewBestRunTime: options.newRecord ?? false,
    parTimeSecondsByLevel: options.parTimes ?? {},
  };
}

function sumFragmentsByType(
  results: readonly LevelResultSnapshot[],
): Partial<Record<FragmentTypeName, number>> {
  const tally: Partial<Record<FragmentTypeName, number>> = {};
  for (const result of results) {
    for (const [type, n] of Object.entries(result.fragmentsByType)) {
      const key = type as FragmentTypeName;
      tally[key] = (tally[key] ?? 0) + (n ?? 0);
    }
  }
  return tally;
}

/* -------------------------------------------------------------------------- */
/* Minimal DOM renderer (placeholder until wave C menu UI)                    */
/* -------------------------------------------------------------------------- */

const FRAGMENT_ORDER_FOR_UI: readonly FragmentTypeName[] = [
  'Music',
  'Science',
  'Language',
  'Art',
  'History',
  'Medicine',
  'Philosophy',
];

export class DomWinScreen {
  private readonly root: HTMLDivElement;

  public constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'win-screen';
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  public show(summary: WinSummary): void {
    this.root.innerHTML = renderHtml(summary);
    this.root.hidden = false;
  }

  public hide(): void {
    this.root.hidden = true;
  }

  public destroy(): void {
    this.root.remove();
  }
}

function renderHtml(summary: WinSummary): string {
  const rows = summary.levels
    .map((row) => {
      const score = row.bestScore === null ? '—' : String(row.bestScore);
      const time = row.bestTimeMs === null ? '—' : formatTimeMs(row.bestTimeMs);
      const par = summary.parTimeSecondsByLevel[row.index];
      const parText = par === undefined ? '' : ` (par ${formatTimeMs(par * 1000)})`;
      return `<tr><td>${row.index}</td><td>${escapeHtml(row.title)}</td><td>${score}</td><td>${time}${parText}</td></tr>`;
    })
    .join('');

  const fragmentBits = FRAGMENT_ORDER_FOR_UI.filter(
    (type) => (summary.fragmentsByType[type] ?? 0) > 0,
  ).map((type) => `${FRAGMENT_LABELS[type]} ×${summary.fragmentsByType[type]}`);

  const recordBadge = summary.isNewBestRunTime ? '<p class="win-record">NEW BEST RUN TIME!</p>' : '';

  return [
    '<h2>ARCHIVE DELIVERED</h2>',
    '<p class="win-tagline">Mänsklighetens minne lever. Tack, AURORA.</p>',
    recordBadge,
    `<ul>` +
      `<li>Total score: ${summary.totalRunScore} (lifetime ${summary.lifetimeTotalScore})</li>` +
      `<li>Total time: ${summary.formattedTotalRunTime}</li>` +
      `<li>Fragments collected: ${summary.fragmentsCollected}` +
      (fragmentBits.length > 0 ? ` — ${fragmentBits.join(', ')}` : '') +
      `</li>` +
      `<li>Checkpoints: ${summary.checkpointsPassed} · Deaths: ${summary.deaths}</li>` +
      (summary.bestRunTimeMs !== null ? `<li>Best run: ${formatTimeMs(summary.bestRunTimeMs)}</li>` : '') +
      `</ul>`,
    '<table><thead><tr><th>#</th><th>Level</th><th>Best score</th><th>Best time</th></tr></thead>' +
      `<tbody>${rows}</tbody></table>`,
  ].join('');
}

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
