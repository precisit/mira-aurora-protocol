import { GameLoop } from './core/GameLoop';
import { GameStateMachine, GameStateName } from './core/GameState';
import { attachLevelTimer, LevelTimer } from './core/Timer';
import { sanitizeFpsCap } from './core/Perf';
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
import { copyRgba, setRgba, SpriteDrawPool } from './renderer/SpriteDrawPool';
import { DomHud } from './ui/Hud';
import { IntroSequence } from './ui/IntroSequence';
import { DomMenu, type MenuCommand } from './ui/Menu';
import { SaveStore } from './save/SaveStore';
import { newlyUnlockedWeapons } from './save/unlocks';
import { WEAPONS } from './game/weapons';
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
import type { Pickup } from './game/pickups';
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
 * On first boot the skippable B4 intro cinematic plays during BOOT before
 * MENU (once per page session; any key/tap skips straight to the menu and
 * the HUD stays hidden until gameplay begins).
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
// Glitch tiles (task C2): hot violet-white while solid, a faint residue when
// the corruption pulse leaves them "empty".
const TINT_GLITCH_SOLID: Rgba = [0.75, 0.4, 1.0, 1];
const TINT_GLITCH_EMPTY: Rgba = [0.55, 0.3, 0.9, 0.14];
// C3: the animated residue scanline reuses one shared tuple (alpha 0.35 over
// the solid hue) instead of allocating a fresh tint per tile per frame.
const GLITCH_RESIDUE_TINT: Rgba = [
  TINT_GLITCH_SOLID[0],
  TINT_GLITCH_SOLID[1],
  TINT_GLITCH_SOLID[2],
  0.35,
];
const GLOW_GLITCH: Rgba = [0.75, 0.45, 1.0, 1.6];
// Level laser grids (task C2) share the boss beam family but read colder.
const GRID_LASER_COLOR: Rgba = [1, 0.28, 0.42, 1];
const GRID_LASER_CORE: Rgba = [1, 0.93, 0.97, 1];

const PLAYER_COLOR: Rgba = [0.45, 0.95, 1, 1];
const PLAYER_CORE_COLOR: Rgba = [1, 1, 1, 1];
const PROJECTILE_PLAYER_COLOR: Rgba = [0.7, 1, 1, 1];
const PROJECTILE_ENEMY_COLOR: Rgba = [1, 0.4, 0.4, 1];

