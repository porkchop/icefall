/**
 * BSP generator parameters — frozen contract 5 from
 * `artifacts/decision-memo-phase-2.md`. **rulesetVersion bump on change.**
 * Any PR touching this file requires `architecture-red-team` review and
 * pins a new golden floor digest in `src/core/self-test.ts`.
 *
 * The values are biased toward producing 6–10 BSP-leaf rooms on the
 * standard 60x24 floor, with each leaf large enough to host a 4x3-or-
 * larger room with one tile of padding on each side.
 */

/** Standard floor width (floors 1..9). */
export const STANDARD_FLOOR_WIDTH = 60;
/** Standard floor height (floors 1..9). */
export const STANDARD_FLOOR_HEIGHT = 24;

/** Boss floor width (floor 10). */
export const BOSS_FLOOR_WIDTH = 40;
/** Boss floor height (floor 10). */
export const BOSS_FLOOR_HEIGHT = 28;

/**
 * Minimum BSP leaf width and height. Below this, the leaf is not split
 * further. Must be > ROOM_PADDING * 2 so that a leaf can host a room
 * with padding on both sides.
 */
export const BSP_MIN_LEAF_WIDTH = 8;
export const BSP_MIN_LEAF_HEIGHT = 6;

/** Hard cap on BSP recursion depth, regardless of leaf size. */
export const BSP_MAX_DEPTH = 5;

/** Inset from each leaf edge before placing a room. */
export const ROOM_PADDING = 1;

/** Minimum side length of the floor-10 boss arena (tiles). */
export const BOSS_ARENA_MIN_SIZE = 20;
