/**
 * Phase 4 cred-chip item recipe
 * (`atlas-recipe.cyberpunk.item.cred-chip`). A small yellow hex-card
 * with green pinout dots.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./floor";

export function recipeItemCredChip(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const yellow = paletteIndex(palette, "neon-yellow");
  const green = paletteIndex(palette, "neon-green");
  const dark = paletteIndex(palette, "void-black");
  // Card body: 10 wide × 6 tall, centered.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 3, 5, 12, 10);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = yellow;
  }
  // Pinout dots (green) on the bottom edge.
  for (let x = 4; x <= 11; x += 2) {
    buf[10 * TILE_SIZE + x] = green;
  }
  // Dark trim edge along the top of the card.
  for (let x = 3; x <= 12; x++) {
    buf[5 * TILE_SIZE + x] = dark;
  }
  // Speckle for character — consumes one prng() per cell in the
  // 4×4 region above the card (so the recipe's PRNG cursor advances
  // deterministically for testability).
  for (let y = 1; y < 5; y++) {
    for (let x = 5; x < 11; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 224) buf[y * TILE_SIZE + x] = green;
    }
  }
  return buf;
}