// Static glow/palette tuples shared as read-only sprite fields (C3: packing
// never mutates them, so one instance serves every frame).
const FLASH_WHITE: Rgba = [1, 1, 1, 1];
const WHITE_SPRITE_COLOR: Rgba = FLASH_WHITE;
const CHECKPOINT_ACTIVE_GLOW: Rgba = [1.0, 0.92, 0.35, 2.2];
const CHECKPOINT_INACTIVE_GLOW: Rgba = [1.0, 0.9, 0.3, 0.6];
const EXIT_GLOW: Rgba = [0.55, 1.0, 0.45, 2.4];
const CORE_EYE_GLOW: Rgba = [1, 1, 1, 2.2];
const SHELL_TINT: Rgba = [0.55, 1, 1, 0.85];
const SHELL_GLOW: Rgba = [0.55, 1, 1, 1.8];
const AURA_GLOW: Rgba = [1, 0.9, 1, 2.5];
const ERASER_FILL: Rgba = [0.02, 0.005, 0.05, 1];
const ERASER_RIM: Rgba = [0.5, 0.2, 0.9, 1.4];
const PLAYER_GLOW: Rgba = [PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 1.6];
const PLAYER_CORE_GLOW: Rgba = [1, 1, 1, 2];
/** Reusable slot for the boss halo glow (rgb follows the body hue). */
const bossHaloGlow: [number, number, number, number] = [1, 1, 1, 2];

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

  const save = new SaveStore();
  // B3: single live SaveData blob — total score banks at level end and the
  // unlock watcher below grants weapons the moment the (projected) total
  // crosses a threshold. Unlocks only ever get added, never revoked.
  let saveData = save.load();
  save.save(saveData);

  // C3 battery settings: persisted DPR cap (render at most N× CSS pixels).
  renderer.setMaxDevicePixelRatio(saveData.settings.dprCap);

  // ---- World / systems -----------------------------------------------------
  const parallax = new ParallaxBackground(renderer);
  await parallax.generate();

  const input = new InputManager();
  input.attach(window);
  const detachTouchUi = setupTouchControls(input);

  const audio = new AudioEngine();
  audio.applySettings(saveData.settings); // persisted volumes (SaveStore hook)
  const detachAudioUnlock = audio.initOnInteraction(window, () => {
    // First user interaction unlocks WebAudio; greet with the intro sting
    // while the cinematic is still running, otherwise the usual UI click.
    const inIntro = intro !== null && !intro.playback.finished;
    audio.playSfx(inIntro ? 'intro-sting' : 'ui-click');
  });
  const hud = new DomHud(document.getElementById('hud-root') ?? document.body);
  const hudRoot = document.getElementById('hud-root');
  const menuHost = document.getElementById('menu-root');
  const state = new GameStateMachine();
  // Task B5: level + total run clocks, kept in sync with the state machine
  // (MENU→PLAYING starts the run, PAUSED pauses, GAMEOVER restarts the level
  // clock while total keeps accumulating — speedrun rules per PLAN.md §4).
  const timer = new LevelTimer();
  const detachTimerSync = attachLevelTimer(state, timer);

  // ---- C1 meta layer: menus -------------------------------------------------
  // The DomMenu owns screens inside MENU/PAUSED (main list, weapon shop,
  // highscores, Archive, settings); commands come back here for execution.
  const menu = new DomMenu(menuHost ?? document.body, {
    onCommand: handleMenuCommand,
    hints: ['\u2191/\u2193 SELECT', 'ENTER CONFIRM', 'ESC BACK'],
  });

  // ---- B4 intro (skippable, once per page session) ------------------------
  let intro: IntroSequence | null = null;
  if (IntroSequence.shouldPlay()) {
    IntroSequence.markPlayed();
    intro = new IntroSequence(renderer, {
      parallax,
      onFinish: () => {
        input.endFrame(); // the skip keypress must not also start the game
        if (state.current === GameStateName.Boot) state.transition(GameStateName.Menu);
      },
    });
    intro.start();
    intro.attach(window); // any key / tap / click skips
    audio.playSfx('intro-sting'); // silent until audio unlocks; guarded
  } else {
    state.transition(GameStateName.Menu); // assets are ready → show menu
  }

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
  /** Highest total score (banked + in-run) we've already granted unlocks for. */
  let unlockWatermark = saveData.totalScore;
  /** Timestamp of the last drawn frame — drives the FPS lock (C1 settings). */
  let lastRenderAtMs = 0;

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
      unlockedWeapons: saveData.unlockedWeapons,
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
        case 'explosion':
          // Nova blast: heavy shake + flash + ember burst at the impact point.
          juice.explosion(event.x, event.y);
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

  // ---- B3 weapon unlock watcher ---------------------------------------------
  // Total score = banked save total + current attempt score. The moment the
  // projected total crosses a threshold the weapon is granted, persisted and
  // toasted. `unlockWatermark` keeps this monotonic: attempt-score resets
  // (pre-checkpoint deaths) can never re-grant or revoke anything.
  function checkWeaponUnlocks(totalScore: number): void {
    if (totalScore <= unlockWatermark) return;
    const fresh = newlyUnlockedWeapons(unlockWatermark, totalScore);
    unlockWatermark = Math.max(unlockWatermark, totalScore);
    if (!fresh.length) return;

    for (const weaponId of fresh) {
      save.unlockWeapon(saveData, weaponId);
      showToast(`NEW WEAPON: ${WEAPONS[weaponId as keyof typeof WEAPONS].name}`, 3400);
      audio.playSfx('checkpoint');
      juice.bloom.pulse(0.55);
    }
    save.save(audio.captureVolumesInto(saveData));
    session?.setUnlockedWeapons(saveData.unlockedWeapons);
  }

  /** Level data for 1-based index, or undefined past the built campaign. */
  function campaignLevel(index: number) {
    return PLAYABLE_LEVELS.find((l) => l.index === index);
  }

  // ---- C1 menu command execution --------------------------------------------
  // The menu layer proposes; the host disposes: state transitions stay here so
  // the meta layer never touches the simulation directly.
  function handleMenuCommand(command: MenuCommand): void {
    switch (command.kind) {
      case 'nav': {
        switch (command.action) {
          case 'start-game':
            levelIndex = 1;
            carriedDoubleJump = false;
            startLevel(levelIndex);
            state.transition(GameStateName.Playing);
            audio.playSfx('checkpoint');
            break;
          case 'resume':
            state.transition(GameStateName.Playing);
            audio.resumeMusic();
            break;
          case 'restart-level':
            startLevel(levelIndex); // fresh attempt, 3 lives, score zeroed
            state.transition(GameStateName.Playing);
            audio.playSfx('checkpoint');
            break;
          case 'quit-to-menu':
            levelFinished = false;
            session = null; // drop the frozen run; parallax stays as backdrop
            audio.stopMusic();
            state.transition(GameStateName.Menu);
            break;
          default:
            // Sub-screen navigation (opens/back) — audible confirmation only.
            audio.playSfx('ui-click');
            break;
        }
        break;
      }
      case 'setting-volume': {
        const current = saveData.settings[command.channel];
        const stepped = Math.round((current + command.delta) * 10) / 10;
        saveData.settings[command.channel] = Math.min(1, Math.max(0, stepped));
        audio.applySettings(saveData.settings);
        save.save(audio.captureVolumesInto(saveData));
        break;
      }
      case 'toggle-fps-cap':
        // Battery saver toggle (PLAN.md §6): uncapped ⇄ 60 FPS rendering.
        // One persisted field drives BOTH render-skip paths: the C3 loop's
        // drift-corrected present lock and the per-render guard below.
        saveData.settings.fpsCap = saveData.settings.fpsCap === null ? 60 : null;
        save.save(audio.captureVolumesInto(saveData));
        loop.setFpsCap(sanitizeFpsCap(saveData.settings.fpsCap));
        break;
    }
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

    const shotCount = session.projectileCount;
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
  // Refreshed at the top of every update step (not per render) so presses are
  // never dropped when the FPS lock skips render frames (C1 settings).
  const latches: FrameLatches = { jump: false, pause: false, confirm: false, swap: false };

  // C3: DOM HUD refresh throttle (~10 Hz).
  const HUD_INTERVAL_MS = 100;
  let hudCooldownMs = HUD_INTERVAL_MS;
  let hudPrimed = false;
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
    saveData = save.load();
    save.recordLevelResult(saveData, data.id, session.score.score, session.timeMs);
    // Bank the attempt into total score; any threshold crossed here is
    // granted + toasted by the same watcher used mid-run.
    checkWeaponUnlocks(saveData.totalScore);
    unlockWatermark = Math.max(unlockWatermark, saveData.totalScore);
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
      const isNewBestRun = save.recordRunTime(saveData, timer.totalElapsedMs);
      save.save(audio.captureVolumesInto(saveData));
      showToast(
        `ARCHIVE RESTORED — TOTAL ${saveData.totalScore}` +
          (isNewBestRun ? ' · NEW BEST RUN TIME!' : ''),
        6000,
      );
    }
  }

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    // C3 battery option from the persisted settings (null = uncapped);
    // simulation keeps its fixed 120 Hz cadence regardless.
    fpsCap: sanitizeFpsCap(saveData.settings.fpsCap),

    // C3 telemetry: long frames (>50 ms) log once per stall episode.
    onLongFrame: (frameDeltaMs) => {
      console.warn(`[perf] long frame: ${frameDeltaMs.toFixed(1)} ms`);
    },

    update(stepMs) {
      refreshLatches();

      // Intro owns BOOT: advance it, and swallow the frame that ends it so a
      // skip keypress never leaks into the menu's "press SPACE to start".
      if (intro && state.current === GameStateName.Boot) {
        intro.update(stepMs / 1000);
        if (intro.playback.finished) {
          input.endFrame();
          return;
        }
      }

      // Clocks only accumulate while PLAYING (timer guards internally).
      timer.advance(stepMs);

      // ---- state machine (edge-latched so multi-step frames can't toggle) --
      switch (state.current) {
        case GameStateName.Menu:
        case GameStateName.Paused: {
          // C1: the menu layer owns input in both states (main list and pause
          // overlay share navigation; PAUSED's root treats Esc/P as resume).
          // Menu actions read edge-triggered presses directly — they are
          // consumed within this same step (endFrame clears them below).
          if (input.wasPressed(InputAction.MenuUp)) menu.model.move(-1);
          if (input.wasPressed(InputAction.MenuDown)) menu.model.move(1);
          const leftPressed = input.wasPressed(InputAction.Left);
          const rightPressed = input.wasPressed(InputAction.Right);
          if (leftPressed || rightPressed) {
            menu.dispatch(menu.model.adjustSelected(leftPressed ? -1 : 1));
          }
          const backRequested = input.wasPressed(InputAction.MenuBack);
          const pauseRequested = takeLatch('pause');
          if (backRequested || pauseRequested) {
            // Esc/P/Backspace: pop a sub-screen if one is open; at a root
            // screen it leaves the menu layer (MENU stays, PAUSED resumes).
            if (!menu.handleBack() && state.current === GameStateName.Paused) {
              state.transition(GameStateName.Playing);
              audio.resumeMusic();
            }
            break;
          }
          if (takeLatch('confirm') || takeLatch('jump')) {
            menu.dispatch(menu.model.activate());
          }
          break;
        }

        case GameStateName.GameOver:
          if (takeLatch('confirm') || takeLatch('jump')) {
            startLevel(levelIndex); // fresh attempt, 3 lives, score zeroed
            state.transition(GameStateName.Playing);
          }
          break;

        case GameStateName.Win:
          if (takeLatch('confirm') || takeLatch('jump')) {
            session = null;
            levelFinished = false;
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
            // B3: cycle unlocked weapons only; the session plays the
            // weapon-switch sfx when a swap actually happened.
            const swapped = session?.cycleWeapon(1) ?? false;
            showToast(
              swapped && session
                ? `${session.weapon.name} — ${session.weapon.blurb}`
                : 'MORE WEAPONS UNLOCK VIA TOTAL SCORE',
            );
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
          // B3: mid-run unlock check (banked total + live attempt score).
          checkWeaponUnlocks(saveData.totalScore + session.score.score);
        }
      }

      // B1 envelopes decay in every state so flashes/shake settle gracefully
      // across pause/game-over transitions.
      juice.update(stepMs / 1000);

      input.endFrame();
    },
    render(_alpha, frameDeltaMs) {
      // C1 FPS lock (settings): when capped, skip drawing whole frames — the
      // canvas keeps the last image while the 120 Hz simulation above keeps
      // running. Latches are refreshed per update step (not per render), so
      // skipped frames never drop input; the same persisted field also drives
      // the loop's own drift-corrected present lock (C3).
      const fpsCap = saveData.settings.fpsCap;
      if (fpsCap !== null && fpsCap > 0) {
        const now = performance.now();
        const minFrameMs = 1000 / fpsCap - 1.5; // small slack for rAF jitter
        if (now - lastRenderAtMs < minFrameMs) return;
        lastRenderAtMs = now;
      }

      // B4 intro owns BOOT: draw the cinematic over black and keep the HUD
      // hidden until the menu/gameplay UI takes over.
      const introActive = state.current === GameStateName.Boot && intro !== null;
      if (introActive) {
        renderer.beginFrame([0, 0, 0, 1]);
        (intro as IntroSequence).render();
        renderer.endFrame();
        menu.hide();
        if (hudRoot) hudRoot.style.display = 'none';
        return;
      }

      // C1 meta layer visibility: main menu over MENU, pause overlay during
      // PAUSED, nothing during gameplay/win/game-over.
      if (state.current === GameStateName.Menu || state.current === GameStateName.Paused) {
        menu.setMode(state.current === GameStateName.Menu ? 'main' : 'pause');
        menu.show();
        menu.sync(saveData);
      } else {
        menu.hide();
      }

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
        // Gameplay particles reuse their pooled draw list (C3); drawn after
        // world sprites and before the boss overlays so beams/voids stay on
        // top, matching previous order on both branches.
        renderer.drawSprites('white', session.particles.buildDraws());
        drawLevelLaserGrids(renderer, session, panX, offsetY);
        drawBossOverlays(renderer, session, panX, offsetY);
        renderer.drawSprites('white', juice.particles.buildDraws());
        drawDarkness(renderer, session);
      }
      drawScreenFlash();
      renderer.endFrame();

      if (hudRoot) hudRoot.style.display = '';
      // C3: throttle DOM HUD writes to ~10 Hz — JSON diffing every frame at
      // 120 Hz costs real time and churns strings for no visual gain.
      hudCooldownMs += frameDeltaMs;
      if (hudCooldownMs >= HUD_INTERVAL_MS || !hudPrimed) {
        hudCooldownMs = 0;
        hudPrimed = true;
        hud.update({
          gameStateName: state.current,
          levelName: session?.level.data.name ?? '—',
          fps: loop.fps,
          cameraX,
          message: currentMessage(),
          score: session?.score.score,
          lives: session?.lives,
          weapon: session?.weapon.name,
          comboMultiplier: session?.score.multiplier,
          timeSeconds: session ? session.timeMs / 1000 : undefined,
          timeText: timer.formatLevelTime(),
          totalTimeText: timer.formatTotalTime(),
          juiceLine: juice.statsLine(),
          boss: session?.getBossHud() ?? null,
        });
      }
    },
  });

  // C3: graceful GPU context loss mid-session — stop the loop and show a
  // clear reload message instead of throwing in the render loop.
  renderer.onDeviceLost = () => {
    loop.stop();
    canvas.classList.add('hidden');
    WebGPURenderer.showContextLostMessage(fallbackHost ?? document.body);
  };

  function currentMessage(): string | null {
    const now = performance.now();
    if (toast && toast.expiresAtMs < now) toast = null;

    switch (state.current) {
      case GameStateName.Menu:
      case GameStateName.Paused:
        // C1: menus carry their own hints; the HUD message line stays quiet.
        return null;
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
    intro?.dispose();
    menu.destroy();
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
//
// C3: every quad comes from a module-level SpriteDrawPool — records, tint
// tuples and the draw arrays are reused across frames, so the render path
// performs zero per-frame allocations after warmup. Draw order (painter's
// algorithm) matches the previous literal-building implementation exactly.
// ---------------------------------------------------------------------------

const worldPool = new SpriteDrawPool(2048);

function buildWorldSprites(
  renderer: WebGPURenderer,
  session: GameSession,
  panX: number,
  offsetY: number,
): readonly SpriteDraw[] {
  const pool = worldPool;
  pool.reset();
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
          case TileType.Solid: {
            const solid = pool.next();
            solid.x = x;
            solid.y = y;
            solid.width = TILE_SIZE;
            solid.height = TILE_SIZE;
            copyRgba(solid.tint, (tx + ty) % 2 === 0 ? TINT_SOLID_A : TINT_SOLID_B);
            break;
          }
          case TileType.Platform: {
            const platform = pool.next();
            platform.x = x;
            platform.y = y;
            platform.width = TILE_SIZE;
            platform.height = 10;
            copyRgba(platform.tint, TINT_PLATFORM);
            break;
          }
          case TileType.Hazard: {
            const hazard = pool.next();
            hazard.x = x;
            hazard.y = y + 6;
            hazard.width = TILE_SIZE;
            hazard.height = TILE_SIZE - 12;
            copyRgba(hazard.tint, TINT_HAZARD);
            hazard.glow = GLOW_HAZARD;
            break;
          }
          case TileType.Glitch: {
            // Corruption pulse: solid tiles burn violet; empty ones leave a
            // faint residue so the bridge can be read in advance. (C2 visual,
            // C3 pooled records — no per-frame allocations.)
            const glitchSolid = level.glitchTilesSolid;
            const glitchQuad = pool.next();
            glitchQuad.x = x;
            glitchQuad.y = y + (glitchSolid ? 0 : 10);
            glitchQuad.width = TILE_SIZE;
            glitchQuad.height = glitchSolid ? TILE_SIZE : 8;
            copyRgba(glitchQuad.tint, glitchSolid ? TINT_GLITCH_SOLID : TINT_GLITCH_EMPTY);
            if (glitchSolid) {
              glitchQuad.glow = GLOW_GLITCH;
              glitchQuad.blend = 'additive';
            } else {
              const residue = pool.next();
              residue.x = x + 4;
              residue.y = y + 12 + (Math.floor(session.timeMs / 90) % 6);
              residue.width = TILE_SIZE - 8;
              residue.height = 2;
              copyRgba(residue.tint, GLITCH_RESIDUE_TINT);
              residue.blend = 'additive';
            }
            break;
          }
        }
      }
    }
  }

  // --- checkpoints & exit ---------------------------------------------------
  for (const checkpoint of session.checkpoints) {
    const marker = pool.next();
    marker.x = checkpoint.worldX + 10 - panX;
    marker.y = checkpoint.worldY - 32 - camY;
    marker.width = 12;
    marker.height = 64;
    copyRgba(marker.tint, checkpoint.activated ? CHECKPOINT_ACTIVE : CHECKPOINT_INACTIVE);
    marker.glow = checkpoint.activated ? CHECKPOINT_ACTIVE_GLOW : CHECKPOINT_INACTIVE_GLOW;
    marker.blend = 'additive';
  }
  const exit = session.exitBoxOrNull;
  if (exit) {
    const exitQuad = pool.next();
    exitQuad.x = exit.x - panX;
    exitQuad.y = exit.y - camY;
    exitQuad.width = exit.width;
    exitQuad.height = exit.height;
    copyRgba(exitQuad.tint, EXIT_COLOR);
    exitQuad.glow = EXIT_GLOW;
    exitQuad.blend = 'additive';
  }

  // --- pickups ---------------------------------------------------------------
  for (const pickup of session.pickupsView) {
    if (!pickup.active) continue;
    const color = pickupColor(pickup);
    const quad = pool.next();
    quad.x = pickup.position.x - panX;
    quad.y = pickup.position.y - camY;
    quad.width = pickup.size.x;
    quad.height = pickup.size.y;
    copyRgba(quad.tint, color);
    quad.glow = color;
    quad.blend = 'additive';
  }

  // --- enemies -----------------------------------------------------------------
  for (const enemy of session.enemiesView) {
    if (!enemy.active) continue;
    const base = ENEMY_COLORS_FALLBACK[enemy.kind as EnemyTypeName] ?? WHITE_SPRITE_COLOR;
    const quad = pool.next();
    quad.x = enemy.position.x - panX;
    quad.y = enemy.position.y - camY;
    quad.width = enemy.size.x;
    quad.height = enemy.size.y;
    // Hit-flash reads as a white pop; otherwise glow shares the body color.
    if (enemy.hitFlashMs > 0) {
      copyRgba(quad.tint, FLASH_WHITE);
      quad.glow = FLASH_WHITE;
    } else {
      copyRgba(quad.tint, base);
      quad.glow = quad.tint;
    }
  }

  // --- boss body ---------------------------------------------------------------
  const boss = session.boss;
  if (boss && boss.active) {
    const base = BOSS_COLORS_FALLBACK[boss.bossId] ?? WHITE_SPRITE_COLOR;
    const box = boss.bodyBox();
    const flashing = boss.hitFlashMs > 0;

    const halo = pool.next();
    halo.x = box.x - 6 - panX;
    halo.y = box.y - 6 - camY;
    halo.width = box.width + 12;
    halo.height = box.height + 12;
    setRgba(halo.tint, base[0], base[1], base[2], 0.4);
    // Glow shares the body hue with boosted strength (single reusable slot).
    halo.glow = setRgba(bossHaloGlow, base[0], base[1], base[2], 2);
    halo.blend = 'additive';

    const body = pool.next();
    body.x = box.x - panX;
    body.y = box.y - camY;
    body.width = box.width;
    body.height = box.height;
    copyRgba(body.tint, flashing ? FLASH_WHITE : base);

    const eye = pool.next();
    eye.x = box.x + box.width / 2 - 7 - panX;
    eye.y = box.y + box.height / 2 - 7 - camY;
    eye.width = 14;
    eye.height = 14;
    copyRgba(eye.tint, PLAYER_CORE_COLOR);
    eye.glow = CORE_EYE_GLOW;
    eye.blend = 'additive';

    // VESSEL's defensive shell reads as a sealed bracket around the body.
    if (boss.shellClosed) {
      const shell = pool.next();
      shell.x = box.x - 14 - panX;
      shell.y = box.y - 14 - camY;
      shell.width = box.width + 28;
      shell.height = box.height + 28;
      copyRgba(shell.tint, SHELL_TINT);
      shell.glow = SHELL_GLOW;
      shell.blend = 'additive';
    }
    // Phase-transition tell: surging white aura.
    if (boss.tellGlowMs > 0) {
      const pulse = 0.35 + 0.3 * Math.sin(session.timeMs / 60);
      const aura = pool.next();
      aura.x = box.x - 22 - panX;
      aura.y = box.y - 22 - camY;
      aura.width = box.width + 44;
      aura.height = box.height + 44;
      setRgba(aura.tint, 1, 1, 1, pulse);
      aura.glow = AURA_GLOW;
      aura.blend = 'additive';
    }
  }

  // --- player (blinks while invulnerable) ---------------------------------------
  const p = session.player;
  const blinkHidden =
    p.isInvulnerable && Math.floor(session.timeMs / 80) % 2 === 1;
  if (!blinkHidden) {
    const thruster = pool.next();
    thruster.x = p.x - 3 - panX;
    thruster.y = p.y - 3 - camY;
    thruster.width = p.width + 6;
    thruster.height = p.height + 6;
    setRgba(thruster.tint, PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2], 0.5);
    thruster.glow = PLAYER_GLOW;
    thruster.blend = 'additive';

    const body = pool.next();
    body.x = p.x - panX;
    body.y = p.y - camY;
    body.width = p.width;
    body.height = p.height;
    copyRgba(body.tint, PLAYER_COLOR);

    const core = pool.next();
    core.x = p.centerX - 4 - panX;
    core.y = p.centerY - 4 - camY;
    core.width = 8;
    core.height = 8;
    copyRgba(core.tint, PLAYER_CORE_COLOR);
    core.glow = PLAYER_CORE_GLOW;
    core.blend = 'additive';
  }

  // --- projectiles ----------------------------------------------------------------
  for (const shot of session.projectilesView) {
    if (!shot.active) continue;
    const quad = pool.next();
    if (shot.eraser) {
      // Absence shard: a hole in the world, faintly violet-edged.
      quad.x = shot.position.x - 3 - panX;
      quad.y = shot.position.y - 3 - camY;
      quad.width = shot.size.x + 6;
      quad.height = shot.size.y + 6;
      copyRgba(quad.tint, ERASER_FILL);
      quad.glow = ERASER_RIM;
    } else {
      quad.x = shot.position.x - panX;
      quad.y = shot.position.y - camY;
      quad.width = shot.size.x;
      quad.height = shot.size.y;
      const color = shot.owner === 'player' ? PROJECTILE_PLAYER_COLOR : PROJECTILE_ENEMY_COLOR;
      copyRgba(quad.tint, color);
      quad.glow = color;
      quad.blend = 'additive';
    }
  }

  // --- particles --------------------------------------------------------------------
  // Game-session particles reuse their own preallocated draw list (C3); the
  // juice system's list is drawn separately by the caller, same as before.
  return pool.view();
}

