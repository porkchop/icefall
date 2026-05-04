/**
 * Phase 6.A.2 cyberblade weapon recipe
 * (`atlas-recipe.cyberpunk.item.weapon-cyberblade`). A diagonal
 * cyan-edged blade with a magenta hilt.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { lineMask, paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponCyberblade(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const cyan = paletteIndex(palette, "neon-cyan");
  const ice = paletteIndex(palette, "ice-white");
  const magenta = paletteIndex(palette, "neon-magenta");
  const dark = paletteIndex(palette, "void-black");
  // Diagonal blade — three parallel lines for thickness.
  const b1 = lineMask(TILE_SIZE, TILE_SIZE, 3, 12, 12, 3);
  const b2 = lineMask(TILE_SIZE, TILE_SIZE, 4, 12, 13, 3);
  const b3 = lineMask(TILE_SIZE, TILE_SIZE, 2, 11, 11, 2);
  for (let i = 0; i < buf.length; i++) {
    if (b1[i] === 1 || b2[i] === 1) buf[i] = ice;
    if (b3[i] === 1) buf[i] = cyan;
  }
  // Magenta hilt at the bottom-left.
  buf[12 * TILE_SIZE + 2] = magenta;
  buf[13 * TILE_SIZE + 2] = magenta;
  buf[12 * TILE_SIZE + 3] = magenta;
  buf[13 * TILE_SIZE + 3] = magenta;
  buf[13 * TILE_SIZE + 4] = magenta;
  // Dark crossguard.
  buf[12 * TILE_SIZE + 4] = dark;
  buf[11 * TILE_SIZE + 4] = dark;
  // Cyan glow at the tip.
  buf[2 * TILE_SIZE + 12] = cyan;
  buf[3 * TILE_SIZE + 13] = cyan;
  // Sparkle on blade.
  for (let y = 3; y <= 11; y++) {
    for (let x = 3; x <= 12; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === ice && n > 240) {
        buf[y * TILE_SIZE + x] = cyan;
      }
    }
  }
  return buf;
}
