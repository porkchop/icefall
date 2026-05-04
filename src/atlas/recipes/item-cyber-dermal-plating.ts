/**
 * Phase 6.A.2 cyber dermal-plating recipe
 * (`atlas-recipe.cyberpunk.item.cyber-dermal-plating`). Overlapping
 * deep-purple plates with cyan rim highlights.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberDermalPlating(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const purple = paletteIndex(palette, "deep-purple");
  const cyan = paletteIndex(palette, "neon-cyan");
  const dark = paletteIndex(palette, "void-black");
  // Three horizontal plate rows.
  const p1 = rectMask(TILE_SIZE, TILE_SIZE, 3, 3, 12, 5);
  const p2 = rectMask(TILE_SIZE, TILE_SIZE, 3, 7, 12, 9);
  const p3 = rectMask(TILE_SIZE, TILE_SIZE, 3, 11, 12, 13);
  for (let i = 0; i < buf.length; i++) {
    if (p1[i] === 1 || p2[i] === 1 || p3[i] === 1) buf[i] = purple;
  }
  // Cyan rim across each plate's top edge.
  for (let x = 3; x <= 12; x++) {
    buf[3 * TILE_SIZE + x] = cyan;
    buf[7 * TILE_SIZE + x] = cyan;
    buf[11 * TILE_SIZE + x] = cyan;
  }
  // Dark seams between plates.
  for (let x = 3; x <= 12; x++) {
    buf[6 * TILE_SIZE + x] = dark;
    buf[10 * TILE_SIZE + x] = dark;
  }
  // Noise speckle on plate interiors.
  for (let y = 4; y <= 12; y++) {
    for (let x = 4; x <= 11; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 235) buf[y * TILE_SIZE + x] = cyan;
    }
  }
  return buf;
}
