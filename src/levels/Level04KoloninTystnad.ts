import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 4 — "Kolonin Tystnad" (tema: övergiven koloni; task C2).
 *
 * Ny mekanik: LASERGRIDDER. Kolonins gator vaktas av pulserande strålar som
 * kör på fasta rytmer — horisontella portar att smita igenom, vertikala
 * pelare i torgsektionen och "Metronomen", en korridor av synkade ridåer.
 *
 * Fyra akter: bostadskvarter (mjuk introduktion) → kolonins torg (vertikala
 * pelare, rensare) → takterräng (klättring med svepende strålar) →
 * Metronomen (slutgauntlet). 3 checkpoints, par ~105 s.
 */

const WIDTH = 224;
const HEIGHT = 24;

export function buildLevel04(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark med fyra gropar ----------------------------------------------------
  b.ground(0, 27);
  b.hazardPit(28, 33);
  b.ground(34, 73);
  b.hazardPit(74, 81);
  b.ground(82, 131);
  b.hazardPit(132, 139);
  b.ground(140, 177);
  b.hazardPit(178, 183);
  b.ground(184, WIDTH - 1);

  // --- Akt 1: Bostadskvarternas tystnad -----------------------------------------
  // Husblock att hoppa på, sedan den första laserporten — generös rytm.
  b.rect(8, 19, 9, 20, TileType.Solid);
  b.rect(15, 18, 17, 20, TileType.Solid);
  b.laserGrid(22, 20, 26, 20, { periodMs: 2600, onMs: 800 });

  // Grop 1: ö-plattform med svepare ovanför.
  b.rect(30, 19, 31, 19, TileType.Platform);
  b.laserGrid(28, 16, 33, 16, { periodMs: 2200, onMs: 700, offsetMs: 600 });
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 44, ty: 20 });

  // --- Akt 2: Kolonins torg ------------------------------------------------------
  // Fontänblock, plattformsträd och två vertikala laserpelare i motfas.
  b.rect(64, 19, 66, 20, TileType.Solid);
  b.rect(70, 18, 73, 18, TileType.Platform);
  b.rect(78, 16, 81, 16, TileType.Platform);
  b.rect(86, 18, 89, 18, TileType.Platform);
  b.laserGrid(76, 14, 76, 20, { periodMs: 2000, onMs: 650 });
  b.laserGrid(84, 12, 84, 20, { periodMs: 2100, onMs: 700, offsetMs: 1050 });

  // --- Akt 3: Takterrängen --------------------------------------------------------
  // Fyra hustak att klättra mellan, med horisontella svepare i hoppen.
  b.rect(142, 17, 144, HEIGHT - 1, TileType.Solid);
  b.rect(149, 14, 151, HEIGHT - 1, TileType.Solid);
  b.laserGrid(145, 13, 148, 13, { periodMs: 1800, onMs: 600 });
  b.rect(156, 17, 158, HEIGHT - 1, TileType.Solid);
  b.rect(163, 13, 165, HEIGHT - 1, TileType.Solid);
  b.laserGrid(159, 15, 162, 15, { periodMs: 1600, onMs: 550, offsetMs: 700 });
  b.rect(168, 9, 170, 9, TileType.Platform); // gömd 1-up platå

  // --- Akt 4: Metronomen ------------------------------------------------------------
  // Fyra synkade ridåer med förskjuten fas över grundgropar — lär rytmen.
  b.hazardPit(193, 195);
  b.hazardPit(199, 201);
  b.laserGrid(190, 15, 190, 20, { periodMs: 1600, onMs: 500, offsetMs: 0 });
  b.laserGrid(196, 15, 196, 20, { periodMs: 1600, onMs: 500, offsetMs: 400 });
  b.laserGrid(202, 15, 202, 20, { periodMs: 1600, onMs: 500, offsetMs: 800 });
  b.laserGrid(208, 15, 208, 20, { periodMs: 1600, onMs: 500, offsetMs: 1200 });
  b.spawn({ kind: 'powerup', powerup: 'Overcharge', tx: 187, ty: 20 });

  // --- Exit-piedestal ------------------------------------------------------------------
  b.rect(214, 18, 221, HEIGHT - 1, TileType.Solid);

  // --- Spawns ----------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [36, 20],
    [92, 20],
    [164, 12],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 217, ty: 17 });

  // Tunnelmasker patrullerar torg och gator.
  for (const [tx, ty] of [
    [48, 20],
    [112, 20],
    [186, 20],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'TunnelWorm', tx, ty });
  }

  // Drönare över taken och torget.
  for (const [tx, ty] of [
    [60, 17],
    [95, 16],
    [126, 18],
    [153, 11],
    [171, 15],
    [203, 16],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }

  // Rensare — kolonins sista vakande system — skjuter tillbaka.
  for (const [tx, ty] of [
    [72, 15],
    [88, 13],
    [146, 11],
    [196, 13],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Purger', tx, ty });
  }

  // Minnesfragment: kolonins vardag — språk, historia, medicin.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [6, 20, 'History'],
    [16, 17, 'Language'],
    [24, 19, 'Medicine'],
    [30, 18, 'History'],
    [52, 20, 'Language'],
    [65, 18, 'Medicine'],
    [71, 17, 'History'],
    [79, 15, 'Language'],
    [87, 17, 'Medicine'],
    [110, 20, 'History'],
    [136, 18, 'Medicine'],
    [150, 13, 'History'],
    [157, 16, 'Language'],
    [169, 8, 'Medicine'],
    [188, 20, 'History'],
    [211, 20, 'Language'],
    [216, 16, 'Medicine'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-04-kolonin-tystnad',
    index: 4,
    name: 'Kolonin Tystnad',
    theme: 'Övergiven koloni',
    intro:
      'ECHO: Kolonin Tystnad. Elva tusen människor en morgon — sen: tystnad. ' +
      'Lasrerna stannade kvar och håller tiden. Lär dig rytmen, AURORA, så släpper de dig igenom.',
    parTimeSeconds: 105,
    fragmentTypes: ['History', 'Language', 'Medicine'],
  });
}
