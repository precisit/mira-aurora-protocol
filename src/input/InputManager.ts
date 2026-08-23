/**
 * Input manager (PLAN.md §4 "Kontroller"):
 *
 * Desktop keyboard:
 *   ←/→ or A/D .... move        Space/W/↑ ... jump
 *   J or X ........ shoot       K or C ...... swap weapon
 *   P/Esc ......... pause       Enter ....... confirm/start
 *
 * Menu navigation (C1 meta layer): ↑/W = up, ↓/S = down,
 * Backspace/Esc = back. The up/down actions ride along on keys that already
 * have gameplay meanings (W/↑ also jump) so no key changes role between
 * gameplay and menus — consumers simply read different actions per state.
 *
 * Touch: multi-touch virtual buttons are supported via `bindTouchButton`
 * (pointer events per element — one pointer per finger, so simultaneous
 * move + jump + shoot works). The HUD buttons themselves arrive in wave A;
 * the plumbing is ready now.
 */

export enum InputAction {
  Left = 'left',
  Right = 'right',
  Jump = 'jump',
  Shoot = 'shoot',
  SwapWeapon = 'swap-weapon',
  Pause = 'pause',
  Confirm = 'confirm',
  MenuUp = 'menu-up',
  MenuDown = 'menu-down',
  MenuBack = 'menu-back',
}

/** KeyboardEvent.code → actions (layout independent). */
const KEY_MAP: Readonly<Record<string, readonly InputAction[]>> = {
  ArrowLeft: [InputAction.Left],
  KeyA: [InputAction.Left],
  ArrowRight: [InputAction.Right],
  KeyD: [InputAction.Right],
  Space: [InputAction.Jump],
  KeyW: [InputAction.Jump, InputAction.MenuUp],
  ArrowUp: [InputAction.Jump, InputAction.MenuUp],
  KeyS: [InputAction.MenuDown],
  ArrowDown: [InputAction.MenuDown],
  Backspace: [InputAction.MenuBack],
  KeyJ: [InputAction.Shoot],
  KeyX: [InputAction.Shoot],
  KeyK: [InputAction.SwapWeapon],
  KeyC: [InputAction.SwapWeapon],
  KeyP: [InputAction.Pause],
  Escape: [InputAction.Pause],
  Enter: [InputAction.Confirm],
};

export interface TouchPoint {
  /** Stable pointer identifier across the touch's lifetime. */
  readonly pointerId: number;
  /** Position relative to the bound element, in CSS pixels. */
  x: number;
  y: number;
}

export class InputManager {
  private readonly downActions = new Set<InputAction>();
  private readonly pressedThisFrame = new Set<InputAction>();
  private readonly activePointers = new Map<number, TouchPoint>();
  private readonly keydown = (e: KeyboardEvent): void => this.onKey(e, true);
  private readonly keyup = (e: KeyboardEvent): void => this.onKey(e, false);
  private readonly targetListeners: Array<() => void> = [];

  // ------------------------------------------------------------ lifecycle --

  public attach(target: Window | HTMLElement = window): void {
    target.addEventListener('keydown', this.keydown as EventListener);
    target.addEventListener('keyup', this.keyup as EventListener);
    this.targetListeners.push(() => {
      target.removeEventListener('keydown', this.keydown as EventListener);
      target.removeEventListener('keyup', this.keyup as EventListener);
    });
  }

  public detach(): void {
    for (const off of this.targetListeners) off();
    this.targetListeners.length = 0;
  }

  private onKey(event: KeyboardEvent, isDown: boolean): void {
    const actions = KEY_MAP[event.code];
    if (!actions) return;

    // Don't swallow browser/devtools shortcuts that happen to use our keys.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Arrows/Space scroll the page by default; we own them during gameplay.
    event.preventDefault();

    for (const action of actions) {
      if (isDown) {
        if (!this.downActions.has(action)) this.pressedThisFrame.add(action);
        this.downActions.add(action);
      } else {
        this.downActions.delete(action);
      }
    }
  }

  // --------------------------------------------------------------- queries --

  /** Is `action` currently held down (keyboard OR touch)? */
  public isDown(action: InputAction): boolean {
    return this.downActions.has(action);
  }

  /** Was `action` pressed since the last {@link endFrame}? (edge-triggered) */
  public wasPressed(action: InputAction): boolean {
    return this.pressedThisFrame.has(action);
  }

  /** Call once at the end of every frame to clear edge-triggered presses. */
  public endFrame(): void {
    this.pressedThisFrame.clear();
  }

  // ----------------------------------------------------------- touch hooks --

  /**
   * Bind a DOM element as a multi-touch virtual button for `action`.
   * Pointer events (not touch events) are used so each finger gets its own
   * event stream — several buttons can be held simultaneously.
   */
  public bindTouchButton(element: HTMLElement, action: InputAction): () => void {
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      if (!this.downActions.has(action)) this.pressedThisFrame.add(action);
      this.downActions.add(action);
      this.activePointers.set(event.pointerId, {
        pointerId: event.pointerId,
        x: event.offsetX,
        y: event.offsetY,
      });
    };
    const release = (event: PointerEvent): void => {
      // Only release when *this* button's pointer lifts.
      const point = this.activePointers.get(event.pointerId);
      if (!point) return;
      this.activePointers.delete(event.pointerId);
      this.downActions.delete(action);
    };
    const move = (event: PointerEvent): void => {
      const point = this.activePointers.get(event.pointerId);
      if (point) {
        point.x = event.offsetX;
        point.y = event.offsetY;
      }
    };

    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointermove', move);

    return () => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('pointermove', move);
    };
  }

  /** Currently tracked touch points (for future on-screen stick/buttons). */
  public get touches(): readonly TouchPoint[] {
    return [...this.activePointers.values()];
  }
}
