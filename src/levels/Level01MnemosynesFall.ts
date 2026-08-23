import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 1 — "Mnemosynes fall" (tema: rymdstationsruin). Tutorial enligt
 * PLAN.md §4: hoppa, skjuta, samla fragment. Mjuk svårighetskurva:
 * platt mark, ett par grunt gropar, låga trappsteg, flygande plattformar
 * och bara drönare som fiender. 3 checkpoints.
 */

const WIDTH = 208;
const HEIGHT = 24;

export function buildLevel01(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark (rad 21–23) med tre grunda faror gropar -------------------------
  b.ground(0, 13);
  b.hazardPit(14, 17);
  b.ground(18, 41);
  b.hazardPit(42, 47);
  b.ground(48, 121);
  b.hazardPit(122, 127);
  b.ground(128, WIDTH - 1);

  // --- Tutorial: låg trappa att hoppa över ----------------------------------
  b.set(10, 20, TileType.Solid);

  // --- Plattform ovanför första marksträckan --------------------------------
  b.rect(20, 17, 24, 17, TileType.Platform);

  // --- Trappa upp till höjdplatå (vertikalitet) ------------------------------
  b.set(52, 20, TileType.Solid);
  b.set(56, 19, TileType.Solid);
  b.set(60, 18, TileType.Solid);
  b.rect(62, 18, 78, HEIGHT - 1, TileType.Solid); // platå, topp rad 18
  b.set(80, 19, TileType.Solid); // trappa ner

  // --- Bro över andra gropen ---------------------------------------------------
  b.rect(43, 18, 46, 18, TileType.Platform);

  // --- Plattformsträdgård: tre höjder med fragment ---------------------------
  b.rect(92, 18, 96, 18, TileType.Platform);
  b.rect(99, 15, 103, 15, TileType.Platform);
  b.rect(106, 18, 110, 18, TileType.Platform);

  // --- Bro över tredje gropen -------------------------------------------------
  b.rect(124, 19, 126, 19, TileType.Platform);

  // --- Stridsavdelning: låg vägg att skjuta bakom -----------------------------
  b.rect(134, 19, 134, 20, TileType.Solid);

  // --- Final: trappor upp till exit-piedestalen -------------------------------
  b.set(172, 19, TileType.Solid);
  b.set(176, 18, TileType.Solid);
  b.rect(180, 18, 205, HEIGHT - 1, TileType.Solid); // avslutande platå, topp rad 18

  // --- Spawns -----------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [34, 20],
    [86, 20],
    [162, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 196, ty: 17 });

  // Fiender: enbart drönare på tutorialnivån.
  for (const [tx, ty] of [
    [26, 18],
    [69, 15],
    [98, 19],
    [113, 19],
    [140, 18],
    [148, 17],
    [182, 15],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }

  // Powerups: sköld mitt i stridsavdelningen, 1-up gömd högst upp.
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 144, ty: 19 });
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 102, ty: 13 });

  // Minnesfragment: främst Musik/Vetenskap + ett Språk-smycke.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [8, 20, 'Music'],
    [11, 20, 'Music'],
    [10, 18, 'Science'],
    [21, 16, 'Music'],
    [23, 16, 'Science'],
    [44, 17, 'Science'],    [66, 17, 'Music'],
    [72, 17, 'Science'],
    [93, 17, 'Music'],
    [101, 14, 'Language'],
    [107, 17, 'Science'],
    [125, 18, 'Music'],
    [139, 20, 'Music'],
    [147, 20, 'Science'],
    [155, 20, 'Music'],
    [168, 20, 'Science'],
    [176, 16, 'Music'],
    [185, 17, 'Science'],
    [192, 17, 'Music'],
    [199, 17, 'Science'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-01-mnemosynes-fall',
    index: 1,
    name: 'Mnemosynes fall',
    theme: 'Rymdstationsruin',
    intro: 'ECHO: AURORA, vakna. Mnemosyne faller — hoppa, skjut och samla det som kan räddas.',
    parTimeSeconds: 90,
    fragmentTypes: ['Music', 'Science', 'Language'],
  });
}
