import { describe, expect, it } from 'vitest';
import { Level, parseAsciiLevel } from '../src/levels/Level';
import { TILE_SIZE } from '../src/levels/LevelData';
import {
  GRAVITY_PX_PER_S2,
  JUMP_VELOCITY_PX_PER_S,
  MAX_FALL_SPEED_PX_PER_S,
  RUN_SPEED_PX_PER_S,
} from '../src/game/physics';
import { Player, emptyPlayerInput, type PlayerInput } from '../src/game/Player';

/**
 * Player physics tests (B0): acceleration, gravity + terminal velocity,
 * jump with coyote time and buffering, double jump gating, jump cut,
 * shields and i-frames.
 */

const STEP_S = 1 / 120;

function makeLevel(rows: string[]): Level {
  return new Level(parseAsciiLevel('player-test', 'Player Test', rows));
}

const FLAT_GROUND = [
  '........................',
  '........................',
  '..S.....................',
  '########################',
];

function spawnPlayer(level: Level): Player {
  const point = level.spawnPoint();
  if (!point) throw new Error('test level has no spawn');
  return new Player(point);
}

function step(player: Player, level: Level, input: Partial<PlayerInput> = {}, steps = 1): void {
  const full: PlayerInput = { ...emptyPlayerInput(), ...input };
  for (let i = 0; i < steps; i++) player.update(full, level, STEP_S);
}

describe('horizontal movement', () => {
  it('accelerates toward run speed and stops with friction', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    step(player, level, {}, 4); // settle on ground

    step(player, level, { moveX: 1 }, 30);
    expect(player.vx).toBeGreaterThan(RUN_SPEED_PX_PER_S * 0.5);
    const maxVx = Math.max(player.vx, RUN_SPEED_PX_PER_S);
    expect(maxVx).toBeLessThanOrEqual(RUN_SPEED_PX_PER_S + 1);

    const xWhileRunning = player.x;
    step(player, level, { moveX: 0 }, 60); // friction halts her
    expect(player.vx).toBe(0);
    expect(player.x).toBeGreaterThan(xWhileRunning); // but she drifted first
  });

  it('caps speed at RUN_SPEED even with prolonged input', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    step(player, level, {}, 4);

    step(player, level, { moveX: 1 }, 240);
    expect(player.vx).toBeCloseTo(RUN_SPEED_PX_PER_S, 0);
  });
});

describe('gravity', () => {
  it('accelerates downward in air and clamps at terminal velocity', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    // Teleport far above the floor (negative Y is open sky) so the fall is
    // long enough to exceed 30 steps of gravity accumulation.
    player.respawnAt({ x: player.centerX, y: -60 });

    let previousVy = player.vy;
    let maxVy = 0;
    for (let i = 0; i < 600; i++) {
      step(player, level, {});
      if (player.grounded) break;
      // Airborne: gravity only accelerates, never beyond terminal velocity.
      expect(player.vy).toBeGreaterThanOrEqual(previousVy - 0.001);
      expect(player.vy).toBeLessThanOrEqual(MAX_FALL_SPEED_PX_PER_S + 0.001);
      previousVy = player.vy;
      maxVy = Math.max(maxVy, player.vy);
    }
    expect(player.grounded).toBe(true);
    expect(maxVy).toBeGreaterThan(GRAVITY_PX_PER_S2 * STEP_S * 30);
  });

  it('cuts jump height short when the jump key is released early', () => {
    const heldLevel = makeLevel(FLAT_GROUND);
    const releasedLevel = makeLevel(FLAT_GROUND);

    const held = spawnPlayer(heldLevel);
    const released = spawnPlayer(releasedLevel);
    step(held, heldLevel, {}, 8); // settle fully onto the floor
    step(released, releasedLevel, {}, 8);

    let heldApex = Number.POSITIVE_INFINITY;
    let releasedApex = Number.POSITIVE_INFINITY;

    step(held, heldLevel, { jumpPressed: true, jumpHeld: true });
    step(released, releasedLevel, { jumpPressed: true, jumpHeld: false });

    for (let i = 0; i < 120 && (!held.grounded || !released.grounded); i++) {
      if (!held.grounded) {
        step(held, heldLevel, { jumpHeld: true });
        heldApex = Math.min(heldApex, held.y);
      }
      if (!released.grounded) {
        step(released, releasedLevel, { jumpHeld: false });
        releasedApex = Math.min(releasedApex, released.y);
      }
    }

    expect(heldApex).toBeLessThan(releasedApex); // holding jumps higher
  });
});

