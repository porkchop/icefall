/**
 * Phase 7.A.2 info-broker NPC recipe
 * (`atlas-recipe.cyberpunk.npc.info-broker`). Hooded silhouette with a
 * cyan glow under the cowl and rim-blue cloak edges — reminiscent of a
 * broker working in low light. Visually distinct from both ripperdoc
 * (flesh-pink + warning-amber) and fixer (steel-grey + neon-orange).
 *
 * Slots at `(atlasX=11, atlasY=1)` per addendum 3a row-major placement.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import { paletteIndex, rectMask, valueNoise2D } from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeNpcInfoBroker(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const navy = paletteIndex(palette, "deep-blue");
  const rim = paletteIndex(palette, "rim-blue");
  const cyan = paletteIndex(palette, "neon-cyan");
  const dark = paletteIndex(palette, "void-black");
  // Cloak body: 8 wide × 11 tall, full-figure silhouette.
  const cloak = rectMask(TILE_SIZE, TILE_SIZE, 4, 4, 11, 14);
  for (let i = 0; i < buf.length; i++) {
    if (cloak[i] === 1) buf[i] = navy;
  }
  // Rim-blue along the cloak edges.
  for (let y = 4; y <= 14; y++) {
    buf[y * TILE_SIZE + 4] = rim;
    buf[y * TILE_SIZE + 11] = rim;
  }
  for (let x = 4; x <= 11; x++) {
    buf[14 * TILE_SIZE + x] = rim;
  }
  // Hood: dark void where a face would be.
  for (let y = 4; y <= 6; y++) {
    for (let x = 6; x <= 9; x++) {
      buf[y * TILE_SIZE + x] = dark;
    }
  }
  // Cyan glow inside the hood — eyes / device readout.
  buf[5 * TILE_SIZE + 7] = cyan;
  buf[5 * TILE_SIZE + 8] = cyan;
  // Speckle of cyan nodes along the cloak — info-broker tech glints.
  for (let y = 8; y <= 13; y++) {
    for (let x = 5; x <= 10; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 230) buf[y * TILE_SIZE + x] = cyan;
    }
  }
  return buf;
}
