/**
 * Phase 6.A.2 nano-repair consumable recipe
 * (`atlas-recipe.cyberpunk.item.consumable-nano-repair`). A small
 * cyan vial with green nano-particles.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemConsumableNanoRepair(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const cyan = paletteIndex(palette, "neon-cyan");
  const green = paletteIndex(palette, "neon-green");
  const dark = paletteIndex(palette, "void-black");
  const ice = paletteIndex(palette, "ice-white");
  // Vial body: 4 wide × 8 tall, centered.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 6, 4, 9, 12);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = cyan;
  }
  // Dark trim around the vial.
  for (let y = 4; y <= 12; y++) {
    buf[y * TILE_SIZE + 5] = dark;
    buf[y * TILE_SIZE + 10] = dark;
  }
  // Cap at top.
  for (let x = 5; x <= 10; x++) {
    buf[3 * TILE_SIZE + x] = dark;
  }
  // Ice-white highlight on left edge.
  for (let y = 5; y <= 11; y++) {
    buf[y * TILE_SIZE + 6] = ice;
  }
  // Green particles inside the vial via noise.
  for (let y = 5; y <= 11; y++) {
    for (let x = 7; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 200) buf[y * TILE_SIZE + x] = green;
    }
  }
  return buf;
}
