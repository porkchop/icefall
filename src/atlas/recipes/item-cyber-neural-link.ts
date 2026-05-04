/**
 * Phase 6.A.2 cyber neural-link recipe
 * (`atlas-recipe.cyberpunk.item.cyber-neural-link`). A small headset
 * cradle with magenta neural-data trace lines.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { circleMask, paletteIndex, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeItemCyberNeuralLink(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const steel = paletteIndex(palette, "steel-grey");
  const magenta = paletteIndex(palette, "neon-magenta");
  const cyan = paletteIndex(palette, "neon-cyan");
  const dark = paletteIndex(palette, "void-black");
  // Outer ring (steel) — radius 6 disk minus radius 4 disk.
  const outer = circleMask(TILE_SIZE, TILE_SIZE, 8, 8, 6);
  const inner = circleMask(TILE_SIZE, TILE_SIZE, 8, 8, 4);
  for (let i = 0; i < buf.length; i++) {
    if (outer[i] === 1 && inner[i] === 0) buf[i] = steel;
  }
  // Inner socket (dark).
  for (let i = 0; i < buf.length; i++) {
    if (inner[i] === 1) buf[i] = dark;
  }
  // Magenta neural-data dots (4 cardinal positions).
  buf[5 * TILE_SIZE + 8] = magenta;
  buf[11 * TILE_SIZE + 8] = magenta;
  buf[8 * TILE_SIZE + 5] = magenta;
  buf[8 * TILE_SIZE + 11] = magenta;
  // Cyan center pip.
  buf[8 * TILE_SIZE + 8] = cyan;
  buf[8 * TILE_SIZE + 7] = cyan;
  buf[7 * TILE_SIZE + 8] = cyan;
  // Speckle noise on outer ring.
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const n = valueNoise2D(prng, x, y);
      if (outer[y * TILE_SIZE + x] === 1 && inner[y * TILE_SIZE + x] === 0 && n > 230) {
        buf[y * TILE_SIZE + x] = magenta;
      }
    }
  }
  return buf;
}
