/**
 * Phase 4 ice-daemon monster recipe
 * (`atlas-recipe.cyberpunk.monster.ice-daemon`). A cyan-rimmed angular
 * silhouette with magenta eye glints.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { circleMask, paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeMonsterIceDaemon(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const cyan = paletteIndex(palette, "neon-cyan");
  const rim = paletteIndex(palette, "rim-blue");
  const magenta = paletteIndex(palette, "neon-magenta");
  const ice = paletteIndex(palette, "ice-white");
  // Body: filled disk r=6 centered at (8, 9).
  const body = circleMask(TILE_SIZE, TILE_SIZE, 8, 9, 6);
  // Rim: outer ring r=7 minus body — pixels in r=7 disk but NOT in r=6.
  const outer = circleMask(TILE_SIZE, TILE_SIZE, 8, 9, 7);
  for (let i = 0; i < buf.length; i++) {
    if (outer[i] === 1 && body[i] === 0) buf[i] = rim;
    else if (body[i] === 1) buf[i] = cyan;
  }
  // Eye glints: two magenta dots.
  buf[6 * TILE_SIZE + 6] = magenta;
  buf[6 * TILE_SIZE + 10] = magenta;
  // Crown highlight: ice-white pixels above the body using value noise.
  for (let y = 2; y < 5; y++) {
    for (let x = 6; x < 11; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 192) buf[y * TILE_SIZE + x] = ice;
    }
  }
  return buf;
}
