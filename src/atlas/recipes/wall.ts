/**
 * Phase 4 wall-tile recipe (`atlas-recipe.cyberpunk.tile.wall`). Steel
 * grey base with a neon-cyan rim glow on the top edge.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./floor";

export function recipeWall(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const dark = paletteIndex(palette, "dark-grey");
  const cyan = paletteIndex(palette, "neon-cyan");
  const rim = paletteIndex(palette, "rim-blue");
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = valueNoise2D(prng, x, y);
      buf[y * TILE_SIZE + x] = n < 96 ? dark : steel;
    }
  }
  // Top rim: cyan glow with rim-blue underline.
  for (let x = 0; x < TILE_SIZE; x++) {
    buf[0 * TILE_SIZE + x] = cyan;
    buf[1 * TILE_SIZE + x] = rim;
  }
  return buf;
}
