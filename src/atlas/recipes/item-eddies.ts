/**
 * Phase 6.A.2 eddies currency item recipe
 * (`atlas-recipe.cyberpunk.item.eddies`). A small green stack of
 * data-coins with a subtle yellow highlight.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemEddies(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const green = paletteIndex(palette, "neon-green");
  const yellow = paletteIndex(palette, "neon-yellow");
  const dark = paletteIndex(palette, "void-black");
  // Three stacked coins (rectangles) at progressively higher rows.
  const c1 = rectMask(TILE_SIZE, TILE_SIZE, 4, 11, 11, 12);
  const c2 = rectMask(TILE_SIZE, TILE_SIZE, 4, 8, 11, 9);
  const c3 = rectMask(TILE_SIZE, TILE_SIZE, 4, 5, 11, 6);
  for (let i = 0; i < buf.length; i++) {
    if (c1[i] === 1 || c2[i] === 1 || c3[i] === 1) buf[i] = green;
  }
  // Dark trim above each coin row.
  for (let x = 4; x <= 11; x++) {
    buf[10 * TILE_SIZE + x] = dark;
    buf[7 * TILE_SIZE + x] = dark;
    buf[4 * TILE_SIZE + x] = dark;
  }
  // Yellow highlight pixels — speckle via prng.
  for (let y = 5; y <= 12; y++) {
    for (let x = 5; x <= 10; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 230) buf[y * TILE_SIZE + x] = yellow;
    }
  }
  return buf;
}
