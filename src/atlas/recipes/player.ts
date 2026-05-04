/**
 * Phase 4 player-sprite recipe (`atlas-recipe.cyberpunk.player`). A
 * white-on-cyan silhouette with neon-green chest indicator.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { circleMask, paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./floor";

export function recipePlayer(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const cyan = paletteIndex(palette, "neon-cyan");
  const ice = paletteIndex(palette, "ice-white");
  const green = paletteIndex(palette, "neon-green");
  const dark = paletteIndex(palette, "void-black");
  // Torso: rectangle 6 wide × 7 tall.
  const torso = rectMask(TILE_SIZE, TILE_SIZE, 5, 6, 10, 12);
  for (let i = 0; i < buf.length; i++) {
    if (torso[i] === 1) buf[i] = cyan;
  }
  // Head: small disk at (8, 4) r=2.
  const head = circleMask(TILE_SIZE, TILE_SIZE, 8, 4, 2);
  for (let i = 0; i < buf.length; i++) {
    if (head[i] === 1) buf[i] = ice;
  }
  // Chest indicator (single green pixel center-mass).
  buf[8 * TILE_SIZE + 7] = green;
  buf[8 * TILE_SIZE + 8] = green;
  // Boots: dark pixels at the bottom of the torso.
  for (let x = 5; x <= 6; x++) buf[13 * TILE_SIZE + x] = dark;
  for (let x = 9; x <= 10; x++) buf[13 * TILE_SIZE + x] = dark;
  // Speckle highlights — consumes prng() per cell so the cursor advances
  // deterministically.
  for (let y = 7; y <= 11; y++) {
    for (let x = 6; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 220) buf[y * TILE_SIZE + x] = ice;
    }
  }
  return buf;
}
