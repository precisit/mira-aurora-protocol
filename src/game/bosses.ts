import type { AABB, Entity, Vec2 } from './entities';
import type { Level } from '../levels/Level';
import { TILE_SIZE } from '../levels/LevelData';
import { BOSS_DIALOGUE, BOSS_MIDFIGHT_LINES } from '../ui/story';

/**
 * Boss framework + the two PLAN.md §3 bosses (task B2).
 *
 *   VESSEL — "the fragment that hid" (level 5). A fight that is more a
 *   conversation with lasers: patterned telegraphed volleys, defensive shells
 *   that open when hit, and mirror windows that reflect AURORA's shots.
 *   Stubborn, scared, ultimately yields.
 *
 *   NULL — queen of pure absence (level 7): shrinking safe zones, darkness
 *   waves and projectiles that erase sprites. Four escalating phases.
 *
 * Pure simulation like enemies.ts/Player.ts: no WebGPU/DOM imports, fixed-
 * timestep `step()` driven by GameSession, which owns projectiles, damage to
 * the player and the JuiceSystem/AudioEngine hooks fired on boss events.
 */

// -------------------------------------------------------------- arena ----

/** World-px rectangle of a boss room; also locks the camera while active. */
export interface ArenaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function arenaFromTiles(tx0: number, ty0: number, tx1: number, ty1: number): ArenaBounds {
  const x = Math.min(tx0, tx1) * TILE_SIZE;
  const y = Math.min(ty0, ty1) * TILE_SIZE;
  return {
    x,
    y,
    width: (Math.abs(tx1 - tx0) + 1) * TILE_SIZE,
    height: (Math.abs(ty1 - ty0) + 1) * TILE_SIZE,
  };
}

export function arenaCenter(arena: ArenaBounds): Vec2 {
  return { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 };
}

/** True once the player has stepped into the arena proper (trigger check). */
export function playerEntersArena(playerCenter: Vec2, arena: ArenaBounds, marginPx = 8): boolean {
  const m = Math.max(0, marginPx);
  return (
    playerCenter.x >= arena.x + m &&
    playerCenter.x <= arena.x + arena.width - m &&
    playerCenter.y >= arena.y + m &&
    playerCenter.y <= arena.y + arena.height - m
  );
}

