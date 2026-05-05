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
 * `docs/PHASES.md:209`. Phase 6.A.2 appends 16 new item recipes (one
 * per non-cred-chip ItemKindId in the expanded item registry) so the
 * count is now 23. Phase 7 will add NPC + boss recipes.
 *
 * Phase 6 frozen contract (`docs/ARCHITECTURE.md` "Phase 6 frozen
 * contracts" → "Atlas extension — coordinate-stable for Phase 4
 * sprites"): the existing seven Phase 4 sprite coordinates remain
 * unchanged; new recipes APPEND to the registry-declaration order so
 * the row-major `placeRecipes` packer slots them after the Phase 4
 * coordinates.
 */

import type { PRNG } from "../core/prng";
import type { Palette } from "../atlas/palette";
import type { RecipeContext } from "../atlas/recipes/types";
// Phase 4 originals (positions 0..6 in the array — coordinate-stable).
import { recipeFloor } from "../atlas/recipes/floor";
import { recipeWall } from "../atlas/recipes/wall";
import { recipeDoor } from "../atlas/recipes/door";
import { recipeMonsterIceDaemon } from "../atlas/recipes/monster-ice-daemon";
import { recipeItemCredChip } from "../atlas/recipes/item-cred-chip";
import { recipeNpcRipperdoc } from "../atlas/recipes/npc-ripperdoc";
import { recipePlayer } from "../atlas/recipes/player";
// Phase 6.A.2 additions (positions 7+ in the array — appended).
import { recipeItemConsumableAdrenalineSpike } from "../atlas/recipes/item-consumable-adrenaline-spike";
import { recipeItemConsumableMedInjector } from "../atlas/recipes/item-consumable-med-injector";
import { recipeItemConsumableNanoRepair } from "../atlas/recipes/item-consumable-nano-repair";
import { recipeItemConsumableSyringe } from "../atlas/recipes/item-consumable-syringe";
import { recipeItemCyberArmor } from "../atlas/recipes/item-cyber-armor";
import { recipeItemCyberDermalPlating } from "../atlas/recipes/item-cyber-dermal-plating";
import { recipeItemCyberNeuralLink } from "../atlas/recipes/item-cyber-neural-link";
import { recipeItemCyberReflexBooster } from "../atlas/recipes/item-cyber-reflex-booster";
import { recipeItemCyberSubdermalArmor } from "../atlas/recipes/item-cyber-subdermal-armor";
import { recipeItemEddies } from "../atlas/recipes/item-eddies";
import { recipeItemWeaponCyberblade } from "../atlas/recipes/item-weapon-cyberblade";
import { recipeItemWeaponKnife } from "../atlas/recipes/item-weapon-knife";
import { recipeItemWeaponMonoblade } from "../atlas/recipes/item-weapon-monoblade";
import { recipeItemWeaponPistol } from "../atlas/recipes/item-weapon-pistol";
import { recipeItemWeaponShotgun } from "../atlas/recipes/item-weapon-shotgun";
import { recipeItemWeaponSmg } from "../atlas/recipes/item-weapon-smg";
// Phase 7.A.1 additions (positions 23+ in the array — appended). Closes
// Phase 6.A.2 code-review nit N4: the 3 Phase 3 items that previously
// lacked atlas recipes (would have produced a renderer-throw if ever
// floor-spawned). Coordinate-stable for all earlier sprites per
// addendum 3a.
import { recipeItemStimPatch } from "../atlas/recipes/item-stim-patch";
import { recipeItemTraumaPack } from "../atlas/recipes/item-trauma-pack";
import { recipeItemCyberdeckMod1 } from "../atlas/recipes/item-cyberdeck-mod-1";
// Phase 7.A.2 additions (positions 26+ in the array — appended).
// Wires NPC + boss content per Phase 7 frozen contract. Coordinate-
// stable for the 26 earlier sprites; new entries slot at row-major
// positions (10,1), (11,1), (12,1).
import { recipeNpcFixer } from "../atlas/recipes/npc-fixer";
import { recipeNpcInfoBroker } from "../atlas/recipes/npc-info-broker";
import { recipeMonsterBossBlackIce } from "../atlas/recipes/monster-boss-black-ice";

export type AtlasSlotId =
  // Phase 4 frozen seven (do NOT reorder).
  | "tile.floor.cyberfloor_01"
  | "tile.wall.cyberfloor_01"
  | "tile.door.cyberdoor"
  | "monster.ice.daemon"
  | "item.cred-chip"
  | "npc.ripperdoc"
  | "player"
  // Phase 6.A.2 additions (slot ids match the corresponding
  // `ItemKindId` so the renderer can look them up directly via
  // `floorItem.kind`).
  | "item.consumable.adrenaline-spike"
  | "item.consumable.med-injector"
  | "item.consumable.nano-repair"
  | "item.consumable.syringe"
  | "item.cyber.armor"
  | "item.cyber.dermal-plating"
  | "item.cyber.neural-link"
  | "item.cyber.reflex-booster"
  | "item.cyber.subdermal-armor"
  | "item.eddies"
  | "item.weapon.cyberblade"
  | "item.weapon.knife"
  | "item.weapon.monoblade"
  | "item.weapon.pistol"
  | "item.weapon.shotgun"
  | "item.weapon.smg"
  // Phase 7.A.1 additions (close Phase 6.A.2 N4 carry-forward).
  | "item.stim-patch"
  | "item.trauma-pack"
  | "item.cyberdeck-mod-1"
  // Phase 7.A.2 additions (NPC + boss). Slot ids match the
  // corresponding `NpcKindId` / `MonsterKindId` so the renderer can
  // look them up directly via the entity's `kind` field.
  | "npc.fixer"
  | "npc.info-broker"
  | "monster.boss.black-ice-v0";

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
  // ----- Phase 4 frozen seven (positions 0..6 — coordinate-stable) -----
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
  // ----- Phase 6.A.2 additions (positions 7+ — appended) -----
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.consumable-adrenaline-spike",
    recipe: recipeItemConsumableAdrenalineSpike,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.consumable.adrenaline-spike",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.consumable-med-injector",
    recipe: recipeItemConsumableMedInjector,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.consumable.med-injector",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.consumable-nano-repair",
    recipe: recipeItemConsumableNanoRepair,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.consumable.nano-repair",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.consumable-syringe",
    recipe: recipeItemConsumableSyringe,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.consumable.syringe",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyber-armor",
    recipe: recipeItemCyberArmor,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyber.armor",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyber-dermal-plating",
    recipe: recipeItemCyberDermalPlating,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyber.dermal-plating",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyber-neural-link",
    recipe: recipeItemCyberNeuralLink,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyber.neural-link",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyber-reflex-booster",
    recipe: recipeItemCyberReflexBooster,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyber.reflex-booster",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyber-subdermal-armor",
    recipe: recipeItemCyberSubdermalArmor,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyber.subdermal-armor",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.eddies",
    recipe: recipeItemEddies,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.eddies",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-cyberblade",
    recipe: recipeItemWeaponCyberblade,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.cyberblade",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-knife",
    // Phase 3 listed `item.weapon.knife` but Phase 4 did not ship a
    // recipe for it (only `item.cred-chip` was painted as the lone
    // item). Phase 6.A.2 lands the dedicated recipe here so the
    // FloorItem renderer can blit dropped knives uniformly with the
    // other Phase 6 weapon items.
    recipe: recipeItemWeaponKnife,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.knife",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-monoblade",
    recipe: recipeItemWeaponMonoblade,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.monoblade",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-pistol",
    recipe: recipeItemWeaponPistol,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.pistol",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-shotgun",
    recipe: recipeItemWeaponShotgun,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.shotgun",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.weapon-smg",
    recipe: recipeItemWeaponSmg,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.weapon.smg",
  }),
  // ----- Phase 7.A.1 — close Phase 6.A.2 N4 carry-forward -----
  // Order within the Phase 7.A.1 block is registry-declaration order
  // (matches the order Phase 3's `src/registries/items.ts` listed these
  // 3 entries when the recipes were originally absent: stim-patch
  // before trauma-pack before cyberdeck-mod-1). The placer is
  // declaration-order, not alphabetical-by-recipe-id, per memo
  // decision 3a — bumping this order would shift `(atlasX, atlasY)`
  // for the 3 new sprites and is therefore frozen at landing.
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.stim-patch",
    recipe: recipeItemStimPatch,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.stim-patch",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.trauma-pack",
    recipe: recipeItemTraumaPack,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.trauma-pack",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.item.cyberdeck-mod-1",
    recipe: recipeItemCyberdeckMod1,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "item.cyberdeck-mod-1",
  }),
  // ----- Phase 7.A.2 — NPC + boss content -----
  // Order within the Phase 7.A.2 block is the order required to slot
  // at (10,1), (11,1), (12,1) on the 16-wide × 8-high atlas grid.
  // Bumping this order would shift `(atlasX, atlasY)` for these
  // 3 sprites; frozen at landing.
  Object.freeze({
    id: "atlas-recipe.cyberpunk.npc.fixer",
    recipe: recipeNpcFixer,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "npc.fixer",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.npc.info-broker",
    recipe: recipeNpcInfoBroker,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "npc.info-broker",
  }),
  Object.freeze({
    id: "atlas-recipe.cyberpunk.boss.black-ice-v0",
    recipe: recipeMonsterBossBlackIce,
    tilesWide: 1,
    tilesHigh: 1,
    slot: "monster.boss.black-ice-v0",
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