// ---------------------------------------------------------------------------
// Boss overlays (task B2): laser beams, erasure voids and the darkness wave.
// Drawn after world sprites so beams/voids read on top of tiles and bodies.
// ---------------------------------------------------------------------------

const LASER_COLOR: Rgba = [1, 0.35, 0.75, 1];
const LASER_CORE: Rgba = [1, 0.95, 1, 1];
const VOID_FILL: Rgba = [0.012, 0.004, 0.03, 0.94];
const VOID_RIM: Rgba = [0.55, 0.25, 1, 0.5];
const LASER_TELEGRAPH_GLOW: Rgba = [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 1.6];
const LASER_BAND_GLOW: Rgba = [LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 2.4];
const LASER_CORE_GLOW: Rgba = [1, 1, 1, 2];

// C3: pooled overlay quads — no per-frame array/object churn here either.
const beamPool = new SpriteDrawPool(64);
const voidPool = new SpriteDrawPool(64);
const overlayQuadPool = new SpriteDrawPool(4);

// C2 level laser grids share the pooled treatment (C3): static glow tuples,
// reusable records, one stable draw array.
const gridLaserPool = new SpriteDrawPool(128);
const GRID_LASER_TELEGRAPH_GLOW: Rgba = [
  GRID_LASER_COLOR[0],
  GRID_LASER_COLOR[1],
  GRID_LASER_COLOR[2],
  1.5,
];
const GRID_LASER_BAND_GLOW: Rgba = [
  GRID_LASER_COLOR[0],
  GRID_LASER_COLOR[1],
  GRID_LASER_COLOR[2],
  2.4,
];
const GRID_LASER_CORE_GLOW: Rgba = [1, 1, 1, 2];

