import { GameLoop } from './core/GameLoop';
import { GameStateMachine, GameStateName } from './core/GameState';
import { AudioEngine } from './audio/AudioEngine';
import { InputAction, InputManager } from './input/InputManager';
import { CAMPAIGN_LEVELS } from './levels/levels';
import { Level } from './levels/Level';
import { TILE_SIZE, TileType } from './levels/LevelData';
import { ParallaxBackground } from './renderer/ParallaxBackground';
import {
  WebGPURenderer,
  type Rgba,
  type SpriteDraw,
} from './renderer/WebGPURenderer';
import { DomHud } from './ui/Hud';
import { SaveStore } from './save/SaveStore';
import type { SfxName } from './audio/SfxSynth';
import { CHECKPOINT_BONUS } from './game/score';
import { GameSession, type GameEvent } from './game/GameSession';
import { emptyPlayerInput, type PlayerInput } from './game/Player';
import { ENEMY_COLORS_FALLBACK } from './game/renderPalette';
import type { EnemyTypeName, FragmentTypeName } from './game/entities';
import { POWERUPS } from './game/entities';
import type { Particle } from './game/ParticleSystem';
import type { Pickup } from './game/pickups';
import type { Projectile } from './game/Projectile';
import './style.css';

/**
 * Aurora Protocol — B0 bootstrap: real gameplay.
 *
 * Boots the WebGPU renderer + parallax, then runs fixed-timestep sessions of
 * {@link GameSession} (player, enemies, projectiles, pickups, checkpoints).
 * State machine: BOOT → MENU → (Space) PLAYING ⇄ PAUSED / → GAMEOVER →
 * PLAYING … → WIN → MENU. Camera follows AURORA; HUD shows score/lives/
 * weapon/combo; procedural SFX fire on gameplay events.
 */

// Neon palette (tints over the white 1×1 texture).
const TINT_SOLID_A: Rgba = [0.16, 0.9, 1.0, 1];
const TINT_SOLID_B: Rgba = [0.1, 0.62, 0.95, 1];
const TINT_PLATFORM: Rgba = [1.0, 0.35, 0.85, 1];
const TINT_HAZARD: Rgba = [1.0, 0.45, 0.15, 1];
const GLOW_HAZARD: Rgba = [1.0, 0.45, 0.15, 1.4];

const PLAYER_COLOR: Rgba = [0.45, 0.95, 1, 1];
const PLAYER_CORE_COLOR: Rgba = [1, 1, 1, 1];
const PROJECTILE_PLAYER_COLOR: Rgba = [0.7, 1, 1, 1];
const PROJECTILE_ENEMY_COLOR: Rgba = [1, 0.4, 0.4, 1];

const CHECKPOINT_INACTIVE: Rgba = [1.0, 0.9, 0.3, 0.5];
const CHECKPOINT_ACTIVE: Rgba = [1.0, 0.95, 0.45, 0.95];
const EXIT_COLOR: Rgba = [0.55, 1.0, 0.45, 0.95];

const PICKUP_FRAGMENT_COLOR: Rgba = [1.0, 0.4, 0.9, 0.9];
const PICKUP_POWERUP_COLOR: Rgba = [0.4, 1.0, 0.9, 0.9];
const PICKUP_UNLOCK_COLOR: Rgba = [1.0, 0.85, 0.3, 1];

/** Transient HUD toast. */
interface Toast {
  text: string;
  expiresAtMs: number;
}

interface FrameLatches {
  jump: boolean;
  pause: boolean;
  confirm: boolean;
  swap: boolean;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const fallbackHost = document.getElementById('fallback');
  if (!canvas) throw new Error('#game canvas missing from index.html');

  // ---- Renderer (defensive init with user-facing fallback) ----------------
  const renderer = new WebGPURenderer();
  try {
    await renderer.init(canvas);
  } catch (error) {
    console.error('[boot] renderer init failed:', error);
    canvas.classList.add('hidden');
    WebGPURenderer.showFallbackMessage(fallbackHost);
    return;
  }

  // ---- World / systems -----------------------------------------------------
  const parallax = new ParallaxBackground(renderer);
  await parallax.generate();

  const input = new InputManager();
  input.attach(window);
  const detachTouchUi = setupTouchControls(input);

