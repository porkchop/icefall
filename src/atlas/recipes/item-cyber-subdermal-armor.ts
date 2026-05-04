/**
 * Phase 6.A.2 cyber subdermal-armor recipe
 * (`atlas-recipe.cyberpunk.item.cyber-subdermal-armor`). A heavy
 * dark-grey vest with rim-blue plates and amber rivet accents.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberSubdermalArmor(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const grey = paletteIndex(palette, "dark-grey");
  const rim = paletteIndex(palette, "rim-blue");
  const amber = paletteIndex(palette, "warning-amber");
  const dark = paletteIndex(palette, "void-black");
  // Vest body: 12 wide × 10 tall, centered.
  const vest = rectMask(TILE_SIZE, TILE_SIZE, 2, 3, 13, 12);
  for (let i = 0; i < buf.length; i++) {
    if (vest[i] === 1) buf[i] = grey;
  }
  // Two rim-blue side panels.
  for (let y = 4; y <= 11; y++) {
    buf[y * TILE_SIZE + 3] = rim;
    buf[y * TILE_SIZE + 4] = rim;
    buf[y * TILE_SIZE + 11] = rim;
    buf[y * TILE_SIZE + 12] = rim;
  }
  // Amber rivets (corners).
  buf[4 * TILE_SIZE + 3] = amber;
  buf[4 * TILE_SIZE + 12] = amber;
  buf[11 * TILE_SIZE + 3] = amber;
  buf[11 * TILE_SIZE + 12] = amber;
  // Dark central seam.
  for (let y = 4; y <= 11; y++) {
    buf[y * TILE_SIZE + 7] = dark;
    buf[y * TILE_SIZE + 8] = dark;
  }
  // Speckle on grey panels.
  for (let y = 4; y <= 11; y++) {
    for (let x = 5; x <= 10; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === grey && n > 225) {
        buf[y * TILE_SIZE + x] = rim;
      }
    }
  }
  return buf;
}
