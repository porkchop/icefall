/**
 * Phase 6.A.2 syringe consumable recipe
 * (`atlas-recipe.cyberpunk.item.consumable-syringe`). A diagonal
 * cyan-tipped syringe with a magenta plunger.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { lineMask, paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemConsumableSyringe(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const ice = paletteIndex(palette, "ice-white");
  const cyan = paletteIndex(palette, "neon-cyan");
  const magenta = paletteIndex(palette, "neon-magenta");
  const steel = paletteIndex(palette, "steel-grey");
  // Diagonal barrel (steel) from (3,12) to (12,3).
  const barrel = lineMask(TILE_SIZE, TILE_SIZE, 3, 12, 12, 3);
  // Make it 2px thick by drawing a parallel line shifted by (1,0).
  const barrel2 = lineMask(TILE_SIZE, TILE_SIZE, 4, 12, 13, 3);
  for (let i = 0; i < buf.length; i++) {
    if (barrel[i] === 1 || barrel2[i] === 1) buf[i] = steel;
  }
  // Cyan tip at top-right (1..3 px range around (12,3)).
  buf[2 * TILE_SIZE + 13] = cyan;
  buf[3 * TILE_SIZE + 12] = cyan;
  buf[3 * TILE_SIZE + 13] = cyan;
  buf[4 * TILE_SIZE + 12] = cyan;
  // Magenta plunger at bottom-left.
  buf[12 * TILE_SIZE + 2] = magenta;
  buf[13 * TILE_SIZE + 2] = magenta;
  buf[12 * TILE_SIZE + 3] = magenta;
  buf[13 * TILE_SIZE + 3] = magenta;
  // Ice-white sparkle highlights via noise.
  for (let y = 3; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 240) buf[y * TILE_SIZE + x] = ice;
    }
  }
  return buf;
}
