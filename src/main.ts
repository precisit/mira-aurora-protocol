import { GameLoop } from './core/GameLoop';
import { GameStateMachine, GameStateName } from './core/GameState';
import { attachLevelTimer, LevelTimer } from './core/Timer';
import { AudioEngine } from './audio/AudioEngine';
import { JuiceSystem } from './effects/JuiceSystem';
import { InputAction, InputManager } from './input/InputManager';
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
import { ENEMY_COLORS_FALLBACK, BOSS_COLORS_FALLBACK } from './game/renderPalette';
import { laserTelegraphBox, type LaserBeam } from './game/bosses';
import { BOSS_DIALOGUE } from './ui/story';
import { PLAYABLE_LEVELS } from './levels/levels';
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
 * weapon/combo plus the B5 level/total clocks and the B1 juice telemetry;
 * procedural SFX fire on gameplay events.
 *
 * B1 juice (PLAN.md §4 "Juice & effekter") routes through {@link JuiceSystem},
 * the shared effects façade: jump/land/shoot are observed from the player
 * each step, and gameplay events drive the particle/shake/bloom recipes.
 * Screen shake offsets the camera transform; a fullscreen additive quad
 * renders the death/explosion screen flash.
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
  // Task B5: level + total run clocks, kept in sync with the state machine
  // (MENU→PLAYING starts the run, PAUSED pauses, GAMEOVER restarts the level
  // clock while total keeps accumulating — speedrun rules per PLAN.md §4).
  const timer = new LevelTimer();
  const detachTimerSync = attachLevelTimer(state, timer);
  state.transition(GameStateName.Menu);

  // ---- B1 juice -------------------------------------------------------------
  const juice = new JuiceSystem({
    setBloom: (patch) => renderer.setBloomOptions(patch),
  });

  /** Fullscreen additive quad while the screen-flash envelope is active. */
  const flashQuad: SpriteDraw[] = [{ x: 0, y: 0, width: 0, height: 0 }];
  const flashColor: [number, number, number, number] = [1, 1, 1, 0];
  const drawScreenFlash = (): void => {
    if (!juice.screenFlash.isActive) return;
    const bounds = renderer.viewBounds;
    const quad = flashQuad[0]!;
    quad.x = bounds.left;
    quad.y = bounds.top;
    quad.width = bounds.right - bounds.left;
    quad.height = bounds.bottom - bounds.top;
    quad.tint = juice.screenFlash.currentColor(flashColor);
    quad.blend = 'additive';
    renderer.drawSprites('white', flashQuad);
  };

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
    timer.restartLevel(); // fresh attempt → per-level clock back to 00:00.00
    prevPlayerGrounded = true;
    prevPlayerVy = 0;
    prevProjectileCount = 0;
    void audio.playMusic(data.id);
  };

  function handleGameEvent(event: GameEvent): void {
    // B1 juice recipes keyed off gameplay events (positions approximate the
    // player anchor unless the event carries its own coordinates).
    if (session) {
      const p = session.player;
      switch (event.type) {
        case 'fragment-collected':
          juice.fragmentPickup(p.centerX, p.centerY);
          break;
        case 'enemy-killed':
          juice.enemyDeath(p.centerX, p.centerY);
          break;
        case 'player-died':
          juice.playerDeath(p.centerX, p.centerY);
          break;
        case 'checkpoint-activated':
          juice.shake.addTrauma(0.22);
          juice.bloom.pulse(0.35);
          break;
        case 'powerup-collected':
          juice.bloom.pulse(0.3);
          break;
        case 'unlock-granted':
          juice.bloom.pulse(0.55);
          break;
        case 'level-complete':
          juice.bloom.pulse(0.6);
          break;
        case 'boss-encountered':
          juice.bossWarning();
          break;
        case 'boss-phase-changed':
          juice.bossWarning();
          break;
        case 'boss-defeated':
          juice.explosion(p.centerX, p.centerY);
          break;
        default:
          break;
      }
    }

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
      case 'boss-encountered':
        showToast(`${BOSS_DIALOGUE[event.boss].encounter === '…' ? event.boss : `${event.boss}: “${BOSS_DIALOGUE[event.boss].encounter}”`}`, 4200);
        break;
      case 'boss-phase-changed':
        if (event.quote) showToast(`${event.boss}: “${event.quote}”`, 3800);
        break;
      case 'boss-quote':
        showToast(`${event.boss}: “${event.text}”`, 3200);
        break;
      case 'boss-defeated': {
        const defeat = BOSS_DIALOGUE[event.boss].defeat;
        const quote = defeat === '…' ? '' : ` “${defeat}”`;
        showToast(`${event.boss} DEFEATED · +${event.points}${quote}`, 5200);
        break;
      }
      case 'level-complete':
        levelFinished = true;
        break;
      default:
        break;
    }
  }

  /** Level data for 1-based index, or undefined past the built campaign. */
  function campaignLevel(index: number) {
    return PLAYABLE_LEVELS.find((l) => l.index === index);
  }

  // ---- B1 continuous juice observers ---------------------------------------
  // Player state from the previous fixed step, used to detect jump/land
  // edges and newly fired projectiles (the session exposes no dedicated
  // hooks for those moments).
  let prevPlayerGrounded = true;
  let prevPlayerVy = 0;
  let prevProjectileCount = 0;
  let lastAimX = 1;
  let lastAimY = 0;

  const applyGameplayJuice = (): void => {
    if (!session) return;
    const p = session.player;

    const shotCount = session.activeProjectiles.length;
    if (shotCount > prevProjectileCount) {
      const len = Math.hypot(lastAimX, lastAimY) || 1;
      juice.shoot(
        p.centerX + (lastAimX / len) * 16,
        p.centerY + (lastAimY / len) * 16,
        Math.atan2(lastAimY, lastAimX),
      );
    }
    prevProjectileCount = shotCount;

    if (!prevPlayerGrounded && p.grounded) {
      const impact = Math.min(2, Math.abs(prevPlayerVy) / 700);
      juice.land(p.centerX, p.centerY + p.height / 2, impact);
    } else if (prevPlayerGrounded && !p.grounded && p.vy < 0) {
      juice.jump(p.centerX, p.centerY + p.height / 2);
    }
    prevPlayerGrounded = p.grounded;
    prevPlayerVy = p.vy;
  };

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
    if (aim) {
      lastAimX = aim.x;
      lastAimY = aim.y;
    } else if (moveX !== 0) {
      lastAimX = moveX;
      lastAimY = 0;
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

    // Advance to the next built slot, skipping unbuilt campaign levels
    // (4 and 6 until Fas 3) so the boss arenas are reachable today.
    const nextLevel = PLAYABLE_LEVELS.filter((l) => l.index > levelIndex).sort(
      (a, b) => a.index - b.index,
    )[0];
    if (nextLevel) {
      levelIndex = nextLevel.index;
      startLevel(levelIndex);
      showToast(`LEVEL ${levelIndex} — ${session.level.data.name}`, 2600);
    } else {
      state.transition(GameStateName.Win);
      audio.stopMusic();
      // Task B5: bank the speedrun total (fastest complete campaign run wins).
      const runSaveData = save.load();
      const isNewBestRun = save.recordRunTime(runSaveData, timer.totalElapsedMs);
      save.save(audio.captureVolumesInto(runSaveData));
      showToast(
        `ARCHIVE RESTORED — TOTAL ${runSaveData.totalScore}` +
          (isNewBestRun ? ' · NEW BEST RUN TIME!' : ''),
        6000,
      );
    }
  }

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    update(stepMs) {
      // Clocks only accumulate while PLAYING (timer guards internally).
      timer.advance(stepMs);

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
          applyGameplayJuice();
        }
      }

      // B1 envelopes decay in every state so flashes/shake settle gracefully
      // across pause/game-over transitions.
      juice.update(stepMs / 1000);

      input.endFrame();
    },

    render() {
      refreshLatches();

      // B1 screen shake rides the camera transform: everything world-space
      // (parallax pan + tiles/entities) shifts by the trauma noise; the DOM
      // HUD stays steady.
      const cameraX = session?.cameraX ?? 0;
      const panX = cameraX - juice.shake.offsetX;
      const offsetY = juice.shake.offsetY;

      renderer.beginFrame([0.03, 0.01, 0.09, 1]);
      parallax.draw(panX);

      if (session) {
        renderer.drawSprites('white', buildWorldSprites(renderer, session, panX, offsetY));
        drawBossOverlays(renderer, session, panX, offsetY);
        renderer.drawSprites('white', juice.particles.buildDraws());
        drawDarkness(renderer, session);
      }
      drawScreenFlash();
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
        timeText: timer.formatLevelTime(),
        totalTimeText: timer.formatTotalTime(),
        juiceLine: juice.statsLine(),
        boss: session?.getBossHud() ?? null,
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
    detachTimerSync();
    audio.dispose();
    hud.destroy();
  });

  loop.start();
  refreshLatches();
}