  const save = new SaveStore();
  const audio = new AudioEngine();
  audio.applySettings(save.load().settings);
  const detachAudioUnlock = audio.initOnInteraction(window, () => audio.playSfx('ui-click'));

  const hud = new DomHud(document.getElementById('hud-root') ?? document.body);
  const state = new GameStateMachine();
  state.transition(GameStateName.Menu);

  // ---- Gameplay bookkeeping -------------------------------------------------
  let levelIndex = 1;
  let session: GameSession | null = null;
  let carriedDoubleJump = false;
  let toast: Toast | null = null;
  /** Set when the current level finished; consumed by the progression step. */
  let levelFinished = false;

  const sfxSink = (name: SfxName, options?: { step?: number }): void => {
    audio.playSfx(name, options);
  };

  const showToast = (text: string, durationMs = 2200): void => {
    toast = { text, expiresAtMs: performance.now() + durationMs };
  };

  const startLevel = (index: number): void => {
    const data = campaignLevel(index);
    if (!data) return;
    session = new GameSession({
      levelData: data,
      hooks: { sfx: sfxSink, onEvent: handleGameEvent },
      seed: 0xa7001 + index * 7919,
    });
    if (carriedDoubleJump) session.player.abilities.doubleJumpUnlocked = true;
    levelFinished = false;
    void audio.playMusic(data.id);
  };

  function handleGameEvent(event: GameEvent): void {
    switch (event.type) {
      case 'checkpoint-activated':
        showToast(`CHECKPOINT · +${CHECKPOINT_BONUS}`);
        break;
      case 'unlock-granted':
        showToast(`UNLOCKED — ${event.unlock}`, 3200);
        carriedDoubleJump = true;
        break;
      case 'powerup-collected':
        showToast(POWERUPS[event.powerup]?.blurb ?? event.powerup);
        break;
      case 'level-complete':
        levelFinished = true;
        break;
      default:
        break;
    }
  }

  /** Level data for 1-based index, or undefined past the built campaign. */
  function campaignLevel(index: number) {
    return CAMPAIGN_LEVELS.find((l) => l.index === index);
  }

  // Per-frame input latches: fixed-step updates may run 0..N times per frame,
  // so edge-triggered actions are captured once and explicitly consumed.
  const latches: FrameLatches = { jump: false, pause: false, confirm: false, swap: false };
  const refreshLatches = (): void => {
    latches.jump = input.wasPressed(InputAction.Jump);
    latches.pause = input.wasPressed(InputAction.Pause);
    latches.confirm = input.wasPressed(InputAction.Confirm);
    latches.swap = input.wasPressed(InputAction.SwapWeapon);
  };
  const takeLatch = (key: keyof FrameLatches): boolean => {
    const value = latches[key];
    latches[key] = false;
    return value;
  };

