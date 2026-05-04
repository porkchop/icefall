/**
 * Phase 6.A.2 shotgun weapon recipe
 * (`atlas-recipe.cyberpunk.item.weapon-shotgun`). A long steel barrel
 * with a wood-tone grip (flesh-pink stand-in) and amber muzzle
 * highlight.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponShotgun(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const dark = paletteIndex(palette, "void-black");
  const flesh = paletteIndex(palette, "flesh-pink");
  const amber = paletteIndex(palette, "warning-amber");
  const orange = paletteIndex(palette, "neon-orange");
  // Long barrel: 12 wide × 2 tall.
  const barrel = rectMask(TILE_SIZE, TILE_SIZE, 2, 5, 13, 6);
  for (let i = 0; i < buf.length; i++) {
    if (barrel[i] === 1) buf[i] = steel;
  }
  // Pump-action below barrel.
  const pump = rectMask(TILE_SIZE, TILE_SIZE, 6, 7, 9, 8);
  for (let i = 0; i < buf.length; i++) {
    if (pump[i] === 1) buf[i] = dark;
  }
  // Stock (flesh-pink wood-tone).
  const stock = rectMask(TILE_SIZE, TILE_SIZE, 1, 7, 4, 9);
  for (let i = 0; i < buf.length; i++) {
    if (stock[i] === 1) buf[i] = flesh;
  }
  // Trigger.
  buf[8 * TILE_SIZE + 5] = dark;
  buf[9 * TILE_SIZE + 5] = dark;
  // Amber muzzle.
  buf[5 * TILE_SIZE + 13] = amber;
  buf[6 * TILE_SIZE + 13] = amber;
  buf[5 * TILE_SIZE + 14] = orange;
  buf[6 * TILE_SIZE + 14] = orange;
  // Outline barrel top.
  for (let x = 2; x <= 13; x++) {
    buf[4 * TILE_SIZE + x] = dark;
  }
  // Speckle wood grain on stock.
  for (let y = 7; y <= 9; y++) {
    for (let x = 1; x <= 4; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === flesh && n > 210) {
        buf[y * TILE_SIZE + x] = dark;
      }
    }
  }
  return buf;
}
