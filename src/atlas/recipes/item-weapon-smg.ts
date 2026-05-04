/**
 * Phase 6.A.2 SMG weapon recipe
 * (`atlas-recipe.cyberpunk.item.weapon-smg`). A compact submachine gun
 * with a vertical magazine and yellow muzzle flash.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemWeaponSmg(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const grey = paletteIndex(palette, "dark-grey");
  const steel = paletteIndex(palette, "steel-grey");
  const yellow = paletteIndex(palette, "neon-yellow");
  const dark = paletteIndex(palette, "void-black");
  // Receiver: 9 wide × 4 tall.
  const recv = rectMask(TILE_SIZE, TILE_SIZE, 3, 6, 11, 9);
  for (let i = 0; i < buf.length; i++) {
    if (recv[i] === 1) buf[i] = grey;
  }
  // Steel highlights on receiver top.
  for (let x = 3; x <= 11; x++) {
    buf[6 * TILE_SIZE + x] = steel;
  }
  // Vertical magazine (4 tall) below receiver.
  const mag = rectMask(TILE_SIZE, TILE_SIZE, 6, 10, 8, 13);
  for (let i = 0; i < buf.length; i++) {
    if (mag[i] === 1) buf[i] = grey;
  }
  // Front sight (steel pip).
  buf[5 * TILE_SIZE + 11] = steel;
  // Yellow muzzle flash.
  buf[7 * TILE_SIZE + 12] = yellow;
  buf[7 * TILE_SIZE + 13] = yellow;
  buf[8 * TILE_SIZE + 13] = yellow;
  buf[6 * TILE_SIZE + 13] = yellow;
  // Trigger guard.
  buf[10 * TILE_SIZE + 5] = dark;
  buf[11 * TILE_SIZE + 5] = dark;
  // Outline.
  for (let x = 3; x <= 11; x++) {
    buf[10 * TILE_SIZE + x] = dark;
  }
  // Speckle on receiver.
  for (let y = 7; y <= 9; y++) {
    for (let x = 4; x <= 10; x++) {
      const n = valueNoise2D(prng, x, y);
      if (buf[y * TILE_SIZE + x] === grey && n > 235) {
        buf[y * TILE_SIZE + x] = steel;
      }
    }
  }
  return buf;
}
