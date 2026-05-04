/**
 * Phase 6.A.2 med-injector consumable recipe
 * (`atlas-recipe.cyberpunk.item.consumable-med-injector`). A red-cross
 * medical injector with amber warning trim.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemConsumableMedInjector(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const ice = paletteIndex(palette, "ice-white");
  const red = paletteIndex(palette, "blood-red");
  const amber = paletteIndex(palette, "warning-amber");
  const dark = paletteIndex(palette, "void-black");
  // Body: 8 wide × 10 tall, centered.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 4, 3, 11, 12);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = ice;
  }
  // Red cross — vertical stroke.
  for (let y = 5; y <= 10; y++) {
    buf[y * TILE_SIZE + 7] = red;
    buf[y * TILE_SIZE + 8] = red;
  }
  // Red cross — horizontal stroke.
  for (let x = 5; x <= 10; x++) {
    buf[7 * TILE_SIZE + x] = red;
    buf[8 * TILE_SIZE + x] = red;
  }
  // Amber warning trim (bottom edge).
  for (let x = 4; x <= 11; x++) {
    buf[12 * TILE_SIZE + x] = amber;
  }
  // Dark outline.
  for (let y = 3; y <= 12; y++) {
    buf[y * TILE_SIZE + 3] = dark;
    buf[y * TILE_SIZE + 12] = dark;
  }
  for (let x = 3; x <= 12; x++) {
    buf[2 * TILE_SIZE + x] = dark;
  }
  // Speckle noise on bottom-half corners.
  for (let y = 9; y <= 11; y++) {
    for (let x = 4; x <= 6; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 230) buf[y * TILE_SIZE + x] = amber;
    }
  }
  return buf;
}
