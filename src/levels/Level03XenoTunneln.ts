import type { FragmentTypeName } from '../game/entities';
import type { LevelData } from './LevelData';
import { TileType } from './LevelData';
import { LevelBuilder } from './LevelBuilder';

/**
 * Nivå 3 — "XENO-tunneln" (tema: svärmens tunnel). Snabbare tempo, tätare
 * fiendetryck och tight plattformering i långa tunnelpartier: tak med
 * "tänder", en elektrifierad tunnelbotten (grinder), maskgallery under
 * bikakan och en sprint genom svärmen. Alla fyra fiendetyper. Trippelhopp
 * som belöning mitt i banan. 4 checkpoints.
 */

const WIDTH = 240;
const HEIGHT = 24;

export function buildLevel03(): LevelData {
  const b = new LevelBuilder(WIDTH, HEIGHT);

  // --- Taktak (rad 0–2) med hängande "tänder" ---------------------------------
  b.rect(0, 0, WIDTH - 1, 2, TileType.Solid);
  for (const tx of [13, 27, 41, 55, 69, 113, 125, 143, 149, 191, 203, 215, 225]) {
    b.rect(tx, 3, tx + 1, 5, TileType.Solid);
  }

  // --- Mark med elektrifierad tunnelbotten och sprintgropar --------------------
  b.ground(0, 31);
  b.hazardPit(32, 68); // grindern — lång elektrifierad sträcka
  b.ground(69, 121);
  b.hazardPit(122, 123); // sprint-hopp 1
  b.ground(124, 133);
  b.hazardPit(134, 135); // sprint-hopp 2
  b.ground(136, 145);
  b.hazardPit(146, 147); // sprint-hopp 3
  b.ground(148, WIDTH - 1);

  // --- Grindern: kedja av smala plattformar över hazardgolvet -------------------
  b.rect(33, 19, 35, 19, TileType.Platform);
  b.rect(38, 17, 40, 17, TileType.Platform);
  b.rect(43, 19, 45, 19, TileType.Platform);
  b.rect(49, 16, 51, 16, TileType.Platform);
  b.rect(55, 18, 57, 18, TileType.Platform);
  b.rect(60, 15, 62, 15, TileType.Platform);
  b.rect(65, 18, 67, 18, TileType.Platform);

  // --- Bikaksmassa: sänkt tak x76–104 (maskgallery) ------------------------------
  b.rect(76, 0, 104, 8, TileType.Solid);

  // Pelare i galleriet
  b.rect(80, 19, 80, 20, TileType.Solid);
  b.rect(88, 18, 88, 20, TileType.Solid);
  b.rect(96, 19, 96, 20, TileType.Solid);

  // --- Uppstigning till höjdrygg och nedstigning ----------------------------------
  b.rect(158, 18, 159, 18, TileType.Platform);
  b.rect(163, 14, 164, 14, TileType.Platform);
  b.rect(168, 12, 179, HEIGHT - 1, TileType.Solid); // höjdrygg, topp rad 12
  b.rect(183, 15, 184, 15, TileType.Platform);
  b.rect(188, 18, 189, 18, TileType.Platform);

  // --- Exit-piedestal ----------------------------------------------------------------
  b.rect(228, 18, 235, HEIGHT - 1, TileType.Solid);

  // --- Spawns ---------------------------------------------------------------------------
  b.spawn({ kind: 'playerSpawn', tx: 3, ty: 20 });

  for (const [tx, ty] of [
    [29, 20],
    [73, 20],
    [108, 20],
    [151, 20],
  ] as const) {
    b.spawn({ kind: 'checkpoint', tx, ty });
  }

  b.spawn({ kind: 'exit', tx: 231, ty: 17 });

  // Tunnelmasker: på mark, i galleriet och hängande under bikakan.
  for (const [tx, ty] of [
    [17, 20],
    [25, 20],
    [84, 20],
    [92, 20],
    [100, 20],
    [86, 9],
    [161, 20],
    [199, 20],
    [211, 20],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'TunnelWorm', tx, ty });
  }

  // Drönare: svärmen.
  for (const [tx, ty] of [
    [37, 14],
    [47, 13],
    [57, 15],
    [114, 17],
    [120, 15],
    [126, 17],
    [132, 14],
    [138, 16],
    [144, 15],
    [166, 12],
    [196, 16],
    [202, 14],
    [208, 16],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Drone', tx, ty });
  }

  for (const [tx, ty] of [
    [71, 19],
    [124, 19],
    [136, 19],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Glitcher', tx, ty });
  }

  for (const [tx, ty] of [
    [94, 16],
    [105, 17],
    [172, 10],
    [218, 18],
  ] as const) {
    b.spawn({ kind: 'enemy', enemy: 'Purger', tx, ty });
  }

  b.spawn({ kind: 'powerup', powerup: 'Shield', tx: 44, ty: 18 });
  b.spawn({ kind: 'powerup', powerup: 'TripleJump', tx: 90, ty: 15 });

  const fragments: Array<[number, number, FragmentTypeName]> = [
    [34, 18, 'Medicine'],
    [39, 16, 'History'],
    [50, 15, 'Medicine'],
    [61, 14, 'Philosophy'],
    [82, 18, 'History'],
    [98, 18, 'Medicine'],
    [116, 20, 'Medicine'],
    [128, 20, 'Medicine'],
    [140, 20, 'Medicine'],
    [175, 10, 'Philosophy'],
    [197, 20, 'Medicine'],
    [203, 20, 'Philosophy'],
    [215, 20, 'Philosophy'],
  ];
  for (const [tx, ty, fragment] of fragments) {
    b.spawn({ kind: 'fragment', fragment, tx, ty });
  }

  return b.build({
    id: 'lvl-03-xeno-tunneln',
    index: 3,
    name: 'XENO-tunneln',
    theme: 'Svärmens tunnel',
    intro:
      'ECHO: Svärmens tunnel. De äter det de inte förstår. Skynd dig, AURORA — och skjut dig fram.',
    parTimeSeconds: 95,
    fragmentTypes: ['History', 'Medicine', 'Philosophy'],
  });
}
