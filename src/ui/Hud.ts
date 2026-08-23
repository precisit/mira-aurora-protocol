/**
 * HUD (PLAN.md §5 src/ui). `HudState` is the pure data contract between game
 * code and any UI implementation; `DomHud` is a minimal DOM renderer used by
 * main.ts. B0 adds score/lives/weapon/combo readouts, task B5 the level/total
 * time clocks and B1 a juice telemetry line.
 */

export interface HudState {
  gameStateName: string;
  levelName: string;
  fps: number;
  cameraX: number;
  /** Current level clock formatted as mm:ss.xx (task B5); null hides it. */
  timeText: string | null;
  /** Total run clock formatted as mm:ss.xx (speedrun total, task B5). */
  totalTimeText: string | null;
  /** Transient message (menu hints, pause text); null hides it. */
  message: string | null;
  /** Level-attempt score (already includes combo multipliers). */
  score?: number;
  /** Lives remaining this level. */
  lives?: number;
  /** Equipped weapon display name, e.g. "PULS". */
  weapon?: string;
  /** Current combo multiplier tier (1 = no combo). */
  comboMultiplier?: number;
  /** Elapsed level time in seconds (fractional). */
  timeSeconds?: number;
  /** B1 "juice" telemetry line (particles/shake/bloom); null hides it. */
  juiceLine?: string | null;
  /** Boss fight readout (task B2); null/absent hides the bar. */
  boss?: { name: string; hpFraction: number; phase: number; phaseCount: number } | null;
}

export interface Hud {
  update(state: HudState): void;
}

export class DomHud implements Hud {
  private readonly root: HTMLDivElement;
  private lastJson = '';

  public constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    host.appendChild(this.root);
    this.render({
      gameStateName: '-',
      levelName: '-',
      fps: 0,
      cameraX: 0,
      timeText: null,
      totalTimeText: null,
      message: null,
    });
  }

  public update(state: HudState): void {
    // Avoid layout churn: only touch the DOM when something changed.
    const json = JSON.stringify(state);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.render(state);
  }

  private render(state: HudState): void {
    const parts: string[] = [
      `state: ${state.gameStateName}`,
      `level: ${state.levelName}`,
      `${Math.round(state.fps)} fps`,
    ];
    if (typeof state.score === 'number') parts.unshift(`SCORE ${formatScore(state.score)}`);
    if (typeof state.lives === 'number') parts.splice(1, 0, `LIVES ${'◆'.repeat(Math.max(0, state.lives)) || '—'}`);
    if (state.weapon) parts.push(`WPN ${escapeHtml(state.weapon)}`);
    if (typeof state.comboMultiplier === 'number' && state.comboMultiplier > 1) {
      parts.push(`COMBO ×${state.comboMultiplier}`);
    }
    if (state.timeText !== null) parts.push(`time: ${state.timeText}`);
    if (state.totalTimeText !== null) parts.push(`total: ${state.totalTimeText}`);
    if (typeof state.timeSeconds === 'number') {
      parts.push(`${state.timeSeconds.toFixed(1)}s`);
    }
    let html = `<span class="hud-title">AURORA PROTOCOL</span><span>${parts.join(' · ')}</span>`;
    if (state.boss) html += renderBossBar(state.boss);
    if (state.message) html += `<span class="hud-message">${escapeHtml(state.message)}</span>`;
    if (state.juiceLine) html += `<span class="hud-juice">${escapeHtml(state.juiceLine)}</span>`;
    this.root.innerHTML = html;
  }

  public destroy(): void {
    this.root.remove();
  }
}

/** Boss name + segmented HP bar + phase pips (task B2). */
function renderBossBar(boss: NonNullable<HudState['boss']>): string {
  const fraction = Math.min(1, Math.max(0, boss.hpFraction));
  const segments = Math.max(1, Math.round(fraction * SEGMENT_COUNT));
  const bar = '▮'.repeat(segments) + '▯'.repeat(Math.max(0, SEGMENT_COUNT - segments));
  const phasePips =
    Array.from({ length: boss.phaseCount }, (_, i) => (i < boss.phase ? '◆' : '◇')).join('');
  return (
    `<span class="hud-boss">` +
    `${escapeHtml(boss.name)} ` +
    `<span class="hud-boss-bar">${bar}</span> ` +
    `${Math.round(fraction * 100)}% ` +
    `<span class="hud-boss-phase">${phasePips} ${boss.phase}/${boss.phaseCount}</span>` +
    `</span>`
  );
}

const SEGMENT_COUNT = 20;

function formatScore(score: number): string {
  return Math.max(0, Math.round(score)).toString().padStart(6, '0');
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
