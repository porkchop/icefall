/**
 * Phase 6.A.2 cyber reflex-booster recipe
 * (`atlas-recipe.cyberpunk.item.cyber-reflex-booster`). A neon-yellow
 * lightning-bolt motif on a deep-blue chip.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberReflexBooster(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const blue = paletteIndex(palette, "deep-blue");
  const yellow = paletteIndex(palette, "neon-yellow");
  const dark = paletteIndex(palette, "void-black");
  const orange = paletteIndex(palette, "neon-orange");
  // Chip body: 10 wide × 10 tall, centered.
  const chip = rectMask(TILE_SIZE, TILE_SIZE, 3, 3, 12, 12);
  for (let i = 0; i < buf.length; i++) {
    if (chip[i] === 1) buf[i] = blue;
  }
  // Dark trim.
  for (let x = 3; x <= 12; x++) {
    buf[3 * TILE_SIZE + x] = dark;
    buf[12 * TILE_SIZE + x] = dark;
  }
  for (let y = 3; y <= 12; y++) {
    buf[y * TILE_SIZE + 3] = dark;
    buf[y * TILE_SIZE + 12] = dark;
  }
  // Lightning-bolt zigzag (yellow).
  buf[5 * TILE_SIZE + 9] = yellow;
  buf[5 * TILE_SIZE + 8] = yellow;
  buf[6 * TILE_SIZE + 8] = yellow;
  buf[6 * TILE_SIZE + 7] = yellow;
  buf[7 * TILE_SIZE + 7] = yellow;
  buf[7 * TILE_SIZE + 8] = yellow;
  buf[7 * TILE_SIZE + 9] = yellow;
  buf[8 * TILE_SIZE + 7] = yellow;
  buf[8 * TILE_SIZE + 6] = yellow;
  buf[9 * TILE_SIZE + 6] = yellow;
  buf[9 * TILE_SIZE + 7] = yellow;
  buf[10 * TILE_SIZE + 6] = yellow;
  // Orange spark highlights.
  buf[4 * TILE_SIZE + 9] = orange;
  buf[10 * TILE_SIZE + 5] = orange;
  // Noise speckle on chip surface.
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === blue && n > 235) {
        buf[y * TILE_SIZE + x] = yellow;
      }
    }
  }
  return buf;
}
