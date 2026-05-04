/**
 * Phase 7.A.1 stim-patch consumable recipe
 * (`atlas-recipe.cyberpunk.item.stim-patch`). A small magenta adhesive
 * patch with a cyan vertical stripe — visually distinct from the
 * Phase 6 syringe consumable. Closes Phase 6.A.2 code-review nit N4
 * (renderer-throw if floor-spawned without a recipe).
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemStimPatch(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const magenta = paletteIndex(palette, "neon-magenta");
  const cyan = paletteIndex(palette, "neon-cyan");
  const dark = paletteIndex(palette, "dark-grey");
  const ice = paletteIndex(palette, "ice-white");
  // Patch body: 8 wide × 10 tall, centered.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 4, 3, 11, 12);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = magenta;
  }
  // Cyan vertical stripe down the centre (col 7..8).
  for (let y = 4; y <= 11; y++) {
    buf[y * TILE_SIZE + 7] = cyan;
    buf[y * TILE_SIZE + 8] = cyan;
  }
  // Dark trim around the patch edge for definition.
  for (let x = 4; x <= 11; x++) {
    buf[3 * TILE_SIZE + x] = dark;
    buf[12 * TILE_SIZE + x] = dark;
  }
  for (let y = 3; y <= 12; y++) {
    buf[y * TILE_SIZE + 4] = dark;
    buf[y * TILE_SIZE + 11] = dark;
  }
  // Ice-white sparkle highlights (one prng() call per cell in the
  // stripe region — keeps the recipe's PRNG cursor advancement
  // testable).
  for (let y = 4; y <= 11; y++) {
    for (let x = 7; x <= 8; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 220) buf[y * TILE_SIZE + x] = ice;
    }
  }
  return buf;
}
