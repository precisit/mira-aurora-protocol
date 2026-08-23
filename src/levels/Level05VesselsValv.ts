import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 5 — "VESSEL:s valv" (task B2 test arena).
 *
 * A minimal, fully playable boss level: a short approach corridor into a
 * sealed vault where VESSEL waits. This stands in for the real level 5 from
 * PLAN.md §4 until the content wave (Fas 3) builds it — the arena descriptor
 * (`kind: 'boss'`) and all GameSession wiring are final, so swapping in the
 * authored level later is purely a data change.
 *
 * Geometry: runway → gate tunnel → open arena (40×16 tiles) with ceiling.
 * The exit sits at the far end of the arena and stays locked while VESSEL
 * stands (GameSession gates completion on the boss's defeat).
 */

const WIDTH = 76;
const HEIGHT = 24;

/** Arena tile rect — also exported for tests. */
export const LEVEL05_ARENA = { tx0: 36, ty0: 5, tx1: 75, ty1: 20 } as const;

export function buildLevel05(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Mark (rad 21–23) över hela banan --------------------------------------
  b.ground(0, WIDTH - 1);

  // --- Förhall: plattformar att hoppa på -------------------------------------
  b.rect(14, 17, 18, 17, TileType.Platform);
  b.rect(22, 15, 26, 15, TileType.Platform);

  // --- Valvgrind: mur med gång (rad 19–20 öppna) ------------------------------
  b.rect(33, 13, 34, 18, TileType.Solid);
  // --- Arena-väggar och tak ---------------------------------------------------
  b.rect(35, 4, 35, 18, TileType.Solid);
  b.rect(35, 4, WIDTH - 1, 4, TileType.Solid);

  // --- Spawns -----------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [10, 20],
    [27, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 72, ty: 20 });
  b.bossArena('VESSEL', LEVEL05_ARENA.tx0, LEVEL05_ARENA.ty0, LEVEL05_ARENA.tx1, LEVEL05_ARENA.ty1);

  // Väktare i förhallen; arenan tillhör VESSEL ensam.
  for (const [tx, ty] of [
    [12, 15],
    [20, 13],
    [29, 18],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }
  b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx: 25, ty: 13 });

  // Powerups: sköld före grinden.
  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 31, ty: 20 });

  // Minnesfragment: Konst (valvets tema) + lite Historia.
  const fragments: Array<[number, number, FragmentTypeName]> = [
    [6, 20, 'Art'],
    [9, 20, 'History'],
    [16, 16, 'Art'],
    [24, 14, 'Art'],
    [30, 20, 'History'],
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