// ---------------------------------------------------------------------------
// World rendering: tiles + entities as batched neon sprites. `panX` is the
// (shake-modified) camera X; `offsetY` is the shake Y applied to every world
// sprite so vertical trauma moves the gameplay layer too.
// ---------------------------------------------------------------------------

function buildWorldSprites(
  renderer: WebGPURenderer,
  session: GameSession,
  panX: number,
  offsetY: number,
): SpriteDraw[] {
  const sprites: SpriteDraw[] = [];
  const level = session.level;
  const camY = session.cameraY + offsetY;
  const bounds = renderer.viewBounds;

  // --- tiles ---------------------------------------------------------------
  const worldLeft = panX + bounds.left;
  const worldRight = panX + bounds.right;
  const tx0 = Math.max(0, Math.floor(worldLeft / TILE_SIZE));
  const tx1 = Math.min(level.widthTiles - 1, Math.ceil(worldRight / TILE_SIZE));
  if (tx1 >= tx0) {
    for (let ty = 0; ty < level.heightTiles; ty++) {
      const y = Level.tileToWorldY(ty) - camY;
      if (y < bounds.top - TILE_SIZE || y > bounds.bottom) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = level.tileAt(tx, ty);
        if (tile === TileType.Empty) continue;
        const x = Level.tileToWorldX(tx) - panX;
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
      x: checkpoint.worldX + 10 - panX,
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
      x: exit.x - panX,
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
      x: pickup.position.x - panX,
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
      x: enemy.position.x - panX,
      y: enemy.position.y - camY,
      width: enemy.size.x,
      height: enemy.size.y,
      tint,
      glow: tint,
    });
  }

  // --- boss body ---------------------------------------------------------------
  const boss = session.boss;
  if (boss && boss.active) {
    const base = BOSS_COLORS_FALLBACK[boss.bossId] ?? ([1, 1, 1, 1] as Rgba);
    const box = boss.bodyBox();
    const flashing = boss.hitFlashMs > 0;
    const bodyTint: Rgba = flashing ? [1, 1, 1, 1] : base;
    sprites.push({
      x: box.x - 6 - panX,
      y: box.y - 6 - camY,
      width: box.width + 12,
      height: box.height + 12,
      tint: [bodyTint[0], bodyTint[1], bodyTint[2], 0.4],
      glow: [bodyTint[0], bodyTint[1], bodyTint[2], 2],
      blend: 'additive',
    });
    sprites.push({ x: box.x - panX, y: box.y - camY, width: box.width, height: box.height, tint: bodyTint });
    // Core eye.
    sprites.push({
      x: box.x + box.width / 2 - 7 - panX,
      y: box.y + box.height / 2 - 7 - camY,
      width: 14,
      height: 14,
      tint: PLAYER_CORE_COLOR,
      glow: [1, 1, 1, 2.2],
      blend: 'additive',
    });
    // VESSEL's defensive shell reads as a sealed bracket around the body.
    if (boss.shellClosed) {
      sprites.push({
        x: box.x - 14 - panX,
        y: box.y - 14 - camY,
        width: box.width + 28,
        height: box.height + 28,
        tint: [0.55, 1, 1, 0.85],
        glow: [0.55, 1, 1, 1.8],
        blend: 'additive',
      });
    }
    // Phase-transition tell: surging white aura.
    if (boss.tellGlowMs > 0) {
      const pulse = 0.35 + 0.3 * Math.sin(session.timeMs / 60);
      sprites.push({
        x: box.x - 22 - panX,
        y: box.y - 22 - camY,
        width: box.width + 44,
        height: box.height + 44,
        tint: [1, 1, 1, pulse],
        glow: [1, 0.9, 1, 2.5],
        blend: 'additive',
      });
    }
  }

  // --- player (blinks while invulnerable) ---------------------------------------
  const p = session.player;
  const blinkHidden =
    p.isInvulnerable && Math.floor(session.timeMs / 80) % 2 === 1;
  if (!blinkHidden) {
    sprites.push({
      x: p.x - 3 - panX,
      y: p.y - 3 - camY,
      width: p.width + 6,
      height: p.height + 6,
      tint: [PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 0.5],
      glow: [PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 1.6],
      blend: 'additive',
    });
    sprites.push({
      x: p.x - panX,
      y: p.y - camY,
      width: p.width,
      height: p.height,
      tint: PLAYER_COLOR,
    });
    sprites.push({
      x: p.centerX - 4 - panX,
      y: p.centerY - 4 - camY,
      width: 8,
      height: 8,
      tint: PLAYER_CORE_COLOR,
      glow: [1, 1, 1, 2],
      blend: 'additive',
    });
  }

  // --- projectiles ----------------------------------------------------------------
  const projectileSprites: SpriteDraw[] = session.activeProjectiles.map((shot: Projectile) => {
    if (shot.eraser) {
      // Absence shard: a hole in the world, faintly violet-edged.
      return {
        x: shot.position.x - 3 - panX,
        y: shot.position.y - 3 - camY,
        width: shot.size.x + 6,
        height: shot.size.y + 6,
        tint: [0.02, 0.005, 0.05, 1],
        glow: [0.5, 0.2, 0.9, 1.4],
      } satisfies SpriteDraw;
    }
    return {
      x: shot.position.x - panX,
      y: shot.position.y - camY,
      width: shot.size.x,
      height: shot.size.y,
      tint: shot.owner === 'player' ? PROJECTILE_PLAYER_COLOR : PROJECTILE_ENEMY_COLOR,
      glow: shot.owner === 'player' ? PROJECTILE_PLAYER_COLOR : PROJECTILE_ENEMY_COLOR,
      blend: 'additive',
    };
  });
  pushAll(sprites, projectileSprites);

  // --- particles --------------------------------------------------------------------
  const particleSprites: SpriteDraw[] = session.particles.active.map((particle: Particle) => ({
    x: particle.x - particle.sizePx / 2 - panX,
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
  target.push(...items);
}

// ---------------------------------------------------------------------------
// Boss overlays (task B2): laser beams, erasure voids and the darkness wave.
// Drawn after world sprites so beams/voids read on top of tiles and bodies.
// ---------------------------------------------------------------------------

const LASER_COLOR: Rgba = [1, 0.35, 0.75, 1];
const LASER_CORE: Rgba = [1, 0.95, 1, 1];
const VOID_FILL: Rgba = [0.012, 0.004, 0.03, 0.94];
const VOID_RIM: Rgba = [0.55, 0.25, 1, 0.5];

function drawBossOverlays(
  renderer: WebGPURenderer,
  session: GameSession,
  panX: number,
  offsetY: number,
): void {
  const boss = session.boss;
  if (!boss) return;
  const camY = session.cameraY + offsetY;

  // --- laser beams ---------------------------------------------------------
  const beamSprites: SpriteDraw[] = [];
  for (const beam of boss.lasersSnapshot as readonly LaserBeam[]) {
    const telegraph = laserTelegraphBox(beam);
    if (telegraph) {
      const blink = 0.4 + 0.4 * Math.abs(Math.sin(beam.remainingMs / 90));
      beamSprites.push({
        x: telegraph.x - panX,
        y: telegraph.y - camY,
        width: telegraph.width,
        height: telegraph.height,
        tint: [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], blink],
        glow: [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 1.6],
        blend: 'additive',
      });
      continue;
    }
    const box =
      beam.mode === 'firing'
        ? {
            x: beam.orientation === 'vertical' ? beam.position - beam.thickness / 2 : beam.spanMin,
            y: beam.orientation === 'vertical' ? beam.spanMin : beam.position - beam.thickness / 2,
            width: beam.orientation === 'vertical' ? beam.thickness : beam.spanMax - beam.spanMin,
            height: beam.orientation === 'vertical' ? beam.spanMax - beam.spanMin : beam.thickness,
          }
        : null;
    if (!box) continue;
    // Outer glow band + white-hot core line.
    beamSprites.push({
      x: box.x - 6 - panX,
      y: box.y - 6 - camY,
      width: box.width + 12,
      height: box.height + 12,
      tint: [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 0.55],
      glow: [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 2.4],
      blend: 'additive',
    });
    beamSprites.push({
      x: box.x - panX,
      y: box.y - camY,
      width: box.width,
      height: box.height,
      tint: LASER_CORE,
      glow: [1, 1, 1, 2],
      blend: 'additive',
    });
  }
  renderer.drawSprites('white', beamSprites);

  // --- NULL's void zones (dark quads with a faint violet rim) ---------------
  const voidSprites: SpriteDraw[] = [];
  for (const zone of boss.hazardCircles()) {
    const d = zone.radiusPx * 2;
    if (zone.radiusPx <= 1) continue;
    voidSprites.push(
      { x: zone.centerX - zone.radiusPx - 3 - panX, y: zone.centerY - zone.radiusPx - 3 - camY,
        width: d + 6, height: d + 6, tint: VOID_RIM },
      { x: zone.centerX - zone.radiusPx - panX, y: zone.centerY - zone.radiusPx - camY,
        width: d, height: d, tint: VOID_FILL },
    );
  }
  renderer.drawSprites('white', voidSprites);
}

/** Fullscreen darkening while NULL's darkness waves peak. */
function drawDarkness(renderer: WebGPURenderer, session: GameSession): void {
  const darkness = session.darknessLevel;
  if (darkness <= 0.01) return;
  const bounds = renderer.viewBounds;
  renderer.drawSprites('white', [
    {
      x: bounds.left,
      y: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
      tint: [0.01, 0, 0.04, Math.min(0.78, darkness * 0.72)],
    },
  ]);
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
