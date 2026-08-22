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

  public get size(): number {
    return this.items.length;
  }
}
