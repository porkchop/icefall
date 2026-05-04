/**
 * Phase 6.A.2 cyber-armor recipe
 * (`atlas-recipe.cyberpunk.item.cyber-armor`). A simple steel chest
 * plate with a rim-blue trim.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberArmor(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const rim = paletteIndex(palette, "rim-blue");
  const dark = paletteIndex(palette, "dark-grey");
  // Chest plate: 10 wide × 8 tall, centered.
  const plate = rectMask(TILE_SIZE, TILE_SIZE, 3, 4, 12, 11);
  for (let i = 0; i < buf.length; i++) {
    if (plate[i] === 1) buf[i] = steel;
  }
  // Rim-blue trim along the top and bottom edges.
  for (let x = 3; x <= 12; x++) {
    buf[3 * TILE_SIZE + x] = rim;
    buf[12 * TILE_SIZE + x] = rim;
  }
  // Two dark seams down the middle to give a chest plate look.
  for (let y = 5; y <= 10; y++) {
    buf[y * TILE_SIZE + 7] = dark;
    buf[y * TILE_SIZE + 8] = dark;
  }
  // Noise speckle on plate surface.
  for (let y = 5; y <= 10; y++) {
    for (let x = 4; x <= 11; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 240) buf[y * TILE_SIZE + x] = rim;
    }
  }
  return buf;
}
