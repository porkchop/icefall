/**
 * Top-level map-gen entry point. Frozen contracts 1, 2, 3, 4, 5, 7, 8,
 * 11, 13 from `artifacts/decision-memo-phase-2.md`.
 *
 * Contract surface:
 *
 *   generateFloor(floorN, streams) → Floor
 *
 * Stream isolation: this is the *only* function that ever consumes a
 * `RunStreams`. It derives one PRNG via `streams.mapgen(floorN)` and
 * threads it through every helper. Per-call invariant: the delta on
 * `streams.__consumed` between entry and exit is exactly the singleton
 * `{ "mapgen:" + floorN }`. Violation throws — that is the runtime
 * arm of the stream-isolation contract.
 *
 * No `Math.*`, no `Date`, no `JSON.parse`, no float arithmetic. All
 * helpers consume the PRNG by parameter; nothing in this file looks
 * at module-level state.
 */

import type { RunStreams } from "../core/streams";
import type { PRNG } from "../core/prng";
import type {
  Door,
  Encounter,
  Floor,
  Point,
  Rect,
  Room,
} from "./types";
import {
  STANDARD_FLOOR_HEIGHT,
  STANDARD_FLOOR_WIDTH,
} from "./params";
import { partition, leaves } from "./bsp";
import { placeRoomInLeaf } from "./rooms";
import {
  carveRoom,
  carveLCorridor,
  placeDoor,
  findDoorCandidate,
} from "./corridors";
import { placeEncountersForRoom } from "./encounters";
import { generateBossFloor } from "./boss-floor";
import { bfsReachable } from "./reachability";
import { TILE_FLOOR, TILE_DOOR } from "./tiles";
import type { RoomKindId } from "../registries/rooms";
import { idiv } from "./math";

/**
 * Generate one floor deterministically. See module doc.
 */
export function generateFloor(floorN: number, streams: RunStreams): Floor {
  if (!Number.isInteger(floorN) || floorN < 1 || floorN > 10) {
    throw new Error(`generateFloor: floorN must be 1..10 (got ${floorN})`);
  }
  // Per-call delta guard — snapshot before, compare after.
  const before = new Set<string>(streams.__consumed);
  const prng = streams.mapgen(floorN);

  const floor =
    floorN === 10
      ? finalizeBossFloor(prng)
      : finalizeStandardFloor(floorN, prng);

  // Verify per-call delta is exactly {"mapgen:floorN"}.
  const expectedKey = `mapgen:${floorN}`;
  const delta: string[] = [];
  for (const k of streams.__consumed) {
    if (!before.has(k)) delta.push(k);
  }
  delta.sort();
  /* v8 ignore start */
  if (delta.length !== 1 || delta[0] !== expectedKey) {
    throw new Error(
      `generateFloor: stream consumption delta ${JSON.stringify(delta)} is not the expected singleton [${expectedKey}]`,
    );
  }
  /* v8 ignore stop */

  // Runtime invariant: every walkable cell reachable from entrance.
  /* v8 ignore start */
  if (!bfsReachable(floor.tiles, floor.width, floor.height, floor.entrance)) {
    throw new Error(
      `generateFloor: floor ${floorN} has unreachable walkable cells`,
    );
  }
  /* v8 ignore stop */

  // Top-tier overlay exclusivity invariant (entrance vs exit vs
  // bossArena rectangle never collide). The renderer also asserts
  // this; we check here for fail-fast generation-time errors.
  assertTopTierExclusivity(floor);

  return floor;
}

function finalizeBossFloor(prng: PRNG): Floor {
  return generateBossFloor(prng);
}

