/**
 * Phase 4 ripperdoc NPC recipe
 * (`atlas-recipe.cyberpunk.npc.ripperdoc`). Flesh-pink torso with
 * orange medical-tech rim and a single warning-amber visor.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./floor";

export function recipeNpcRipperdoc(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const flesh = paletteIndex(palette, "flesh-pink");
  const orange = paletteIndex(palette, "neon-orange");
  const amber = paletteIndex(palette, "warning-amber");
  const purple = paletteIndex(palette, "deep-purple");
  // Body torso: 6 wide × 9 tall, centered horizontally, lower half.
  const torso = rectMask(TILE_SIZE, TILE_SIZE, 5, 6, 10, 14);
  for (let i = 0; i < buf.length; i++) {
    if (torso[i] === 1) buf[i] = flesh;
  }
  // Orange rim on torso edges.
  for (let y = 6; y <= 14; y++) {
    buf[y * TILE_SIZE + 5] = orange;
    buf[y * TILE_SIZE + 10] = orange;
  }
  // Head: small flesh disk above the torso.
  for (let y = 2; y <= 5; y++) {
    for (let x = 6; x <= 9; x++) {
      buf[y * TILE_SIZE + x] = flesh;
    }
  }
  // Amber visor across the eyes.
  for (let x = 6; x <= 9; x++) {
    buf[3 * TILE_SIZE + x] = amber;
  }
  // Purple speckle on the apron — uses prng() per cell.
  for (let y = 9; y <= 13; y++) {
    for (let x = 6; x <= 9; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 200) buf[y * TILE_SIZE + x] = purple;
    }
  }
  return buf;
}
