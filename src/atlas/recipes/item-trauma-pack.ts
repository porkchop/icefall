/**
 * Phase 7.A.1 trauma-pack consumable recipe
 * (`atlas-recipe.cyberpunk.item.trauma-pack`). A blood-red medical kit
 * with a white-cross icon — tier 2 consumable visually distinct from
 * stim-patch (magenta) and the Phase 6 healing items. Closes Phase
 * 6.A.2 code-review nit N4.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemTraumaPack(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const red = paletteIndex(palette, "blood-red");
  const ice = paletteIndex(palette, "ice-white");
  const dark = paletteIndex(palette, "void-black");
  const amber = paletteIndex(palette, "warning-amber");
  // Kit body: 10 wide × 9 tall, centered with handle slot above.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 3, 5, 12, 13);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = red;
  }
  // White medical cross (3 wide × 5 tall, vertical bar; 5 wide × 3 tall,
  // horizontal bar) centered around (8, 9).
  for (let y = 7; y <= 11; y++) {
    buf[y * TILE_SIZE + 7] = ice;
    buf[y * TILE_SIZE + 8] = ice;
  }
  for (let x = 6; x <= 9; x++) {
    buf[8 * TILE_SIZE + x] = ice;
    buf[9 * TILE_SIZE + x] = ice;
  }
  // Handle (amber) on top of the kit.
  for (let x = 6; x <= 9; x++) {
    buf[3 * TILE_SIZE + x] = amber;
    buf[4 * TILE_SIZE + x] = amber;
  }
  // Dark trim along the bottom edge for definition.
  for (let x = 3; x <= 12; x++) {
    buf[13 * TILE_SIZE + x] = dark;
  }
  // Speckle for character — consumes one prng() per cell in a small
  // region so the cursor advances deterministically.
  for (let y = 5; y < 7; y++) {
    for (let x = 4; x < 12; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 232) buf[y * TILE_SIZE + x] = amber;
    }
  }
  return buf;
}