describe('jumping', () => {
  it('applies the jump impulse when grounded', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    step(player, level, {}, 6);

    step(player, level, { jumpPressed: true, jumpHeld: true });
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
    expect(player.grounded).toBe(false);
  });

  // Spawn stands one tile left of a cliff; a short walk reaches the edge
  // well inside the 90 ms coyote window.
  const LEDGE = [
    '............',
    '............',
    '.....S.     ',
    '######  ####',
  ];

  function ledgeFixture(): { level: Level; player: Player } {
    const level = makeLevel(LEDGE);
    const player = spawnPlayer(level);
    step(player, level, {}, 6);
    return { level, player };
  }

  it('still jumps within the coyote window after walking off a ledge', () => {
    const { level, player } = ledgeFixture();
    expect(player.grounded).toBe(true);

    // Run right off the ledge (≈16 steps to clear the edge at RUN_SPEED;
    // she leaves the ground around step 15, well inside the 90 ms window).
    step(player, level, { moveX: 1, jumpHeld: false }, 16);
    expect(player.grounded).toBe(false);

    const vyBefore = player.vy;
    step(player, level, { jumpPressed: true, jumpHeld: true });
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
    expect(vyBefore).toBeGreaterThan(0); // she was falling
  });

  it('refuses a ground-style jump once coyote time has lapsed', () => {
    const { level, player } = ledgeFixture();

    step(player, level, { moveX: 1 }, 30); // ≈250 ms past the ledge — coyote expired
    expect(player.grounded).toBe(false);
    const vyBefore = player.vy;
    step(player, level, { jumpPressed: true, jumpHeld: false });
    // No double jump yet (locked), so the press must not lift her.
    expect(player.vy).toBeGreaterThanOrEqual(vyBefore);
  });

  it('buffers a jump pressed just before landing', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    step(player, level, {}, 6);
    player.respawnAt({ x: player.centerX, y: 40 }); // drop her into the air

    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      step(player, level, {});
      landed = player.grounded;
    }
    expect(landed).toBe(true);

    // Jump again to prove normal jumping works post-landing; then verify the
    // buffer path directly: press mid-air right before touching down.
    player.respawnAt({ x: player.centerX, y: 40 });
    let bufferedJumpFired = false;
    for (let i = 0; i < 90; i++) {
      const nearGround = player.vy > 0 && player.y + player.height > 3 * TILE_SIZE - 14;
      step(player, level, { jumpPressed: nearGround, jumpHeld: true });
      if (nearGround && player.vy === JUMP_VELOCITY_PX_PER_S) {
        bufferedJumpFired = true;
        break;
      }
    }
    expect(bufferedJumpFired).toBe(true);
  });
});

describe('double jump gating', () => {
  function airbornUnlockedFixture(): { level: Level; player: Player } {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    step(player, level, {}, 6);
    return { level, player };
  }

  it('ignores an air-jump press while double jump is locked', () => {
    const { level, player } = airbornUnlockedFixture();
    player.respawnAt({ x: player.centerX, y: 40 });

    step(player, level, {}); // start falling
    const vyBefore = player.vy;
    step(player, level, { jumpPressed: true, jumpHeld: false });
    expect(player.canDoubleJump).toBe(false);
    expect(player.vy).toBeGreaterThanOrEqual(vyBefore);
  });

  it('allows exactly one air jump once unlocked', () => {
    const { level, player } = airbornUnlockedFixture();
    player.abilities.doubleJumpUnlocked = true;
    player.respawnAt({ x: player.centerX, y: 40 });

    // First press mid-air → double jump fires.
    step(player, level, { jumpPressed: true, jumpHeld: false });
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
    const afterDouble = player.y;

    // Second press → no more air jumps.
    step(player, level, { jumpPressed: true, jumpHeld: false }, 3);
    expect(player.vy).toBeGreaterThan(JUMP_VELOCITY_PX_PER_S); // gravity wins
    void afterDouble;
  });

  it('TripleJump powerup grants one additional air jump temporarily', () => {
    const { level, player } = airbornUnlockedFixture();
    player.abilities.doubleJumpUnlocked = true;
    player.respawnAt({ x: player.centerX, y: 40 });
    // Granted after respawnAt: respawning deliberately clears temp effects.
    player.effects.tripleJumpMs = 8000;

    step(player, level, { jumpPressed: true }); // double
    step(player, level, { jumpPressed: true }); // triple
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
    expect(player.maxJumps).toBe(3);
  });

  it('resets air jumps after landing', () => {
    const { level, player } = airbornUnlockedFixture();
    player.abilities.doubleJumpUnlocked = true;
    player.respawnAt({ x: player.centerX, y: 48 });
    step(player, level, { jumpPressed: true }); // burn the air jump

    for (let i = 0; i < 400 && !player.grounded; i++) step(player, level, {});
    expect(player.grounded).toBe(true);

    step(player, level, { jumpPressed: true, jumpHeld: true }); // ground jump
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
    step(player, level, { jumpHeld: true });
    step(player, level, { jumpPressed: true, jumpHeld: false }); // air jump again
    expect(player.vy).toBe(JUMP_VELOCITY_PX_PER_S);
  });
});

describe('damage bookkeeping', () => {
  it('shield absorbs the first hit and grants brief i-frames', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    player.effects.shieldCharges = 1;

    expect(player.takeHit()).toBe('shield');
    expect(player.effects.shieldCharges).toBe(0);
    expect(player.isInvulnerable).toBe(true);
  });

  it('ignores hits during invulnerability frames', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    player.grantInvulnerability(1000);

    expect(player.takeHit()).toBe('ignored');
  });

  it('dies without shield outside i-frames', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    expect(player.takeHit()).toBe('killed');
  });

  it('respawn places the player at the point with fresh effects and grace', () => {
    const level = makeLevel(FLAT_GROUND);
    const player = spawnPlayer(level);
    player.effects.shieldCharges = 1;
    player.vx = 300;

    player.respawnAt({ x: 200, y: 100 });
    expect(player.centerX).toBeCloseTo(200, 0);
    expect(player.centerY).toBeCloseTo(100, 0);
    expect(player.vx).toBe(0);
    expect(player.isInvulnerable).toBe(true);
    expect(player.effects.shieldCharges).toBe(0);
  });
});
