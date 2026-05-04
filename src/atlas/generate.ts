/**
 * Phase 4 atlas-generation orchestrator (memo decision 10). Walks
 * `ATLAS_RECIPES`, runs each recipe under its `streams.atlas(recipeId)`
 * PRNG, blits the resulting 16×16 palette-index buffer into the atlas
 * pixel grid at the placement coordinates with `TILE_PADDING` of
 * transparent padding, and produces the encoded PNG bytes plus the
 * accompanying `AtlasManifest`.
 *
 * The atlas root seed is `atlasSeedToBytes(seed)` — NOT `seedToBytes`
 * — per addendum B7 (the two are byte-distinct domains).
 */

import { sha256Hex } from "../core/hash";
import { streamsForRun } from "../core/streams";
import {
  ATLAS_PIXEL_HEIGHT,
  ATLAS_PIXEL_WIDTH,
  ATLAS_TILES_HIGH,
  ATLAS_TILES_WIDE,
  TILE_PADDING,
  TILE_SIZE,
} from "./params";
import { CYBERPUNK_NEON_V1 } from "./palette";
import { encodeIndexedPng } from "./png";
import { atlasSeedToBytes } from "./seed";
import { placeRecipes } from "./layout";
import {
  ATLAS_RECIPES,
  type AtlasSlotId,
} from "../registries/atlas-recipes";
import type { RecipeContext } from "./recipes/floor";

export type AtlasManifest = {
  readonly atlasBinaryHash: string;
  readonly atlasSeed: string;
  readonly generator: {
    readonly primitiveSetVersion: 1;
    readonly tilePadding: 1;
    readonly tileSize: 16;
    readonly tilesHigh: number;
    readonly tilesWide: number;
  };
  readonly palette: {
    readonly id: string;
    readonly size: number;
  };
  readonly schemaVersion: 1;
  readonly sprites: ReadonlyMap<AtlasSlotId, AtlasSpriteEntry>;
};

export type AtlasSpriteEntry = {
  readonly atlasX: number;
  readonly atlasY: number;
  readonly recipeId: string;
  readonly tilesHigh: number;
  readonly tilesWide: number;
};

export type GeneratedAtlas = {
  readonly png: Uint8Array;
  readonly manifest: AtlasManifest;
};

/**
 * Generate the atlas binary + manifest for a given atlas-seed string.
 * Pure — no I/O. Callers (`tools/gen-atlas.ts`, `src/main.ts` preview)
 * own the `node:fs.writeFileSync` / `URL.createObjectURL` step.
 */
export function generateAtlas(atlasSeed: string): GeneratedAtlas {
  const rootSeed = atlasSeedToBytes(atlasSeed);

  // Prepare the atlas pixel buffer (defaulting to palette index 0 = transparent).
  const pixels = new Uint8Array(ATLAS_PIXEL_WIDTH * ATLAS_PIXEL_HEIGHT);

  // Compute placement coordinates from the recipe registry.
  const placements = placeRecipes(
    ATLAS_RECIPES.map((r) => ({
      id: r.id,
      tilesWide: r.tilesWide,
      tilesHigh: r.tilesHigh,
    })),
  );

  // Run each recipe under its own atlas stream and blit the result.
  for (let i = 0; i < ATLAS_RECIPES.length; i++) {
    const entry = ATLAS_RECIPES[i]!;
    const placement = placements[i]!;
    const streams = streamsForRun(rootSeed);
    const prng = streams.atlas(entry.id);
    const ctx: RecipeContext = {
      tileSize: TILE_SIZE as 16,
      slotName: entry.slot,
      atlasSeed,
    };
    const tile = entry.recipe(prng, CYBERPUNK_NEON_V1, ctx);
    // Blit the 16×16 tile at (atlasX*(TILE_SIZE+TILE_PADDING),
    // atlasY*(TILE_SIZE+TILE_PADDING)). Multi-tile sprites: the recipe
    // returns a single TILE_SIZE×TILE_SIZE buffer, so multi-tile entries
    // currently paint only the top-left cell. (Phase 4 ships only 1×1
    // sprites; the multi-tile path lands in Phase 6/7 along with the
    // boss recipe — addendum N9.)
    const px0 = placement.atlasX * (TILE_SIZE + TILE_PADDING);
    const py0 = placement.atlasY * (TILE_SIZE + TILE_PADDING);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        pixels[(py0 + y) * ATLAS_PIXEL_WIDTH + (px0 + x)] =
          tile[y * TILE_SIZE + x]!;
      }
    }
  }

  const png = encodeIndexedPng(
    ATLAS_PIXEL_WIDTH,
    ATLAS_PIXEL_HEIGHT,
    pixels,
    CYBERPUNK_NEON_V1,
  );
  const atlasBinaryHash = sha256Hex(png);

  // Build the manifest. Sprites are inserted in alphabetical key order
  // (the manifest serializer is the canonical-form authority; the Map
  // here is just data — order is enforced at serialization time).
  const sprites = new Map<AtlasSlotId, AtlasSpriteEntry>();
  for (let i = 0; i < ATLAS_RECIPES.length; i++) {
    const entry = ATLAS_RECIPES[i]!;
    const placement = placements[i]!;
    sprites.set(entry.slot, {
      atlasX: placement.atlasX,
      atlasY: placement.atlasY,
      recipeId: entry.id,
      tilesHigh: entry.tilesHigh,
      tilesWide: entry.tilesWide,
    });
  }
  const manifest: AtlasManifest = {
    atlasBinaryHash,
    atlasSeed,
    generator: {
      primitiveSetVersion: 1,
      tilePadding: TILE_PADDING as 1,
      tileSize: TILE_SIZE as 16,
      tilesHigh: ATLAS_TILES_HIGH,
      tilesWide: ATLAS_TILES_WIDE,
    },
    palette: {
      id: CYBERPUNK_NEON_V1.id,
      size: CYBERPUNK_NEON_V1.colors.length,
    },
    schemaVersion: 1,
    sprites,
  };

  return { png, manifest };
}
