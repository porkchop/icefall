/**
 * Phase 4 atlas-recipes registry (memo decision 2a). Stable string
 * IDs match the regex
 *   `^atlas-recipe\.(cyberpunk)\.(tile|monster|item|player|npc|ui|boss)\.[a-z][a-z0-9-]*$`.
 *
 * The registry is data-only and append-only by convention. Adding a
 * recipe at the end of the array does NOT move earlier sprites'
 * `(atlasX, atlasY)` (decision 3a invariant).
 *
 * Phase 4 ships seven recipes — floor tile, wall tile, door tile, one
 * monster, one item, one NPC, the player sprite — per
 * `docs/PHASES.md:209`. Phase 6 + 7 add additive entries.
 */

import type { PRNG } from "../core/prng";
import type { Palette } from "../atlas/palette";
import type { RecipeContext } from "../atlas/recipes/floor";
import { recipeFloor } from "../atlas/recipes/floor";
import { recipeWall } from "../atlas/recipes/wall";
import { recipeDoor } from "../atlas/recipes/door";
import { recipeMonsterIceDaemon } from "../atlas/recipes/monster-ice-daemon";
import { recipeItemCredChip } from "../atlas/recipes/item-cred-chip";
import { recipeNpcRipperdoc } from "../atlas/recipes/npc-ripperdoc";
import { recipePlayer } from "../atlas/recipes/player";

export type AtlasSlotId =
  | "tile.floor.cyberfloor_01"
  | "tile.wall.cyberfloor_01"
  | "tile.door.cyberdoor"
  | "monster.ice.daemon"
  | "item.cred-chip"
  | "npc.ripperdoc"
  | "player";

export type Recipe = (
  prng: PRNG,
  palette: Palette,
  ctx: RecipeContext,
) => Uint8Array;

export type AtlasRecipeEntry = {
  readonly id: string;
  readonly recipe: Recipe;
  readonly tilesWide: 1 | 2 | 4;
  readonly tilesHigh: 1 | 2 | 4;
  readonly slot: AtlasSlotId;
};

/**
 * Recipe-ID format regex per memo decision 2 + frozen-contract item 3.
 * Theme alternation is `cyberpunk` for v1; adding a theme is a
 * `rulesetVersion` bump (N11).
 */
export const ATLAS_RECIPE_ID_REGEX =
  /^atlas-recipe\.(cyberpunk)\.(tile|monster|item|player|npc|ui|boss)\.[a-z][a-z0-9-]*$/;

export const ATLAS_RECIPES: readonly AtlasRecipeEntry[] = Object.freeze([
  Object.freeze({
    id: "atlas-recipe.cyberpunk.tile.floor",
    recipe: recipeFloor,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "tile.floor.cyberfloor_01",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.tile.wall",
    recipe: recipeWall,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "tile.wall.cyberfloor_01",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.tile.door",
    recipe: recipeDoor,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "tile.door.cyberdoor",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.monster.ice-daemon",
    recipe: recipeMonsterIceDaemon,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "monster.ice.daemon",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cred-chip",
    recipe: recipeItemCredChip,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cred-chip",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.npc.ripperdoc",
    recipe: recipeNpcRipperdoc,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "npc.ripperdoc",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.player.player",
    recipe: recipePlayer,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "player",
  }),
]);

export const ATLAS_RECIPE_IDS: readonly string[] = Object.freeze(
  ATLAS_RECIPES.map((r) => r.id),
);

export function getAtlasRecipe(id: string): AtlasRecipeEntry {
  for (let i = 0; i < ATLAS_RECIPES.length; i++) {
    const r = ATLAS_RECIPES[i]!;
    if (r.id === id) return r;
  }
  throw new Error(`getAtlasRecipe: unknown recipe id "${id}"`);
}
