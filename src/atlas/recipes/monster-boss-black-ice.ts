/**
 * Phase 7.A.2 boss recipe
 * (`atlas-recipe.cyberpunk.boss.black-ice-v0`). The floor-10 boss
 * (`monster.boss.black-ice-v0`) — a large angular silhouette in
 * deep-purple and neon-magenta with an ice-white core, built at 16×16
 * (the atlas grid is 1×1 cells; multi-cell sprites are deferred to
 * Phase 9 polish per `src/atlas/generate.ts` blit-loop comment).
 *
 * Slots at `(atlasX=12, atlasY=1)` per addendum 3a row-major placement.
 */

import type { PRNG } from "../../core/prng";
import type { Palette } from "../palette";
import {
  circleMask,
  paletteIndex,
  rectMask,
  valueNoise2D,
} from "../primitives";
import { TILE_SIZE } from "../params";
import type { RecipeContext } from "./types";

export function recipeMonsterBossBlackIce(
  prng: PRNG,
  palette: Palette,
  _ctx: RecipeContext,
): Uint8Array {
  const buf = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const purple = paletteIndex(palette, "deep-purple");
  const magenta = paletteIndex(palette, "neon-magenta");
  const ice = paletteIndex(palette, "ice-white");
  const dark = paletteIndex(palette, "void-black");
  const rim = paletteIndex(palette, "rim-blue");
  // Body: large filled silhouette filling most of the tile.
  const body = rectMask(TILE_SIZE, TILE_SIZE, 2, 3, 13, 14);
  for (let i = 0; i < buf.length; i++) {
    if (body[i] === 1) buf[i] = purple;
  }
  // Magenta angular shoulder spikes.
  for (let x = 2; x <= 13; x++) {
    buf[3 * TILE_SIZE + x] = magenta;
  }
  buf[2 * TILE_SIZE + 3] = magenta;
  buf[2 * TILE_SIZE + 12] = magenta;
  buf[1 * TILE_SIZE + 4] = magenta;
  buf[1 * TILE_SIZE + 11] = magenta;
  // Ice-white core: a small disk in the chest area.
  const core = circleMask(TILE_SIZE, TILE_SIZE, 7, 8, 2);
  for (let i = 0; i < buf.length; i++) {
    if (core[i] === 1) buf[i] = ice;
  }
  // Rim-blue accent at the bottom.
  for (let x = 2; x <= 13; x++) {
    buf[14 * TILE_SIZE + x] = rim;
  }
  // Magenta eye glints — high on the body.
  buf[5 * TILE_SIZE + 5] = magenta;
  buf[5 * TILE_SIZE + 10] = magenta;
  // Dark crackle pattern across the silhouette via PRNG.
  for (let y = 4; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) {
      const n = valueNoise2D(prng, x, y);
      if (n > 232) buf[y * TILE_SIZE + x] = dark;
    }
  }
  return buf;
}
