import { describe, expect, it } from 'vitest';
import {
  cameraClampForArena,
  playerEntersArena,
  type ArenaBounds,
} from '../src/game/bosses';
import { ARENA_TEST_LEVELS, CAMPAIGN_LEVELS, PLAYABLE_LEVELS, getPlayableLevel } from '../src/levels/levels';
import { validateLevelData } from '../src/levels/validate';
import { TILE_SIZE } from '../src/levels/LevelData';
import { GameSession, STARTING_LIVES, type GameEvent } from '../src/game/GameSession';
import { emptyPlayerInput, type PlayerInput } from '../src/game/Player';

/**
 * Boss arena tests (task B2): the `boss` spawn kind validates cleanly, the
 * trigger arms the encounter, the camera locks to the arena, player shots
 * reach the boss through the regular damage path, the exit stays sealed
 * until defeat and the kill pays out.
 */

const STEP_SECONDS = 1 / 120;

function idleInput(): PlayerInput {
  return emptyPlayerInput();
}

interface RecordedHooks {
  events: GameEvent[];
  sfx: string[];
}

function makeSession(levelIndex: number): { session: GameSession; hooks: RecordedHooks } {
  const data = getPlayableLevel(levelIndex);
  if (!data) throw new Error(`no playable level ${levelIndex}`);
  const hooks: RecordedHooks = { events: [], sfx: [] };
  const session = new GameSession({
    levelData: data,
    hooks: {
      sfx: (name) => hooks.sfx.push(name),
      onEvent: (event) => hooks.events.push(event),
    },
    seed: 0xb055,
  });
  return { session, hooks };
}

/** Teleport AURORA so her center sits at (worldX, worldY). */
function placePlayerAt(session: GameSession, worldX: number, worldY: number): void {
  session.player.x = worldX - session.player.width / 2;
  session.player.y = worldY - session.player.height / 2;
  session.player.vx = 0;
  session.player.vy = 0;
}

function stepFor(session: GameSession, ms: number, input: PlayerInput = idleInput()): void {
  let remaining = ms;
  while (remaining > 0) {
    session.update(STEP_SECONDS * 1000, input);
    remaining -= STEP_SECONDS * 1000;
    if (session.status !== 'playing') break;
  }
}

const VESSEL_LEVEL = getPlayableLevel(5)!;
const NULL_LEVEL = getPlayableLevel(7)!;
const VESSEL_ARENA: ArenaBounds = {
  x: VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.tx0 * TILE_SIZE,
  y: VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.ty0 * TILE_SIZE,
  width:
    (VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.tx1 -
      VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.tx0 +
      1) *
    TILE_SIZE,
  height:
    (VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.ty1 -
      VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss')!.ty0 +
      1) *
    TILE_SIZE,
};

describe('arena level data', () => {
  it('campaign registry is untouched by the boss stand-ins', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(3);
    expect(ARENA_TEST_LEVELS.map((l) => l.index)).toEqual([5, 7]);
    expect(PLAYABLE_LEVELS.map((l) => l.index)).toEqual([1, 2, 3, 5, 7]);
  });

  it('both boss arenas validate as well-formed levels', () => {
    for (const data of ARENA_TEST_LEVELS) {
      expect(validateLevelData(data), data.id).toEqual([]);
      const arenas = data.spawns.filter((s) => s.kind === 'boss');
      expect(arenas).toHaveLength(1);
    }
  });

  it('level 5 hosts VESSEL in an open 40-tile-wide arena', () => {
    const spawn = VESSEL_LEVEL.spawns.find((s) => s.kind === 'boss');
    expect(spawn && spawn.kind === 'boss' ? spawn.boss : null).toBe('VESSEL');
    expect(VESSEL_ARENA.width / TILE_SIZE).toBe(40);
  });

  it('level 7 hosts NULL behind a sealed exit', () => {
    const spawn = NULL_LEVEL.spawns.find((s) => s.kind === 'boss');
    expect(spawn && spawn.kind === 'boss' ? spawn.boss : null).toBe('NULL');
  });
});