  // Pointer aim (desktop): last known position in virtual view space.
  let pointerView: { x: number; y: number } | null = null;
  const onPointerMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const bounds = renderer.viewBounds;
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    pointerView = {
      x: bounds.left + nx * (bounds.right - bounds.left),
      y: bounds.top + ny * (bounds.bottom - bounds.top),
    };
  };
  canvas.addEventListener('pointermove', onPointerMove);

  function buildPlayerInput(): PlayerInput {
    if (!session) return emptyPlayerInput();

    const moveLeft = input.isDown(InputAction.Left) ? 1 : 0;
    const moveRight = input.isDown(InputAction.Right) ? 1 : 0;
    const moveX = moveRight - moveLeft;

    const p = session.player;
    let aim: PlayerInput['aim'] = null;
    if (pointerView) {
      const worldX = pointerView.x + session.cameraX;
      const worldY = pointerView.y + session.cameraY;
      const dx = worldX - p.centerX;
      const dy = worldY - p.centerY;
      const len = Math.hypot(dx, dy);
      if (len > 8) aim = { x: dx / len, y: dy / len };
    }

    return {
      moveX,
      jumpPressed: takeLatch('jump'),
      jumpHeld: input.isDown(InputAction.Jump),
      shootHeld: input.isDown(InputAction.Shoot),
      aim,
    };
  }

  // ---- Progression ----------------------------------------------------------
  function handleLevelProgression(): void {
    if (!session || !levelFinished) return;

    const data = session.level.data;
    const saveData = save.load();
    save.recordLevelResult(saveData, data.id, session.score.score, session.timeMs);
    save.save(audio.captureVolumesInto(saveData));

    const nextIndex = levelIndex + 1;
    if (campaignLevel(nextIndex)) {
      levelIndex = nextIndex;
      startLevel(levelIndex);
      showToast(`LEVEL ${levelIndex} — ${session.level.data.name}`, 2600);
    } else {
      state.transition(GameStateName.Win);
      audio.stopMusic();
      showToast(`ARCHIVE RESTORED — TOTAL ${save.load().totalScore}`, 6000);
    }
  }

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    update(stepMs) {
      // ---- state machine (edge-latched so multi-step frames can't toggle) --
      switch (state.current) {
        case GameStateName.Menu:
          if (takeLatch('confirm') || takeLatch('jump')) {
            levelIndex = 1;
            carriedDoubleJump = false;
            startLevel(levelIndex);
            state.transition(GameStateName.Playing);
            audio.playSfx('checkpoint');
          }
          break;

        case GameStateName.Paused:
          if (takeLatch('pause') || takeLatch('confirm')) {
            state.transition(GameStateName.Playing);
            audio.resumeMusic();
          }
          break;

        case GameStateName.GameOver:
          if (takeLatch('confirm') || takeLatch('jump')) {
            startLevel(levelIndex); // fresh attempt, 3 lives, score zeroed
            state.transition(GameStateName.Playing);
          }
          break;

        case GameStateName.Win:
          if (takeLatch('confirm') || takeLatch('jump')) {
            state.transition(GameStateName.Menu);
          }
          break;

        case GameStateName.Playing:
          if (takeLatch('pause')) {
            state.transition(GameStateName.Paused);
            audio.pauseMusic();
            break;
          }
          if (takeLatch('swap')) {
            audio.playSfx('weapon-switch');
            showToast('PULS equipped — more weapons unlock via total score');
          }
          break;

        default:
          break;
      }

      // ---- simulation ------------------------------------------------------
      if (state.current === GameStateName.Playing && session) {
        if (session.status === 'gameOver') {
          state.transition(GameStateName.GameOver);
        } else if (session.status === 'levelComplete' || levelFinished) {
          handleLevelProgression();
        } else {
          session.update(stepMs, buildPlayerInput());
        }
      }

      input.endFrame();
    },

    render() {
      refreshLatches();

      renderer.beginFrame([0.03, 0.01, 0.09, 1]);
      const cameraX = session?.cameraX ?? 0;
      parallax.draw(cameraX);

      if (session) {
        renderer.drawSprites('white', buildWorldSprites(renderer, session));
      }
      renderer.endFrame();

      hud.update({
        gameStateName: state.current,
        levelName: session?.level.data.name ?? '—',
        fps: loop.fps,
        cameraX,
        message: currentMessage(),
        score: session?.score.score,
        lives: session?.lives,
        weapon: session ? 'PULS' : undefined,
        comboMultiplier: session?.score.multiplier,
        timeSeconds: session ? session.timeMs / 1000 : undefined,
      });
    },
  });

  function currentMessage(): string | null {
    const now = performance.now();
    if (toast && toast.expiresAtMs < now) toast = null;

    switch (state.current) {
      case GameStateName.Menu:
        return 'PRESS SPACE TO START · ARROWS/AD MOVE · SPACE JUMP · J SHOOT · P PAUSE';
      case GameStateName.Paused:
        return 'PAUSED — P OR ENTER TO RESUME';
      case GameStateName.GameOver:
        return 'GAME OVER — ENTER TO RETRY THIS LEVEL';
      case GameStateName.Win:
        return 'AURORA PROTOCOL COMPLETE — THE ARCHIVE IS SAFE. ENTER FOR MENU.';
      default:
        return toast?.text ?? session?.level.data.intro ?? null;
    }
  }

  window.addEventListener('beforeunload', () => {
    loop.stop();
    input.detach();
    canvas.removeEventListener('pointermove', onPointerMove);
    detachTouchUi();
    detachAudioUnlock();
    audio.dispose();
    hud.destroy();
  });

  loop.start();
  refreshLatches();
}

// ---------------------------------------------------------------------------
// World rendering: tiles + entities as batched neon sprites.
// ---------------------------------------------------------------------------

