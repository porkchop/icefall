/**
 * Corridor carving and door placement on a tile grid. All operations
 * are integer arithmetic over `Uint8Array` storage; the grid is passed
 * by reference and mutated in place.
 *
 * Coordinates are integer; rectangles are in inclusive-origin /
 * exclusive-extent form.
 */

import type { Rect, Point, Door } from "./types";
import { TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_VOID } from "./tiles";

function setTile(
  tiles: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  v: number,
): void {
  /* v8 ignore next */
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  tiles[y * width + x] = v;
}

function getTile(
  tiles: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  /* v8 ignore next */
  if (x < 0 || x >= width || y < 0 || y >= height) return TILE_VOID;
  return tiles[y * width + x]!;
}

/**
 * Stamp a room rectangle into the tile grid: interior cells become
 * `TILE_FLOOR`, the outer 1-tile ring becomes `TILE_WALL`. Cells outside
 * the rect are not touched.
 */
export function carveRoom(
  tiles: Uint8Array,
  width: number,
  height: number,
  rect: Rect,
): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const onEdge =
        x === rect.x ||
        x === rect.x + rect.w - 1 ||
        y === rect.y ||
        y === rect.y + rect.h - 1;
      setTile(tiles, width, height, x, y, onEdge ? TILE_WALL : TILE_FLOOR);
    }
  }
}

/**
 * Carve an L-shaped corridor from `a` to `b`. If `horizontalFirst` is
 * true, the corridor moves in x first then y; otherwise vice versa.
 *
 * Each corridor cell becomes `TILE_FLOOR`. Existing floor and door
 * tiles are not touched (so we do not undo room interiors), but walls
 * and void cells are overwritten so the corridor punches through walls
 * cleanly. Door placement happens in `placeDoor`, after corridor
 * carving identifies which wall cells need to become doors.
 */
export function carveLCorridor(
  tiles: Uint8Array,
  width: number,
  height: number,
  a: Point,
  b: Point,
  horizontalFirst: boolean,
): void {
  if (horizontalFirst) {
    carveHLine(tiles, width, height, a.x, b.x, a.y);
    carveVLine(tiles, width, height, b.x, a.y, b.y);
  } else {
    carveVLine(tiles, width, height, a.x, a.y, b.y);
    carveHLine(tiles, width, height, a.x, b.x, b.y);
  }
}

function carveHLine(
  tiles: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y: number,
): void {
  const lo = x0 < x1 ? x0 : x1;
  const hi = x0 < x1 ? x1 : x0;
  for (let x = lo; x <= hi; x++) {
    const t = getTile(tiles, width, height, x, y);
    if (t === TILE_WALL || t === TILE_VOID) {
      setTile(tiles, width, height, x, y, TILE_FLOOR);
    }
  }
}

function carveVLine(
  tiles: Uint8Array,
  width: number,
  height: number,
  x: number,
  y0: number,
  y1: number,
): void {
  const lo = y0 < y1 ? y0 : y1;
  const hi = y0 < y1 ? y1 : y0;
  for (let y = lo; y <= hi; y++) {
    const t = getTile(tiles, width, height, x, y);
    if (t === TILE_WALL || t === TILE_VOID) {
      setTile(tiles, width, height, x, y, TILE_FLOOR);
    }
  }
}

/**
 * Convert a single wall cell into a door, returning the placed door.
 * The caller is responsible for picking a cell that is on the room's
 * outer wall and adjacent to corridor floor on at least one side.
 */
export function placeDoor(
  tiles: Uint8Array,
  width: number,
  height: number,
  at: Point,
): Door {
  setTile(tiles, width, height, at.x, at.y, TILE_DOOR);
  return { x: at.x, y: at.y };
}

/**
 * Find a door candidate cell on the boundary of a room rect that is
 * adjacent (4-neighbor) to a corridor floor tile outside the room.
 * Returns the lowest-(y,x) such cell, deterministically. Returns null
 * if no such cell exists. **Used by** `generate.ts` after corridor
 * carving to install doors.
 */
export function findDoorCandidate(
  tiles: Uint8Array,
  width: number,
  height: number,
  room: Rect,
): Point | null {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const onEdge =
        x === room.x ||
        x === room.x + room.w - 1 ||
        y === room.y ||
        y === room.y + room.h - 1;
      if (!onEdge) continue;
      const t = getTile(tiles, width, height, x, y);
      if (t !== TILE_WALL) continue;
      // Check the four orthogonal neighbours; one must be a corridor
      // (i.e. floor outside the room) and the opposite must be the
      // room interior.
      const sides: { dx: number; dy: number }[] = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
      ];
      for (const s of sides) {
        const nx = x + s.dx;
        const ny = y + s.dy;
        const ix = x - s.dx;
        const iy = y - s.dy;
        if (
          nx < room.x ||
          nx >= room.x + room.w ||
          ny < room.y ||
          ny >= room.y + room.h
        ) {
          // Neighbour is outside room: it must be floor.
          const outside = getTile(tiles, width, height, nx, ny);
          // Inside neighbour must be room floor (interior).
          const inside = getTile(tiles, width, height, ix, iy);
          if (outside === TILE_FLOOR && inside === TILE_FLOOR) {
            return { x, y };
          }
        }
      }
    }
  }
  return null;
}