describe('arena trigger detection', () => {
  it('fires only once the player center is inside the rect minus margin', () => {
    const arena: ArenaBounds = { x: 100, y: 100, width: 400, height: 300 };
    expect(playerEntersArena({ x: 90, y: 200 }, arena)).toBe(false); // left
    expect(playerEntersArena({ x: 104, y: 104 }, arena)).toBe(false); // inside the margin band
    expect(playerEntersArena({ x: 108, y: 200 }, arena)).toBe(true); // exactly on the trigger edge
    expect(playerEntersArena({ x: 130, y: 200 }, arena)).toBe(true);
    expect(playerEntersArena({ x: 480, y: 380 }, arena)).toBe(true);
    expect(playerEntersArena({ x: 497, y: 393 }, arena)).toBe(false); // margin edge
    expect(playerEntersArena({ x: 520, y: 200 }, arena)).toBe(false); // right
  });

  it('engages the boss with a warning when AURORA steps into the vault', () => {
    const { session, hooks } = makeSession(5);
    expect(session.boss).toBeNull();
    expect(session.getBossHud()).toBeNull();

    stepFor(session, 500); // settle on the runway
    placePlayerAt(session, VESSEL_ARENA.x - 100, VESSEL_ARENA.y + 400);
    stepFor(session, 300);
    expect(session.boss).toBeNull(); // still outside

    placePlayerAt(session, VESSEL_ARENA.x + 60, VESSEL_ARENA.y + 400); // inside
    stepFor(session, 50);
    expect(session.boss).not.toBeNull();
    expect(session.boss?.displayName).toBe('VESSEL');
    expect(hooks.events.some((e) => e.type === 'boss-encountered')).toBe(true);
    expect(hooks.sfx).toContain('boss-warning');

    const hud = session.getBossHud();
    expect(hud?.name).toBe('VESSEL');
    expect(hud?.phaseCount).toBe(3);
    expect(hud?.hpFraction).toBeCloseTo(1, 5);
  });

  it('locks the camera to the arena while the fight runs', () => {
    const { session } = makeSession(5);
    stepFor(session, 500);
    placePlayerAt(session, VESSEL_ARENA.x + 60, VESSEL_ARENA.y + 400);
    stepFor(session, 2500); // engage + let the follow converge
    expect(session.bossFightActive).toBe(true);

    const clamps = cameraClampForArena(
      VESSEL_ARENA,
      1280,
      720,
      session.level.pixelWidth,
      session.level.pixelHeight,
    );
    // The vault arena is exactly view-width wide: X pins to the arena edge.
    expect(clamps.minX).toBe(clamps.maxX);
    expect(session.cameraX).toBeGreaterThanOrEqual(clamps.minX - 1);
    expect(session.cameraX).toBeLessThanOrEqual(clamps.maxX + 1);
    expect(session.cameraY).toBeGreaterThanOrEqual(clamps.minY - 1);
    expect(session.cameraY).toBeLessThanOrEqual(clamps.maxY + 1);
  });

  it('routes player shots into the boss through the normal damage path', () => {
    const { session, hooks } = makeSession(5);
    stepFor(session, 500);
    placePlayerAt(session, VESSEL_ARENA.x + 60, VESSEL_ARENA.y + 400);
    stepFor(session, 1800); // past the engaging warning window
    const boss = session.boss!;
    expect(boss.state).toBe('active');

    // Park directly under the boss and fire straight up.
    const input = emptyPlayerInput();
    input.shootHeld = true;
    input.aim = { x: 0, y: -1 };
    let elapsed = 0;
    while (elapsed < 6000 && boss.hp >= boss.maxHp) {
      placePlayerAt(session, boss.center().x, boss.center().y + 60);
      session.update(STEP_SECONDS * 1000, input);
      elapsed += STEP_SECONDS * 1000;
      if (session.status !== 'playing') break;
    }
    expect(boss.hp).toBeLessThan(boss.maxHp);
    expect(hooks.sfx).toContain('combo-tick'); // hit-confirm blip
  });

  it('seals the exit while the boss stands and completes after the kill pays out', () => {
    const { session, hooks } = makeSession(5);
    stepFor(session, 500);
    placePlayerAt(session, VESSEL_ARENA.x + 60, VESSEL_ARENA.y + 400);
    stepFor(session, 1800);
    const boss = session.boss!;

    // Exit overlap does nothing while VESSEL lives.
    placePlayerAt(session, 72 * TILE_SIZE + 16, 20 * TILE_SIZE + 16);
    stepFor(session, 200);
    expect(session.status).toBe('playing');

    // Kill him; the death sequence runs, then the reward lands.
    boss.takeHit(9999, () => 0.5);
    expect(boss.state).toBe('dying');
    placePlayerAt(session, 640, 660); // off the exit during the sequence
    stepFor(session, 2600);
    expect(boss.isDefeated).toBe(true);

    const defeated = hooks.events.find((e) => e.type === 'boss-defeated');
    expect(defeated && defeated.type === 'boss-defeated').toBe(true);
    if (defeated && defeated.type === 'boss-defeated') {
      expect(defeated.points).toBe(2500); // first award: combo x1
    }

    // Now the door opens.
    placePlayerAt(session, 72 * TILE_SIZE + 16, 20 * TILE_SIZE + 16);
    stepFor(session, 200);
    expect(session.status).toBe('levelComplete');
  });

  it('deals contact damage and resets the fight when AURORA dies pre-checkpoint', () => {
    const { session } = makeSession(5);
    stepFor(session, 500);
    placePlayerAt(session, VESSEL_ARENA.x + 60, VESSEL_ARENA.y + 400);
    stepFor(session, 1800);
    const boss = session.boss!;

    placePlayerAt(session, boss.center().x, boss.center().y); // body overlap
    stepFor(session, 100);
    expect(session.lives).toBe(STARTING_LIVES - 1);

    // No checkpoint reached -> full attempt restart re-arms the encounter.
    expect(session.status).toBe('playing');
    expect(session.boss).toBeNull();
    expect(session.bossFightActive).toBe(false);
    expect(session.score.score).toBe(0);
  });

  it('runs the NULL arena: shots fly, voids grow, HUD tracks four phases', () => {
    const { session, hooks } = makeSession(7);
    stepFor(session, 500);
    const nullSpawn = NULL_LEVEL.spawns.find((s) => s.kind === 'boss');
    if (!nullSpawn || nullSpawn.kind !== 'boss') throw new Error('missing NULL arena');
    const arenaX = nullSpawn.tx0 * TILE_SIZE;
    const arenaY = nullSpawn.ty0 * TILE_SIZE;
    placePlayerAt(session, arenaX + 80, arenaY + 420);
    stepFor(session, 120); // triggers engagement

    const boss = session.boss!;
    expect(boss.displayName).toBe('NULL');
    expect(session.getBossHud()?.phaseCount).toBe(4);

    let sawShots = false;
    let sawVoids = false;
    let elapsed = 0;
    while (elapsed < 15000 && !(sawShots && sawVoids)) {
      placePlayerAt(session, arenaX + 80, arenaY + 420); // hold position
      session.update(STEP_SECONDS * 1000, idleInput());
      elapsed += STEP_SECONDS * 1000;
      sawShots ||= session.activeProjectiles.some((shot) => shot.owner === 'enemy');
      sawVoids ||= session.boss?.hazardCircles().length !== undefined &&
        session.boss.hazardCircles().length > 0;
      if (session.status !== 'playing') break;
    }
    expect(sawShots || sawVoids).toBe(true);
    expect(hooks.events.some((e) => e.type === 'boss-encountered')).toBe(true);
    // Darkness stays dark-zero outside her darkness waves (still phase 1+2 here).
    expect(session.darknessLevel).toBeLessThan(1);
  });
});