function buildWorldSprites(
  renderer: WebGPURenderer,
  session: GameSession,
): SpriteDraw[] {
  const sprites: SpriteDraw[] = [];
  const level = session.level;
  const camX = session.cameraX;
  const camY = session.cameraY;
  const bounds = renderer.viewBounds;

  // --- tiles ---------------------------------------------------------------
  const worldLeft = camX + bounds.left;
  const worldRight = camX + bounds.right;
  const tx0 = Math.max(0, Math.floor(worldLeft / TILE_SIZE));
  const tx1 = Math.min(level.widthTiles - 1, Math.ceil(worldRight / TILE_SIZE));
  if (tx1 >= tx0) {
    for (let ty = 0; ty < level.heightTiles; ty++) {
      const y = Level.tileToWorldY(ty) - camY;
      if (y < bounds.top - TILE_SIZE || y > bounds.bottom) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = level.tileAt(tx, ty);
        if (tile === TileType.Empty) continue;
        const x = Level.tileToWorldX(tx) - camX;
        switch (tile) {
          case TileType.Solid:
            sprites.push({
              x,
              y,
              width: TILE_SIZE,
              height: TILE_SIZE,
              tint: (tx + ty) % 2 === 0 ? TINT_SOLID_A : TINT_SOLID_B,
            });
            break;
          case TileType.Platform:
            sprites.push({ x, y, width: TILE_SIZE, height: 10, tint: TINT_PLATFORM });
            break;
          case TileType.Hazard:
            sprites.push({
              x,
              y: y + 6,
              width: TILE_SIZE,
              height: TILE_SIZE - 12,
              tint: TINT_HAZARD,
              glow: GLOW_HAZARD,
            });
            break;
        }
      }
    }
  }

  // --- checkpoints & exit ---------------------------------------------------
  for (const checkpoint of session.checkpoints) {
    sprites.push({
      x: checkpoint.worldX + 10 - camX,
      y: checkpoint.worldY - 32 - camY,
      width: 12,
      height: 64,
      tint: checkpoint.activated ? CHECKPOINT_ACTIVE : CHECKPOINT_INACTIVE,
      glow: checkpoint.activated ? [1.0, 0.92, 0.35, 2.2] : [1.0, 0.9, 0.3, 0.6],
      blend: 'additive',
    });
  }
  const exit = session.exitBoxOrNull;
  if (exit) {
    sprites.push({
      x: exit.x - camX,
      y: exit.y - camY,
      width: exit.width,
      height: exit.height,
      tint: EXIT_COLOR,
      glow: [0.55, 1.0, 0.45, 2.4],
      blend: 'additive',
    });
  }

  // --- pickups ---------------------------------------------------------------
  for (const pickup of session.activePickups) {
    const color = pickupColor(pickup);
    sprites.push({
      x: pickup.position.x - camX,
      y: pickup.position.y - camY,
      width: pickup.size.x,
      height: pickup.size.y,
      tint: color,
      glow: color,
      blend: 'additive',
    });
  }

  // --- enemies -----------------------------------------------------------------
  for (const enemy of session.activeEnemies) {
    const base = ENEMY_COLORS_FALLBACK[enemy.kind as EnemyTypeName] ?? ([1, 1, 1, 1] as Rgba);
    const flashing = enemy.hitFlashMs > 0;
    const tint: Rgba = flashing ? [1, 1, 1, 1] : base;
    sprites.push({
      x: enemy.position.x - camX,
      y: enemy.position.y - camY,
      width: enemy.size.x,
      height: enemy.size.y,
      tint,
      glow: tint,
    });
  }

  // --- player (blinks while invulnerable) ---------------------------------------
  const p = session.player;
  const blinkHidden =
    p.isInvulnerable && Math.floor(session.timeMs / 80) % 2 === 1;
  if (!blinkHidden) {
    sprites.push({
      x: p.x - 3 - camX,
      y: p.y - 3 - camY,
      width: p.width + 6,
      height: p.height + 6,
      tint: [PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 0.5],
      glow: [PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 1.6],
      blend: 'additive',
    });
    sprites.push({
      x: p.x - camX,
      y: p.y - camY,
      width: p.width,
      height: p.height,
      tint: PLAYER_COLOR,
    });
    sprites.push({
      x: p.centerX - 4 - camX,
      y: p.centerY - 4 - camY,
      width: 8,
      height: 8,
      tint: PLAYER_CORE_COLOR,
      glow: [1, 1, 1, 2],
      blend: 'additive',
    });
  }

  // --- projectiles ----------------------------------------------------------------
  const projectileSprites: SpriteDraw[] = session.activeProjectiles.map((shot: Projectile) => ({
    x: shot.position.x - camX,
    y: shot.position.y - camY,
    width: shot.size.x,
    height: shot.size.y,
    tint: shot.owner === 'player' ? PROJECTILE_PLAYER_COLOR : PROJECTILE_ENEMY_COLOR,
    glow: shot.owner === 'player' ? PROJECTILE_PLAYER_COLOR : PROJECTILE_ENEMY_COLOR,
    blend: 'additive',
  }));
  pushAll(sprites, projectileSprites);

  // --- particles --------------------------------------------------------------------
  const particleSprites: SpriteDraw[] = session.particles.active.map((particle: Particle) => ({
    x: particle.x - particle.sizePx / 2 - camX,
    y: particle.y - particle.sizePx / 2 - camY,
    width: particle.sizePx,
    height: particle.sizePx,
    tint: [
      particle.color[0],
      particle.color[1],
      particle.color[2],
      Math.max(0, Math.min(1, particle.lifeSeconds / particle.maxLifeSeconds)),
    ] as Rgba,
    blend: 'additive',
  }));
  pushAll(sprites, particleSprites);

  return sprites;
}

