import { EntityPool, aabbOverlap, type AABB } from './entities';
import { Player, emptyPlayerInput, type PlayerInput } from './Player';
import {
  createProjectile,
  launchProjectile,
  updateProjectile,
  projectileOverlaps,
  type Projectile,
} from './Projectile';
import {
  damageEnemy,
  enemyCenter,
  classifyCrawlSurface,
  spawnEnemyAt,
  updateEnemy,
  type Enemy,
  type EnemyFireEvent,
} from './enemies';
import { animatePickup, createPickupsFromSpawns, type Pickup } from './pickups';
import { CHECKPOINT_BONUS, ScoreTracker, type SfxSink } from './score';
import { ParticleSystem } from './ParticleSystem';
import { touchesHazard } from './collision';
import { WEAPONS, DEFAULT_WEAPON_ID, aimDirection } from './weapons';
import { ENEMY_COLORS_FALLBACK } from './renderPalette';
import {
  ABILITY_UNLOCKS,
  ENEMIES,
  FRAGMENT_POINT_VALUES,
  POWERUPS,
  type FragmentTypeName,
  type PowerupTypeName,
} from './entities';
import { Level } from '../levels/Level';
import type { LevelData } from '../levels/LevelData';
import { SeededRng } from '../core/Rng';
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../renderer/types';

/**
 * GameSession — one playable level attempt (task B0).
 *
 * Owns the player, enemies, projectiles, pickups and particles for the
 * active level and enforces PLAN.md §4 rules:
 *
 *   - 3 lives per level; any hit or hazard kills AURORA.
 *   - Death before the first checkpoint restarts the whole level attempt
 *     (score resets so fragments can't be farmed); death after a checkpoint
 *     respawns at it keeping collected state.
 *   - Game over (0 lives): main.ts restarts the level with fresh lives.
 *   - Checkpoints give bonus points + sfx once each.
 *   - Combo multiplier applies to fragment pickups and kills.
 *
 * Pure simulation: no WebGPU/DOM imports, fixed-timestep `update(stepMs)`,
 * deterministic via seeded RNG — fully unit-testable in Node.
 */

export const STARTING_LIVES = 3;
export const MAX_LIVES = 9;

const ENEMY_PROJECTILE_SPEED_PX_PER_S = 320;
const ENEMY_PROJECTILE_LIFETIME_S = 2.2;

const MAGNET_RADIUS_PX = 220;
const MAGNET_PULL_PX_PER_S = 460;

/** Pickup collection uses a slightly forgiving box around the player. */
const PICKUP_FORGIVENESS_PX = 6;

/** Camera follow stiffness (higher = snappier). */
const CAMERA_FOLLOW_RATE = 8;

export type SessionStatus = 'playing' | 'levelComplete' | 'gameOver';

export type GameEvent =
  | { type: 'checkpoint-activated'; index: number }
  | { type: 'unlock-granted'; unlock: string }
  | { type: 'powerup-collected'; powerup: PowerupTypeName }
  | { type: 'fragment-collected'; fragment: FragmentTypeName }
  | { type: 'enemy-killed'; kind: string }
  | { type: 'player-died'; remainingLives: number }
  | { type: 'respawned'; atCheckpoint: boolean }
  | { type: 'level-restarted' }
  | { type: 'game-over' }
  | { type: 'level-complete' };

export interface SessionHooks {
  /** Procedural SFX sink (defaults to silence — tests stay quiet). */
  sfx?: SfxSink;
  /** Gameplay events for HUD toasts/progression handling. */
  onEvent?: (event: GameEvent) => void;
}

export interface GameSessionOptions {
  levelData: LevelData;
  hooks?: SessionHooks;
  /** Seed for deterministic particle/teleport randomness. */
  seed?: number;
}

interface CheckpointState {
  worldX: number;
  worldY: number;
  activated: boolean;
}

export class GameSession {
  public readonly level: Level;
  public readonly player: Player;
  public readonly particles: ParticleSystem;
  public readonly score = new ScoreTracker({
    onComboTick: ({ tier }) => this.hooks.sfx?.('combo-tick', { step: tier }),
  });

  private readonly hooks: SessionHooks;
  private readonly rng: SeededRng;
  private readonly enemies: Enemy[] = [];
  private readonly projectiles = new EntityPool<Projectile>(createProjectile);
  private readonly pickups: Pickup[] = [];
  private readonly checkpointList: CheckpointState[] = [];
  private exitBox: AABB | null = null;

