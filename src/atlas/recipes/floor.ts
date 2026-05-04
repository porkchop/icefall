/**
 * Phase 4 floor-tile recipe (`atlas-recipe.cyberpunk.tile.floor`). A
 * dark cyberpunk floor with subtle noise speckle and a deep-blue
 * grout grid.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export type { RecipeContext };

export function recipeFloor(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const dark = paletteIndex(palette, "void-black");
  const mid = paletteIndex(palette, "dark-grey");
  const grout = paletteIndex(palette, "deep-blue");
  // Fill with noise-speckled dark base. Each pixel consumes one prng()
  // call via valueNoise2D (addendum N3).
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = valueNoise2D(prng, x, y);
      buf[y * TILE_SIZE + x] = n < 32 ? mid : dark;
    }
  }
  // Grout grid every 8 px (forms a subtle quadrant cross).
  for (let i = 0; i < TILE_SIZE; i++) {
    buf[7 * TILE_SIZE + i] = grout;
    buf[i * TILE_SIZE + 7] = grout;
  }
  return buf;
}
