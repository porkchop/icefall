/**
 * Phase 4 door-tile recipe (`atlas-recipe.cyberpunk.tile.door`). Dark
 * door panel with a magenta access-panel slot.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeDoor(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const dark = paletteIndex(palette, "void-black");
  const steel = paletteIndex(palette, "steel-grey");
  const magenta = paletteIndex(palette, "neon-magenta");
  // Steel door body with noise speckle.
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = valueNoise2D(prng, x, y);
      buf[y * TILE_SIZE + x] = n < 64 ? dark : steel;
    }
  }
  // Magenta vertical access-panel slot near right edge (cols 11..12, rows 5..10).
  const panel = rectMask(TILE_SIZE, TILE_SIZE, 11, 5, 12, 10);
  for (let i = 0; i < buf.length; i++) {
    if (panel[i] === 1) buf[i] = magenta;
  }
  return buf;
}
