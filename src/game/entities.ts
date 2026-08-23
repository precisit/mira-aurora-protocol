/** Minimal 2D vector + entity foundation shared by all gameplay modules. */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });

/** Axis-aligned bounding box, the game's only collision primitive (PLAN §6). */
export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Entity {
  readonly id: number;
  position: Vec2;
  velocity: Vec2;
  size: Vec2;
  active: boolean;
}

let nextEntityId = 1;

export function createEntity(position: Vec2, size: Vec2): Entity {
  return {
    id: nextEntityId++,
    position: vec2(position.x, position.y),
    velocity: vec2(),
    size: vec2(size.x, size.y),
    active: true,
  };
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Object pool (PLAN.md §6 "Objektpooling"): reuse inactive entities instead of
 * churning allocations during gameplay.
 */
export class EntityPool<T extends Entity> {
  private readonly items: T[] = [];

  public constructor(private readonly factory: (id: number) => T) {}

  /** Reactivate a pooled entity or construct a new one if none available. */
  public spawn(): T {
    const free = this.items.find((e) => !e.active);
    if (free) {
      free.active = true;
      return free;
    }
    const created = this.factory(nextEntityId++);
    this.items.push(created);
    return created;
  }

  public release(entity: T): void {
    entity.active = false;
    entity.velocity.x = 0;
    entity.velocity.y = 0;
  }

  public get active(): readonly T[] {
    return this.items.filter((e) => e.active);
  }

  /**
   * Live-entity count without allocating a filtered array (hot-path read,
   * task C3). O(n) over the pool — pools stay small by design.
   */
  public get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i]!.active) n += 1;
    }
    return n;
  }

  /**
   * The backing array itself (never reallocated except by growth). Index
   * iteration over a cached length lets hot loops avoid both the snapshot
   * spread (`[...pool.active]`) and the filtered-array allocation; entries
   * appended mid-loop simply start past the cached length.
   */
  public get itemsView(): readonly T[] {
    return this.items;
  }

  public get size(): number {
    return this.items.length;
  }
}

// ---------------------------------------------------------------------------
// Typed spawn descriptors (task A2): levels reference enemies, powerups,
// ability unlocks and memory fragments by type name; the gameplay wave (Fas 1)
// turns these descriptors into live entities.
// ---------------------------------------------------------------------------

/** Enemy archetypes (PLAN.md §4 "Fiender (basuppsättning)"). */
export type EnemyTypeName = 'Drone' | 'TunnelWorm' | 'Glitcher' | 'Purger';

export interface EnemyDescriptor {
  readonly type: EnemyTypeName;
  /** Hits required to destroy the enemy (PLAN.md §4). */
  readonly hitsToDestroy: number;
  /** Score awarded on kill, before combo multiplier. */
  readonly killScore: number;
  /** Behavior hint for the Fas-1 gameplay implementation. */
  readonly movement: 'straight-fly' | 'ground-crawl' | 'blink-teleport' | 'hover-shooter';
}

export const ENEMIES: Readonly<Record<EnemyTypeName, EnemyDescriptor>> = {
  Drone: { type: 'Drone', hitsToDestroy: 1, killScore: 50, movement: 'straight-fly' },
  TunnelWorm: { type: 'TunnelWorm', hitsToDestroy: 1, killScore: 75, movement: 'ground-crawl' },
  Glitcher: { type: 'Glitcher', hitsToDestroy: 2, killScore: 150, movement: 'blink-teleport' },
  Purger: { type: 'Purger', hitsToDestroy: 3, killScore: 250, movement: 'hover-shooter' },
};

/** Temporary in-level powerups (PLAN.md §4 "Powerups i banan"). */
export type PowerupTypeName = 'Overcharge' | 'Shield' | 'Magnet' | 'TripleJump' | 'OneUp';

export interface PowerupDescriptor {
  readonly type: PowerupTypeName;
  /** Effect duration in seconds, or null for instant/permanent-pickup effects. */
  readonly durationSeconds: number | null;
  readonly blurb: string;
}

export const POWERUPS: Readonly<Record<PowerupTypeName, PowerupDescriptor>> = {
  Overcharge: { type: 'Overcharge', durationSeconds: 8, blurb: 'Rapid fire i 8 sekunder' },
  Shield: { type: 'Shield', durationSeconds: null, blurb: 'Absorberar 1 träff' },
  Magnet: { type: 'Magnet', durationSeconds: 8, blurb: 'Drar till sig minnesfragment' },
  TripleJump: { type: 'TripleJump', durationSeconds: 8, blurb: 'Tillfälligt tredje hopp' },
  OneUp: { type: 'OneUp', durationSeconds: null, blurb: 'Extra liv' },
};

/**
 * Permanent ability unlocks found as story pickups in levels
 * (PLAN.md: dubbelhopp låses upp i nivå 2 — "AURORA hittar sitt andra thruster").
 */
export type AbilityUnlockName = 'DoubleJumpUnlock';

export interface AbilityUnlockDescriptor {
  readonly type: AbilityUnlockName;
  readonly grants: 'double-jump';
  readonly blurb: string;
}

export const ABILITY_UNLOCKS: Readonly<Record<AbilityUnlockName, AbilityUnlockDescriptor>> = {
  DoubleJumpUnlock: {
    type: 'DoubleJumpUnlock',
    grants: 'double-jump',
    blurb: 'AURORAS andra thruster — dubbelhopp',
  },
};

/**
 * The seven archive themes Mnemosyne was split into (PLAN.md §3 "De sju
 * fragmenten") with their pickup point values (PLAN.md §4 "Poäng & highscore":
 * Musik 10, Vetenskap 25 … Filosofi 100).
 */
export type FragmentTypeName =
  | 'Music'
  | 'Science'
  | 'Language'
  | 'Art'
  | 'History'
  | 'Medicine'
  | 'Philosophy';

export const FRAGMENT_POINT_VALUES: Readonly<Record<FragmentTypeName, number>> = {
  Music: 10,
  Science: 25,
  Language: 40,
  Art: 50,
  History: 60,
  Medicine: 75,
  Philosophy: 100,
};

/** Swedish display names for HUD/UI. */
export const FRAGMENT_LABELS: Readonly<Record<FragmentTypeName, string>> = {
  Music: 'Musik',
  Science: 'Vetenskap',
  Language: 'Språk',
  Art: 'Konst',
  History: 'Historia',
  Medicine: 'Medicin',
  Philosophy: 'Filosofi',
};

/** Archive themes ordered from least to most valuable ('1'–'7' in ASCII levels). */
export const FRAGMENT_ORDER: readonly FragmentTypeName[] = [
  'Music',
  'Science',
  'Language',
  'Art',
  'History',
  'Medicine',
  'Philosophy',
];
