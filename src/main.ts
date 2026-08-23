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
import './style.css';

/**
 * Aurora Protocol — Fas 0 bootstrap.
 *
 * Boots the WebGPU renderer, generates the five parallax layers, loads
 * level 1 ("Mnemosynes fall") and starts a fixed-timestep loop that slowly
 * pans the camera across it. Background + tiles are visible; the player entity arrives in
 * wave A. State machine: BOOT → MENU → (Space) PLAYING ⇄ PAUSED.
 */

/** Demo camera pan speed in world px/s. */
const CAMERA_SPEED_PX_PER_S = 140;

// Neon tile palette for the test level (tints over the white 1×1 texture).
const TINT_SOLID_A: Rgba = [0.16, 0.9, 1.0, 1];
const TINT_SOLID_B: Rgba = [0.1, 0.62, 0.95, 1];
const TINT_PLATFORM: Rgba = [1.0, 0.35, 0.85, 1];
const TINT_HAZARD: Rgba = [1.0, 0.45, 0.15, 1];
const TINT_MARKER_CHECKPOINT: Rgba = [1.0, 0.9, 0.3, 0.8];
const TINT_MARKER_GOAL: Rgba = [0.55, 1.0, 0.45, 0.9];
const TINT_MARKER_PICKUP: Rgba = [1.0, 0.4, 0.9, 0.8];

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
  const audio = new AudioEngine();
  const hud = new DomHud(document.getElementById('hud-root') ?? document.body);
  const state = new GameStateMachine();
  state.transition(GameStateName.Menu); // assets are ready → show menu

  // Audio must unlock on the first user gesture (autoplay policy).
  const unlockAudio = (): void => {
    void audio.unlock().then(() => audio.playSfx('ui-click'));
  };
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('pointerdown', unlockAudio, { once: true });

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
            sprites.push({ x, y: y + 6, width: TILE_SIZE, height: TILE_SIZE - 12, tint: TINT_HAZARD });
            break;
        }
      }
    }

    // Spawn-layer entities as glowing markers so the data is visible in-demo.
    for (const spawn of level.data.spawns) {
      if (spawn.kind === 'playerSpawn') continue;
      const tint =
        spawn.kind === 'checkpoint'
          ? TINT_MARKER_CHECKPOINT
          : spawn.kind === 'exit'
            ? TINT_MARKER_GOAL
            : TINT_MARKER_PICKUP;
      const height = TILE_SIZE * 2;
      sprites.push({
        x: Level.tileToWorldX(spawn.tx) + 10 - demo.cameraX,
        y: Level.tileToWorldY(spawn.ty + 1) - height,
        width: 12,
        height,
        tint,
      });
    }

    return sprites;
  };

  // ---- Fixed-timestep loop --------------------------------------------------
  const loop = new GameLoop({
    update(stepMs) {
      // Edge-triggered actions drive the state machine.
      if (
        state.current === GameStateName.Menu &&
        (input.wasPressed(InputAction.Confirm) || input.wasPressed(InputAction.Jump))
      ) {
        state.transition(GameStateName.Playing);
        audio.playSfx('checkpoint');
      }
      if (
        state.current === GameStateName.Paused &&
        (input.wasPressed(InputAction.Pause) || input.wasPressed(InputAction.Confirm))
      ) {
        state.transition(GameStateName.Playing);
      }
      if (state.current === GameStateName.Playing && input.wasPressed(InputAction.Pause)) {
        state.transition(GameStateName.Paused);
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
      }

      input.endFrame();
    },
    render() {
      renderer.beginFrame([0.03, 0.01, 0.09, 1]);
      parallax.draw(demo.cameraX);
      renderer.drawSprites('white', buildTileSprites()); // tiles on top of parallax
      renderer.endFrame();

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
