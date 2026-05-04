/**
 * Phase 3 sim constants — frozen by the Phase 3 decision memo
 * (see addendum and frozen-contract list in
 * `artifacts/decision-memo-phase-3.md`). Bumping any value here is a
 * `rulesetVersion` bump.
 */

/** Maximum BFS step count at which a monster transitions to chasing. */
export const MAX_LOS_RADIUS = 8;

/**
 * Roll-pre-image domain anchor — frozen per addendum B1. Positioned
 * between `encodeAction(action)` and the length-prefixed domain bytes
 * inside `rollBytes`, this 16-byte ASCII literal makes the roll pre-image
 * impossible to confuse with any future action-encoder tag extension.
 */
export const ROLL_DOMAIN_ANCHOR_TEXT = "icefall:roll:v1:" as const;

/** Phase 3 frozen action vocabulary (decision 3). */
export const ACTION_TYPE_WAIT = "wait" as const;
export const ACTION_TYPE_MOVE = "move" as const;
export const ACTION_TYPE_ATTACK = "attack" as const;
export const ACTION_TYPE_DESCEND = "descend" as const;

export const ACTION_TYPES_PHASE_3: readonly string[] = Object.freeze([
  ACTION_TYPE_WAIT,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_DESCEND,
]);

/**
 * Direction ordinals — frozen by addendum N4. The eight directions in
 * lexicographic-tiebreak order, with `(dy, dx)` deltas where y increases
 * southward (matching `Floor.tiles[y * width + x]` row-major addressing).
 */
export const DIR_N = 0 as const;
export const DIR_E = 1 as const;
export const DIR_S = 2 as const;
export const DIR_W = 3 as const;
export const DIR_NE = 4 as const;
export const DIR_SE = 5 as const;
export const DIR_SW = 6 as const;
export const DIR_NW = 7 as const;

export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** `(dy, dx)` delta for each direction ordinal. Index = ordinal. */
export const DIR_DELTAS: readonly { readonly dy: number; readonly dx: number }[] =
  Object.freeze([
    Object.freeze({ dy: -1, dx: 0 }), // N
    Object.freeze({ dy: 0, dx: 1 }), // E
    Object.freeze({ dy: 1, dx: 0 }), // S
    Object.freeze({ dy: 0, dx: -1 }), // W
    Object.freeze({ dy: -1, dx: 1 }), // NE
    Object.freeze({ dy: 1, dx: 1 }), // SE
    Object.freeze({ dy: 1, dx: -1 }), // SW
    Object.freeze({ dy: -1, dx: -1 }), // NW
  ]);
