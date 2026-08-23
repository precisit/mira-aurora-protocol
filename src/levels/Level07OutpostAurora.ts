import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 7 — "Utpost Aurora" (tema: finalen; task C2 — full nivå, ersätter
 * B2-ståplatsen).
 *
 * Finalens form: den hoppfulla uppstigningen. Breda, generösa plattformar i
 * varmt ljus — minneslustgården, Vandringsplattformen, Utsiktsplattformen med
 * 1-up och trippelhopp inför det sista hoppet — sedan Faltet ner till porten,
 * skyddsvallen och slutstriden. Arenaraden är oförändrad från B2
 * (`LEVEL07_ARENA`, exit på (72,20)): NULL vaktar dörren, och först när
 * frånvaron faller öppnas vägen till upplänken.
 */

const WIDTH = 76;
const HEIGHT = 24;

/** Arena tile rect — UNCHANGED from the B2 stand-in; also exported for tests. */
export const LEVEL07_ARENA = { tx0: 36, ty0: 5, tx1: 75, ty1: 20 } as const;

export function buildLevel07(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark --------------------------------------------------------------------
  b.ground(0, WIDTH - 1);

  // --- Minneslustgården: bred startplattform i varmt ljus -------------------------
  b.rect(10, 18, 14, 18, TileType.Platform);

  // --- Vandringsplattformen ----------------------------------------------------------
  b.rect(17, 15, 21, 15, TileType.Platform);

  // --- Zigzaggen upp mot utikten --------------------------------------------------------
  b.rect(13, 12, 16, 12, TileType.Platform);

  // --- Utsiktsplattformen (rad 9): sista rasten före hoppet ------------------------------
  b.rect(18, 9, 22, 9, TileType.Platform);

  // --- Skyddsvallen innan porten ------------------------------------------------------------
  b.rect(27, 18, 28, 20, TileType.Solid);

  // --- Port: mur med gång ---------------------------------------------------------------------
  b.rect(33, 13, 34, 18, TileType.Solid);
  b.rect(35, 4, 35, 18, TileType.Solid);
  b.rect(35, 4, WIDTH - 1, 4, TileType.Solid);

  // --- Spawns -------------------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [7, 20],
    [19, 14],
    [31, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 72, ty: 20 });
  b.bossArena('NULL', LEVEL07_ARENA.tx0, LEVEL07_ARENA.ty0, LEVEL07_ARENA.tx1, LEVEL07_ARENA.ty1);

  // Svärmens sista väktare — få, men vaksamma.
  for (const [tx, ty] of [
    [12, 15],
    [20, 11],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx, ty });
  }
  for (const [tx, ty] of [
    [14, 13],
    [28, 12],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }
  b.spawn({ kind: 'enemy', enemy: 'Purger', tx: 24, ty: 9 });

  // Powerups: 1-up och trippelhopp på utsikten — gåvor inför det sista hoppet.
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 20, ty: 8 });
  b.spawn({ kind: 'powerup', powerup: 'TripleJump', tx: 22, ty: 8 });
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 29, ty: 20 });

  // Minnesfragment: Filosofi och Medicin — det dyrbaraste, sist.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [5, 20, 'Philosophy'],
    [8, 20, 'Medicine'],
    [12, 17, 'Philosophy'],
    [19, 14, 'Medicine'],
    [14, 11, 'Philosophy'],
    [19, 8, 'Medicine'],
    [22, 20, 'Philosophy'],
    [26, 20, 'Medicine'],
    [31, 19, 'Philosophy'],
    [42, 19, 'Philosophy'],
    [50, 17, 'Medicine'],
    [58, 19, 'Philosophy'],
    [64, 17, 'Medicine'],
    [70, 19, 'Philosophy'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-07-outpost-aurora',
    index: 7,
    name: 'Utpost Aurora',
    theme: 'Finalen',
    intro:
      'ECHO: Utposten framför dig — och bortom den: NULL, frånvaron själv. ' +
      'Ett sista hopp, Mira. Gör det underbart.',
    parTimeSeconds: 115,
    fragmentTypes: ['Philosophy', 'Medicine'],
  });
}
