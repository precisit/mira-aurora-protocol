/**
 * Physics/movement tuning constants (PLAN.md §4 "Rörelse & kärnmekanik").
 * Values are first-pass arcade targets; wave A (core gameplay) tunes them.
 *
 * All units: pixels & seconds (world px, 32 px tiles, 1280×720 virtual view).
 */

/** Downward acceleration. */
export const GRAVITY_PX_PER_S2 = 2600;

/** Terminal fall speed. */
export const MAX_FALL_SPEED_PX_PER_S = 1100;

/** Horizontal run speed. */
export const RUN_SPEED_PX_PER_S = 340;

/** Ground acceleration/deceleration toward target speed. */
export const GROUND_ACCEL_PX_PER_S2 = 3400;
export const AIR_ACCEL_PX_PER_S2 = 2200;

/** Instant upward velocity applied on jump (negative = up). */
export const JUMP_VELOCITY_PX_PER_S = -760;

/** Grace time after leaving a ledge where a jump still counts as grounded. */
export const COYOTE_TIME_MS = 90;

/** Buffer window for jump presses executed slightly before landing. */
export const JUMP_BUFFER_MS = 120;

/**
 * Extra downward acceleration while rising with the jump key released
 * ("jump cut") so tap-jumps are shorter than held jumps — arcade tightness.
 */
export const JUMP_CUT_GRAVITY_SCALE = 1.9;

/** Horizontal pushback applied to a body when damaged (small knockback). */
export const HIT_KNOCKBACK_PX_PER_S = 220;

/** Invulnerability window after taking damage (blink time), ms. */
export const INVULNERABLE_MS = 1200;

/** Shorter grace after a shield absorbs a hit, ms. */
export const SHARED_SHIELD_IFRAME_MS = 600;

