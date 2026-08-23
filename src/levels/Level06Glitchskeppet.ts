import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 6 — "Glitchskeppet" (tema: spegelbild av nivå 1, allt korrupt;
 * task C2).
 *
 * Mnemosynes dröm om sig själv: nivå 1:s skelett — groparna, trappan,
 * plattformsträdgården, stridsavdelningen, exit-piedestalen — igen, men
 * hårdare överallt. Ny mekanik: KORRUMPERADE TILES (`TileType.Glitch`) som
 * flimrar solid/tom på fast rytm — broplankor och hoppstenar är inte alltid
 * där. Fiendetrycket är tätare och alla fyra typerna medverkar.
 *
 * Spegelmatris (nivå 1 → nivå 6):
 *   grop 14–17 → 14–19 · bro → flimrande plankor
 *   grop 42–47 → 44–51 · bro → glimmande gliphopp
 *   trappa topp 18 → topp 15 (dubbelhoppsklättring)
 *   plattformsträdgård → mittplattformen korrumperad
 *   grop 122–127 → 126–133 · bro → tre ensamma hoppstenar
 *   slutplatå topp 18 → topp 17, exit flyttad ett steg upp
 */

const WIDTH = 208;
const HEIGHT = 24;

export function buildLevel06(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark — nivå 1:s tre gropar, nu bredare ---------------------------------
  b.ground(0, 13);
  b.hazardPit(14, 19);
  b.ground(20, 43);
  b.hazardPit(44, 51);
  b.ground(52, 125);
  b.hazardPit(126, 133);
  b.ground(134, WIDTH - 1);

  // --- Grop 1: korrupta broplankor (flimrar) ------------------------------------
  b.set(16, 19, TileType.Glitch);
  b.set(17, 19, TileType.Glitch);

  // --- Tutorialsteget, speglat och högt -------------------------------------------
  b.rect(26, 19, 27, 20, TileType.Solid);

  // --- Plattform ovanför första marksträckan ----------------------------------------
  b.rect(22, 16, 26, 16, TileType.Platform);

  // --- Trappan: dubbelhoppssteg upp till höjdplatå (topp rad 15) ----------------------
  b.set(52, 19, TileType.Solid);
  b.set(56, 17, TileType.Solid);
  b.set(60, 15, TileType.Solid);
  b.rect(62, 15, 80, HEIGHT - 1, TileType.Solid); // platå, topp rad 15
  b.set(82, 16, TileType.Solid); // trappa ner

  // --- Grop 2: glimmande glipbro (håla i mitten — dubbelhopp eller timing) -------------
  b.set(45, 18, TileType.Glitch);
  b.set(46, 18, TileType.Glitch);
  b.set(48, 18, TileType.Glitch);
  b.set(49, 18, TileType.Glitch);

  // --- Plattformsträdgården: mittnivån är korrumperad -------------------------------
  b.rect(94, 17, 97, 17, TileType.Platform);
  b.rect(100, 14, 103, 14, TileType.Glitch); // flimrande mittplattform
  b.rect(106, 17, 109, 17, TileType.Platform);

  // --- Grop 3: tre ensamma hoppstenar --------------------------------------------------
  b.set(128, 19, TileType.Glitch);
  b.set(130, 19, TileType.Glitch);
  b.set(132, 19, TileType.Glitch);

  // --- Stridsavdelning: högre skyddsmur --------------------------------------------------
  b.rect(138, 18, 138, 20, TileType.Solid);

  // --- Final: spegelvända trappor upp till exit-piedestalen -------------------------------
  b.set(176, 19, TileType.Solid);
  b.set(180, 17, TileType.Solid);
  b.rect(184, 17, 205, HEIGHT - 1, TileType.Solid); // avslutande platå, topp rad 17

  // --- Spawns ---------------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [36, 20],
    [90, 20],
    [146, 20],
    [172, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 196, ty: 16 });

  // Drönare — skeppet drömmer sitt gamla besättningsspöke, tätare än någonsin.
  for (const [tx, ty] of [
    [24, 18],
    [70, 12],
    [96, 15],
    [112, 18],
    [120, 16],
    [150, 16],
    [186, 14],
    [192, 14],
    [200, 14],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }

  // Tunnelmasker på platåer och golv.
  for (const [tx, ty] of [
    [30, 20],
    [70, 14],
    [114, 20],
    [160, 20],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'TunnelWorm', tx, ty });
  }

  // Glitcher i par — spegelbildens egen fiende.
  for (const [tx, ty] of [
    [58, 12],
    [104, 11],
    [143, 18],
    [190, 13],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx, ty });
  }

  // Rensare leder Dansen (ECHO:s råd: skjut de som skjuter tillbaka först).
  for (const [tx, ty] of [
    [66, 10],
    [122, 15],
    [196, 13],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Purger', tx, ty });
  }

  // Powerups: sköld tidigt, överladdning inför stridsavdelningen, 1-up högst upp.
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 33, ty: 20 });
  b.spawn({ kind: 'powerup', powerup: 'Overcharge', tx: 137, ty: 20 });
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 102, ty: 12 });

  // Minnesfragment: samma teman som nivå 1 — återställda ur korruptionen.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [8, 20, 'Music'],
    [12, 20, 'Science'],
    [16, 18, 'Language'],
    [23, 15, 'Music'],
    [25, 15, 'Science'],
    [38, 20, 'Music'],
    [46, 17, 'Science'],
    [49, 17, 'Music'],
    [65, 14, 'Science'],
    [72, 14, 'Music'],
    [95, 16, 'Language'],
    [101, 13, 'Science'],
    [107, 16, 'Music'],
    [129, 18, 'Language'],
    [131, 18, 'Science'],
    [141, 20, 'Music'],
    [155, 20, 'Science'],
    [168, 20, 'Language'],
    [181, 16, 'Music'],
    [188, 16, 'Science'],
    [199, 16, 'Language'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-06-glitchskeppet',
    index: 6,
    name: 'Glitchskeppet',
    theme: 'Spegelbild av nivå 1, korrupt',
    intro:
      'ECHO: Du har varit här förut — det har korridorena också, nästan. ' +
      'Skeppet drömmer sig självt och golven dröms bort ibland. Lita på fötterna, AURORA, inte på synen.',
    parTimeSeconds: 100,
    fragmentTypes: ['Music', 'Science', 'Language'],
  });
}
