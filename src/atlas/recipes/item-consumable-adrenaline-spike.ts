/**
 * Phase 6.A.2 adrenaline-spike consumable recipe
 * (`atlas-recipe.cyberpunk.item.consumable-adrenaline-spike`). An
 * orange spike with a red bulb top.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { lineMask, paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemConsumableAdrenalineSpike(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const orange = paletteIndex(palette, "neon-orange");
  const red = paletteIndex(palette, "blood-red");
  const yellow = paletteIndex(palette, "neon-yellow");
  const dark = paletteIndex(palette, "void-black");
  // Vertical orange spike: 2 wide × 8 tall.
  const spike = rectMask(TILE_SIZE, TILE_SIZE, 7, 5, 8, 12);
  for (let i = 0; i < buf.length; i++) {
    if (spike[i] === 1) buf[i] = orange;
  }
  // Red bulb top: 4 wide × 3 tall.
  const bulb = rectMask(TILE_SIZE, TILE_SIZE, 6, 2, 9, 4);
  for (let i = 0; i < buf.length; i++) {
    if (bulb[i] === 1) buf[i] = red;
  }
  // Pointed tip at the bottom (single dark pixel).
  buf[13 * TILE_SIZE + 7] = dark;
  buf[13 * TILE_SIZE + 8] = dark;
  // Yellow energy lines on either side via lineMask.
  const energyL = lineMask(TILE_SIZE, TILE_SIZE, 5, 4, 5, 11);
  const energyR = lineMask(TILE_SIZE, TILE_SIZE, 10, 4, 10, 11);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0 && (energyL[i] === 1 || energyR[i] === 1)) {
      buf[i] = yellow;
    }
  }
  // Speckle the bulb with yellow highlights.
  for (let y = 2; y <= 4; y++) {
    for (let x = 6; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 220) buf[y * TILE_SIZE + x] = yellow;
    }
  }
  return buf;
}
