import { GameLoop } from './core/GameLoop';
import { GameStateMachine, GameStateName } from './core/GameState';
import { attachLevelTimer, LevelTimer } from './core/Timer';
import { AudioEngine } from './audio/AudioEngine';
import { JuiceSystem } from './effects/JuiceSystem';
import { InputAction, InputManager } from './input/InputManager';
import { getLevel } from './levels/levels';
import { Level } from './levels/Level';
import { TILE_SIZE, TileType } from './levels/LevelData';
import { ParallaxBackground } from './renderer/ParallaxBackground';
import {
  VIRTUAL_WIDTH,
  WebGPURenderer,
  type Rgba,
  type SpriteDraw,
} from './renderer/WebGPURenderer';
import { DomHud } from './ui/Hud';
import { SaveStore } from './save/SaveStore';
import './style.css';

/**
 * Aurora Protocol — Fas 0 bootstrap.
 *
 * Boots the WebGPU renderer, generates the five parallax layers, loads
 * level 1 ("Mnemosynes fall") and starts a fixed-timestep loop that slowly
 * pans the camera across it. Background + tiles are visible; the player entity arrives in
 * wave A. State machine: BOOT → MENU → (Space) PLAYING ⇄ PAUSED.
 *
 * B1 juice demo (PLAN.md §4 "Juice & effekter"): a floating test-droid
 * exercises the effects API — SPACE jumps (stretch + puffs), J shoots
 * (muzzle flash), K detonates an explosion preset, ←/→ pump screen shake
 * manually. Everything routes through {@link JuiceSystem}, the same API the
 * real player/enemies will consume.
 */

/** Demo camera pan speed in world px/s. */
const CAMERA_SPEED_PX_PER_S = 140;

/** Demo droid physics (simple bounce rig to exercise jump/land juice). */
const DROID_GRAVITY_PX_PER_S2 = 2400;
const DROID_JUMP_VELOCITY_PX_PER_S = -680;
const DROID_HALF_SIZE = 14;

// Neon tile palette for the test level (tints over the white 1×1 texture).
const TINT_SOLID_A: Rgba = [0.16, 0.9, 1.0, 1];
const TINT_SOLID_B: Rgba = [0.1, 0.62, 0.95, 1];
const TINT_PLATFORM: Rgba = [1.0, 0.35, 0.85, 1];
const TINT_HAZARD: Rgba = [1.0, 0.45, 0.15, 1];
const GLOW_HAZARD: Rgba = [1.0, 0.45, 0.15, 1.4];
const TINT_MARKER_CHECKPOINT: Rgba = [1.0, 0.9, 0.3, 0.9];
const GLOW_MARKER_CHECKPOINT: Rgba = [1.0, 0.92, 0.35, 2.2];
const TINT_MARKER_GOAL: Rgba = [0.55, 1.0, 0.45, 0.95];
const GLOW_MARKER_GOAL: Rgba = [0.55, 1.0, 0.45, 2.6];
const TINT_MARKER_PICKUP: Rgba = [1.0, 0.4, 0.9, 0.8];
const GLOW_MARKER_PICKUP: Rgba = [1.0, 0.4, 0.9, 2.4];

/** World-Y the demo droid hovers at (its "ground" for landing juice). */
const DROID_HOVER_Y = 560;

/** Tint of the juice test-droid quad (warm AURORA core). */
const TINT_DROID: Rgba = [1.0, 0.75, 0.35, 1];
const GLOW_DROID: Rgba = [1.0, 0.7, 0.3, 2.2];

interface DemoState {
  cameraX: number;
  cameraDir: 1 | -1;
  /** Juice test-droid (world px). Hovers at screen center; bounces on demand. */
  droidX: number;
  droidY: number;
  droidVY: number;
  droidGrounded: boolean;
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

  const level = new Level(getLevel(1));
  const input = new InputManager();
  input.attach(window);
  const save = new SaveStore();
  const audio = new AudioEngine();
  audio.applySettings(save.load().settings); // persisted volumes (SaveStore hook)
  const detachAudioUnlock = audio.initOnInteraction(window, () => audio.playSfx('ui-click'));
   const hud = new DomHud(document.getElementById('hud-root') ?? document.body);
  const state = new GameStateMachine();
  // Task B5: level + total run clocks, kept in sync with the state machine
  // (MENU→PLAYING starts the run, PAUSED pauses, GAMEOVER restarts the level
  // clock while total keeps accumulating — speedrun rules per PLAN.md §4).
  const timer = new LevelTimer();
  const detachTimerSync = attachLevelTimer(state, timer);
  state.transition(GameStateName.Menu); // assets are ready → show menu