export interface CameraClamps {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Camera clamps for an active boss fight: arenas wider/taller than the view
 * scroll within their bounds; smaller arenas are centered instead. The result
 * is intersected with the level bounds so the camera never leaves the map.
 */
export function cameraClampForArena(
  arena: ArenaBounds,
  viewWidth: number,
  viewHeight: number,
  levelPixelWidth: number,
  levelPixelHeight: number,
): CameraClamps {
  const axis = (start: number, length: number, view: number): [number, number] => {
    if (length >= view) return [start, start + length - view];
    const centered = start + length / 2 - view / 2;
    return [centered, centered];
  };
  const [minX, maxX] = axis(arena.x, arena.width, viewWidth);
  const [minY, maxY] = axis(arena.y, arena.height, viewHeight);
  const absMaxX = Math.max(0, levelPixelWidth - viewWidth);
  const absMaxY = Math.max(0, levelPixelHeight - viewHeight);
  return {
    minX: clampNumber(minX, 0, absMaxX),
    maxX: clampNumber(maxX, 0, absMaxX),
    minY: clampNumber(minY, 0, absMaxY),
    maxY: clampNumber(maxY, 0, absMaxY),
  };
}

function clampNumber(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

// ------------------------------------------------------------- lasers ----

export interface LaserRequest {
  orientation: 'horizontal' | 'vertical';
  /** Row (horizontal) or column (vertical) center in world px. */
  position: number;
  spanMin: number;
  spanMax: number;
  thickness: number;
  telegraphMs: number;
  fireMs: number;
}

export interface LaserBeam extends LaserRequest {
  id: number;
  mode: 'telegraph' | 'firing';
  remainingMs: number;
}

export const MAX_ACTIVE_LASERS = 10;

/** Damage box while firing; null during the telegraph or after expiry. */
export function laserBox(laser: LaserRequest & { mode?: string; remainingMs?: number }): AABB | null {
  if (laser.mode === 'telegraph') return null;
  if (laser.mode === 'firing' && (laser.remainingMs ?? 0) <= 0) return null;
  if (laser.orientation === 'vertical') {
    return {
      x: laser.position - laser.thickness / 2,
      y: laser.spanMin,
      width: laser.thickness,
      height: laser.spanMax - laser.spanMin,
    };
  }
  return {
    x: laser.spanMin,
    y: laser.position - laser.thickness / 2,
    width: laser.spanMax - laser.spanMin,
    height: laser.thickness,
  };
}

/** Thin aim line shown during the telegraph (renderer convenience). */
export function laserTelegraphBox(laser: LaserBeam): AABB | null {
  if (laser.mode !== 'telegraph') return null;
  if (laser.orientation === 'vertical') {
    return { x: laser.position - 1, y: laser.spanMin, width: 2, height: laser.spanMax - laser.spanMin };
  }
  return { x: laser.spanMin, y: laser.position - 1, width: laser.spanMax - laser.spanMin, height: 2 };
}

// ---------------------------------------------------------- void zones ----

/** One growing circle of pure absence (NULL). Inside it, sprites are erased. */
export interface VoidZone {
  centerX: number;
  centerY: number;
  radiusPx: number;
  growthPxPerS: number;
  maxRadiusPx: number;
  /** Telegraph time before the void starts growing (ms). */
  delayMs: number;
  ageMs: number;
}

/** Pure safe-zone shrinking math: radius at `ageMs`, linear after the delay. */
export function voidRadiusAt(
  ageMs: number,
  delayMs: number,
  growthPxPerS: number,
  maxRadiusPx: number,
): number {
  const growingForSeconds = Math.max(0, ageMs - delayMs) / 1000;
  return Math.min(Math.max(0, maxRadiusPx), Math.max(0, growingForSeconds) * growthPxPerS);
}

export function updateVoidZone(zone: VoidZone, dtMs: number): void {
  zone.ageMs += Math.max(0, dtMs);
  zone.radiusPx = voidRadiusAt(zone.ageMs, zone.delayMs, zone.growthPxPerS, zone.maxRadiusPx);
}

/** True when the point is inside the erasure circle (small forgiveness inset). */
export function pointInVoid(px: number, py: number, zone: VoidZone, forgivenessPx = 5): boolean {
  const effective = zone.radiusPx - forgivenessPx;
  if (effective <= 0) return false;
  const dx = px - zone.centerX;
  const dy = py - zone.centerY;
  return dx * dx + dy * dy < effective * effective;
}

/**
 * Width of the still-safe gap between two voids pressing in on the same row.
 * Negative once they have swallowed the corridor — pure math for NULL's
 * shrinking safe zones.
 */
export function safeCorridorWidth(left: VoidZone, right: VoidZone): number {
  return right.centerX - right.radiusPx - (left.centerX + left.radiusPx);
}

/** Total lifetime of a void: delay + full growth plus a short fade tail. */
export function voidLifetimeMs(zone: Pick<VoidZone, 'delayMs' | 'growthPxPerS' | 'maxRadiusPx'>): number {
  const growMs = (zone.maxRadiusPx / Math.max(1e-6, zone.growthPxPerS)) * 1000;
  return zone.delayMs + growMs + VOID_FADE_TAIL_MS;
}

const VOID_FADE_TAIL_MS = 600;

// ------------------------------------------------------- darkness waves --

/**
 * Trapezoid envelope for NULL's darkness waves: ramps 0→1 over `riseMs`,
 * holds at 1, then falls back to 0 over `fallMs`.
 */
export function darknessEnvelope(
  elapsedMs: number,
  riseMs: number,
  holdMs: number,
  fallMs: number,
): number {
  const t = Math.max(0, elapsedMs);
  if (t < riseMs) return clamp01(t / riseMs);
  if (t < riseMs + holdMs) return 1;
  if (t < riseMs + holdMs + fallMs) return clamp01(1 - (t - riseMs - holdMs) / fallMs);
  return 0;
}

// ------------------------------------------------------------- events ----

export type BossId = 'VESSEL' | 'NULL';

export type BossState = 'engaging' | 'active' | 'transition' | 'dying' | 'dead';

/** Result of a player shot reaching the boss through GameSession's damage path. */
export type BossHitOutcome =
  | 'hit'
  | 'immune'
  /** Shot bounced off shell/mirror — session spawns a returning enemy shot. */
  | 'reflected';

export interface BossShotRequest {
  origin: Vec2;
  direction: Vec2;
  speedPxPerS: number;
  damage: number;
  lifetimeSeconds: number;
  /** Erasing projectile (NULL): deletes other sprites it touches. */
  eraser?: boolean;
}

export interface BossStepContext {
  level: Level;
  arena: ArenaBounds;
  playerCenter: Vec2;
  dtSeconds: number;
  rng: () => number;
}

export interface BossStepResult {
  shots: BossShotRequest[];
  quotes: string[];
  /** True on the step a new phase began (visual/audio tell hook). */
  phaseChanged: boolean;
  phaseIntroLine: string | null;
}

export interface BossHudInfo {
  id: BossId;
  name: string;
  hpFraction: number;
  phase: number;
  phaseCount: number;
}

export interface BossPhaseConfig {
  name: string;
  /** HP fraction (of max) at which this phase ends and the next begins. */
  endAtHpFraction: number;
  /** Pattern ids cycled round-robin while this phase lasts. */
  patterns: readonly string[];
  /** Idle ms between patterns. */
  attackGapMs: number;
  /** Tell duration when entering this phase (ms); quotes its intro line. */
  transitionMs: number;
  introLine: string | null;
}

export interface BossConfig {
  id: BossId;
  displayName: string;
  hp: number;
  size: { width: number; height: number };
  killScore: number;
  deathDurationMs: number;
  /** Warning window before the boss starts acting (boss-warning tell). */
  engageMs: number;
  phases: readonly BossPhaseConfig[];
}

// ------------------------------------------------------------ framework --

let bossEntitySeq = 1;
let nextLaserId = 1;

/**
 * Base class for all bosses: hp + phase thresholds, a deterministic pattern
 * scheduler (idle gap → pattern → gap …), telegraphed laser bookkeeping,
 * contact body, and a dying/death sequence. Subclasses provide motion and
 * pattern implementations; damage routing stays in GameSession so boss hits
 * travel the exact same projectile path as regular enemies.
 */
export abstract class BossEntity implements Entity {
  public readonly id: number = bossEntitySeq++;
  public readonly position: Vec2;
  public readonly velocity: Vec2 = { x: 0, y: 0 };
  public readonly size: Vec2;
  public active = true;

  public hp: number;
  public readonly maxHp: number;
  public state: BossState = 'engaging';
  public phaseIndex = 0;
  /** White flash after taking a hit (ms), same convention as Enemy. */
  public hitFlashMs = 0;
  /** Phase-transition tell glow (ms) — main.ts answers with juice/audio. */
  public tellGlowMs = 0;

  protected readonly cfg: BossConfig;
  protected readonly lasers: LaserBeam[] = [];
  protected clockMs = 0;
  protected readonly scratch = new Map<string, number>();

  private patternIdValue: string | null = null;
  private patternElapsedMsValue = 0;
  private rotationIndex = 0;
  private idleRemainingMs = 0;
  private transitionRemainingMs = 0;
  private engageRemainingMs: number;
  private dyingRemainingMsValue = 0;
  private queuedQuotes: string[] = [];
  private phaseChangeQueued = false;

  protected constructor(cfg: BossConfig, anchor: Vec2) {
    this.cfg = cfg;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.size = { x: cfg.size.width, y: cfg.size.height };
    this.position = { x: anchor.x - cfg.size.width / 2, y: anchor.y - cfg.size.height / 2 };
    this.engageRemainingMs = cfg.engageMs;
    this.idleRemainingMs = cfg.phases[0]?.attackGapMs ?? 800;
  }

  // ------------------------------------------------------------- queries --

  public get bossId(): BossId {
    return this.cfg.id;
  }

  public get displayName(): string {
    return this.cfg.displayName;
  }

  public get killScore(): number {
    return this.cfg.killScore;
  }

  public get phaseCount(): number {
    return this.cfg.phases.length;
  }

  public get phaseName(): string {
    return this.cfg.phases[this.phaseIndex]?.name ?? '?';
  }

  public get hpFraction(): number {
    return clampNumber(this.hp / this.maxHp, 0, 1);
  }

  public get isDefeated(): boolean {
    return this.state === 'dead';
  }

  public get currentPatternId(): string | null {
    return this.patternIdValue;
  }

  public get patternElapsedMs(): number {
    return this.patternElapsedMsValue;
  }

  public get isAttacking(): boolean {
    return this.state === 'active' && this.patternIdValue !== null;
  }

  /** Progress through the current pattern, 0..1 (attack-window tests/HUD). */
  public get patternProgress(): number {
    if (!this.patternIdValue) return 0;
    const duration = this.patternDuration(this.patternIdValue);
    return duration > 0 ? clampNumber(this.patternElapsedMsValue / duration, 0, 1) : 1;
  }

  /** All live beams incl. telegraphs, for rendering. */
  public get lasersSnapshot(): readonly LaserBeam[] {
    return this.lasers;
  }

  /** Damage boxes of every currently firing beam (session checks vs player). */
  public activeLaserBoxes(): AABB[] {
    const boxes: AABB[] = [];
    for (const laser of this.lasers) {
      const box = laserBox(laser);
      if (box) boxes.push(box);
    }
    return boxes;
  }

  /** Erasure circles touching the player kill outright (absence, not damage). */
  public hazardCircles(): readonly VoidZone[] {
    return [];
  }

  /** 0..1 renderer overlay strength (NULL's darkness waves; else 0). */
  public get darknessLevel(): number {
    return 0;
  }

  /** VESSEL's closed-shell visual flag; bosses without shells stay false. */
  public get shellClosed(): boolean {
    return false;
  }

  public hudInfo(): BossHudInfo {
    return {
      id: this.cfg.id,
      name: this.cfg.displayName,
      hpFraction: this.hpFraction,
      phase: this.phaseIndex + 1,
      phaseCount: this.phaseCount,
    };
  }

  public bodyBox(): AABB {
    return { x: this.position.x, y: this.position.y, width: this.size.x, height: this.size.y };
  }

  public center(): Vec2 {
    return { x: this.position.x + this.size.x / 2, y: this.position.y + this.size.y / 2 };
  }

  public get dyingRemainingMs(): number {
    return this.dyingRemainingMsValue;
  }

  // -------------------------------------------------------------- damage --

  /**
   * Apply projectile damage (same amount semantics as damageEnemy). Subclasses
   * may intercept first — shells absorb, mirrors reflect. Returns what
   * happened so GameSession can spawn reflected return fire.
   */
  public takeHit(amount: number, rng: () => number): BossHitOutcome {
    if (
      !this.active ||
      this.state === 'dying' ||
      this.state === 'dead' ||
      this.state === 'engaging'
    ) {
      return 'immune';
    }
    const intercepted = this.interceptHit(amount, rng);
    if (intercepted !== null) {
      this.hitFlashMs = Math.max(this.hitFlashMs, 60);
      return intercepted;
    }

    this.hp -= Math.max(1, Math.round(amount));
    this.hitFlashMs = 90;
    if (this.hp <= 0) {
      this.hp = 0;
      this.enterDeath();
      return 'hit';
    }
    const targetPhase = this.phaseIndexFor(this.hp / this.maxHp);
    if (targetPhase > this.phaseIndex) this.enterPhase(targetPhase);
    return 'hit';
  }

  /** Hook: shells/mirrors. Return 'immune'/'reflected', or null to take damage. */
  protected interceptHit(_amount: number, _rng: () => number): BossHitOutcome | null {
    return null;
  }

  private enterDeath(): void {
    this.state = 'dying';
    this.dyingRemainingMsValue = this.cfg.deathDurationMs;
    this.clearAttacks();
    this.onDeathStart();
  }

  protected onDeathStart(): void {}

  private enterPhase(nextIndex: number): void {
    this.phaseIndex = nextIndex;
    this.state = 'transition';
    this.transitionRemainingMs = this.cfg.phases[nextIndex]?.transitionMs ?? 1200;
    this.tellGlowMs = this.transitionRemainingMs;
    this.rotationIndex = 0;
    this.patternIdValue = null;
    this.clearAttacks();
    const line = this.cfg.phases[nextIndex]?.introLine ?? null;
    if (line) this.queuedQuotes.push(line);
    this.phaseChangeQueued = true;
  }

  /** Highest phase whose window contains `hpFraction` (never skips backwards). */
  protected phaseIndexFor(hpFraction: number): number {
    let index = this.cfg.phases.length - 1;
    for (let i = 0; i < this.cfg.phases.length - 1; i++) {
      const endAt = this.cfg.phases[i]?.endAtHpFraction ?? 0;
      if (hpFraction > endAt) {
        index = i;
        break;
      }
    }
    return index;
  }

  // ---------------------------------------------------------------- step --

  /** Advance one fixed step. Deterministic given ctx.rng. */
  public step(ctx: BossStepContext): BossStepResult {
    const result: BossStepResult = {
      shots: [],
      quotes: [],
      phaseChanged: false,
      phaseIntroLine: null,
    };

    if (this.phaseChangeQueued) {
      this.phaseChangeQueued = false;
      result.phaseChanged = true;
      result.phaseIntroLine = this.cfg.phases[this.phaseIndex]?.introLine ?? null;
    }
    while (this.queuedQuotes.length > 0) {
      const quote = this.queuedQuotes.shift();
      if (quote !== undefined) result.quotes.push(quote);
    }

    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtSeconds * 1000);
    if (this.tellGlowMs > 0) this.tellGlowMs = Math.max(0, this.tellGlowMs - ctx.dtSeconds * 1000);
    this.tickLasers(ctx.dtSeconds * 1000);
    if (this.state !== 'dead') this.onUpdate(ctx);

    switch (this.state) {
      case 'engaging': {
        this.clockMs += ctx.dtSeconds * 1000;
        this.updateMotion(ctx);
        this.engageRemainingMs -= ctx.dtSeconds * 1000;
        if (this.engageRemainingMs <= 0) {
          this.state = 'active';
          this.idleRemainingMs = this.phase.attackGapMs;
        }
        break;
      }
      case 'transition': {
        this.clockMs += ctx.dtSeconds * 1000;
        this.updateMotion(ctx);
        this.transitionRemainingMs -= ctx.dtSeconds * 1000;
        if (this.transitionRemainingMs <= 0) {
          this.state = 'active';
          this.idleRemainingMs = this.phase.attackGapMs;
        }
        break;
      }
      case 'active': {
        this.clockMs += ctx.dtSeconds * 1000;
        this.updateMotion(ctx);
        if (!this.patternIdValue) {
          this.idleRemainingMs -= ctx.dtSeconds * 1000;
          if (this.idleRemainingMs <= 0) this.beginNextPattern();
        } else {
          this.runPattern(this.patternIdValue, ctx, result);
          this.patternElapsedMsValue += ctx.dtSeconds * 1000;
          if (this.patternElapsedMsValue >= this.patternDuration(this.patternIdValue)) {
            this.endPattern();
          }
        }
        break;
      }
      case 'dying': {
        this.dyingRemainingMsValue -= ctx.dtSeconds * 1000;
        if (this.dyingRemainingMsValue <= 0) {
          this.dyingRemainingMsValue = 0;
          this.state = 'dead';
          this.active = false;
        }
        break;
      }
      case 'dead':
        break;
    }

    return result;
  }

  // ------------------------------------------------------------ scheduler --

  private get phase(): BossPhaseConfig {
    const phase = this.cfg.phases[this.phaseIndex];
    if (!phase) throw new Error(`BossEntity: missing phase ${this.phaseIndex}`);
    return phase;
  }

  protected abstract readonly patternDurations: Readonly<Record<string, number>>;

  protected patternDuration(patternId: string): number {
    const duration = this.patternDurations[patternId];
    if (duration === undefined) {
      throw new Error(`${this.cfg.id}: no duration registered for pattern "${patternId}"`);
    }
    return duration;
  }

  protected abstract runPattern(
    patternId: string,
    ctx: BossStepContext,
    result: BossStepResult,
  ): void;

  protected updateMotion(_ctx: BossStepContext): void {}

  /** Per-frame subclass hook (void growth etc.) — runs in every live state. */
  protected onUpdate(_ctx: BossStepContext): void {}

  /** Accumulate a named per-pattern timer (ms); reset via resetScratch. */
  protected scratchElapsed(key: string, dtMs: number): number {
    const next = (this.scratch.get(key) ?? 0) + Math.max(0, dtMs);
    this.scratch.set(key, next);
    return next;
  }

  protected resetScratch(key: string): void {
    this.scratch.set(key, 0);
  }

  private beginNextPattern(): void {
    const patterns = this.phase.patterns;
    if (patterns.length === 0) throw new Error(`${this.cfg.id}: phase has no patterns`);
    const id = patterns[this.rotationIndex % patterns.length];
    if (!id) throw new Error(`${this.cfg.id}: pattern hole at rotation ${this.rotationIndex}`);
    this.rotationIndex += 1;
    this.patternIdValue = id;
    this.patternElapsedMsValue = 0;
    this.scratch.clear();
    this.onPatternStart(id);
  }

  private endPattern(): void {
    const id = this.patternIdValue;
    this.patternIdValue = null;
    if (id) this.onPatternEnd(id);
    this.idleRemainingMs = this.phase.attackGapMs;
  }

  protected onPatternStart(_patternId: string): void {}

  protected onPatternEnd(_patternId: string): void {}

  /** Emit a quote once per pattern (deduplicated by `key` until scratch resets). */
  protected say(result: BossStepResult, line: string, key: string): void {
    if (this.scratch.get(key) === 1) return;
    this.scratch.set(key, 1);
    result.quotes.push(line);
  }

  protected spawnLaser(request: LaserRequest): void {
    if (this.lasers.length >= MAX_ACTIVE_LASERS) return;
    this.lasers.push({
      ...request,
      id: nextLaserId++,
      mode: 'telegraph',
      remainingMs: Math.max(1, request.telegraphMs),
    });
  }

  protected clearAttacks(): void {
    this.lasers.length = 0;
    this.scratch.clear();
  }

  private tickLasers(dtMs: number): void {
    for (const laser of this.lasers) {
      laser.remainingMs -= dtMs;
      if (laser.remainingMs <= 0 && laser.mode === 'telegraph') {
        laser.mode = 'firing';
        laser.remainingMs = Math.max(1, laser.fireMs);
      }
    }
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i] as LaserBeam;
      if (laser.remainingMs <= 0) this.lasers.splice(i, 1);
    }
  }

  /** Aim helper shared by both bosses: normalized shot(s) toward the player. */
  protected aimedShots(
    ctx: BossStepContext,
    origin: Vec2,
    count: number,
    spreadRad: number,
    speedPxPerS: number,
    options: { damage?: number; lifetimeSeconds?: number; eraser?: boolean } = {},
  ): BossShotRequest[] {
    const base = Math.atan2(ctx.playerCenter.y - origin.y, ctx.playerCenter.x - origin.x);
    const shots: BossShotRequest[] = [];
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spreadRad * 2;
      const angle = base + offset;
      shots.push({
        origin: { x: origin.x, y: origin.y },
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        speedPxPerS,
        damage: options.damage ?? 1,
        lifetimeSeconds: options.lifetimeSeconds ?? 3,
        eraser: options.eraser,
      });
    }
    return shots;
  }
}

