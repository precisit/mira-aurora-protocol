import type { Vec2 } from './entities';
import {
  AIR_ACCEL_PX_PER_S2,
  COYOTE_TIME_MS,
  GRAVITY_PX_PER_S2,
  GROUND_ACCEL_PX_PER_S2,
  INVULNERABLE_MS,
  JUMP_BUFFER_MS,
  JUMP_CUT_GRAVITY_SCALE,
  JUMP_VELOCITY_PX_PER_S,
  MAX_FALL_SPEED_PX_PER_S,
  RUN_SPEED_PX_PER_S,
} from './physics';
import { moveAndCollide, type CollisionFlags, type PhysicsBody } from './collision';
import type { Level } from '../levels/Level';

/**
 * AURORA — the player droid (PLAN.md §4 "Rörelse & kärnmekanik").
 *
 * Acceleration-based run, gravity, tight jumping with coyote time + jump
 * buffering, double jump locked behind the level-2 unlock pickup (temporary
 * TripleJump powerup adds a third), 8-direction aiming for shooting, and
 * damage bookkeeping (shield charges + invulnerability frames). Lives and
 * respawn rules live in GameSession; the player reports hits/deaths.
 *
 * `position` is the AABB top-left corner (world px).
 */

/** Player hitbox — small enough for 1-tile crawl spaces, generous to the art. */
export const PLAYER_WIDTH = 20;
export const PLAYER_HEIGHT = 26;

export interface PlayerInput {
  /** -1 = left, +1 = right, 0 = neutral. */
  moveX: number;
  /** Edge-triggered this frame. */
  jumpPressed: boolean;
  jumpHeld: boolean;
  shootHeld: boolean;
  /** Normalized aim direction; null falls back to horizontal facing. */
  aim: Vec2 | null;
}

export function emptyPlayerInput(): PlayerInput {
  return { moveX: 0, jumpPressed: false, jumpHeld: false, shootHeld: false, aim: null };
}

export interface PlayerAbilities {
  /** Permanent unlock from the level-2 story pickup ("andra thrustern"). */
  doubleJumpUnlocked: boolean;
}

export interface PlayerEffects {
  /** Overcharge powerup: rapid fire while > 0 (ms remaining). */
  overchargeMs: number;
  /** Triple-jump powerup: extra air jump while > 0 (ms remaining). */
  tripleJumpMs: number;
  /** Magnet powerup duration is tracked by the session (it moves fragments). */
  magnetMs: number;
  /** Shield powerup: absorbs one hit per charge. */
  shieldCharges: number;
}

export type PlayerHitOutcome = 'ignored' | 'shield' | 'killed';

export interface WeaponState {
  /** Cooldown remaining before the next shot may fire (ms). */
  cooldownMs: number;
}

export class Player implements PhysicsBody {
  public x: number;
  public y: number;
  public readonly width = PLAYER_WIDTH;
  public readonly height = PLAYER_HEIGHT;
  public vx = 0;
  public vy = 0;

  /** Facing sign (+1 right / −1 left); drives default aim and art flip. */
  public facing: 1 | -1 = 1;

  public grounded = false;
  public jumpedFromGroundThisAir = false;

  private coyoteTimerMs = 0;
  private jumpBufferTimerMs = 0;
  private airJumpsUsed = 0;
  private _invulnerableMs = 0;

  public readonly abilities: PlayerAbilities = { doubleJumpUnlocked: false };
  public readonly effects: PlayerEffects = {
    overchargeMs: 0,
    tripleJumpMs: 0,
    magnetMs: 0,
    shieldCharges: 0,
  };

  /** Shooting cooldown state (weapon logic itself lives in GameSession). */
  public weapon: WeaponState = { cooldownMs: 0 };

  /** Set when moveAndCollide reported a hazard overlap this step. */
  public touchedHazardLastStep = false;

  public constructor(spawn: Vec2) {
    this.x = spawn.x - this.width / 2;
    this.y = spawn.y - this.height / 2;
  }

  // ------------------------------------------------------------- queries --

  public get centerX(): number {
    return this.x + this.width / 2;
  }

  public get centerY(): number {
    return this.y + this.height / 2;
  }

  public get isInvulnerable(): boolean {
    return this._invulnerableMs > 0;
  }

  public get invulnerableMs(): number {
    return this._invulnerableMs;
  }

  /** Total jumps allowed per airtime given current abilities/effects. */
  public get maxJumps(): number {
    let jumps = 1; // ground jump
    if (this.abilities.doubleJumpUnlocked) jumps += 1;
    if (this.effects.tripleJumpMs > 0) jumps += 1;
    return jumps;
  }

  public get canDoubleJump(): boolean {
    return this.maxJumps >= 2;
  }

  /** Resolve an incoming hit; returns what happened so the session reacts. */
  public takeHit(): PlayerHitOutcome {
    if (this.isInvulnerable) return 'ignored';
    if (this.effects.shieldCharges > 0) {
      this.effects.shieldCharges -= 1;
      this._invulnerableMs = SHIELD_IFRAME_MS;
      return 'shield';
    }
    return 'killed';
  }

