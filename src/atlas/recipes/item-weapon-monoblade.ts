/**
 * Phase 6.A.2 monoblade weapon recipe
 * (`atlas-recipe.cyberpunk.item.weapon-monoblade`). A long thin
 * white-edged blade with magenta hilt and warning amber accents.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponMonoblade(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const ice = paletteIndex(palette, "ice-white");
  const cyan = paletteIndex(palette, "neon-cyan");
  const magenta = paletteIndex(palette, "neon-magenta");
  const amber = paletteIndex(palette, "warning-amber");
  const dark = paletteIndex(palette, "void-black");
  // Vertical blade: 1 wide × 10 tall.
  const blade = rectMask(TILE_SIZE, TILE_SIZE, 7, 1, 8, 10);
  for (let i = 0; i < buf.length; i++) {
    if (blade[i] === 1) buf[i] = ice;
  }
  // Cyan edge highlights left-side.
  for (let y = 1; y <= 10; y++) {
    buf[y * TILE_SIZE + 6] = cyan;
  }
  // Dark crossguard.
  for (let x = 4; x <= 11; x++) {
    buf[11 * TILE_SIZE + x] = dark;
  }
  // Magenta hilt — vertical.
  for (let y = 12; y <= 14; y++) {
    buf[y * TILE_SIZE + 7] = magenta;
    buf[y * TILE_SIZE + 8] = magenta;
  }
  // Amber pommel cap.
  buf[14 * TILE_SIZE + 6] = amber;
  buf[14 * TILE_SIZE + 9] = amber;
  // Sparkle on blade.
  for (let y = 1; y <= 10; y++) {
    for (let x = 6; x <= 8; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === ice && n > 245) {
        buf[y * TILE_SIZE + x] = cyan;
      }
    }
  }
  return buf;
}