// ============================================================== VESSEL ==

const VESSEL_SHELL_BREAK_HITS = 3;
const VESSEL_REFLECT_CHANCE = 0.55;
const VESSEL_HOVER_Y_PX = 96;
const VESSEL_PILLAR_INTERVAL_MS = 520;
const VESSEL_LANE_INTERVAL_MS = 560;
const VESSEL_LANE_COUNT = 5;
const VESSEL_CROSS_INTERVAL_MS = 480;
const VESSEL_AIMED_INTERVAL_MS = 960;
const VESSEL_MARCH_INTERVAL_MS = 300;
const VESSEL_MARCH_COLUMNS = 9;

const VESSEL_CONFIG: BossConfig = {
  id: 'VESSEL',
  displayName: 'VESSEL',
  hp: 64,
  size: { width: 64, height: 64 },
  killScore: 2500,
  deathDurationMs: 2200,
  engageMs: 1500,
  phases: [
    {
      name: 'Barricade',
      endAtHpFraction: 0.66,
      patterns: ['pillar-volley', 'sweep-lane', 'hide-shell'],
      attackGapMs: 1050,
      transitionMs: 1300,
      introLine: null,
    },
    {
      name: 'The Argument',
      endAtHpFraction: 0.33,
      patterns: ['cross-barrage', 'mirror-guard', 'march-lasers'],
      attackGapMs: 900,
      transitionMs: 1400,
      introLine: BOSS_DIALOGUE.VESSEL.phaseIntro[1] ?? null,
    },
    {
      name: 'Yield',
      endAtHpFraction: 0,
      patterns: ['reluctant-shot', 'open-heart'],
      attackGapMs: 1350,
      transitionMs: 1500,
      introLine: BOSS_DIALOGUE.VESSEL.phaseIntro[2] ?? null,
    },
  ],
};