function finalizeStandardFloor(floorN: number, prng: PRNG): Floor {
  const width = STANDARD_FLOOR_WIDTH;
  const height = STANDARD_FLOOR_HEIGHT;
  const tiles = new Uint8Array(width * height);

  // Step 1: BSP partition.
  const tree = partition({ x: 0, y: 0, w: width, h: height }, prng);
  const leafRects = leaves(tree);
  /* v8 ignore start */
  if (leafRects.length < 2) {
    throw new Error(
      "generateFloor: BSP produced fewer than 2 leaves; cannot place entrance + exit",
    );
  }
  /* v8 ignore stop */

  // Step 2: place a room in each leaf. The first leaf is the
  // entrance; the last leaf is the exit; the rest are regular. This
  // keeps entrance and exit on opposite sides of the BSP tree, which
  // typically maximizes traversal length on a 60x24 floor.
  const placedRects: Rect[] = [];
  const rooms: Room[] = [];
  for (let i = 0; i < leafRects.length; i++) {
    const leaf = leafRects[i]!;
    const kind: RoomKindId =
      i === 0 ? "room.entrance" : i === leafRects.length - 1 ? "room.exit" : "room.regular";
    const rect = placeRoomInLeaf(leaf, prng, kind);
    placedRects.push(rect);
    rooms.push({ id: i, kind, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  }

  // Step 3: carve room interiors.
  for (const r of placedRects) carveRoom(tiles, width, height, r);

  // Step 4: walk the BSP tree bottom-up; for every internal node,
  // connect a representative point of its left subtree to a
  // representative point of its right subtree with an L-shaped
  // corridor. The representative point is the centre of the leftmost
  // / rightmost room in the subtree (deterministic; integer-only).
  connectSubtrees(tree, leafRects, placedRects, tiles, width, height, prng);

  // Step 5: place doors where corridors meet rooms. For each room,
  // search its boundary for a wall cell that is adjacent to corridor
  // floor outside the room and convert it to TILE_DOOR.
  const doors: Door[] = [];
  for (const r of placedRects) {
    const cand = findDoorCandidate(tiles, width, height, r);
    if (cand !== null) {
      doors.push(placeDoor(tiles, width, height, cand));
    }
  }

  // Step 6: encounter placement (regular rooms only).
  const encounters: Encounter[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i]!;
    const slots = placeEncountersForRoom(
      tiles,
      width,
      height,
      room,
      prng,
      floorN,
    );
    for (const s of slots) encounters.push(s);
  }

  // Step 7: derive entrance and exit *positions* from the entrance
  // and exit rooms. Each is the integer-centre of its room's
  // interior.
  const entranceRoom = placedRects[0]!;
  const exitRoom = placedRects[placedRects.length - 1]!;
  const entrance = roomInteriorCentre(entranceRoom);
  const exit = roomInteriorCentre(exitRoom);

  return {
    floor: floorN,
    width,
    height,
    tiles,
    rooms,
    doors,
    encounters,
    entrance,
    exit,
    bossArena: null,
  };
}

function roomInteriorCentre(r: Rect): Point {
  // Interior is r.x+1..r.x+r.w-2 (inclusive), so centre = r.x + idiv(r.w, 2).
  return { x: r.x + idiv(r.w, 2), y: r.y + idiv(r.h, 2) };
}

/**
 * Walk the BSP tree (post-order); for each split node connect the
 * representative point of its left subtree's leftmost room to the
 * representative point of its right subtree's rightmost room. The
 * connection is an L-shaped corridor whose orientation
 * (horizontal-then-vertical or the inverse) is chosen by one PRNG
 * bit per connection.
 */
function connectSubtrees(
  tree: ReturnType<typeof partition>,
  leafRects: readonly Rect[],
  placedRects: readonly Rect[],
  tiles: Uint8Array,
  width: number,
  height: number,
  prng: PRNG,
): void {
  // Build a leaf -> placedRect index lookup by walking leaves in the
  // same in-order traversal that `leaves(tree)` uses. We avoid using
  // `Map` here because `for (const k of map)` iterates in insertion
  // order — the determinism rule wants explicit sorted iteration —
  // and a parallel-array linear search is just as fast for tens of
  // entries.
  function findLeafIdx(rect: Rect): number {
    for (let i = 0; i < leafRects.length; i++) {
      if (leafRects[i] === rect) return i;
    }
    /* v8 ignore next */
    throw new Error("connectSubtrees: leaf not found in leafRects");
  }

  function reps(node: ReturnType<typeof partition>): {
    first: Rect;
    last: Rect;
  } {
    if (node.kind === "leaf") {
      const idx = findLeafIdx(node.rect);
      const room = placedRects[idx]!;
      return { first: room, last: room };
    }
    const left = reps(node.left);
    const right = reps(node.right);
    // After connecting children below, the parent picks left.first and
    // right.last as the subtree's overall span.
    const lc = roomInteriorCentre(left.last);
    const rc = roomInteriorCentre(right.first);
    const horizontalFirst = (prng() & 1) === 0;
    carveLCorridor(tiles, width, height, lc, rc, horizontalFirst);
    return { first: left.first, last: right.last };
  }

  reps(tree);
}

function assertTopTierExclusivity(floor: Floor): void {
  // Top-tier cells: entrance, exit (if present), every cell of the
  // bossArena rectangle (if present). No two of these may be the
  // same cell.
  const seen = new Set<number>();
  function reserve(x: number, y: number, label: string): void {
    const idx = y * floor.width + x;
    /* v8 ignore start */
    if (seen.has(idx)) {
      throw new Error(
        `generateFloor: top-tier overlay collision at (${x},${y}) for ${label}`,
      );
    }
    /* v8 ignore stop */
    seen.add(idx);
  }
  reserve(floor.entrance.x, floor.entrance.y, "entrance");
  if (floor.exit !== null) {
    reserve(floor.exit.x, floor.exit.y, "exit");
  }
  if (floor.bossArena !== null) {
    const ba = floor.bossArena;
    for (let yy = ba.y; yy < ba.y + ba.h; yy++) {
      for (let xx = ba.x; xx < ba.x + ba.w; xx++) {
        reserve(xx, yy, "bossArena");
      }
    }
  }
  // Also assert entrance and exit are on TILE_FLOOR (not door) — memo
  // addendum N3: door-under-entrance is impossible.
  /* v8 ignore next 5 */
  if (floor.tiles[floor.entrance.y * floor.width + floor.entrance.x] !== TILE_FLOOR) {
    throw new Error(
      "generateFloor: entrance not on TILE_FLOOR (door-under-entrance forbidden)",
    );
  }
  /* v8 ignore next 6 */
  if (
    floor.exit !== null &&
    floor.tiles[floor.exit.y * floor.width + floor.exit.x] !== TILE_FLOOR
  ) {
    throw new Error("generateFloor: exit not on TILE_FLOOR");
  }
  // Door tiles must be TILE_DOOR.
  for (let i = 0; i < floor.doors.length; i++) {
    const d = floor.doors[i]!;
    /* v8 ignore next 3 */
    if (floor.tiles[d.y * floor.width + d.x] !== TILE_DOOR) {
      throw new Error(`generateFloor: door at (${d.x},${d.y}) not TILE_DOOR`);
    }
  }
}
