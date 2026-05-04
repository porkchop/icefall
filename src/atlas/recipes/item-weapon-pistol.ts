/**
 * Phase 6.A.2 pistol weapon recipe
 * (`atlas-recipe.cyberpunk.item.weapon-pistol`). A compact dark-grey
 * pistol with an orange muzzle flash and amber sights.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponPistol(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const grey = paletteIndex(palette, "dark-grey");
  const steel = paletteIndex(palette, "steel-grey");
  const orange = paletteIndex(palette, "neon-orange");
  const amber = paletteIndex(palette, "warning-amber");
  const dark = paletteIndex(palette, "void-black");
  // Slide: 8 wide × 3 tall, near top-mid.
  const slide = rectMask(TILE_SIZE, TILE_SIZE, 3, 5, 10, 7);
  for (let i = 0; i < buf.length; i++) {
    if (slide[i] === 1) buf[i] = grey;
  }
  // Grip: 3 wide × 5 tall.
  const grip = rectMask(TILE_SIZE, TILE_SIZE, 6, 8, 8, 12);
  for (let i = 0; i < buf.length; i++) {
    if (grip[i] === 1) buf[i] = grey;
  }
  // Steel highlights along slide top.
  for (let x = 3; x <= 10; x++) {
    buf[5 * TILE_SIZE + x] = steel;
  }
  // Trigger guard (dark).
  buf[8 * TILE_SIZE + 5] = dark;
  buf[9 * TILE_SIZE + 5] = dark;
  buf[8 * TILE_SIZE + 9] = dark;
  // Muzzle flash (orange) at the right tip.
  buf[6 * TILE_SIZE + 11] = orange;
  buf[5 * TILE_SIZE + 11] = orange;
  buf[7 * TILE_SIZE + 11] = orange;
  buf[6 * TILE_SIZE + 12] = orange;
  // Amber sight pip.
  buf[4 * TILE_SIZE + 9] = amber;
  // Outline.
  for (let x = 3; x <= 10; x++) {
    buf[8 * TILE_SIZE + x] = dark;
  }
  // Speckle on grip.
  for (let y = 8; y <= 12; y++) {
    for (let x = 6; x <= 8; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === grey && n > 230) {
        buf[y * TILE_SIZE + x] = steel;
      }
    }
  }
  return buf;
}
