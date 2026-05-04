/**
 * Phase 4 atlas layout constants — frozen-contract item 5 (memo
 * decision 3 + addendum B6). Bumping any of these is a `rulesetVersion`
 * bump (the IDAT byte stream changes; `atlasBinaryHash` changes; every
 * shared fingerprint breaks). Tile-grid resizes are coordinate-stable
 * (existing `(atlasX, atlasY)` are preserved) but binary-unstable.
 *
 * Per addendum B6 the resize rule is "pure increase only, at a
 * rulesetVersion boundary, with architecture-red-team review."
 */

/** Per-tile pixel size (square). */
export const TILE_SIZE = 16;

/**
 * Per-cell transparent padding to the right and bottom of every tile.
 * Defense-in-depth against bilinear-filter bleed in a future renderer.
 */
export const TILE_PADDING = 1;

/** Atlas grid width in cells. */
export const ATLAS_TILES_WIDE = 16;

/** Atlas grid height in cells (Phase 4 cell budget = 16 × 8 = 128). */
export const ATLAS_TILES_HIGH = 8;

/**
 * Atlas image pixel width: `ATLAS_TILES_WIDE * (TILE_SIZE + TILE_PADDING)`.
 * Equals 272 px in v1.
 */
export const ATLAS_PIXEL_WIDTH = ATLAS_TILES_WIDE * (TILE_SIZE + TILE_PADDING);

/**
 * Atlas image pixel height: `ATLAS_TILES_HIGH * (TILE_SIZE + TILE_PADDING)`.
 * Equals 136 px in v1.
 */
export const ATLAS_PIXEL_HEIGHT = ATLAS_TILES_HIGH * (TILE_SIZE + TILE_PADDING);

/**
 * Total cells available in the v1 grid (`16 × 8 = 128`). Phase 4 + 6 +
 * 7 fits comfortably (~41 effective cells).
 */
export const ATLAS_CELLS = ATLAS_TILES_WIDE * ATLAS_TILES_HIGH;

/**
 * Phase 4 placeholder atlas seed (memo decision 8). Bumping is allowed
 * pre-Phase-9 without `architecture-red-team` review (the seed is
 * still placeholder); Phase 9 selects the v1 release seed and freezes
 * it.
 */
export const ATLAS_SEED_DEFAULT = "icefall-phase4-placeholder-atlas-seed";
