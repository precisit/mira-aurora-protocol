import { EntityPool, aabbOverlap, type AABB } from './entities';
import { Player, emptyPlayerInput, type PlayerInput } from './Player';
import {
  createProjectile,
  launchProjectile,
  launchSplitChild,
  launchWeaponProjectile,
  updateProjectile,
  projectileCenter,
  projectileOverlaps,
  projectileBox,
  type Projectile,
  type SplitChildSpec,
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
import {
  DEFAULT_WEAPON_ID,
  WEAPONS,
  WEAPON_ORDER,
  aimDirection,
  chargeFraction,
  spreadDirections,
  type WeaponColor,
  type WeaponDef,
  type WeaponId,
} from './weapons';
import { ENEMY_COLORS_FALLBACK } from './renderPalette';
import {
  ABILITY_UNLOCKS,
  ENEMIES,
  FRAGMENT_POINT_VALUES,
  POWERUPS,
  type FragmentTypeName,
  type PowerupTypeName,
} from './entities';
import {
  BossEntity,
  cameraClampForArena,
  createBoss,
  playerEntersArena,
  pointInVoid,
  arenaFromTiles,
  type ArenaBounds,
  type BossHudInfo,
  type BossId,
  type BossShotRequest,
  type BossStepResult,
} from './bosses';
import { Level } from '../levels/Level';
import type { LevelData } from '../levels/LevelData';
import {
  laserDamageBox,
  laserGridFromSpawn,
  laserTelegraphRect,
  type LaserGrid,
} from './lasers';
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

/** Boss hover anchor height above the arena's top edge (task B2). */
const BOSS_HOVER_ANCHOR_Y_PX = 120;
/** Seconds between fragment bursts during a boss death sequence. */
const BOSS_DEATH_BURST_INTERVAL_S = 0.28;
/** Speed of shots VESSEL's mirror bounces back at AURORA. */
const REFLECTED_SHOT_SPEED_PX_PER_S = 380;

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
  | { type: 'weapon-unlocked'; weaponId: WeaponId }
  | { type: 'explosion'; x: number; y: number; radiusPx: number }
  | { type: 'powerup-collected'; powerup: PowerupTypeName }
  | { type: 'fragment-collected'; fragment: FragmentTypeName }
  | { type: 'enemy-killed'; kind: string }
  | { type: 'player-died'; remainingLives: number }
  | { type: 'respawned'; atCheckpoint: boolean }
  | { type: 'level-restarted' }
  | { type: 'game-over' }
  | { type: 'level-complete' }
  /** Boss fight armed as AURORA stepped into the arena (task B2). */
  | { type: 'boss-encountered'; boss: BossId }
  | { type: 'boss-phase-changed'; boss: BossId; phase: number; quote: string | null }
  | { type: 'boss-quote'; boss: BossId; text: string }
  | { type: 'boss-defeated'; boss: BossId; points: number };

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
  /**
   * Weapon ids currently unlocked by total score (B3). Only these can be
   * cycled/selectable; defaults to the starting weapon alone.
   */
  unlockedWeapons?: readonly string[];
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
  /** Timed laser grids parsed from level data (task C2); empty in plain levels. */
  private readonly laserGrids: LaserGrid[] = [];
  private exitBox: AABB | null = null;

  /** Boss arena parsed from level data (task B2); null in plain levels. */
  private arenaSpawn: Extract<LevelData['spawns'][number], { kind: 'boss' }> | null = null;
  private _bossArena: ArenaBounds | null = null;
  private _boss: BossEntity | null = null;
  private bossEngaged = false;
  private bossDefeatHandled = false;
  private bossBurstCountdownSeconds = 0;

  private _lives = STARTING_LIVES;
  private _status: SessionStatus = 'playing';
  private _timeMs = 0;
  private _cameraX = 0;
  private _cameraY = 0;
  private _killsThisSession = 0;

  // B3 weapon state: equipped id, unlock set (external, score-driven) and
  // hold-to-charge accumulator for Nova.
  private _weaponId: WeaponId = DEFAULT_WEAPON_ID;
  private readonly unlockedWeaponIds = new Set<WeaponId>([DEFAULT_WEAPON_ID]);
  private chargeMs = 0;

  public constructor(options: GameSessionOptions) {
    this.level = new Level(options.levelData);
    this.hooks = options.hooks ?? {};
    this.rng = new SeededRng(options.seed ?? 0xa7001);
    if (options.unlockedWeapons) this.setUnlockedWeapons(options.unlockedWeapons);

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

  // -------------------------------------------------------------- weapons --

  /** Equipped weapon id (always one of the unlocked set). */
  public get weaponId(): WeaponId {
    return this._weaponId;
  }

  /** Equipped weapon definition. */
  public get weapon(): WeaponDef {
    return WEAPONS[this._weaponId];
  }

  /** Unlocked weapon ids, in unlock-threshold order. */
  public get unlockedWeapons(): WeaponId[] {
    return WEAPON_ORDER.filter((id) => this.unlockedWeaponIds.has(id));
  }

  /** Nova-style charge progress 0..1 (1 for instant-fire weapons). */
  public get chargeFraction(): number {
    return chargeFraction(this.chargeMs, this.weapon.chargeMs);
  }

  /**
   * Cycle to the next/previous unlocked weapon in threshold order. Returns
   * false when there is nothing else to switch to (single-weapon arsenal).
   */
  public cycleWeapon(step: number = 1): boolean {
    const arsenal = this.unlockedWeapons;
    if (arsenal.length < 2) return false;
    const index = arsenal.indexOf(this._weaponId);
    const next = arsenal[(index + step + arsenal.length * Math.abs(step)) % arsenal.length]!;
    return this.equipWeapon(next);
  }

  /** Direct selection; refuses locked weapons. */
  public selectWeapon(weaponId: WeaponId): boolean {
    if (!this.unlockedWeaponIds.has(weaponId)) return false;
    return this.equipWeapon(weaponId);
  }

  /**
   * Merge externally-unlocked ids into the session set (additive — unlocks
   * never go backwards). If the equipped weapon is not in the merged set,
   * falls back to the highest-tier unlocked one.
   */
  public setUnlockedWeapons(weaponIds: readonly string[]): void {
    for (const id of weaponIds) {
      if (Object.prototype.hasOwnProperty.call(WEAPONS, id)) {
        this.unlockedWeaponIds.add(id as WeaponId);
      }
    }
    if (!this.unlockedWeaponIds.has(this._weaponId)) {
      const fallback = this.unlockedWeapons.at(-1) ?? DEFAULT_WEAPON_ID;
      this._weaponId = fallback;
      this.chargeMs = 0;
    }
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

  // ------------------------------------------------------- boss queries --

  /** Live boss once the arena has been triggered; null before/after reset. */
  public get boss(): BossEntity | null {
    return this._boss;
  }

  /** World-px arena bounds from level data, or null. */
  public get bossArena(): ArenaBounds | null {
    return this._bossArena;
  }

  /** True between trigger and defeat (camera lock + exit seal window). */
  public get bossFightActive(): boolean {
    return this._boss !== null && !this._boss.isDefeated;
  }

  /** 0..1 renderer overlay for NULL's darkness waves. */
  public get darknessLevel(): number {
    return this._boss?.darknessLevel ?? 0;
  }

  /** HUD contract for the boss HP bar, or null while no fight is running. */
  public getBossHud(): BossHudInfo | null {
    if (!this._boss || !this.bossEngaged || this._boss.isDefeated) return null;
    return this._boss.hudInfo();
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

    // Corruption clock (glitch tiles) + timed laser grids (task C2).
    this.level.syncGlitchTiles(this._timeMs);
    if (!this.player.isInvulnerable && this.laserUnderPlayer()) {
      this.damagePlayer();
      if (this._status !== 'playing') return;
    }

    this.handleShooting(input, stepMs);
    this.updateBossFight(dtSeconds);
    if (this._status !== 'playing') return;
    this.updateEnemies(dtSeconds);
    this.updateProjectiles(dtSeconds);
    this.updatePickups(dtSeconds);
    this.updateCheckpointsAndExit();
    this.particles.update(dtSeconds, 1400);
    this.followCamera(dtSeconds);
  }

  // ------------------------------------------------------------ shooting --

  private handleShooting(input: PlayerInput, stepMs: number): void {
    const p = this.player;
    const weapon = this.weapon;

    // Hold-to-charge (Nova): builds while the trigger is held and the gun is
    // ready; auto-fires the big blast at 100 % and resets. Releasing early
    // or firing drops the charge.
    if (weapon.chargeMs > 0) {
      if (!input.shootHeld || p.weapon.cooldownMs > 0) {
        this.chargeMs = 0;
        return;
      }
      this.chargeMs += Math.max(0, stepMs);
      if (this.chargeFraction < 1) return;
      this.chargeMs = 0;
      this.fireVolley(weapon, input);
      p.weapon.cooldownMs = this.cooldownFor(weapon, p);
      return;
    }

    if (!input.shootHeld || p.weapon.cooldownMs > 0) return;

    this.fireVolley(weapon, input);
    p.weapon.cooldownMs = this.cooldownFor(weapon, p);
  }

  /** Overcharge powerup halves every weapon's cooldown (WeaponDef contract). */
  private cooldownFor(weapon: WeaponDef, p: Player): number {
    const overcharged = p.effects.overchargeMs > 0;
    return overcharged ? weapon.cooldownMs / 2 : weapon.cooldownMs;
  }

  /** Fire one trigger pull: a fan of `spreadCount` weapon projectiles. */
  private fireVolley(weapon: WeaponDef, input: PlayerInput): void {
    const p = this.player;
    const direction = input.aim ?? ({ x: p.facing, y: 0 } as const);
    const muzzle: { x: number; y: number } = {
      x: p.centerX + direction.x * 14,
      y: p.centerY + direction.y * 14,
    };
    const baseDirection = aimDirection(muzzle, {
      x: muzzle.x + direction.x * 100,
      y: muzzle.y + direction.y * 100,
    });

    for (const dir of spreadDirections(baseDirection, weapon.spreadCount, weapon.spreadAngleDeg)) {
      launchWeaponProjectile(this.projectiles.spawn(), weapon, muzzle, dir);
    }

    this.hooks.sfx?.('shoot');
  }

  private equipWeapon(weaponId: WeaponId): boolean {
    if (weaponId === this._weaponId) return false;
    this._weaponId = weaponId;
    this.chargeMs = 0;
    this.hooks.sfx?.('weapon-switch');
    return true;
  }

  // ------------------------------------------------------------- enemies --

  private buildWorldEntities(): void {
    this.enemies.length = 0;
    this.pickups.length = 0;
    this.checkpointList.length = 0;
    this.laserGrids.length = 0;
    this.exitBox = null;
    for (const item of this.projectiles.active) item.active = false;
    this.particles.clear();

    // Boss state re-arms with the world (attempt restarts reset the fight).
    this.arenaSpawn = null;
    this._bossArena = null;
    this._boss = null;
    this.bossEngaged = false;
    this.bossDefeatHandled = false;
    this.bossBurstCountdownSeconds = 0;

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
        case 'boss':
          // Arm the boss room (task B2): the encounter triggers when the
          // player walks in — see updateBossFight.
          if (!this.arenaSpawn) {
            this.arenaSpawn = spawn;
            this._bossArena = arenaFromTiles(spawn.tx0, spawn.ty0, spawn.tx1, spawn.ty1);
          }
          break;
        case 'laser':
          // Timed environmental beam (task C2): stepped against the session
          // clock in update() — no entity, just a pulsing damage box.
          this.laserGrids.push(laserGridFromSpawn(spawn));
          break;
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

  // ---------------------------------------------------------------- boss --

  /**
   * Boss encounter lifecycle (task B2): arm on arena entry, step the boss,
   * realize its shots/quotes, then apply its hazards — firing lasers, erasure
   * voids (instant, like hazards) and contact damage.
   */
  private updateBossFight(dtSeconds: number): void {
    if (!this._bossArena || !this.arenaSpawn) return;
    if (!this._boss) {
      if (
        !this.bossEngaged &&
        playerEntersArena(this.playerEntersCenter(), this._bossArena)
      ) {
        this.engageBoss();
      }
      return;
    }

    const boss = this._boss;
    const result: BossStepResult = boss.step({
      level: this.level,
      arena: this._bossArena,
      playerCenter: { x: this.player.centerX, y: this.player.centerY },
      dtSeconds,
      rng: () => this.rng.next(),
    });

    for (const quote of result.quotes) {
      this.hooks.onEvent?.({ type: 'boss-quote', boss: boss.bossId, text: quote });
    }
    if (result.phaseChanged) {
      this.hooks.sfx?.('boss-warning');
      this.hooks.onEvent?.({
        type: 'boss-phase-changed',
        boss: boss.bossId,
        phase: boss.phaseIndex + 1,
        quote: result.phaseIntroLine,
      });
    }
    for (const shotRequest of result.shots) this.spawnBossShot(shotRequest);

    if (boss.state === 'dying') this.updateDeathSequence(dtSeconds);
    if (boss.state === 'dead' && !this.bossDefeatHandled) this.completeBossDefeat(boss);
    if (this._status !== 'playing') return;

    // Firing lasers hurt like any hit (i-frames respected).
    if (!this.player.isInvulnerable) {
      for (const beamBox of boss.activeLaserBoxes()) {
        if (this.overlapsPlayer(beamBox)) {
          this.damagePlayer();
          break;
        }
      }
    }
    if (this._status !== 'playing') return;

    // Voids are absence, not attacks: they erase outright (hazard rules).
    for (const zone of boss.hazardCircles()) {
      if (pointInVoid(this.player.centerX, this.player.centerY, zone)) {
        this.killPlayer();
        return;
      }
    }

    // Contact damage off the boss body.
    if (!this.player.isInvulnerable && this.overlapsPlayer(boss.bodyBox())) {
      this.damagePlayer();
    }
  }

  private playerEntersCenter(): { x: number; y: number } {
    return { x: this.player.centerX, y: this.player.centerY };
  }

  private engageBoss(): void {
    const arena = this._bossArena;
    const spawn = this.arenaSpawn;
    if (!arena || !spawn) return;
    this.bossEngaged = true;
    this._boss = createBoss(spawn.boss, {
      x: arena.x + arena.width / 2,
      y: arena.y + BOSS_HOVER_ANCHOR_Y_PX,
    });
    this.hooks.sfx?.('boss-warning');
    this.hooks.onEvent?.({ type: 'boss-encountered', boss: spawn.boss });
  }

  private spawnBossShot(request: BossShotRequest): void {
    const shot = this.projectiles.spawn();
    launchProjectile(
      shot,
      'enemy',
      request.origin,
      request.direction,
      request.speedPxPerS,
      request.damage,
      request.lifetimeSeconds,
    );
    shot.eraser = request.eraser === true;
    this.hooks.sfx?.('shoot');
  }

  /** Fragment bursts across the boss while it dies (death sequence juice). */
  private updateDeathSequence(dtSeconds: number): void {
    const boss = this._boss;
    if (!boss) return;
    this.bossBurstCountdownSeconds -= dtSeconds;
    if (this.bossBurstCountdownSeconds > 0) return;
    this.bossBurstCountdownSeconds = BOSS_DEATH_BURST_INTERVAL_S;
    const box = boss.bodyBox();
    const angle = this.rng.next() * Math.PI * 2;
    const radius = this.rng.next() * Math.min(box.width, box.height) * 0.45;
    this.particles.emit({
      x: box.x + box.width / 2 + Math.cos(angle) * radius,
      y: box.y + box.height / 2 + Math.sin(angle) * radius,
      count: 14,
      speedMin: 60,
      speedMax: 240,
      lifeSeconds: 0.5,
      sizePx: 5,
      gravityScale: 0.5,
      color: [1, 0.95, 0.7, 1],
    });
  }

  /** Boss down: reward points, clear the arena, free the exit. */
  private completeBossDefeat(boss: BossEntity): void {
    this.bossDefeatHandled = true;
    const points = this.score.award(boss.killScore, this._timeMs, { kind: 'kill' });
    const center = boss.center();
    for (let ring = 0; ring < 3; ring++) {
      this.particles.emit({
        x: center.x,
        y: center.y,
        count: 18,
        speedMin: 80 + ring * 90,
        speedMax: 260 + ring * 120,
        lifeSeconds: 0.6 + ring * 0.2,
        sizePx: 6 - ring,
        gravityScale: 0.4,
        color: ring === 0 ? [1, 1, 1, 1] : [1, 0.8, 0.35, 1],
      });
    }
    this.hooks.sfx?.('checkpoint');
    this.hooks.onEvent?.({ type: 'boss-defeated', boss: boss.bossId, points });
  }

  // ---------------------------------------------------------- projectiles --

  private updateProjectiles(dtSeconds: number): void {
    // Snapshot: a lethal enemy shot can restart the attempt mid-loop.
    for (const projectile of [...this.projectiles.active]) {
      if (this._status !== 'playing') return;
      const result = updateProjectile(this.level, projectile, dtSeconds);
      if (!result.expired) {
        if (projectile.owner === 'player') {
          this.resolvePlayerShot(projectile);
        } else {
          // Erasing shots (NULL) delete player shots they touch — absence eats
          // light. Otherwise enemy bolts hurt AURORA as usual.
          if (projectile.eraser && this.erasePlayerShots(projectile)) continue;
          if (projectileOverlaps(projectile, playerBox(this.player))) {
            deactivateProjectile(projectile);
            this.emitImpactSparks(projectile);
            this.damagePlayer();
          }
        }
        continue;
      }

      // Died to tiles/bounds/lifetime — still detonate or split first.
      if (result.hitTile) this.emitImpactSparks(projectile);
      this.resolveProjectileDeath(projectile, /* hitEnemy */ false);
    }
  }

  /** Deactivate every player shot overlapping `eraser`; true if any were. */
  private erasePlayerShots(eraser: Projectile): boolean {
    let erased = false;
    for (const other of [...this.projectiles.active]) {
      if (!other.active || other.owner !== 'player') continue;
      if (!projectileOverlaps(eraser, projectileBox(other))) continue;
      deactivateProjectile(other);
      this.emitImpactSparks(other);
      erased = true;
    }
    if (erased) deactivateProjectile(eraser);
    return erased;
  }

  /**
   * Player-shot vs enemies: pierce passes through (de-duplicated per enemy),
   * explosions and splits trigger when the shot finally stops.
   */
  private resolvePlayerShot(projectile: Projectile): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (!projectileOverlaps(projectile, enemyBox(enemy))) continue;
      if (projectile.hitEnemies.includes(enemy.id)) continue;

      projectile.hitEnemies.push(enemy.id);
      this.applyDamageToEnemy(enemy, projectile.damage);

      if (projectile.explosionRadiusPx > 0) {
        this.explodeProjectile(projectile, enemy);
        deactivateProjectile(projectile);
        return;
      }

      if (projectile.pierceLeft > 0) {
        projectile.pierceLeft -= 1;
        continue;
      }

      this.resolveProjectileDeath(projectile, /* hitEnemy */ true);
      deactivateProjectile(projectile);
      return;
    }

    // Boss damage path (task B2): same overlap + damage flow as enemies.
    const boss = this._boss;
    if (
      projectile.active &&
      boss &&
      boss.active &&
      projectileOverlaps(projectile, boss.bodyBox())
    ) {
      deactivateProjectile(projectile);
      this.emitImpactSparks(projectile);
      const outcome = boss.takeHit(projectile.damage, () => this.rng.next());
      if (outcome === 'reflected') {
        // Mirror shell: the shot returns at AURORA as an enemy bolt.
        const back = aimDirection(boss.center(), this.playerEntersCenter());
        const returning = this.projectiles.spawn();
        launchProjectile(
          returning,
          'enemy',
          { x: boss.center().x + back.x * 20, y: boss.center().y + back.y * 20 },
          back,
          REFLECTED_SHOT_SPEED_PX_PER_S,
          1,
          ENEMY_PROJECTILE_LIFETIME_S,
        );
        this.hooks.sfx?.('shoot');
      } else if (outcome === 'hit') {
        this.hooks.sfx?.('combo-tick', { step: 1 });
      }
    }
  }

  /**
   * Death effects for a dying player shot: Nova blasts an area (skipping
   * enemies the shot already damaged), Fragment scatters its shards. Enemy
   * shots and plain weapons do nothing.
   */
  private resolveProjectileDeath(projectile: Projectile, hitEnemy: boolean): void {
    void hitEnemy;
    if (projectile.owner !== 'player') return;
    if (projectile.explosionRadiusPx > 0) {
      this.explodeProjectile(projectile, null);
      return;
    }
    if (projectile.splitChildrenLeft > 0) {
      this.spawnSplitChildren(projectile);
    }
  }

  /** Area damage around a dying Nova blast + juice event for shake/flash. */
  private explodeProjectile(projectile: Projectile, directHit: Enemy | null): void {
    const center = projectileCenter(projectile);
    const radius = projectile.explosionRadiusPx;

    for (const enemy of this.enemies) {
      if (!enemy.active || enemy === directHit) continue;
      if (projectile.hitEnemies.includes(enemy.id)) continue;
      const ec = enemyCenter(enemy);
      if (Math.hypot(ec.x - center.x, ec.y - center.y) > radius) continue;
      projectile.hitEnemies.push(enemy.id);
      this.applyDamageToEnemy(enemy, projectile.damage);
    }

    this.particles.emit({
      x: center.x,
      y: center.y,
      count: 26,
      speedMin: 80,
      speedMax: radius * 3.4,
      lifeSeconds: 0.5,
      sizePx: 6,
      gravityScale: 0.25,
      color: projectile.color,
    });
    this.hooks.sfx?.('shoot');
    this.hooks.onEvent?.({
      type: 'explosion',
      x: center.x,
      y: center.y,
      radiusPx: radius,
    });
  }

  /** Fragment crystals burst into a forward fan of shards on death. */
  private spawnSplitChildren(parent: Projectile): void {
    const count = parent.splitChildrenLeft;
    if (count <= 0) return;

    // Snapshot everything BEFORE spawning: the pool may reuse the parent's
    // own slot for the first child, wiping its fields mid-burst.
    const speed = Math.hypot(parent.velocity.x, parent.velocity.y);
    const forward =
      speed > 1
        ? { x: parent.velocity.x / speed, y: parent.velocity.y / speed }
        : { x: 1, y: 0 };
    const spec: SplitChildSpec = {
      owner: parent.owner,
      color: parent.color,
      damage: parent.splitChildDamage,
      lifetimeSeconds: parent.splitChildLifetimeSeconds,
      speedPxPerS: parent.splitChildSpeedPxPerS,
    };
    const origin = projectileCenter(parent);
    const fanAngleDeg = parent.splitFanAngleDeg;
    parent.splitChildrenLeft = 0;

    for (const dir of spreadDirections(forward, count, fanAngleDeg)) {
      launchSplitChild(this.projectiles.spawn(), spec, origin, dir);
    }

    this.particles.emit({
      x: origin.x,
      y: origin.y,
      count: 8,
      speedMin: 30,
      speedMax: 160,
      lifeSeconds: 0.3,
      sizePx: 3,
      color: spec.color,
    });
  }

  /** Shared damage/kill resolution so shots and blasts score identically. */
  private applyDamageToEnemy(enemy: Enemy, amount: number): void {
    const destroyed = damageEnemy(enemy, amount);
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

    // The exit stays sealed while a boss stands (task B2): no skipping the
    // fight by touching the door behind it.
    const exitSealed = this.bossFightActive;
    if (!exitSealed && this.exitBox && aabbOverlap(playerBox(this.player), this.exitBox)) {
      this._status = 'levelComplete';
      this.hooks.sfx?.('checkpoint');
      this.hooks.onEvent?.({ type: 'level-complete' });
    }
  }

  // ------------------------------------------------- damage/death/rules --

  /** All parsed laser grids (renderer + tests). */
  public get lasers(): readonly LaserGrid[] {
    return this.laserGrids;
  }

  /** Damage boxes of every beam currently firing (renderer + tests). */
  public firingLaserBoxes(): AABB[] {
    const boxes: AABB[] = [];
    for (const grid of this.laserGrids) {
      const box = laserDamageBox(grid, this._timeMs);
      if (box) boxes.push(box);
    }
    return boxes;
  }

  /** Blinking warning lines of beams about to fire (renderer). */
  public telegraphLaserBoxes(): AABB[] {
    const boxes: AABB[] = [];
    for (const grid of this.laserGrids) {
      const box = laserTelegraphRect(grid, this._timeMs);
      if (box) boxes.push(box);
    }
    return boxes;
  }

  private laserUnderPlayer(): boolean {
    for (const box of this.firingLaserBoxes()) {
      if (this.overlapsPlayer(box)) return true;
    }
    return false;
  }

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

  /** Arena-derived clamps while a fight runs; null frees the camera. */
  private arenaCameraClamps() {
    if (!this.bossFightActive || !this._bossArena) return null;
    return cameraClampForArena(
      this._bossArena,
      VIRTUAL_WIDTH,
      VIRTUAL_HEIGHT,
      this.level.pixelWidth,
      this.level.pixelHeight,
    );
  }

  private snapCamera(): void {
    const clamps = this.arenaCameraClamps();
    const baseX = clampCamera(
      this.player.centerX - VIRTUAL_WIDTH / 2,
      this.level.pixelWidth - VIRTUAL_WIDTH,
    );
    const baseY = clampCamera(
      this.player.centerY - VIRTUAL_HEIGHT / 2,
      this.level.pixelHeight - VIRTUAL_HEIGHT,
    );
    this._cameraX = clampInto(baseX, clamps?.minX ?? null, clamps?.maxX ?? null);
    this._cameraY = clampInto(baseY, clamps?.minY ?? null, clamps?.maxY ?? null);
  }

  private followCamera(dtSeconds: number): void {
    const clamps = this.arenaCameraClamps();
    let targetX = clampCamera(
      this.player.centerX - VIRTUAL_WIDTH / 2,
      this.level.pixelWidth - VIRTUAL_WIDTH,
    );
    let targetY = clampCamera(
      this.player.centerY - VIRTUAL_HEIGHT / 2,
      this.level.pixelHeight - VIRTUAL_HEIGHT,
    );
    targetX = clampInto(targetX, clamps?.minX ?? null, clamps?.maxX ?? null);
    targetY = clampInto(targetY, clamps?.minY ?? null, clamps?.maxY ?? null);
    const t = Math.min(1, CAMERA_FOLLOW_RATE * dtSeconds);
    this._cameraX += (targetX - this._cameraX) * t;
    this._cameraY += (targetY - this._cameraY) * t;
  }

  // ----------------------------------------------------------- particles --

  private emitImpactSparks(projectile: Projectile): void {
    const color: WeaponColor = projectile.owner === 'player' ? projectile.color : [1, 0.3, 0.3, 1];
    this.particles.emit({
      x: projectile.position.x + projectile.size.x / 2,
      y: projectile.position.y + projectile.size.y / 2,
      count: 5,
      speedMin: 20,
      speedMax: 120,
      lifeSeconds: 0.25,
      sizePx: 3,
      color,
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

/** Constrain `value` into [lo, hi] when either bound is provided. */
function clampInto(value: number, lo: number | null, hi: number | null): number {
  let result = value;
  if (lo !== null && result < lo) result = lo;
  if (hi !== null && result > hi) result = hi;
  return result;
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
