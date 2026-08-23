import type { BossId } from '../game/bosses';
import type { LevelData, LevelSpawn } from './LevelData';
import { TileType } from './LevelData';

/**
 * Fluent helper for hand-building tile levels in TS (task A2). Produces the
 * same data-driven {@link LevelData} the ASCII parser emits — levels stay
 * plain data modules; this just keeps large maps readable and precise.
 *
 * Coordinates are inclusive tile rects; out-of-range writes are clamped.
 */
export class LevelBuilder {
  public readonly spawns: LevelSpawn[] = [];
  private readonly grid: TileType[][];

  public constructor(
    public readonly widthTiles: number,
    public readonly heightTiles: number,
  ) {
    if (widthTiles < 1 || heightTiles < 1) {
      throw new Error(`LevelBuilder: invalid dimensions ${widthTiles}×${heightTiles}`);
    }
    this.grid = Array.from({ length: heightTiles }, () =>
      Array.from({ length: widthTiles }, () => TileType.Empty),
    );
  }

  /** Single tile write. */
  public set(tx: number, ty: number, tile: TileType): this {
    return this.rect(tx, ty, tx, ty, tile);
  }

  /** Inclusive rectangle fill (clamped to the grid). */
  public rect(x0: number, y0: number, x1: number, y1: number, tile: TileType): this {
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(this.widthTiles - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(this.heightTiles - 1, Math.max(y0, y1));
    for (let ty = ay; ty <= by; ty++) {
      const row = this.grid[ty];
      if (!row) continue;
      for (let tx = ax; tx <= bx; tx++) {
        row[tx] = tile;
      }
    }
    return this;
  }

  /** Solid ground from `topRow` down to the level floor. Default top leaves a 3-row crust. */
  public ground(x0: number, x1: number, topRow = this.heightTiles - 3): this {
    return this.rect(x0, topRow, x1, this.heightTiles - 1, TileType.Solid);
  }

  /**
   * Carve a hazard pit through the ground crust: clears rows from `surfaceRow`
   * (default walking surface) to the floor and lays a hazard strip at `floorRow`.
   */
  public hazardPit(
    x0: number,
    x1: number,
    options: { surfaceRow?: number; floorRow?: number } = {},
  ): this {
    const surface = options.surfaceRow ?? this.heightTiles - 3;
    const floor = options.floorRow ?? this.heightTiles - 1;
    this.rect(x0, surface, x1, this.heightTiles - 1, TileType.Empty);
    return this.rect(x0, floor, x1, floor, TileType.Hazard);
  }

  /** Append an entity spawn (tile coordinates). */
  public spawn(spawn: LevelSpawn): this {
    this.spawns.push(spawn);
    return this;
  }

  /**
   * Mark a boss room (task B2): inclusive tile rect the encounter triggers
   * inside. Keep the rect free of solid tiles so the fight stays open.
   */
  public bossArena(boss: BossId, tx0: number, ty0: number, tx1: number, ty1: number): this {
    return this.spawn({ kind: 'boss', boss, tx0, ty0, tx1, ty1 });
  }

  /**
   * Lay a timed laser grid (task C2): an inclusive tile rect that pulses on
   * `periodMs` (beam fires for `onMs`, shifted by `offsetMs`). Keep the span
   * clear of solid tiles so the beam reads and hits cleanly.
   */
  public laserGrid(
    tx0: number,
    ty0: number,
    tx1: number,
    ty1: number,
    timing: { periodMs: number; onMs: number; offsetMs?: number },
  ): this {
    return this.spawn({
      kind: 'laser',
      tx0,
      ty0,
      tx1,
      ty1,
      periodMs: timing.periodMs,
      onMs: timing.onMs,
      offsetMs: timing.offsetMs ?? 0,
    });
  }

  /**
   * Finish the level. `meta` must be complete for campaign levels — use
   * {@link validateLevelData} (tests + CI) to catch authoring mistakes.
   */
  public build(meta: {
    id: string;
    index: number;
    name: string;
    theme: string;
    intro: string;
    parTimeSeconds: number;
    fragmentTypes: LevelData['fragmentTypes'];
  }): LevelData {
    return {
      ...meta,
      widthTiles: this.widthTiles,
      heightTiles: this.heightTiles,
      tiles: this.grid.map((row) => [...row]),
      spawns: [...this.spawns],
    };
  }
}