  private _lives = STARTING_LIVES;
  private _status: SessionStatus = 'playing';
  private _timeMs = 0;
  private _cameraX = 0;
  private _cameraY = 0;
  private _killsThisSession = 0;

  public constructor(options: GameSessionOptions) {
    this.level = new Level(options.levelData);
    this.hooks = options.hooks ?? {};
    this.rng = new SeededRng(options.seed ?? 0xa7001);

    const spawn = this.level.spawnPoint();
    if (!spawn) throw new Error(`GameSession: level "${options.levelData.id}" has no playerSpawn`);
    this.player = new Player(spawn);

    this.particles = new ParticleSystem(this.rng);
    this.buildWorldEntities();

    // Start the camera on the player so frame one is already framed.
    this.snapCamera();
    // Brief spawn protection so enemies don't instagib on frame one.
    this.player.grantInvulnerability(600);
  }

  // ------------------------------------------------------------- queries --

  public get lives(): number {
    return this._lives;
  }

  public get status(): SessionStatus {
    return this._status;
  }

  public get timeMs(): number {
    return this._timeMs;
  }

  public get cameraX(): number {
    return this._cameraX;
  }

  public get cameraY(): number {
    return this._cameraY;
  }

  public get kills(): number {
    return this._killsThisSession;
  }

  public get activeEnemies(): readonly Enemy[] {
    return this.enemies.filter((e) => e.active);
  }

  public get activeProjectiles(): readonly Projectile[] {
    return this.projectiles.active;
  }

  public get activePickups(): readonly Pickup[] {
    return this.pickups.filter((p) => p.active);
  }

  /** Checkpoint bookkeeping (for rendering + respawn rules). */
  public get checkpoints(): readonly CheckpointState[] {
    return this.checkpointList;
  }

  public get exitBoxOrNull(): AABB | null {
    return this.exitBox;
  }

  /** World-px position of the last activated checkpoint, if any. */
  public get lastCheckpointPosition(): { x: number; y: number } | null {
    for (let i = this.checkpointList.length - 1; i >= 0; i--) {
      const checkpoint = this.checkpointList[i];
      if (checkpoint?.activated) {
        return { x: checkpoint.worldX + 16, y: checkpoint.worldY + 16 };
      }
    }
    return null;
  }

  public get checkpointCountActivated(): number {
    return this.checkpointList.filter((c) => c.activated).length;
  }

  // -------------------------------------------------------------- update --

  /** Advance the simulation one fixed step (`stepMs` from GameLoop). */
  public update(stepMs: number, input: PlayerInput = emptyPlayerInput()): void {
    if (this._status !== 'playing') return;
    const dtSeconds = Math.max(0, stepMs / 1000);
    this._timeMs += stepMs;
    this.score.update(this._timeMs);

    // --- player movement -------------------------------------------------
    this.player.update(input, this.level, dtSeconds);
    if (this.hazardUnderPlayer()) {
      this.killPlayer();
      return;
    }

    this.handleShooting(input);
    this.updateEnemies(dtSeconds);
    this.updateProjectiles(dtSeconds);
    this.updatePickups(dtSeconds);
    this.updateCheckpointsAndExit();
    this.particles.update(dtSeconds, 1400);
    this.followCamera(dtSeconds);
  }

  // ------------------------------------------------------------ shooting --

  private handleShooting(input: PlayerInput): void {
    const weapon = WEAPONS[DEFAULT_WEAPON_ID];
    const p = this.player;
    if (!input.shootHeld || p.weapon.cooldownMs > 0) return;

    const overcharged = p.effects.overchargeMs > 0;
    const direction =
      input.aim ??
      ({ x: p.facing, y: 0 } as const);

    const muzzle: { x: number; y: number } = {
      x: p.centerX + direction.x * 14,
      y: p.centerY + direction.y * 14,
    };

    const shot = this.projectiles.spawn();
    launchProjectile(
      shot,
      'player',
      muzzle,
      aimDirection(muzzle, { x: muzzle.x + direction.x * 100, y: muzzle.y + direction.y * 100 }),
      weapon.projectileSpeedPxPerS,
      weapon.damage,
      weapon.lifetimeSeconds,
    );

    p.weapon.cooldownMs = overcharged ? weapon.cooldownMs / 2 : weapon.cooldownMs;
    this.hooks.sfx?.('shoot');
  }

  // ------------------------------------------------------------- enemies --

