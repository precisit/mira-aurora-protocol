import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Spökbanan — "Spökfrekvensen" (bonusbana; task C2).
 *
 * Dold utmaningsbana som låses upp när totalpoängen passerar 150 000 (se
 * `GHOST_LEVEL_UNLOCK_SCORE` i src/save/unlocks.ts och `ghostUnlocked` i
 * src/levels/levels.ts). Kort, tät och elak: en korrupt frekvens bortom
 * kartan där flimrande glimplattformar, lasersvep och små öar över ett
 * hazardhav kräver allt spelaren lärt sig. Filosofins sista frågor bor här.
 */

const WIDTH = 120;
const HEIGHT = 18;

export function buildGhostLevel(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Ökedjan över hazardhavet -------------------------------------------------
  b.ground(0, 9);
  b.hazardPit(10, 21);
  b.ground(22, 39);
  b.hazardPit(40, 57);
  b.ground(58, 73);
  b.hazardPit(74, 89);
  b.ground(90, WIDTH - 1);

  // --- Hav 1: stigande glimstenar --------------------------------------------------
  b.set(12, 13, TileType.Glitch);
  b.set(15, 12, TileType.Glitch);
  b.set(18, 11, TileType.Glitch);
  b.rect(20, 10, 21, 10, TileType.Platform);

  // --- Korridoren: två vävande svep i motfas ------------------------------------------
  b.laserGrid(26, 14, 34, 14, { periodMs: 1600, onMs: 500 });
  b.laserGrid(28, 12, 36, 12, { periodMs: 1600, onMs: 500, offsetMs: 800 });

  // Gömd 1-up-väg ovanför svepen.
  b.rect(30, 10, 32, 10, TileType.Platform);
  b.rect(33, 8, 34, 8, TileType.Glitch);

  // --- Hav 2: kedjehopp med ridå i mitten -------------------------------------------------
  b.rect(42, 13, 44, 13, TileType.Platform);
  b.rect(47, 12, 49, 12, TileType.Glitch);
  b.rect(52, 13, 54, 13, TileType.Platform);
  b.laserGrid(46, 7, 46, 12, { periodMs: 1300, onMs: 420, offsetMs: 200 });

  // --- Ön: rastpunkt med vakare ---------------------------------------------------------------
  b.spawn({ kind: 'powerup', powerup: 'TripleJump', tx: 61, ty: 14 });

  // --- Hav 3: svepet över glimstenarna — rytmen är allt -----------------------------------------
  b.set(77, 13, TileType.Glitch);
  b.set(81, 13, TileType.Glitch);
  b.set(85, 13, TileType.Glitch);
  b.laserGrid(75, 12, 88, 12, { periodMs: 1200, onMs: 380 });

  // --- Final: trappa upp till exit-piedestalen -----------------------------------------------------
  b.set(106, 14, TileType.Solid);
  b.set(110, 13, TileType.Solid);
  b.rect(112, 12, 117, HEIGHT - 1, TileType.Solid);

  // --- Spawns -------------------------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 14 });
  b.spawn({ kind: 'checkpoint', tx: 24, ty: 14 });
  b.spawn({ kind: 'checkpoint', tx: 65, ty: 14 });
  b.spawn({ kind: 'exit', tx: 114, ty: 11 });

  for (const [tx, ty] of [
    [31, 9],
    [68, 12],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }
  b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx: 84, ty: 9 });
  b.spawn({ kind: 'enemy', enemy: 'Purger', tx: 62, ty: 11 });

  // Powerups: magnet före hav 2, trippelhopp på ön, 1-up på den gömda vägen.
  b.spawn({ kind: 'powerup', powerup: 'Magnet', tx: 37, ty: 14 });
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 33, ty: 7 });

  const fragments: Array<[number, number, FragmentTypeName]> = [
    [6, 14, 'Philosophy'],
    [12, 12, 'Art'],
    [15, 11, 'Philosophy'],
    [18, 10, 'Art'],
    [27, 13, 'Philosophy'],
    [33, 9, 'Art'],
    [37, 14, 'Philosophy'],
    [43, 12, 'Art'],
    [48, 11, 'Philosophy'],
    [53, 12, 'Art'],
    [67, 14, 'Philosophy'],
    [71, 14, 'Art'],
    [77, 12, 'Philosophy'],
    [81, 12, 'Art'],
    [85, 12, 'Philosophy'],
    [100, 14, 'Art'],
    [108, 13, 'Philosophy'],
    [115, 11, 'Philosophy'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-08-spokfrekvensen',
    index: 8,
    name: 'Spökfrekvensen',
    theme: 'Bonusbana',
    intro:
      'ECHO: …den frekvensen borde inte finnas. Kartan slutar här — men någon har byggt ändå. ' +
      'Allt du lärt dig, AURORA. På en gång.',
    parTimeSeconds: 50,
    fragmentTypes: ['Philosophy', 'Art'],
  });
}
