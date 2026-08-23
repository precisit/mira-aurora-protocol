import type { LevelData } from './LevelData';
import { isStandableCell, tileAt } from './validate';
import { TileType } from './LevelData';

/**
 * Conservative reachability analysis for tile levels (task A2 test support,
 * later reusable for a debug overlay). Models AURORA's jump as a tile-space
 * profile: the maximum rise and horizontal span of one jump chain, plus how
 * far she may fall. Values are deliberately *pessimistic* relative to real
 * physics so "reachable" here means "surely reachable in game".
 *
 *   - single jump: clears ledges up to 4 tiles, crosses ≤6-tile gaps
 *   - double jump: clears ledges up to 8 tiles, crosses ≤10-tile gaps
 */
export interface JumpProfile {
  readonly maxRiseTiles: number;
  readonly maxSpanTiles: number;
  readonly maxDropTiles: number;
}

export const SINGLE_JUMP_PROFILE: JumpProfile = {
  maxRiseTiles: 4,
  maxSpanTiles: 6,
  maxDropTiles: 24,
};

export const DOUBLE_JUMP_PROFILE: JumpProfile = {
  maxRiseTiles: 8,
  maxSpanTiles: 10,
  maxDropTiles: 28,
};

/** All cells AURORA can stand on (empty cell with Solid/Platform below). */
export function standableGrid(data: LevelData): boolean[][] {
  return Array.from({ length: data.heightTiles }, (_, ty) =>
    Array.from({ length: data.widthTiles }, (_, tx) => isStandableCell(data, tx, ty)),
  );
}

function spawnCell(data: LevelData): { tx: number; ty: number } {
  const spawn = data.spawns.find((s) => s.kind === 'playerSpawn');
  if (!spawn) throw new Error(`level "${data.id}": no playerSpawn`);
  return { tx: spawn.tx, ty: spawn.ty };
}

/**
 * Conservative arc check for one jump edge (sx,sy) → (nx,ny):
 *  - rise capped by the profile, drop capped by `maxDropTiles`;
 *  - every intermediate column must be free of Solid tiles across the rows
 *    the arc spans (walls cannot be tunnelled "through" by the model);
 *  - vertical descents must not pass through Hazard cells.
 */
function canJump(
  data: LevelData,
  profile: JumpProfile,
  sx: number,
  sy: number,
  nx: number,
  ny: number,
): boolean {
  if (sy - ny > profile.maxRiseTiles) return false; // rise
  if (ny - sy > profile.maxDropTiles) return false; // drop

  // Never route through hazard cells on vertical sweeps at the target column.
  const stepY = Math.sign(ny - sy);
  if (stepY !== 0) {
    for (let y = sy + stepY; y !== ny; y += stepY) {
      if (tileAt(data, nx, y) === TileType.Hazard) return false;
    }
  }

  // Horizontal clearance: intermediate columns between the endpoints.
  const lo = Math.min(sx, nx);
  const hi = Math.max(sx, nx);
  if (hi - lo > 1) {
    const rowLo = Math.min(sy, ny);
    const rowHi = Math.max(sy, ny);
    for (let cx = lo + 1; cx <= hi - 1; cx++) {
      for (let cy = rowLo; cy <= rowHi; cy++) {
        if (tileAt(data, cx, cy) === TileType.Solid) return false;
      }
    }
  }
  return true;
}

/**
 * BFS over standable cells starting at the player spawn, moving only along
 * jumps permitted by `profile` (see {@link canJump}). Hazards are never
 * entered because only standable (safe-floor) cells are visited.
 */
export function reachableFrom(data: LevelData, profile: JumpProfile): boolean[][] {
  const standable = standableGrid(data);
  const seen = Array.from({ length: data.heightTiles }, () =>
    Array.from({ length: data.widthTiles }, () => false),
  );

  const start = spawnCell(data);
  if (!standable[start.ty]?.[start.tx]) return seen;

  const queue: Array<{ tx: number; ty: number }> = [start];
  seen[start.ty]![start.tx] = true;

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (let dx = -profile.maxSpanTiles; dx <= profile.maxSpanTiles; dx++) {
      const nx = current.tx + dx;
      if (nx < 0 || nx >= data.widthTiles) continue;
      // Rise above the current row is limited; drops are allowed further down.
      const minTy = Math.max(0, current.ty - profile.maxRiseTiles);
      const maxTy = Math.min(data.heightTiles - 1, current.ty + profile.maxDropTiles);
      for (let ny = minTy; ny <= maxTy; ny++) {
        if (!standable[ny]?.[nx] || seen[ny]?.[nx]) continue;
        if (!canJump(data, profile, current.tx, current.ty, nx, ny)) continue;
        const row = seen[ny];
        if (row) row[nx] = true;
        queue.push({ tx: nx, ty: ny });
      }
    }
  }

  return seen;
}

/** True when the target cell is reachable from the spawn under `profile`. */
export function isReachable(
  data: LevelData,
  profile: JumpProfile,
  tx: number,
  ty: number,
): boolean {
  return reachableFrom(data, profile)[ty]?.[tx] === true;
}
