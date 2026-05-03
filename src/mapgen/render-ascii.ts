/**
 * ASCII renderer for `Floor`. Frozen contract 13 from
 * `artifacts/decision-memo-phase-2.md`.
 *
 *   '#' wall        '<' entrance
 *   '.' floor       '>' exit
 *   '+' door        'B' boss-arena marker
 *   ' ' void        'e' encounter slot
 *
 * Top-tier overlays `< > B` are mutually exclusive per cell — the
 * generator places them in geometrically disjoint locations and this
 * renderer asserts the invariant. `e` outranks tile codes; tile codes
 * outrank `' '` (which is the void default).
 *
 * Output: `lines.join("\n") + "\n"`. Exactly one trailing `\n`. LF
 * only, never CRLF.
 */

import type { Floor } from "./types";
import { TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_VOID } from "./tiles";

const CHAR_VOID = " ";
const CHAR_FLOOR = ".";
const CHAR_WALL = "#";
const CHAR_DOOR = "+";
const CHAR_ENTRANCE = "<";
const CHAR_EXIT = ">";
const CHAR_BOSS = "B";
const CHAR_ENCOUNTER = "e";

/**
 * Map a tile byte to its ASCII char. Future tile codes render as '?' so
 * they are visible in the diagnostic preview without perturbing the
 * existing fixture pack. Exported for direct unit testing.
 */
export function tileChar(t: number): string {
  if (t === TILE_FLOOR) return CHAR_FLOOR;
  if (t === TILE_WALL) return CHAR_WALL;
  if (t === TILE_DOOR) return CHAR_DOOR;
  if (t === TILE_VOID) return CHAR_VOID;
  return "?";
}

/**
 * Render a floor as ASCII. Throws if two top-tier overlays would
 * collide on the same cell — this is a generation-time invariant
 * (memo addendum N3) and the renderer is the second line of defence.
 */
export function renderAscii(floor: Floor): string {
  const { width, height, tiles, entrance, exit, bossArena, encounters } =
    floor;

  // Build a parallel overlay grid; '\0' = no overlay.
  const overlay = new Array<string>(width * height);
  for (let i = 0; i < overlay.length; i++) overlay[i] = "";

  function setOverlay(x: number, y: number, ch: string, label: string): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    const prev = overlay[idx]!;
    if (prev !== "" && isTopTier(prev) && isTopTier(ch)) {
      throw new Error(
        `renderAscii: top-tier overlay collision at (${x},${y}): '${prev}' vs '${ch}' (${label})`,
      );
    }
    // Lower-tier overlay can be replaced by higher-tier; equal tier
    // keeps the existing one (deterministic by source order).
    if (prev === "" || rankOf(prev) < rankOf(ch)) {
      overlay[idx] = ch;
    }
  }

  // Encounters are the lowest overlay tier; place them first so any
  // top-tier overlay that lands on the same cell wins via rank.
  for (let i = 0; i < encounters.length; i++) {
    const e = encounters[i]!;
    setOverlay(e.x, e.y, CHAR_ENCOUNTER, "encounter");
  }
  // Boss-arena rectangle.
  if (bossArena !== null) {
    for (let yy = bossArena.y; yy < bossArena.y + bossArena.h; yy++) {
      for (let xx = bossArena.x; xx < bossArena.x + bossArena.w; xx++) {
        setOverlay(xx, yy, CHAR_BOSS, "bossArena");
      }
    }
  }
  // Entrance and exit beat boss-arena; collision fails the invariant.
  setOverlay(entrance.x, entrance.y, CHAR_ENTRANCE, "entrance");
  if (exit !== null) {
    setOverlay(exit.x, exit.y, CHAR_EXIT, "exit");
  }

  // Compose final grid line-by-line.
  const lines = new Array<string>(height);
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const ov = overlay[idx]!;
      if (ov !== "") {
        row += ov;
      } else {
        row += tileChar(tiles[idx]!);
      }
    }
    lines[y] = row;
  }
  return lines.join("\n") + "\n";
}

function isTopTier(ch: string): boolean {
  return ch === CHAR_ENTRANCE || ch === CHAR_EXIT || ch === CHAR_BOSS;
}

/**
 * Overlay rank: top-tier overlays beat encounter overlays beat tile chars.
 * Exported for direct unit testing of the precedence contract.
 */
export function rankOf(ch: string): number {
  if (isTopTier(ch)) return 3;
  if (ch === CHAR_ENCOUNTER) return 2;
  return 1;
}
