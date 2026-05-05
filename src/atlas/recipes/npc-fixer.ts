/**
 * Phase 7.A.2 fixer NPC recipe
 * (`atlas-recipe.cyberpunk.npc.fixer`). Dark steel-grey trench coat
 * silhouette with neon-orange jacket-trim and a warning-amber eyepiece —
 * visually distinct from the ripperdoc's flesh-pink-and-orange
 * silhouette so the FloorItem renderer can disambiguate at a glance.
 *
 * Recipe coordinate ordering: this is the first appended Phase 7.A.2
 * recipe (after the 3 Phase 7.A.1 carry-forward items at row 1 cells
 * 7..9). Per addendum 3a row-major placement, this slots at
 * `(atlasX=10, atlasY=1)` — coordinate-stable for the prior 26
 * sprites.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeNpcFixer(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const orange = paletteIndex(palette, "neon-orange");
  const amber = paletteIndex(palette, "warning-amber");
  const dark = paletteIndex(palette, "dark-grey");
  const flesh = paletteIndex(palette, "flesh-pink");
  // Trench-coat torso: 6 wide × 9 tall, lower-center.
  const torso = rectMask(TILE_SIZE, TILE_SIZE, 5, 6, 10, 14);
  for (let i = 0; i < buf.length; i++) {
    if (torso[i] === 1) buf[i] = steel;
  }
  // Orange lapel stripes down the front.
  for (let y = 7; y <= 13; y++) {
    buf[y * TILE_SIZE + 7] = orange;
    buf[y * TILE_SIZE + 8] = orange;
  }
  // Dark trim along the bottom hem.
  for (let x = 5; x <= 10; x++) {
    buf[14 * TILE_SIZE + x] = dark;
  }
  // Head: small flesh-pink disk above the torso.
  for (let y = 2; y <= 5; y++) {
    for (let x = 6; x <= 9; x++) {
      buf[y * TILE_SIZE + x] = flesh;
    }
  }
  // Amber eyepiece across the right eye (one cell wide).
  buf[3 * TILE_SIZE + 8] = amber;
  buf[3 * TILE_SIZE + 9] = amber;
  // Dark hat brim over the head.
  for (let x = 5; x <= 10; x++) {
    buf[1 * TILE_SIZE + x] = dark;
  }
  // Speckle on the coat — uses prng() per cell.
  for (let y = 9; y <= 13; y++) {
    for (let x = 5; x <= 10; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 220) buf[y * TILE_SIZE + x] = dark;
    }
  }
  return buf;
}
