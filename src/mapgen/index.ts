/**
 * Public surface of `src/mapgen/`. Re-exports the deterministic floor
 * generator and the supporting types / serializer / renderer that the
 * diagnostic page, fixture-pack CLI, and Phase 5 renderer all consume.
 *
 * Internal helpers (BSP, corridors, encounters, reachability, math)
 * are not re-exported — callers go through `generateFloor` and the
 * resulting `Floor` object.
 */

export { generateFloor } from "./generate";
export { generateBossFloor } from "./boss-floor";
export { serializeFloor, FLOOR_SCHEMA_VERSION } from "./serialize";
// parseFloor is intentionally NOT exported here — addendum N6 keeps the
// strict parser internal to mapgen. Tests and the fixture-pack regenerator
// reach into `./serialize` directly. Phase 8 will introduce a separate
// `parseExternalFloor` for hostile-input loading.
export { renderAscii } from "./render-ascii";
export {
  TILE_VOID,
  TILE_FLOOR,
  TILE_WALL,
  TILE_DOOR,
  isWalkable,
} from "./tiles";
export type {
  Floor,
  Room,
  Door,
  Encounter,
  Rect,
  Point,
} from "./types";
export {
  STANDARD_FLOOR_WIDTH,
  STANDARD_FLOOR_HEIGHT,
  BOSS_FLOOR_WIDTH,
  BOSS_FLOOR_HEIGHT,
  BOSS_ARENA_MIN_SIZE,
} from "./params";