/**
 * VESSEL — "the fragment that hid" (PLAN.md §3, boss of level 5). Three
 * phases mirroring his arc: Barricade (stubborn), The Argument (scared —
 * mirrors begin reflecting), Yield (he gives up). Defensive shells open when
 * hit hard enough; every laser is telegraphed so the fight reads as a
 * conversation with light.
 */
export class VesselBoss extends BossEntity {
  private shellIsClosed = false;
  private strainHits = 0;

  public constructor(anchor: Vec2) {
    super(VESSEL_CONFIG, anchor);
  }

  protected override readonly patternDurations: Readonly<Record<string, number>> = {
    'pillar-volley': 2600,
    'sweep-lane': 2800,
    'hide-shell': 2600,
    'cross-barrage': 3000,
    'mirror-guard': 2400,
    'march-lasers': 3200,
    'reluctant-shot': 2200,
    'open-heart': 2800,
  };

  public override get shellClosed(): boolean {
    return this.shellIsClosed;
  }

  protected override updateMotion(ctx: BossStepContext): void {
    const arena = ctx.arena;
    const cx = arena.x + arena.width / 2 + Math.sin(this.clockMs * 0.00055) * arena.width * 0.26;
    const cy = arena.y + VESSEL_HOVER_Y_PX + Math.sin(this.clockMs * 0.0016) * 12;
    this.velocity.x = cx - (this.position.x + this.size.x / 2);
    this.velocity.y = cy - (this.position.y + this.size.y / 2);
    this.position.x = cx - this.size.x / 2;
    this.position.y = cy - this.size.y / 2;
  }

