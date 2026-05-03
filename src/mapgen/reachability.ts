/**
 * BFS over walkable tiles (`TILE_FLOOR | TILE_DOOR`). Used by
 * `generateFloor` as a runtime invariant — every walkable cell on the
 * map must be reachable from the entrance.
 *
 * Integer-only, deterministic. The queue stores `(x, y)` pairs as two
 * parallel `Int32Array`s so we never have to recover `y` from a packed
 * index — recovering `y = idx / width` would need a `/` operator, and
 * the determinism lint rule bans it.
 */

import type { Point } from "./types";
import { isWalkable } from "./tiles";

/**
 * Returns `true` iff every walkable cell in the grid is reachable from
 * `start`. Throws if `start` itself is not walkable.
 */
export function bfsReachable(
  tiles: Uint8Array,
  width: number,
  height: number,
  start: Point,
): boolean {
  const total = width * height;
  const startIdx = start.y * width + start.x;
  if (!isWalkable(tiles[startIdx]!)) {
    throw new Error(
      `bfsReachable: start cell (${start.x},${start.y}) is not walkable`,
    );
  }

  const visited = new Uint8Array(total);
  const xs = new Int32Array(total);
  const ys = new Int32Array(total);
  let head = 0;
  let tail = 0;

  visited[startIdx] = 1;
  xs[tail] = start.x;
  ys[tail] = start.y;
  tail++;
  let visitedCount = 1;

  while (head < tail) {
    const x = xs[head]!;
    const y = ys[head]!;
    head++;
    if (x > 0) {
      if (tryVisit(tiles, width, visited, x - 1, y)) {
        xs[tail] = x - 1;
        ys[tail] = y;
        tail++;
        visitedCount++;
      }
    }
    if (x + 1 < width) {
      if (tryVisit(tiles, width, visited, x + 1, y)) {
        xs[tail] = x + 1;
        ys[tail] = y;
        tail++;
        visitedCount++;
      }
    }
    if (y > 0) {
      if (tryVisit(tiles, width, visited, x, y - 1)) {
        xs[tail] = x;
        ys[tail] = y - 1;
        tail++;
        visitedCount++;
      }
    }
    if (y + 1 < height) {
      if (tryVisit(tiles, width, visited, x, y + 1)) {
        xs[tail] = x;
        ys[tail] = y + 1;
        tail++;
        visitedCount++;
      }
    }
  }

  let walkable = 0;
  for (let i = 0; i < total; i++) if (isWalkable(tiles[i]!)) walkable++;
  return visitedCount === walkable;
}

function tryVisit(
  tiles: Uint8Array,
  width: number,
  visited: Uint8Array,
  x: number,
  y: number,
): boolean {
  const idx = y * width + x;
  if (visited[idx]!) return false;
  if (!isWalkable(tiles[idx]!)) return false;
  visited[idx] = 1;
  return true;
}
