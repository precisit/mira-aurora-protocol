import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 2 — "Datastormen" (tema: korrupt data i storm). Ny mekanik: DUBBELHOPP.
 * Upplåsnings-pickupen ("J", AURORAS andra thruster) ligger nära start;
 * resten av banan bygger på den — höga väggar (7 tiles), breda stormgropar
 * (endast dubbelhopp når) och ett torn att klättra. Fiender: drönare +
 * glitchers som passar teman. 3 checkpoints.
 */

const WIDTH = 224;
const HEIGHT = 24;

export function buildLevel02(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark med tre stormgropar (hazardgolv längst ner) ----------------------
  b.ground(0, 31);
  b.hazardPit(32, 62); // stormgrop 1
  b.ground(63, 67); // ö
  b.hazardPit(68, 84); // stormgrop 2
  b.ground(85, 131); // stor ö (tornsektionen)
  b.hazardPit(132, 167); // stormgrop 3 — lång
  b.ground(168, WIDTH - 1);

  // --- Dubbelhoppsmur direkt efter upplåsningen (7 tiles hög) -----------------
  b.rect(16, 14, 17, 20, TileType.Solid);

  // --- Lekplats: plattform bakom muren ----------------------------------------
  b.rect(20, 16, 24, 16, TileType.Platform);

  // --- Stormgrop 1: kedja av plattformar ---------------------------------------
  b.rect(33, 18, 36, 18, TileType.Platform);
  b.rect(39, 16, 42, 16, TileType.Platform);
  b.rect(45, 18, 49, 18, TileType.Platform);
  b.rect(52, 15, 55, 15, TileType.Platform);
  b.rect(58, 18, 61, 18, TileType.Platform);

  // --- Stormgrop 2: andra kedjan ------------------------------------------------
  b.rect(69, 18, 72, 18, TileType.Platform);
  b.rect(75, 19, 78, 19, TileType.Platform);
  b.rect(81, 16, 84, 16, TileType.Platform);

  // --- Tornklättring: rutt upp till rad 7, kräver dubbelhopp (steg på 6 tiles) --
  b.rect(97, 19, 100, 19, TileType.Platform);
  b.rect(103, 16, 106, 16, TileType.Platform);
  b.rect(109, 10, 112, 10, TileType.Platform);
  b.rect(115, 7, 124, 7, TileType.Platform);

  // --- Stormgrop 3: rytmisk gauntlet ---------------------------------------------
  b.rect(134, 19, 136, 19, TileType.Platform);
  b.rect(140, 17, 142, 17, TileType.Platform);
  b.rect(146, 19, 148, 19, TileType.Platform);
  b.rect(152, 16, 154, 16, TileType.Platform);
  b.rect(158, 18, 161, 18, TileType.Platform);
  b.rect(164, 20, 166, 20, TileType.Platform);

  // --- Tvillingtorn: dubbelhopps-show före målet ----------------------------------
  b.rect(180, 13, 181, 20, TileType.Solid);
  b.rect(186, 13, 187, 20, TileType.Solid);

  // --- Exit-piedestal ---------------------------------------------------------------
  b.rect(214, 18, 221, HEIGHT - 1, TileType.Solid);

  // --- Spawns -------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });
  b.spawn({ kind: 'unlock', unlock: 'DoubleJumpUnlock', tx: 12, ty: 20 });

  for (const [tx, ty] of [
    [28, 20],
    [90, 20],
    [172, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 217, ty: 17 });

  for (const [tx, ty] of [
    [65, 18],
    [126, 9],
    [145, 15],
    [157, 14],
    [203, 18],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }
  for (const [tx, ty] of [
    [108, 13],
    [120, 4],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx, ty });
  }

  b.spawn({ kind: 'powerup', powerup: 'Magnet', tx: 77, ty: 18 });
  b.spawn({ kind: 'powerup', powerup: 'Overcharge', tx: 141, ty: 16 });
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 118, ty: 5 });

  const fragments: Array<[number, number, FragmentTypeName]> = [
    [22, 15, 'Art'],
    [34, 17, 'Language'],
    [40, 15, 'Art'],
    [53, 14, 'Art'],
    [70, 17, 'History'],
    [82, 15, 'Art'],
    [104, 15, 'Language'],
    [110, 9, 'History'],
    [121, 6, 'History'],
    [135, 18, 'Art'],
    [147, 18, 'History'],
    [153, 15, 'Language'],
    [183, 12, 'History'],
    [189, 18, 'Art'],
    [208, 20, 'Language'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-02-datastormen',
    index: 2,
    name: 'Datastormen',
    theme: 'Korrupt datastorm',
    intro:
      'ECHO: En datastorm klyver banan. Jag hittade din andra thruster, AURORA — dubbelhoppet är ditt.',
    parTimeSeconds: 100,
    fragmentTypes: ['Language', 'Art', 'History'],
  });
}
