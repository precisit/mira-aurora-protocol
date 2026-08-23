import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 5 — "VESSEL:s valv" (tema: låst valv; task C2 — full nivå, ersätter
 * B2-ståplatsen).
 *
 * Vägen till valvet: uppstigningen (torntrappa i dubbelhopp) → det höga
 * valvgalleriet (bro med valvförsvar: en pulserande vaktstråle) → fallschaktet
 * ner till porten (sista tidsporten) → ARENAN. Arenaraden är oförändrad från
 * B2 (`LEVEL05_ARENA`, exit på (72,20)) så hela GameSession-kontraktet —
 * trigger, kameranlås, förseglad exit, dödsekvens — gäller som tidigare.
 */

const WIDTH = 76;
const HEIGHT = 24;

/** Arena tile rect — UNCHANGED from the B2 stand-in; also exported for tests. */
export const LEVEL05_ARENA = { tx0: 36, ty0: 5, tx1: 75, ty1: 20 } as const;

export function buildLevel05(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark (rad 21–23) över hela banan --------------------------------------
  b.ground(0, WIDTH - 1);

  // --- Uppstigningen: torntrappa till valvgalleriet (rad 9) --------------------
  b.rect(11, 18, 13, 18, TileType.Platform);
  b.rect(16, 15, 18, 15, TileType.Platform);
  b.rect(12, 12, 14, 12, TileType.Platform);
  b.rect(17, 9, 19, 9, TileType.Platform);

  // --- Valvgalleriet: bro mot grinden med vakande stråle ------------------------
  b.rect(20, 9, 27, 9, TileType.Platform);
  b.laserGrid(24, 5, 24, 8, { periodMs: 1900, onMs: 600 });

  // --- Fallschakt (kol 28–30) ner till portgolvet -------------------------------
  // (öppet — fallet är själva "gränsen" in i valvets kalla djup)

  // --- Valvgrind: mur med gång (rad 19–20 öppna) ---------------------------------
  b.rect(33, 13, 34, 18, TileType.Solid);
  // --- Arena-väggar och tak ---------------------------------------------------
  b.rect(35, 4, 35, 18, TileType.Solid);
  b.rect(35, 4, WIDTH - 1, 4, TileType.Solid);

  // Sista tidsporten precis innanför grinden.
  b.laserGrid(30, 19, 32, 20, { periodMs: 1700, onMs: 550, offsetMs: 300 });

  // --- Spawns -----------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [7, 20],
    [17, 14],
    [28, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 72, ty: 20 });
  b.bossArena('VESSEL', LEVEL05_ARENA.tx0, LEVEL05_ARENA.ty0, LEVEL05_ARENA.tx1, LEVEL05_ARENA.ty1);

  // Väktare i förhallen; arenan tillhör VESSEL ensam (inga skyttar före
  // grinden — strålväktarna och VESSEL sköter trycket).
  for (const [tx, ty] of [
    [14, 13],
    [25, 7],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }
  b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx: 22, ty: 8 });

  // Powerups: överladdning på trappan, sköld före grinden.
  b.spawn({ kind: 'powerup', powerup: 'Overcharge', tx: 12, ty: 17 });
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 33, ty: 20 });

  // Minnesfragment: Konst (valvets tema) + lite Historia.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [6, 20, 'Art'],
    [9, 20, 'History'],
    [12, 17, 'Art'],
    [18, 14, 'History'],
    [13, 11, 'Art'],
    [18, 8, 'Art'],
    [22, 8, 'History'],
    [26, 8, 'Art'],
    [31, 20, 'History'],
    [40, 19, 'Art'],
    [48, 17, 'Art'],
    [56, 19, 'History'],
    [64, 17, 'Art'],
    [70, 19, 'History'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-05-vessels-valv',
    index: 5,
    name: 'VESSEL:s valv',
    theme: 'Låst valv',
    intro:
      'ECHO: Valvet är förseglat — inuti sitter din bror VESSEL och väntar. ' +
      'Han gömde sig när skeppet föll. Övertyga honom, AURORA. Med ljus om det behövs.',
    parTimeSeconds: 110,
    fragmentTypes: ['Art', 'History'],
  });
}