  // ---- B1 juice -------------------------------------------------------------
  const juice = new JuiceSystem({
    setBloom: (patch) => renderer.setBloomOptions(patch),
  });
  console.info(
    '[juice] demo controls: SPACE/W jump · J/X shoot · K/C explosion · ←/→ screen shake · P pause',
  );

  const demo: DemoState = {
    cameraX: 0,
    cameraDir: 1,
    droidX: VIRTUAL_WIDTH / 2,
    droidY: DROID_HOVER_Y,
    droidVY: 0,
    droidGrounded: true,
  };

  /**
   * Build sprite list for tiles currently visible through the virtual view.
   * `panX` is the (shake-modified) camera X; `offsetY` is the shake Y applied
   * to every world sprite so vertical trauma moves the gameplay layer too.
   */
  const buildTileSprites = (panX: number, offsetY: number): SpriteDraw[] => {
    const sprites: SpriteDraw[] = [];
    const bounds = renderer.viewBounds;

    // Camera maps world→view by simple translation: viewX = worldX - panX.
    const worldLeft = panX + bounds.left;
    const worldRight = panX + bounds.right;

    const tx0 = Math.max(0, Math.floor(worldLeft / TILE_SIZE));
    const tx1 = Math.min(level.widthTiles - 1, Math.ceil(worldRight / TILE_SIZE));
    if (tx1 < tx0) return sprites;

    for (let ty = 0; ty < level.heightTiles; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = level.tileAt(tx, ty);
        if (tile === TileType.Empty) continue;

        const x = Level.tileToWorldX(tx) - panX;
        const y = Level.tileToWorldY(ty) + offsetY;

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
          case TileType.Platform: // thin one-way platform slab
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

    // Spawn-layer entities as additive glowing markers so the data is visible
    // in-demo (exercises the neon-glow sprite path from the A1 wave).
    for (const spawn of level.data.spawns) {
      if (spawn.kind === 'playerSpawn') continue;
      const isCheckpoint = spawn.kind === 'checkpoint';
      const isExit = spawn.kind === 'exit';
      const height = TILE_SIZE * 2;
      sprites.push({
        x: Level.tileToWorldX(spawn.tx) + 10 - panX,
        y: Level.tileToWorldY(spawn.ty + 1) - height + offsetY,
        width: 12,
        height,
        tint: isCheckpoint
          ? TINT_MARKER_CHECKPOINT
          : isExit
            ? TINT_MARKER_GOAL
            : TINT_MARKER_PICKUP,
        glow: isCheckpoint
          ? GLOW_MARKER_CHECKPOINT
          : isExit
            ? GLOW_MARKER_GOAL
            : GLOW_MARKER_PICKUP,
        blend: 'additive',
      });
    }

    return sprites;
  };

  /**
   * The B1 test-droid: a glowing quad deformed by the shared squash &
   * stretch spring, so S&S is visible without the real player entity.
   */
  const buildDroidSprite = (panX: number, offsetY: number): SpriteDraw => {
    const size = DROID_HALF_SIZE * 2;
    return {
      x: demo.droidX - panX - (size * juice.playerSquash.scaleX) / 2,
      y: demo.droidY + offsetY - (size * juice.playerSquash.scaleY) / 2,
      width: size * juice.playerSquash.scaleX,
      height: size * juice.playerSquash.scaleY,
      tint: TINT_DROID,
      glow: GLOW_DROID,
    };
  };

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

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    update(stepMs) {
      // Clocks only accumulate while PLAYING (timer guards internally).
      timer.advance(stepMs);

      // Edge-triggered actions drive the state machine.
      if (
        state.current === GameStateName.Menu &&
        (input.wasPressed(InputAction.Confirm) || input.wasPressed(InputAction.Jump))
      ) {
        state.transition(GameStateName.Playing);
        audio.playSfx('checkpoint');
        // Per-level track; warns once and stays silent until Fas 5 adds mp3s.
        void audio.playMusic(level.data.id);
      }
      if (
        state.current === GameStateName.Paused &&
        (input.wasPressed(InputAction.Pause) || input.wasPressed(InputAction.Confirm))
      ) {
        state.transition(GameStateName.Playing);
        audio.resumeMusic();
      }
      if (state.current === GameStateName.Playing && input.wasPressed(InputAction.Pause)) {
        state.transition(GameStateName.Paused);
        audio.pauseMusic();
      }

      // Auto-pan the camera while playing (ping-pong across the level).
      if (state.current === GameStateName.Playing) {
        const stepSeconds = stepMs / 1000;
        const maxCameraX = Math.max(0, level.pixelWidth - VIRTUAL_WIDTH);
        demo.cameraX += demo.cameraDir * CAMERA_SPEED_PX_PER_S * stepSeconds;
        if (demo.cameraX >= maxCameraX) {
          demo.cameraX = maxCameraX;
          demo.cameraDir = -1;
        } else if (demo.cameraX <= 0) {
          demo.cameraX = 0;
          demo.cameraDir = 1;
        }

        // ---- B1 juice demo: droid rig + input-triggered effects ----------
        demo.droidX = demo.cameraX + VIRTUAL_WIDTH / 2;

        if (input.wasPressed(InputAction.Jump) && demo.droidGrounded) {
          demo.droidVY = DROID_JUMP_VELOCITY_PX_PER_S;
          demo.droidGrounded = false;
          juice.jump(demo.droidX, demo.droidY + DROID_HALF_SIZE);
        }
        if (input.wasPressed(InputAction.Shoot)) {
          juice.shoot(
            demo.droidX + demo.cameraDir * DROID_HALF_SIZE,
            demo.droidY,
            demo.cameraDir > 0 ? 0 : Math.PI,
          );
        }
        if (input.wasPressed(InputAction.SwapWeapon)) {
          juice.explosion(demo.droidX + demo.cameraDir * 90, demo.droidY - 40);
        }
        if (input.wasPressed(InputAction.Left)) juice.shake.addTrauma(0.35);
        if (input.wasPressed(InputAction.Right)) juice.shake.addTrauma(0.65);

        // Simple gravity bounce against the hover altitude → landing juice.
        if (!demo.droidGrounded) {
          demo.droidVY += DROID_GRAVITY_PX_PER_S2 * stepSeconds;
          demo.droidY += demo.droidVY * stepSeconds;
          if (demo.droidY >= DROID_HOVER_Y && demo.droidVY > 0) {
            const impact = Math.min(2, Math.abs(demo.droidVY) / 700);
            demo.droidY = DROID_HOVER_Y;
            demo.droidVY = 0;
            demo.droidGrounded = true;
            juice.land(demo.droidX, demo.droidY + DROID_HALF_SIZE, impact);
          }
        }

        juice.update(stepSeconds);
      }

      input.endFrame();
    },
    render() {
      // Screen shake hooks into the camera offset: everything world-space
      // (parallax pan + tile/marker/droid positions) shifts by the trauma
      // noise; the HUD stays steady.
      const panX = demo.cameraX - juice.shake.offsetX;
      const offsetY = juice.shake.offsetY;

      renderer.beginFrame([0.03, 0.01, 0.09, 1]);
      parallax.draw(panX);
      const sprites = buildTileSprites(panX, offsetY); // tiles on top of parallax
      sprites.push(buildDroidSprite(panX, offsetY));
      renderer.drawSprites('white', sprites);
      renderer.drawSprites('white', juice.particles.buildDraws());
      drawScreenFlash();
      renderer.endFrame();

      hud.update({
        gameStateName: state.current,
        levelName: level.data.name,
        fps: loop.fps,
        cameraX: demo.cameraX,
        timeText: timer.formatLevelTime(),
        totalTimeText: timer.formatTotalTime(),
        message: stateMessage(state.current),
        juiceLine: juice.statsLine(),
      });
    },
  });

  window.addEventListener('beforeunload', () => {
    loop.stop();
    input.detach();
    detachAudioUnlock();
    detachTimerSync();
    audio.dispose();
    hud.destroy();
  });

  loop.start();
}

function stateMessage(state: GameStateName): string | null {
  switch (state) {
    case GameStateName.Menu:
      return 'Press SPACE to start · P pauses';
    case GameStateName.Paused:
      return 'PAUSED — press P or ENTER to resume';
    default:
      return null;
  }
}

boot().catch((error) => {
  console.error('[boot] fatal:', error);
  WebGPURenderer.showFallbackMessage(document.getElementById('fallback'));
});
