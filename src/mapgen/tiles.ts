/**
 * Tile codes — frozen contract 1 from
 * `artifacts/decision-memo-phase-2.md`. Codes 4..255 are reserved for
 * additive expansion (Phase 6 lockable doors, Phase 7 NPCs, etc.).
 * Renumbering an existing code is a `rulesetVersion` bump.
 *
 * In-memory storage is a `Uint8Array` of length `width*height`,
 * row-major: `tiles[y * width + x]`. On the wire, the same bytes are
 * emitted as RFC 4648 §5 base64url (unpadded) via
 * `src/core/hash.ts:base64url`.
 */

export const TILE_VOID = 0;
export const TILE_FLOOR = 1;
export const TILE_WALL = 2;
export const TILE_DOOR = 3;

/** Inclusive range of legal tile-code byte values. */
export const TILE_CODE_MIN = 0;
export const TILE_CODE_MAX = 255;

/**
 * True iff the tile code is walkable for BFS reachability and player /
 * monster movement. `TILE_DOOR` is walkable; `TILE_WALL` and
 * `TILE_VOID` are not.
 */
export function isWalkable(code: number): boolean {
  return code === TILE_FLOOR || code === TILE_DOOR;
}
