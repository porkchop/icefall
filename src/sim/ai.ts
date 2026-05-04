/**
 * Phase 3 monster AI — frozen-contract item 7 (zero-PRNG, zero-roll
 * inside a tick) and addendum N4 (BFS coordinate system + N5 metric).
 *
 * BFS distance map is computed from the player's position with
 * 8-connected adjacency; each monster picks the single adjacent
 * walkable cell whose distance is one less than its own, breaking
 * ties by the direction list `N, E, S, W, NE, SE, SW, NW`. If
 * adjacent to the player, attack instead of moving.
 *
 * The AI consumes no PRNG cursors and no per-roll subhash. All ops
 * are integer (no floats — `bfsDistance` returns the integer step
 * count or the integer sentinel `MAX_LOS_RADIUS + 1`).
 */

import type { Floor } from "../mapgen/types";
import { TILE_FLOOR, TILE_DOOR } from "../mapgen/tiles";
import {
  DIR_DELTAS,
  MAX_LOS_RADIUS,
  type Direction,
} from "./params";
import type { Monster, Point } from "./types";

const UNREACHABLE = MAX_LOS_RADIUS + 1;

function isWalkable(floor: Floor, y: number, x: number): boolean {
  if (x < 0 || x >= floor.width || y < 0 || y >= floor.height) return false;
  const t = floor.tiles[y * floor.width + x]!;
  return t === TILE_FLOOR || t === TILE_DOOR;
}

/**
 * BFS distance map from `start` over walkable cells, capped at
 * `MAX_LOS_RADIUS`. Returns a `Int16Array` of length `width*height`
 * where each cell's value is its step count in `[0, MAX_LOS_RADIUS]`
 * if reached within the cap, else `UNREACHABLE` (= `MAX_LOS_RADIUS + 1`,
 * integer-only sentinel — addendum N5).
 *
 * The BFS is computed over walkable terrain only; monster-occupied
 * cells are NOT treated as blocked, so each monster can read its own
 * distance to the player without being blocked by itself or other
 * monsters. Move-time occupancy is checked separately in the turn
 * loop (`turn.ts`), which prevents two monsters from stepping into
 * the same cell.
 */
export function bfsDistanceMapFromPlayer(
  floor: Floor,
  player: Point,
  _monsters: readonly Monster[],
): Int16Array {
  const w = floor.width;
  const h = floor.height;
  const map = new Int16Array(w * h);
  for (let i = 0; i < map.length; i++) map[i] = UNREACHABLE;

  const sx = player.x;
  const sy = player.y;
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return map;

  // Parallel-array ring-buffer queue (xs/ys) so we never have to
  // recover y from a packed index via division — the determinism lint
  // rule bans `/`. Same pattern as `src/mapgen/reachability.ts`.
  const xs = new Int32Array(w * h);
  const ys = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  map[sy * w + sx] = 0;
  xs[tail] = sx;
  ys[tail] = sy;
  tail++;

  while (head < tail) {
    const cx = xs[head]!;
    const cy = ys[head]!;
    head++;
    const d = map[cy * w + cx]!;
    if (d >= MAX_LOS_RADIUS) continue;

    for (let i = 0; i < DIR_DELTAS.length; i++) {
      const delta = DIR_DELTAS[i]!;
      const ny = cy + delta.dy;
      const nx = cx + delta.dx;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (map[ni]! !== UNREACHABLE) continue;
      if (!isWalkable(floor, ny, nx)) continue;
      map[ni] = (d + 1) as number;
      xs[tail] = nx;
      ys[tail] = ny;
      tail++;
    }
  }

  return map;
}

/**
 * Decide one monster's tick action. Returns either:
 *   - `{ kind: "stay" }` — monster doesn't move (idle, or chasing but
 *     no path)
 *   - `{ kind: "move", to: { y, x }, newAiState }` — step one cell
 *   - `{ kind: "attack" }` — monster is adjacent to player; attack
 *
 * Pure function. Reads the BFS distance map computed once per tick.
 */
export type MonsterDecision =
  | { readonly kind: "stay"; readonly newAiState: "idle" | "chasing" }
  | {
      readonly kind: "move";
      readonly to: Point;
      readonly newAiState: "idle" | "chasing";
    }
  | { readonly kind: "attack"; readonly newAiState: "chasing" };

export function decideMonsterAction(
  monster: Monster,
  player: Point,
  distMap: Int16Array,
  floor: Floor,
): MonsterDecision {
  const w = floor.width;
  const monsterIdx = monster.pos.y * w + monster.pos.x;
  const my = monster.pos.y;
  const mx = monster.pos.x;

  // Adjacency check — within one cell of player (chebyshev distance 1).
  const dy = my - player.y;
  const dx = mx - player.x;
  const adyAbs = dy < 0 ? -dy : dy;
  const adxAbs = dx < 0 ? -dx : dx;
  if (adyAbs <= 1 && adxAbs <= 1 && (adyAbs + adxAbs) >= 1) {
    return { kind: "attack", newAiState: "chasing" };
  }

  // BFS distance from monster cell — but the map is from the player,
  // so we read the monster cell's distance. If unreachable or > LOS,
  // monster falls back to idle (decision 7).
  const monsterDist = distMap[monsterIdx]!;
  if (monsterDist > MAX_LOS_RADIUS) {
    // Out of sight; revert to idle, stay put.
    return { kind: "stay", newAiState: "idle" };
  }

  // Pick the adjacent walkable cell whose distance is monsterDist - 1,
  // breaking ties by direction-order (N, E, S, W, NE, SE, SW, NW).
  for (let i = 0; i < DIR_DELTAS.length; i++) {
    const delta = DIR_DELTAS[i]!;
    const ny = my + delta.dy;
    const nx = mx + delta.dx;
    if (nx < 0 || nx >= w || ny < 0 || ny >= floor.height) continue;
    const ni = ny * w + nx;
    if (distMap[ni]! === monsterDist - 1) {
      return {
        kind: "move",
        to: { y: ny, x: nx },
        newAiState: "chasing",
      };
    }
  }

  // No valid step found — monster sees the player but every neighbor
  // is blocked. Stay put but remain in chasing state.
  return { kind: "stay", newAiState: "chasing" };
}

/** Direction ordinal for a unit `(dy, dx)` step, or `-1` if not unit. */
export function dirOrdinalForStep(dy: number, dx: number): Direction | -1 {
  for (let i = 0; i < DIR_DELTAS.length; i++) {
    const delta = DIR_DELTAS[i]!;
    if (delta.dy === dy && delta.dx === dx) return i as Direction;
  }
  return -1;
}

export const AI_UNREACHABLE_SENTINEL = UNREACHABLE;
