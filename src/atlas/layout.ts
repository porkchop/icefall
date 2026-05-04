/**
 * Phase 4 atlas-grid placement function (memo decision 3a + addendum
 * N9). Walks the input registry in declaration order, packing into the
 * `ATLAS_TILES_WIDE × ATLAS_TILES_HIGH` cell grid row-major. Multi-tile
 * sprites are placed contiguously; if the current row has insufficient
 * remaining cells the cursor advances to the next row (skipped cells
 * stay transparent).
 *
 * Frozen invariant: adding a recipe at the *end* of the registry never
 * moves any earlier recipe's `(atlasX, atlasY)`.
 */

import {
  ATLAS_CELLS,
  ATLAS_TILES_HIGH,
  ATLAS_TILES_WIDE,
} from "./params";

export type AtlasPlacementEntry = {
  readonly id: string;
  readonly tilesWide: 1 | 2 | 4;
  readonly tilesHigh: 1 | 2 | 4;
};

export type SpritePlacement = {
  readonly id: string;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly tilesWide: 1 | 2 | 4;
  readonly tilesHigh: 1 | 2 | 4;
};

/**
 * Place a list of registry entries into the atlas grid. Throws when an
 * entry cannot fit anywhere in the remaining grid (registry exceeds
 * `ATLAS_CELLS`).
 */
export function placeRecipes(
  entries: readonly AtlasPlacementEntry[],
): SpritePlacement[] {
  const out: SpritePlacement[] = [];
  let cursorRow = 0;
  let cursorCol = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const w = e.tilesWide;
    const h = e.tilesHigh;
    if (cursorCol + w > ATLAS_TILES_WIDE) {
      // Wrap to the next row; leftover cells in the previous row stay
      // transparent (no backfill, no compaction — pinned by decision 3a).
      cursorRow += 1;
      cursorCol = 0;
    }
    if (cursorRow + h > ATLAS_TILES_HIGH) {
      throw new Error(
        `atlas: registry exceeds atlas grid (got ${entries.length}, max ${ATLAS_CELLS})`,
      );
    }
    out.push({
      id: e.id,
      atlasX: cursorCol,
      atlasY: cursorRow,
      tilesWide: w,
      tilesHigh: h,
    });
    cursorCol += w;
  }
  return out;
}
