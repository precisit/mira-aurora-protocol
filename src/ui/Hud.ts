/**
 * HUD skeleton (PLAN.md §5 src/ui — full HUD lands in wave A).
 *
 * `HudState` is the pure data contract between game code and any UI
 * implementation; `DomHud` is a minimal DOM renderer used by the Fas 0 demo.
 */

export interface HudState {
  gameStateName: string;
  levelName: string;
  fps: number;
  cameraX: number;
  /** Transient message (menu hints, pause text); null hides it. */
  message: string | null;
  /** B1 "juice" telemetry line (particles/shake/bloom); null hides it. */
  juiceLine?: string | null;
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
    this.render({ gameStateName: '-', levelName: '-', fps: 0, cameraX: 0, message: null });
  }

  public update(state: HudState): void {
    // Avoid layout churn: only touch the DOM when something changed.
    const json = JSON.stringify(state);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.render(state);
  }

  private render(state: HudState): void {
    const parts = [
      `AURORA PROTOCOL`,
      `state: ${state.gameStateName}`,
      `level: ${state.levelName}`,
      `${Math.round(state.fps)} fps`,
    ];
    let html = `<span class="hud-title">${parts[0]}</span><span>${parts.slice(1).join(' · ')}</span>`;
    if (state.message) html += `<span class="hud-message">${escapeHtml(state.message)}</span>`;
    if (state.juiceLine) html += `<span class="hud-juice">${escapeHtml(state.juiceLine)}</span>`;
    this.root.innerHTML = html;
  }

  public destroy(): void {
    this.root.remove();
  }
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
