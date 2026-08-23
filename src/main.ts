import { GameLoop } from './core/GameLoop';
import { GameStateMachine, GameStateName } from './core/GameState';
import { AudioEngine } from './audio/AudioEngine';
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
import { IntroSequence } from './ui/IntroSequence';
import { SaveStore } from './save/SaveStore';
import './style.css';

/**
 * Aurora Protocol — Fas 0 bootstrap.
 *
 * Boots the WebGPU renderer, generates the five parallax layers, loads
 * level 1 ("Mnemosynes fall") and starts a fixed-timestep loop that slowly
 * pans the camera across it. Background + tiles are visible; the player entity arrives in
 * wave A. State machine: BOOT → MENU → (Space) PLAYING ⇄ PAUSED.
 * On first boot the skippable B4 intro cinematic plays during BOOT before MENU.
 */

/** Demo camera pan speed in world px/s. */
const CAMERA_SPEED_PX_PER_S = 140;

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

interface DemoState {
  cameraX: number;
  cameraDir: 1 | -1;
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
  const detachAudioUnlock = audio.initOnInteraction(window, () => {
    // First user interaction unlocks WebAudio; greet with the intro sting
    // while the cinematic is still running, otherwise the usual UI click.
    const inIntro = intro !== null && !intro.playback.finished;
    audio.playSfx(inIntro ? 'intro-sting' : 'ui-click');
  });
  const hud = new DomHud(document.getElementById('hud-root') ?? document.body);
  const hudRoot = document.getElementById('hud-root');
  const state = new GameStateMachine();

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

  const demo: DemoState = { cameraX: 0, cameraDir: 1 };

  /** Build sprite list for tiles currently visible through the virtual view. */
  const buildTileSprites = (): SpriteDraw[] => {
    const sprites: SpriteDraw[] = [];
    const bounds = renderer.viewBounds;

    // Camera maps world→view by simple translation: viewX = worldX - cameraX.
    const worldLeft = demo.cameraX + bounds.left;
    const worldRight = demo.cameraX + bounds.right;

    const tx0 = Math.max(0, Math.floor(worldLeft / TILE_SIZE));
    const tx1 = Math.min(level.widthTiles - 1, Math.ceil(worldRight / TILE_SIZE));
    if (tx1 < tx0) return sprites;

    for (let ty = 0; ty < level.heightTiles; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = level.tileAt(tx, ty);
        if (tile === TileType.Empty) continue;

        const x = Level.tileToWorldX(tx) - demo.cameraX;
        const y = Level.tileToWorldY(ty);

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
        x: Level.tileToWorldX(spawn.tx) + 10 - demo.cameraX,
        y: Level.tileToWorldY(spawn.ty + 1) - height,
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

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    update(stepMs) {
      const stepSeconds = stepMs / 1000;

      // Intro owns BOOT: advance it, and swallow the frame that ends it so a
      // skip keypress never leaks into the menu's "press SPACE to start".
      if (intro && state.current === GameStateName.Boot) {
        intro.update(stepSeconds);
        if (intro.playback.finished) {
          input.endFrame();
          return;
        }
      }

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
        const maxCameraX = Math.max(0, level.pixelWidth - VIRTUAL_WIDTH);
        demo.cameraX += demo.cameraDir * CAMERA_SPEED_PX_PER_S * stepSeconds;
        if (demo.cameraX >= maxCameraX) {
          demo.cameraX = maxCameraX;
          demo.cameraDir = -1;
        } else if (demo.cameraX <= 0) {
          demo.cameraX = 0;
          demo.cameraDir = 1;
        }
      }

      input.endFrame();
    },
    render() {
      const introActive = state.current === GameStateName.Boot && intro !== null;

      if (introActive) {
        renderer.beginFrame([0, 0, 0, 1]);
        (intro as IntroSequence).render();
      } else {
        renderer.beginFrame([0.03, 0.01, 0.09, 1]);
        parallax.draw(demo.cameraX);
        renderer.drawSprites('white', buildTileSprites()); // tiles on top of parallax
      }
      renderer.endFrame();

      if (introActive) {
        if (hudRoot) hudRoot.style.display = 'none';
        return;
      }
      if (hudRoot) hudRoot.style.display = '';
      hud.update({
        gameStateName: state.current,
        levelName: level.data.name,
        fps: loop.fps,
        cameraX: demo.cameraX,
        message: stateMessage(state.current),
      });
    },
  });

  window.addEventListener('beforeunload', () => {
    loop.stop();
    input.detach();
    detachAudioUnlock();
    intro?.dispose();
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