/**
 * Level laser grids (task C2): blinking telegraph lines, then a glowing
 * beam with a white-hot core while the pulse fires.
 */
function drawLevelLaserGrids(
  renderer: WebGPURenderer,
  session: GameSession,
  panX: number,
  offsetY: number,
): void {
  const camY = session.cameraY + offsetY;
  const draws = gridLaserPool;
  draws.reset();

  for (const line of session.telegraphLaserBoxes()) {
    const blink = 0.35 + 0.45 * Math.abs(Math.sin(session.timeMs / 80));
    const quad = draws.next();
    quad.x = line.x - panX;
    quad.y = line.y - camY;
    quad.width = line.width;
    quad.height = line.height;
    setRgba(quad.tint, GRID_LASER_COLOR[0], GRID_LASER_COLOR[1], GRID_LASER_COLOR[2], blink);
    quad.glow = GRID_LASER_TELEGRAPH_GLOW;
    quad.blend = 'additive';
  }

  for (const box of session.firingLaserBoxes()) {
    // Outer glow band + white-hot core line.
    const band = draws.next();
    band.x = box.x - 6 - panX;
    band.y = box.y - 6 - camY;
    band.width = box.width + 12;
    band.height = box.height + 12;
    setRgba(band.tint, GRID_LASER_COLOR[0], GRID_LASER_COLOR[1], GRID_LASER_COLOR[2], 0.55);
    band.glow = GRID_LASER_BAND_GLOW;
    band.blend = 'additive';

    const core = draws.next();
    core.x = box.x - panX;
    core.y = box.y - camY;
    core.width = box.width;
    core.height = box.height;
    copyRgba(core.tint, GRID_LASER_CORE);
    core.glow = GRID_LASER_CORE_GLOW;
    core.blend = 'additive';
  }

  if (draws.length > 0) renderer.drawSprites('white', draws.view());
}

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
  const beams = beamPool;
  beams.reset();
  for (const beam of boss.lasersSnapshot as readonly LaserBeam[]) {
    const telegraph = laserTelegraphBox(beam);
    if (telegraph) {
      const blink = 0.4 + 0.4 * Math.abs(Math.sin(beam.remainingMs / 90));
      const quad = beams.next();
      quad.x = telegraph.x - panX;
      quad.y = telegraph.y - camY;
      quad.width = telegraph.width;
      quad.height = telegraph.height;
      setRgba(quad.tint, LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], blink);
      quad.glow = LASER_TELEGRAPH_GLOW;
      quad.blend = 'additive';
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
    const band = beams.next();
    band.x = box.x - 6 - panX;
    band.y = box.y - 6 - camY;
    band.width = box.width + 12;
    band.height = box.height + 12;
    setRgba(band.tint, LASER_COLOR[0], LASER_COLOR[1], LASER_COLOR[2], 0.55);
    band.glow = LASER_BAND_GLOW;
    band.blend = 'additive';

    const core = beams.next();
    core.x = box.x - panX;
    core.y = box.y - camY;
    core.width = box.width;
    core.height = box.height;
    copyRgba(core.tint, LASER_CORE);
    core.glow = LASER_CORE_GLOW;
    core.blend = 'additive';
  }
  renderer.drawSprites('white', beams.view());

  // --- NULL's void zones (dark quads with a faint violet rim) ---------------
  const voids = voidPool;
  voids.reset();
  for (const zone of boss.hazardCircles()) {
    const d = zone.radiusPx * 2;
    if (zone.radiusPx <= 1) continue;
    const rim = voids.next();
    rim.x = zone.centerX - zone.radiusPx - 3 - panX;
    rim.y = zone.centerY - zone.radiusPx - 3 - camY;
    rim.width = d + 6;
    rim.height = d + 6;
    copyRgba(rim.tint, VOID_RIM);

    const fill = voids.next();
    fill.x = zone.centerX - zone.radiusPx - panX;
    fill.y = zone.centerY - zone.radiusPx - camY;
    fill.width = d;
    fill.height = d;
    copyRgba(fill.tint, VOID_FILL);
  }
  renderer.drawSprites('white', voids.view());
}

/** Fullscreen darkening while NULL's darkness waves peak. */
function drawDarkness(renderer: WebGPURenderer, session: GameSession): void {
  const darkness = session.darknessLevel;
  if (darkness <= 0.01) return;
  const bounds = renderer.viewBounds;
  const quad = overlayQuadPool.next();
  quad.x = bounds.left;
  quad.y = bounds.top;
  quad.width = bounds.right - bounds.left;
  quad.height = bounds.bottom - bounds.top;
  setRgba(quad.tint, 0.01, 0, 0.04, Math.min(0.78, darkness * 0.72));
  renderer.drawSprites('white', overlayQuadPool.view());
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
      <button class="touch-btn" data-action="swap" aria-label="Swap weapon">WPN</button>
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
              : action === 'swap'
                ? InputAction.SwapWeapon
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
