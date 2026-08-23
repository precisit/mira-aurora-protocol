import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 7 — "Utpost Aurora" (task B2 test arena).
 *
 * Minimal final level: the last approach to Outpost Aurora, then NULL —
 * queen of pure absence. Stands in for the real PLAN.md §4 level 7 until the
 * content wave builds it; the `kind: 'boss'` arena descriptor and all
 * GameSession wiring are final, so replacing this with an authored level is
 * purely a data change.
 *
 * Geometry mirrors the vault arena but opens into the uplink platform: after
 * NULL falls, AURORA reaches the exit (the "hop" itself arrives with Fas 3).
 */

const WIDTH = 76;
const HEIGHT = 24;

/** Arena tile rect — also exported for tests. */
export const LEVEL07_ARENA = { tx0: 36, ty0: 5, tx1: 75, ty1: 20 } as const;

export function buildLevel07(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark --------------------------------------------------------------------
  b.ground(0, WIDTH - 1);

  // --- Sista sträckan: plattformsträd och fara ----------------------------------
  b.rect(12, 17, 16, 17, TileType.Platform);
  b.rect(20, 15, 24, 15, TileType.Platform);
  b.rect(28, 18, 29, 20, TileType.Solid); // liten skyddsvalv innan porten

  // --- Port: mur med gång --------------------------------------------------------
  b.rect(33, 13, 34, 18, TileType.Solid);
  b.rect(35, 4, 35, 18, TileType.Solid);
  b.rect(35, 4, WIDTH - 1, 4, TileType.Solid);

  // --- Spawns ---------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [9, 20],
    [26, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 72, ty: 20 });
  b.bossArena('NULL', LEVEL07_ARENA.tx0, LEVEL07_ARENA.ty0, LEVEL07_ARENA.tx1, LEVEL07_ARENA.ty1);

  // Svärmens sista väktare.
  for (const [tx, ty] of [
    [14, 15],
    [22, 13],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx, ty });
  }
  b.spawn({ kind: 'enemy', enemy: 'Purger', tx: 30, ty: 16 });

  // Powerups: sköld + extra liv inför slutstriden.
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 31, ty: 20 });
  b.spawn({ kind: 'powerup', powerup: 'OneUp', tx: 22, ty: 14 });

  // Minnesfragment: Filosofi och Medicin — det dyrbaraste, sist.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [6, 20, 'Philosophy'],
    [10, 20, 'Medicine'],
    [14, 16, 'Philosophy'],
    [22, 14, 'Medicine'],
    [30, 20, 'Philosophy'],
    [42, 19, 'Philosophy'],
    [50, 17, 'Medicine'],
    [58, 19, 'Philosophy'],
    [66, 17, 'Medicine'],
    [71, 19, 'Philosophy'],
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
    parTimeSeconds: 130,
    fragmentTypes: ['Philosophy', 'Medicine'],
  });
}
