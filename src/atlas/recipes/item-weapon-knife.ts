/**
 * Phase 6.A.2 weapon-knife recipe
 * (`atlas-recipe.cyberpunk.item.weapon-knife`). The Phase 3 frozen
 * `item.weapon.knife` finally gets a sprite — a simple steel blade
 * with a dark hilt. Phase 4 listed it in the item registry but did
 * not paint a recipe (only `item.cred-chip` was painted); 6.A.2
 * closes the gap so the renderer can blit dropped knives.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponKnife(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const ice = paletteIndex(palette, "ice-white");
  const dark = paletteIndex(palette, "void-black");
  const flesh = paletteIndex(palette, "flesh-pink");
  // Diagonal blade — 8 long, 2 wide.
  const blade = rectMask(TILE_SIZE, TILE_SIZE, 6, 3, 9, 9);
  for (let i = 0; i < buf.length; i++) {
    if (blade[i] === 1) buf[i] = steel;
  }
  // Ice-white edge highlight on right side.
  for (let y = 3; y <= 9; y++) {
    buf[y * TILE_SIZE + 9] = ice;
  }
  // Pointed tip.
  buf[2 * TILE_SIZE + 7] = ice;
  buf[2 * TILE_SIZE + 8] = ice;
  // Crossguard (dark) just below blade.
  for (let x = 5; x <= 10; x++) {
    buf[10 * TILE_SIZE + x] = dark;
  }
  // Flesh-pink hilt.
  for (let y = 11; y <= 13; y++) {
    buf[y * TILE_SIZE + 7] = flesh;
    buf[y * TILE_SIZE + 8] = flesh;
  }
  // Pommel (dark).
  buf[14 * TILE_SIZE + 7] = dark;
  buf[14 * TILE_SIZE + 8] = dark;
  // Sparkle on blade.
  for (let y = 3; y <= 9; y++) {
    for (let x = 6; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === steel && n > 240) {
        buf[y * TILE_SIZE + x] = ice;
      }
    }
  }
  return buf;
}