  private buildWorldEntities(): void {
    this.enemies.length = 0;
    this.pickups.length = 0;
    this.checkpointList.length = 0;
    this.exitBox = null;
    for (const item of this.projectiles.active) item.active = false;
    this.particles.clear();

    for (const spawn of this.level.data.spawns) {
      switch (spawn.kind) {
        case 'enemy': {
          const enemy = spawnEnemyAt(spawn.enemy, Level.tileCenter(spawn.tx, spawn.ty));
          if (enemy.kind === 'TunnelWorm') classifyCrawlSurface(enemy, this.level);
          this.enemies.push(enemy);
          break;
        }
        case 'checkpoint':
          this.checkpointList.push({
            worldX: Level.tileToWorldX(spawn.tx),
            worldY: Level.tileToWorldY(spawn.ty),
            activated: false,
          });
          break;
        case 'exit': {
          const center = Level.tileCenter(spawn.tx, spawn.ty);
          this.exitBox = {
            x: center.x - 16,
            y: center.y - 32,
            width: 32,
            height: 64,
          };
          break;
        }
        default:
          break;
      }
    }
    this.pickups.push(...createPickupsFromSpawns(this.level.data.spawns));
  }

  private updateEnemies(dtSeconds: number): void {
    const ctx = {
      level: this.level,
      playerCenter: { x: this.player.centerX, y: this.player.centerY },
      dtSeconds,
      rng: () => this.rng.next(),
    };

    // Iterate a snapshot: a killing blow can rebuild the world underneath us.
    for (const enemy of [...this.enemies]) {
      if (!enemy.active || this._status !== 'playing') continue;
      const fire = updateEnemy(enemy, ctx);
      if (fire && this._status === 'playing') this.spawnEnemyShot(fire);

      // Contact damage.
      if (
        this._status === 'playing' &&
        !this.player.isInvulnerable &&
        this.overlapsPlayer(enemyCenterBox(enemy))
      ) {
        this.damagePlayer();
      }
    }
  }

  private spawnEnemyShot(fire: EnemyFireEvent): void {
    const center = enemyCenter(fire.enemy);
    const shot = this.projectiles.spawn();
    launchProjectile(
      shot,
      'enemy',
      { x: center.x + fire.direction.x * 12, y: center.y + fire.direction.y * 12 },
      fire.direction,
      ENEMY_PROJECTILE_SPEED_PX_PER_S,
      1,
      ENEMY_PROJECTILE_LIFETIME_S,
    );
    this.hooks.sfx?.('shoot');
  }

  // ---------------------------------------------------------- projectiles --

  private updateProjectiles(dtSeconds: number): void {
    // Snapshot: a lethal enemy shot can restart the attempt mid-loop.
    for (const projectile of [...this.projectiles.active]) {
      if (this._status !== 'playing') return;
      const result = updateProjectile(this.level, projectile, dtSeconds);
      if (result.expired) {
        if (result.hitTile) this.emitImpactSparks(projectile);
        continue;
      }

      if (projectile.owner === 'player') {
        this.resolvePlayerShot(projectile);
      } else if (projectileOverlaps(projectile, playerBox(this.player))) {
        deactivateProjectile(projectile);
        this.emitImpactSparks(projectile);
        this.damagePlayer();
      }
    }
  }

  private resolvePlayerShot(projectile: Projectile): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (!projectileOverlaps(projectile, enemyBox(enemy))) continue;

      deactivateProjectile(projectile);
      this.emitImpactSparks(projectile);
      const destroyed = damageEnemy(enemy, projectile.damage);
      if (!destroyed) {
        this.hooks.sfx?.('combo-tick', { step: 1 }); // hit-confirm blip
        return;
      }