  protected override interceptHit(_amount: number, rng: () => number): BossHitOutcome | null {
    // Closed shells absorb everything; enough hits force them open ("shells
    // that open when hit").
    if (this.shellIsClosed) {
      this.strainHits += 1;
      if (this.strainHits >= VESSEL_SHELL_BREAK_HITS) {
        this.shellIsClosed = false;
        this.tellGlowMs = Math.max(this.tellGlowMs, 220);
      }
      return 'immune';
    }
    // Mirror windows bounce some shots straight back at AURORA.
    if (this.currentPatternId === 'mirror-guard' && rng() < VESSEL_REFLECT_CHANCE) {
      return 'reflected';
    }
    return null;
  }

  protected override onPatternStart(patternId: string): void {
    if (patternId === 'hide-shell') {
      this.shellIsClosed = true;
      this.strainHits = 0;
    }
  }

  protected override onPatternEnd(patternId: string): void {
    if (patternId === 'hide-shell') this.shellIsClosed = false;
  }

  protected override runPattern(
    patternId: string,
    ctx: BossStepContext,
    result: BossStepResult,
  ): void {
    switch (patternId) {
      case 'pillar-volley':
        this.pillarVolley(ctx);
        break;
      case 'sweep-lane':
        this.sweepLanes(ctx);
        break;
      case 'hide-shell':
        this.say(result, BOSS_MIDFIGHT_LINES.VESSEL[0] ?? '', 'shellQuoted');
        break;
      case 'cross-barrage':
        this.crossBarrage(ctx, result);
        break;
      case 'mirror-guard':
        this.say(result, BOSS_MIDFIGHT_LINES.VESSEL[2] ?? '', 'mirrorQuoted');
        break;
      case 'march-lasers':
        this.marchLasers(ctx);
        break;
      case 'reluctant-shot':
        this.reluctantShots(ctx, result);
        break;
      case 'open-heart':
        this.say(result, BOSS_MIDFIGHT_LINES.VESSEL[3] ?? '', 'yieldQuoted');
        break;
      default:
        break;
    }
  }

