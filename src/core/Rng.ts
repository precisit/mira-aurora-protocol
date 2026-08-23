/**
 * Deterministic seeded RNG (mulberry32).
 *
 * All procedural content (parallax layers, later: level decoration, particles)
 * must be reproducible across runs and platforms, so we never use Math.random()
 * in generators. Same seed ⇒ same sequence, which also makes it testable.
 */
export class SeededRng {
  private state: number;

  public constructor(seed: number) {
    // Avoid a degenerate all-zero internal state.
    this.state = seed >>> 0 === 0 ? 0x9e3779b9 : seed >>> 0;
  }

  /** Next float in [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  public int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Random element of a non-empty array (throws on empty). */
  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('SeededRng.pick: empty array');
    const index = this.int(0, items.length - 1);
    const item = items[index];
    return item as T; // guarded above; satisfies noUncheckedIndexedAccess
  }
}