function pushAll(target: SpriteDraw[], items: readonly SpriteDraw[]): void {
  for (const item of items) target.push(item);
}

function pickupColor(pickup: Pickup): Rgba {
  if (pickup.kind === 'unlock') return PICKUP_UNLOCK_COLOR;
  if (pickup.kind === 'powerup') return PICKUP_POWERUP_COLOR;
  return FRAGMENT_TINTS[pickup.fragment ?? 'Music'] ?? PICKUP_FRAGMENT_COLOR;
}

const FRAGMENT_TINTS: Readonly<Record<FragmentTypeName, Rgba>> = {
  Music: [1.0, 0.45, 0.75, 0.9],
  Science: [0.45, 0.85, 1.0, 0.9],
  Language: [1.0, 0.85, 0.45, 0.9],
  Art: [0.75, 0.5, 1.0, 0.9],
  History: [1.0, 0.6, 0.4, 0.9],
  Medicine: [0.5, 1.0, 0.65, 0.9],
  Philosophy: [1.0, 1.0, 0.6, 0.9],
};

// ---------------------------------------------------------------------------
// Touch controls (multi-touch via InputManager.bindTouchButton).
// ---------------------------------------------------------------------------

function setupTouchControls(input: InputManager): () => void {
  const isCoarsePointer =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const hasTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  if (!isCoarsePointer && !hasTouch) return () => undefined;

  const container = document.createElement('div');
  container.className = 'touch-ui';
  container.innerHTML = `
    <div class="touch-group touch-left">
      <button class="touch-btn" data-action="left" aria-label="Move left">◀</button>
      <button class="touch-btn" data-action="right" aria-label="Move right">▶</button>
    </div>
    <div class="touch-group touch-right">
      <button class="touch-btn" data-action="shoot" aria-label="Shoot">FIRE</button>
      <button class="touch-btn" data-action="jump" aria-label="Jump">JUMP</button>
    </div>
  `;
  document.body.appendChild(container);

  const detachers: Array<() => void> = [];
  for (const button of Array.from(container.querySelectorAll('.touch-btn'))) {
    const element = button as HTMLElement;
    const action = element.dataset.action;
    const mapped =
      action === 'left'
        ? InputAction.Left
        : action === 'right'
          ? InputAction.Right
          : action === 'jump'
            ? InputAction.Jump
            : action === 'shoot'
              ? InputAction.Shoot
              : null;
    if (!mapped) continue;
    element.classList.add('no-select');
    detachers.push(input.bindTouchButton(element, mapped));
  }

  return () => {
    for (const detach of detachers) detach();
    container.remove();
  };
}

boot().catch((error) => {
  console.error('[boot] fatal:', error);
  WebGPURenderer.showFallbackMessage(document.getElementById('fallback'));
});