  /** Vertical columns telegraphed over the player's position. */
  private pillarVolley(ctx: BossStepContext): void {
    if (this.scratchElapsed('pillar', ctx.dtSeconds * 1000) < VESSEL_PILLAR_INTERVAL_MS) return;
    this.resetScratch('pillar');
    const arena = ctx.arena;
    const px = clampNumber(ctx.playerCenter.x, arena.x + 24, arena.x + arena.width - 24);
    this.spawnLaser({
      orientation: 'vertical',
      position: px,
      spanMin: arena.y,
      spanMax: arena.y + arena.height,
      thickness: 14,
      telegraphMs: 520,
      fireMs: 300,
    });
  }

  /** Horizontal lanes marching through the arena's heights. */
  private sweepLanes(ctx: BossStepContext): void {
    if (this.scratchElapsed('lane', ctx.dtSeconds * 1000) < VESSEL_LANE_INTERVAL_MS) return;
    this.resetScratch('lane');
    const index = Number(this.scratch.get('laneIdx')) || 0;
    this.scratch.set('laneIdx', index + 1);
    const arena = ctx.arena;
    const lane =
      arena.y + 60 + ((arena.height - 120) / (VESSEL_LANE_COUNT - 1)) * (index % VESSEL_LANE_COUNT);
    this.spawnLane(lane, arena);
  }

  private spawnLane(position: number, arena: ArenaBounds): void {
    this.spawnLaser({
      orientation: 'horizontal',
      position,
      spanMin: arena.x,
      spanMax: arena.x + arena.width,
      thickness: 12,
      telegraphMs: 420,
      fireMs: 260,
    });
  }

  /** Phase 2: alternating H/V beams near the player plus aimed pairs. */
  private crossBarrage(ctx: BossStepContext, result: BossStepResult): void {
    const dtMs = ctx.dtSeconds * 1000;
    if (this.scratchElapsed('cross', dtMs) >= VESSEL_CROSS_INTERVAL_MS) {
      this.resetScratch('cross');
      const arena = ctx.arena;
      const vertical = (Number(this.scratch.get('crossAlt')) || 0) % 2 === 0;
      this.scratch.set('crossAlt', (Number(this.scratch.get('crossAlt')) || 0) + 1);
      if (vertical) {
        const px = clampNumber(
          ctx.playerCenter.x + 80,
          arena.x + 20,
          arena.x + arena.width - 20,
        );
        this.spawnLaser({
          orientation: 'vertical',
          position: px,
          spanMin: arena.y,
          spanMax: arena.y + arena.height,
          thickness: 12,
          telegraphMs: 380,
          fireMs: 240,
        });
      } else {
        const py = clampNumber(ctx.playerCenter.y, arena.y + 30, arena.y + arena.height - 30);
        this.spawnLane(py, arena);
      }
    }
    if (this.scratchElapsed('aimed', dtMs) >= VESSEL_AIMED_INTERVAL_MS) {
      this.resetScratch('aimed');
      result.shots.push(...this.aimedShots(ctx, this.center(), 2, 0.16, 340));
    }
  }