      // Kill: score with combo + fragment burst.
      const baseScore = ENEMIES[enemy.kind]?.killScore ?? 50;
      this.score.award(baseScore, this._timeMs, { kind: 'kill' });
      this._killsThisSession += 1;
      this.emitDeathBurst(enemy);
      this.hooks.sfx?.('pickup');
      this.hooks.onEvent?.({ type: 'enemy-killed', kind: enemy.kind });
      return;
    }
  }

  // ------------------------------------------------------------- pickups --

  private updatePickups(dtSeconds: number): void {
    const magnetActive = this.player.effects.magnetMs > 0;
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      animatePickup(pickup, this._timeMs);

      if (magnetActive && pickup.kind === 'fragment') {
        const dx = this.player.centerX - (pickup.position.x + pickup.size.x / 2);
        const dy = this.player.centerY - (pickup.position.y + pickup.size.y / 2);
        const dist = Math.hypot(dx, dy);
        if (dist > 1 && dist < MAGNET_RADIUS_PX) {
          pickup.position.x += (dx / dist) * MAGNET_PULL_PX_PER_S * dtSeconds;
          pickup.position.y += (dy / dist) * MAGNET_PULL_PX_PER_S * dtSeconds;
        }
      }

      if (this.overlapsPlayer(pickupBoxExpanded(pickup))) this.collect(pickup);
    }
  }

  private collect(pickup: Pickup): void {
    pickup.active = false;

    switch (pickup.kind) {
      case 'fragment': {
        const fragment = pickup.fragment ?? 'Music';
        const value = FRAGMENT_POINT_VALUES[fragment] ?? 10;
        this.score.award(value, this._timeMs, { kind: 'fragment' });
        this.hooks.sfx?.('pickup');
        this.hooks.onEvent?.({ type: 'fragment-collected', fragment });
        break;
      }
      case 'powerup': {
        const powerup = pickup.powerup ?? 'Shield';
        this.applyPowerup(powerup);
        break;
      }
      case 'unlock': {
        const name = pickup.unlock ?? 'DoubleJumpUnlock';
        this.player.abilities.doubleJumpUnlocked = true;
        this.hooks.sfx?.('checkpoint');
        this.hooks.onEvent?.({ type: 'unlock-granted', unlock: ABILITY_UNLOCKS[name]?.blurb ?? name });
        break;
      }
    }

    this.particles.emit({
      x: pickup.position.x + pickup.size.x / 2,
      y: pickup.position.y + pickup.size.y / 2,
      count: 8,
      speedMin: 30,
      speedMax: 150,
      lifeSeconds: 0.4,
      sizePx: 4,
      color: [1, 0.9, 0.4, 1],
    });
  }

  private applyPowerup(powerup: PowerupTypeName): void {
    const descriptor = POWERUPS[powerup];
    switch (powerup) {
      case 'Overcharge':
        this.player.effects.overchargeMs = (descriptor?.durationSeconds ?? 8) * 1000;
        break;
      case 'TripleJump':
        this.player.effects.tripleJumpMs = (descriptor?.durationSeconds ?? 8) * 1000;
        break;
      case 'Magnet':
        this.player.effects.magnetMs = (descriptor?.durationSeconds ?? 8) * 1000;
        break;
      case 'Shield':
        this.player.effects.shieldCharges = Math.min(2, this.player.effects.shieldCharges + 1);
        break;
      case 'OneUp':
        this._lives = Math.min(MAX_LIVES, this._lives + 1);
        break;
    }
    this.hooks.sfx?.('pickup');
    this.hooks.onEvent?.({ type: 'powerup-collected', powerup });
  }

  // ----------------------------------------------- checkpoints & progress --

  private updateCheckpointsAndExit(): void {
    const px = this.player.centerX;
    const py = this.player.centerY;

    this.checkpointList.forEach((checkpoint, index) => {
      if (checkpoint.activated) return;
      const withinReach =
        Math.abs(px - (checkpoint.worldX + 16)) < 40 && Math.abs(py - (checkpoint.worldY + 16)) < 56;
      if (!withinReach) return;

      checkpoint.activated = true;
      this.score.addFlatBonus(CHECKPOINT_BONUS);
      this.hooks.sfx?.('checkpoint');
      this.hooks.onEvent?.({ type: 'checkpoint-activated', index });
    });

    if (this.exitBox && aabbOverlap(playerBox(this.player), this.exitBox)) {
      this._status = 'levelComplete';
      this.hooks.sfx?.('checkpoint');
      this.hooks.onEvent?.({ type: 'level-complete' });
    }
  }

  // ------------------------------------------------- damage/death/rules --

  private hazardUnderPlayer(): boolean {
    return touchesHazard(this.level, playerBox(this.player));
  }

  private overlapsPlayer(box: AABB): boolean {
    return aabbOverlap(box, playerBox(this.player));
  }

  private damagePlayer(): void {
    const outcome = this.player.takeHit();
    if (outcome === 'ignored') return;
    if (outcome === 'shield') {
      this.hooks.sfx?.('damage');
      this.player.vx = -this.player.facing * 200;
      return;
    }
    this.killPlayer();
  }

  /** Death per PLAN.md §4: −1 life, respawn at checkpoint or restart level. */
  public killPlayer(): void {
    if (this._status !== 'playing') return;

    this._lives -= 1;
    this.emitPlayerBurst();
    this.hooks.sfx?.('death');
    this.hooks.onEvent?.({ type: 'player-died', remainingLives: Math.max(0, this._lives) });

    if (this._lives <= 0) {
      this._lives = 0;
      this._status = 'gameOver';
      this.hooks.onEvent?.({ type: 'game-over' });
      return;
    }

    const checkpoint = this.lastCheckpointPosition;
    if (checkpoint) {
      this.player.respawnAt(checkpoint);
      this.hooks.onEvent?.({ type: 'respawned', atCheckpoint: true });
    } else {
      // Died before the first checkpoint: restart the level attempt (−1 life
      // persists). Score resets so fragments cannot be farmed by dying.
      this.restartAttempt();
      this.hooks.onEvent?.({ type: 'respawned', atCheckpoint: false });
    }
    this.snapCamera();
  }

  /**
   * Full attempt reset used for pre-checkpoint deaths: rebuilds enemies/
   * pickups/projectiles/particles and clears score/time. Keeps lives.
   */
  public restartAttempt(): void {
    this.buildWorldEntities();
    this.score.reset();
    this._timeMs = 0;
    this._killsThisSession = 0;
    this.player.resetEffects();
    const spawn = this.level.spawnPoint();
    if (spawn) this.player.respawnAt(spawn);
    this.player.grantInvulnerability(900);
    this.snapCamera();
    this.hooks.onEvent?.({ type: 'level-restarted' });
  }

  // --------------------------------------------------------------- camera --

  private snapCamera(): void {
    this._cameraX = clampCamera(
      this.player.centerX - VIRTUAL_WIDTH / 2,
      this.level.pixelWidth - VIRTUAL_WIDTH,
    );
    this._cameraY = clampCamera(
      this.player.centerY - VIRTUAL_HEIGHT / 2,
      this.level.pixelHeight - VIRTUAL_HEIGHT,
    );
  }

  private followCamera(dtSeconds: number): void {
    const targetX = clampCamera(
      this.player.centerX - VIRTUAL_WIDTH / 2,
      this.level.pixelWidth - VIRTUAL_WIDTH,
    );
    const targetY = clampCamera(
      this.player.centerY - VIRTUAL_HEIGHT / 2,
      this.level.pixelHeight - VIRTUAL_HEIGHT,
    );
    const t = Math.min(1, CAMERA_FOLLOW_RATE * dtSeconds);
    this._cameraX += (targetX - this._cameraX) * t;
    this._cameraY += (targetY - this._cameraY) * t;
  }

  // ----------------------------------------------------------- particles --

  private emitImpactSparks(projectile: Projectile): void {
    this.particles.emit({
      x: projectile.position.x + projectile.size.x / 2,
      y: projectile.position.y + projectile.size.y / 2,
      count: 5,
      speedMin: 20,
      speedMax: 120,
      lifeSeconds: 0.25,
      sizePx: 3,
      color: projectile.owner === 'player' ? [0.5, 1, 1, 1] : [1, 0.3, 0.3, 1],
    });
  }

  /** Fragment-style burst in the enemy's palette (PLAN.md "juice" hook). */
  private emitDeathBurst(enemy: Enemy): void {
    const center = enemyCenter(enemy);
    this.particles.emit({
      x: center.x,
      y: center.y,
      count: 16,
      speedMin: 60,
      speedMax: 260,
      lifeSeconds: 0.6,
      sizePx: 5,
      gravityScale: 0.8,
      color: ENEMY_COLORS_FALLBACK[enemy.kind] ?? [1, 1, 1, 1],
    });
  }

  private emitPlayerBurst(): void {
    this.particles.emit({
      x: this.player.centerX,
      y: this.player.centerY,
      count: 24,
      speedMin: 80,
      speedMax: 320,
      lifeSeconds: 0.8,
      sizePx: 6,
      gravityScale: 0.7,
      color: [0.45, 0.95, 1, 1],
    });
  }
}

// ------------------------------------------------------------------ utils --

function clampCamera(value: number, max: number): number {
  const upper = Math.max(0, max);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), upper);
}

function playerBox(player: Player): AABB {
  return { x: player.x, y: player.y, width: player.width, height: player.height };
}

function enemyBox(enemy: Enemy): AABB {
  return { x: enemy.position.x, y: enemy.position.y, width: enemy.size.x, height: enemy.size.y };
}

function enemyCenterBox(enemy: Enemy): AABB {
  return enemyBox(enemy);
}

function pickupBoxExpanded(pickup: Pickup): AABB {
  const f = PICKUP_FORGIVENESS_PX;
  return {
    x: pickup.position.x - f,
    y: pickup.position.y - f,
    width: pickup.size.x + f * 2,
    height: pickup.size.y + f * 2,
  };
}

function deactivateProjectile(p: Projectile): void {
  p.active = false;
}
