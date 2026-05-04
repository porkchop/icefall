/**
 * Phase 7.A.1 cyberdeck-mod-1 equipment recipe
 * (`atlas-recipe.cyberpunk.item.cyberdeck-mod-1`). A purple circuit
 * board fragment with green trace lines — distinct from the cyber.*
 * cyberware recipes (which paint plate-armor silhouettes) and the
 * weapon recipes. Closes Phase 6.A.2 code-review nit N4.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberdeckMod1(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const purple = paletteIndex(palette, "deep-purple");
  const green = paletteIndex(palette, "neon-green");
  const cyan = paletteIndex(palette, "neon-cyan");
  const dark = paletteIndex(palette, "void-black");
  // Circuit board substrate (purple): 12 wide × 10 tall centered.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 2, 3, 13, 12);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = purple;
  }
  // Green horizontal trace lines (rows 5, 8, 11).
  for (let x = 3; x <= 12; x++) {
    buf[5 * TILE_SIZE + x] = green;
    buf[8 * TILE_SIZE + x] = green;
    buf[11 * TILE_SIZE + x] = green;
  }
  // Cyan vertical trace lines (cols 5, 10).
  for (let y = 4; y <= 11; y++) {
    buf[y * TILE_SIZE + 5] = cyan;
    buf[y * TILE_SIZE + 10] = cyan;
  }
  // Dark connector pins along the top edge.
  for (let x = 3; x <= 12; x += 2) {
    buf[3 * TILE_SIZE + x] = dark;
  }
  // Speckle for character — consumes one prng() per cell in a small
  // region. Keeps the recipe's PRNG cursor advancement testable.
  for (let y = 6; y <= 7; y++) {
    for (let x = 6; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 224) buf[y * TILE_SIZE + x] = green;
    }
  }
  return buf;
}