  /** A corridor of columns marching left→right; keep moving or be cornered. */
  private marchLasers(ctx: BossStepContext): void {
    if (this.scratchElapsed('march', ctx.dtSeconds * 1000) < VESSEL_MARCH_INTERVAL_MS) return;
    this.resetScratch('march');
    const arena = ctx.arena;
    const index = Number(this.scratch.get('marchIdx')) || 0;
    this.scratch.set('marchIdx', index + 1);
    const x =
      arena.x + 40 + ((index % VESSEL_MARCH_COLUMNS) / (VESSEL_MARCH_COLUMNS - 1)) * (arena.width - 80);
    this.spawnLaser({
      orientation: 'vertical',
      position: x,
      spanMin: arena.y,
      spanMax: arena.y + arena.height,
      thickness: 10,
      telegraphMs: 360,
      fireMs: 240,
    });
  }

  /** Phase 3: slow, sad single shots — he barely wants to fight anymore. */
  private reluctantShots(ctx: BossStepContext, result: BossStepResult): void {
    const fired = Number(this.scratch.get('reluctantCount')) || 0;
    if (fired === 0 && this.patternElapsedMs >= 400) {
      this.scratch.set('reluctantCount', 1);
      result.shots.push(...this.aimedShots(ctx, this.center(), 1, 0, 250));
    } else if (fired === 1 && this.patternElapsedMs >= 1100) {
      this.scratch.set('reluctantCount', 2);
      result.shots.push(...this.aimedShots(ctx, this.center(), 1, 0, 250));
    }
  }
}

// ================================================================ NULL ==

const NULL_DARK_RISE_MS = 1000;
const NULL_DARK_HOLD_MS = 2400;
const NULL_DARK_FALL_MS = 1200;
const NULL_BLINK_MS = 2400;
const MAX_VOID_ZONES = 8;

const NULL_CONFIG: BossConfig = {
  id: 'NULL',
  displayName: 'NULL',
  hp: 96,
  size: { width: 74, height: 74 },
  killScore: 5000,
  deathDurationMs: 2600,
  engageMs: 1800,
  phases: [
    {
      name: 'Presence',
      endAtHpFraction: 0.75,
      patterns: ['aimed-burst', 'edge-voids'],
      attackGapMs: 950,
      transitionMs: 1300,
      introLine: null,
    },
    {
      name: 'Erasure',
      endAtHpFraction: 0.5,
      patterns: ['eraser-line', 'closing-voids'],
      attackGapMs: 850,
      transitionMs: 1400,
      introLine: BOSS_DIALOGUE.NULL.phaseIntro[1] ?? null,
    },
    {
      name: 'Darkness',
      endAtHpFraction: 0.25,
      patterns: ['dark-wave'],
      attackGapMs: 800,
      transitionMs: 1500,
      introLine: BOSS_DIALOGUE.NULL.phaseIntro[2] ?? null,
    },
    {
      name: 'Absence',
      endAtHpFraction: 0,
      patterns: ['shrinking-sanctum', 'annihilation'],
      attackGapMs: 620,
      transitionMs: 1600,
      introLine: BOSS_DIALOGUE.NULL.phaseIntro[3] ?? null,
    },
  ],
};

/**
 * NULL — queen of pure absence (PLAN.md §3, final boss of level 7). Attacks
 * with absence itself: growing void zones shrink the safe area, darkness
 * waves blind AURORA while volleys continue, and her eraser shots delete
 * other sprites they touch. Four escalating phases ending in Absence.
 */
export class NullBoss extends BossEntity {
  public readonly voidZones: VoidZone[] = [];

  private blinkCooldownMs = NULL_BLINK_MS;

  public constructor(anchor: Vec2) {
    super(NULL_CONFIG, anchor);
  }

  protected override readonly patternDurations: Readonly<Record<string, number>> = {
    'aimed-burst': 2400,
    'edge-voids': 3200,
    'eraser-line': 3000,
    'closing-voids': 3400,
    'dark-wave': NULL_DARK_RISE_MS + NULL_DARK_HOLD_MS + NULL_DARK_FALL_MS,
    'shrinking-sanctum': 5000,
    annihilation: 3200,
  };

  public override get darknessLevel(): number {
    if (this.state !== 'active') return 0;
    if (this.phaseIndex === 2 && this.currentPatternId === 'dark-wave') {
      return darknessEnvelope(
        this.patternElapsedMs,
        NULL_DARK_RISE_MS,
        NULL_DARK_HOLD_MS,
        NULL_DARK_FALL_MS,
      );
    }
    if (this.phaseIndex === 3 && this.currentPatternId !== null) return 0.18; // ambient dread
    return 0;
  }

  public override hazardCircles(): readonly VoidZone[] {
    return this.voidZones;
  }

  protected override onDeathStart(): void {
    // Her absence dies with her: the arena reopens completely.
    this.voidZones.length = 0;
  }

  protected override updateMotion(ctx: BossStepContext): void {
    const arena = ctx.arena;
    this.blinkCooldownMs -= ctx.dtSeconds * 1000;
    if (this.blinkCooldownMs <= 0 && this.state === 'active') {
      this.blinkCooldownMs = NULL_BLINK_MS;
      const rx = arena.x + 70 + ctx.rng() * (arena.width - 140);
      const ry = arena.y + 50 + ctx.rng() * 130;
      this.position.x = rx - this.size.x / 2;
      this.position.y = ry - this.size.y / 2;
      this.tellGlowMs = Math.max(this.tellGlowMs, 130);
      return;
    }
    const baseX = arena.x + arena.width / 2 + Math.sin(this.clockMs * 0.00042) * arena.width * 0.3;
    const baseY = arena.y + 110 + Math.sin(this.clockMs * 0.0009) * 26;
    this.velocity.x = baseX - (this.position.x + this.size.x / 2);
    this.velocity.y = baseY - (this.position.y + this.size.y / 2);
    this.position.x += this.velocity.x * Math.min(1, ctx.dtSeconds * 3);
    this.position.y += this.velocity.y * Math.min(1, ctx.dtSeconds * 3);
  }