  /** Grant temporary invulnerability (used on spawn/respawn too). */
  public grantInvulnerability(ms: number = INVULNERABLE_MS): void {
    this._invulnerableMs = Math.max(this._invulnerableMs, Math.max(0, ms));
  }

  public resetEffects(): void {
    this.effects.overchargeMs = 0;
    this.effects.tripleJumpMs = 0;
    this.effects.magnetMs = 0;
    this.effects.shieldCharges = 0;
    this.weapon.cooldownMs = 0;
  }

  /** Full reset to a spawn point (level start / respawn). Keeps abilities. */
  public respawnAt(spawn: Vec2): void {
    this.x = spawn.x - this.width / 2;
    this.y = spawn.y - this.height / 2;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.jumpedFromGroundThisAir = false;
    this.coyoteTimerMs = 0;
    this.jumpBufferTimerMs = 0;
    this.airJumpsUsed = 0;
    this._invulnerableMs = RESPAWN_IFRAME_MS;
    this.resetEffects();
  }

  /**
   * Advance movement/jumping one fixed step. Returns collision flags so the
   * session can react to walls/ceilings/hazards.
   */
  public update(input: PlayerInput, level: Level, dtSeconds: number): CollisionFlags {
    const dtMs = dtSeconds * 1000;

    this.tickTimers(dtMs);
    this.applyHorizontal(input.moveX, dtSeconds);

    // Gravity first so a jump impulse set below is the final velocity for
    // this step (crisp, full-strength jumps).
    this.applyGravity(input.jumpHeld, dtSeconds);

    if (input.jumpPressed) this.jumpBufferTimerMs = JUMP_BUFFER_MS;

    // Resolve movement BEFORE handling the buffered press so a jump pressed
    // on the landing frame fires on that same step instead of being dropped
    // until the next one.
    const flags = moveAndCollide(level, this, dtSeconds);
    this.grounded = flags.onGround;
    if (this.grounded) {
      this.coyoteTimerMs = COYOTE_TIME_MS;
      this.airJumpsUsed = 0;
      this.jumpedFromGroundThisAir = false;
    }

    if (this.jumpBufferTimerMs > 0) {
      if (this.grounded || this.coyoteTimerMs > 0) {
        this.performGroundJump();
      } else if (this.airJumpsUsed < this.airJumpAllowance()) {
        this.performAirJump();
      }
    }

    this.touchedHazardLastStep = flags.touchedHazard;

    // Facing follows deliberate motion or aim.
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    else if (input.aim && Math.abs(input.aim.x) > 0.25) {
      this.facing = input.aim.x > 0 ? 1 : -1;
    }

    return flags;
  }

  // ------------------------------------------------------------ internals --

  /** Air jumps still available (double/triple), not counting the ground jump. */
  private airJumpAllowance(): number {
    return Math.max(0, this.maxJumps - 1);
  }

  private performGroundJump(): void {
    this.vy = JUMP_VELOCITY_PX_PER_S;
    this.grounded = false;
    this.coyoteTimerMs = 0;
    this.jumpBufferTimerMs = 0;
    this.jumpedFromGroundThisAir = true;
  }

  private performAirJump(): void {
    this.vy = JUMP_VELOCITY_PX_PER_S;
    this.airJumpsUsed += 1;
    this.jumpBufferTimerMs = 0;
  }

  private applyHorizontal(moveX: number, dtSeconds: number): void {
    const clampedMove = clampMove(moveX);
    const target = clampedMove * RUN_SPEED_PX_PER_S;
    const accel =
      this.grounded || this.coyoteTimerMs > 0 ? GROUND_ACCEL_PX_PER_S2 : AIR_ACCEL_PX_PER_S2;
    this.vx = approach(this.vx, target, accel * dtSeconds);
  }

  private applyGravity(jumpHeld: boolean, dtSeconds: number): void {
    const rising = this.vy < 0;
    const cutScale = rising && !jumpHeld ? JUMP_CUT_GRAVITY_SCALE : 1;
    this.vy = Math.min(this.vy + GRAVITY_PX_PER_S2 * cutScale * dtSeconds, MAX_FALL_SPEED_PX_PER_S);
  }

  private tickTimers(dtMs: number): void {
    if (this.coyoteTimerMs > 0) this.coyoteTimerMs = Math.max(0, this.coyoteTimerMs - dtMs);
    if (this.jumpBufferTimerMs > 0) this.jumpBufferTimerMs = Math.max(0, this.jumpBufferTimerMs - dtMs);
    if (this._invulnerableMs > 0) this._invulnerableMs = Math.max(0, this._invulnerableMs - dtMs);
    this.weapon.cooldownMs = Math.max(0, this.weapon.cooldownMs - dtMs);
    this.effects.overchargeMs = Math.max(0, this.effects.overchargeMs - dtMs);
    this.effects.tripleJumpMs = Math.max(0, this.effects.tripleJumpMs - dtMs);
    this.effects.magnetMs = Math.max(0, this.effects.magnetMs - dtMs);
  }
}

const SHIELD_IFRAME_MS = 600;
const RESPAWN_IFRAME_MS = 1500;

function clampMove(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