  protected override onUpdate(ctx: BossStepContext): void {
    const dtMs = ctx.dtSeconds * 1000;
    for (const zone of this.voidZones) updateVoidZone(zone, dtMs);
    this.pruneVoids();
  }

  protected override runPattern(
    patternId: string,
    ctx: BossStepContext,
    result: BossStepResult,
  ): void {
    switch (patternId) {
      case 'aimed-burst':
        if (this.scratchElapsed('burst', ctx.dtSeconds * 1000) >= 700) {
          this.resetScratch('burst');
          result.shots.push(...this.aimedShots(ctx, this.center(), 3, 0.22, 310));
        }
        break;
      case 'edge-voids':
        this.seedVoidPairOnce(ctx, 650, 62, 150);
        break;
      case 'eraser-line':
        if (this.scratchElapsed('eraser', ctx.dtSeconds * 1000) >= 780) {
          this.resetScratch('eraser');
          result.shots.push(...this.aimedShots(ctx, this.center(), 4, 0.5, 190, { eraser: true }));
        }
        break;
      case 'closing-voids':
        if (!this.scratch.get('seeded')) {
          this.scratch.set('seeded', 1);
          const py = clampNumber(
            ctx.playerCenter.y,
            ctx.arena.y + 70,
            ctx.arena.y + ctx.arena.height - 50,
          );
          this.spawnVoid(ctx.arena.x + 14, py, 500, 85, 270);
          this.spawnVoid(ctx.arena.x + ctx.arena.width - 14, py, 500, 85, 270);
        }
        break;
      case 'dark-wave':
        if (
          this.darknessLevel > 0.55 &&
          this.scratchElapsed('darkShot', ctx.dtSeconds * 1000) >= 430
        ) {
          this.resetScratch('darkShot');
          result.shots.push(...this.aimedShots(ctx, this.center(), 1, 0, 350));
        }
        break;
      case 'shrinking-sanctum':
        this.shrinkingSanctum(ctx, result);
        break;
      case 'annihilation': {
        const dtMs = ctx.dtSeconds * 1000;
        if (this.scratchElapsed('annihilLaser', dtMs) >= 380) {
          this.resetScratch('annihilLaser');
          const arena = ctx.arena;
          const px = clampNumber(ctx.playerCenter.x, arena.x + 20, arena.x + arena.width - 20);
          this.spawnLaser({
            orientation: 'vertical',
            position: px,
            spanMin: arena.y,
            spanMax: arena.y + arena.height,
            thickness: 11,
            telegraphMs: 300,
            fireMs: 200,
          });
        }
        if (this.scratchElapsed('annihilShot', dtMs) >= 380) {
          this.resetScratch('annihilShot');
          result.shots.push(...this.aimedShots(ctx, this.center(), 1, 0, 360));
        }
        break;
      }
      default:
        break;
    }
  }

  /** Two voids at the arena's side edges, growing toward the middle. */
  private seedVoidPairOnce(ctx: BossStepContext, delayMs: number, growth: number, maxR: number): void {
    if (this.scratch.get('seeded')) return;
    this.scratch.set('seeded', 1);
    const py = clampNumber(
      ctx.playerCenter.y,
      ctx.arena.y + 70,
      ctx.arena.y + ctx.arena.height - 50,
    );
    this.spawnVoid(ctx.arena.x + 18, py, delayMs, growth, maxR);
    this.spawnVoid(ctx.arena.x + ctx.arena.width - 18, py, delayMs, growth, maxR);
  }

  /** Final phase: one vast floor void swallows the arena down to pockets. */
  private shrinkingSanctum(ctx: BossStepContext, result: BossStepResult): void {
    if (!this.scratch.get('seeded')) {
      this.scratch.set('seeded', 1);
      const arena = ctx.arena;
      const maxRadius = Math.max(120, Math.min(arena.width, arena.height) * 0.5 - 90);
      this.spawnVoid(
        arena.x + arena.width / 2,
        arena.y + arena.height - 44,
        900,
        95,
        maxRadius,
      );
    }
    if (this.scratchElapsed('sanctumShot', ctx.dtSeconds * 1000) >= 800) {
      this.resetScratch('sanctumShot');
      result.shots.push(...this.aimedShots(ctx, this.center(), 2, 0.12, 330));
    }
  }

  private spawnVoid(
    centerX: number,
    centerY: number,
    delayMs: number,
    growthPxPerS: number,
    maxRadiusPx: number,
  ): void {
    if (this.voidZones.length >= MAX_VOID_ZONES) return;
    this.voidZones.push({
      centerX,
      centerY,
      radiusPx: 0,
      growthPxPerS,
      maxRadiusPx,
      delayMs,
      ageMs: 0,
    });
  }

  private pruneVoids(): void {
    for (let i = this.voidZones.length - 1; i >= 0; i--) {
      const zone = this.voidZones[i] as VoidZone;
      if (zone.ageMs >= voidLifetimeMs(zone)) this.voidZones.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------- factory --

/** Build the live boss for an arena trigger. Anchor is the hover center. */
export function createBoss(boss: BossId, anchor: Vec2): BossEntity {
  switch (boss) {
    case 'VESSEL':
      return new VesselBoss(anchor);
    case 'NULL':
      return new NullBoss(anchor);
  }
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}
