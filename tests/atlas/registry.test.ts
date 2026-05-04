import { describe, expect, it } from "vitest";
import {
  ATLAS_RECIPES,
  ATLAS_RECIPE_IDS,
  ATLAS_RECIPE_ID_REGEX,
  getAtlasRecipe,
} from "../../src/registries/atlas-recipes";
import { CYBERPUNK_NEON_V1 } from "../../src/atlas/palette";
import { TILE_SIZE, ATLAS_SEED_DEFAULT } from "../../src/atlas/params";
import { atlasSeedToBytes } from "../../src/atlas/seed";
import { streamsForRun } from "../../src/core/streams";
import type { RecipeContext } from "../../src/atlas/recipes/types";

/**
 * Phase 4 frozen-contract item 3 — recipe registry shape tests (memo
 * decision 2 + 2a). Every entry has a regex-conforming ID, a function
 * recipe, and produces a 256-byte palette-index buffer when run.
 */

describe("ATLAS_RECIPES — shape", () => {
  it("ships 26 entries — Phase 4's 7 + Phase 6.A.2's 16 item additions + Phase 7.A.1's 3 carry-forward item recipes (stim-patch + trauma-pack + cyberdeck-mod-1)", () => {
    expect(ATLAS_RECIPES.length).toBe(26);
  });

  it("every entry has a regex-conforming recipe ID", () => {
    for (const entry of ATLAS_RECIPES) {
      expect(entry.id).toMatch(ATLAS_RECIPE_ID_REGEX);
    }
  });

  it("every entry's recipe is a function", () => {
    for (const entry of ATLAS_RECIPES) {
      expect(typeof entry.recipe).toBe("function");
    }
  });

  it("every entry has tilesWide and tilesHigh in {1, 2, 4}", () => {
    const allowed = new Set([1, 2, 4]);
    for (const entry of ATLAS_RECIPES) {
      expect(allowed.has(entry.tilesWide)).toBe(true);
      expect(allowed.has(entry.tilesHigh)).toBe(true);
    }
  });

  it("recipe IDs are unique", () => {
    const ids = ATLAS_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ATLAS_RECIPE_IDS mirrors ATLAS_RECIPES.map(r => r.id)", () => {
    expect(ATLAS_RECIPE_IDS).toEqual(ATLAS_RECIPES.map((r) => r.id));
  });
});

describe("ATLAS_RECIPES — slot coverage (Phase 4 + Phase 6.A.2)", () => {
  it("includes the seven Phase 4 frozen slots", () => {
    const slots = new Set(ATLAS_RECIPES.map((r) => r.slot));
    expect(slots.has("item.cred-chip")).toBe(true);
    expect(slots.has("monster.ice.daemon")).toBe(true);
    expect(slots.has("npc.ripperdoc")).toBe(true);
    expect(slots.has("player")).toBe(true);
    expect(slots.has("tile.door.cyberdoor")).toBe(true);
    expect(slots.has("tile.floor.cyberfloor_01")).toBe(true);
    expect(slots.has("tile.wall.cyberfloor_01")).toBe(true);
  });

  it("includes the Phase 6.A.2 item slot ids (one per non-cred-chip item registry entry)", () => {
    const slots = new Set(ATLAS_RECIPES.map((r) => r.slot));
    const expected = [
      "item.consumable.adrenaline-spike",
      "item.consumable.med-injector",
      "item.consumable.nano-repair",
      "item.consumable.syringe",
      "item.cyber.armor",
      "item.cyber.dermal-plating",
      "item.cyber.neural-link",
      "item.cyber.reflex-booster",
      "item.cyber.subdermal-armor",
      "item.eddies",
      "item.weapon.cyberblade",
      "item.weapon.knife",
      "item.weapon.monoblade",
      "item.weapon.pistol",
      "item.weapon.shotgun",
      "item.weapon.smg",
    ];
    for (const e of expected) {
      expect(slots.has(e as never)).toBe(true);
    }
  });

  it("preserves the Phase 4 declaration order in the first seven entries (coordinate-stability)", () => {
    const firstSeven = ATLAS_RECIPES.slice(0, 7).map((r) => r.id);
    expect(firstSeven).toEqual([
      "atlas-recipe.cyberpunk.tile.floor",
      "atlas-recipe.cyberpunk.tile.wall",
      "atlas-recipe.cyberpunk.tile.door",
      "atlas-recipe.cyberpunk.monster.ice-daemon",
      "atlas-recipe.cyberpunk.item.cred-chip",
      "atlas-recipe.cyberpunk.npc.ripperdoc",
      "atlas-recipe.cyberpunk.player.player",
    ]);
  });
});

describe("ATLAS_RECIPES — output buffer shape", () => {
  it("every recipe returns a 256-byte Uint8Array under ATLAS_SEED_DEFAULT", () => {
    const root = atlasSeedToBytes(ATLAS_SEED_DEFAULT);
    for (const entry of ATLAS_RECIPES) {
      const streams = streamsForRun(root);
      const prng = streams.atlas(entry.id);
      const ctx: RecipeContext = {
        tileSize: TILE_SIZE as 16,
        slotName: entry.slot,
        atlasSeed: ATLAS_SEED_DEFAULT,
      };
      const out = entry.recipe(prng, CYBERPUNK_NEON_V1, ctx);
      expect(out).toBeInstanceOf(Uint8Array);
      expect(out.length).toBe(TILE_SIZE * TILE_SIZE);
    }
  });

  it("every recipe paints only valid palette indices (< 16)", () => {
    const root = atlasSeedToBytes(ATLAS_SEED_DEFAULT);
    for (const entry of ATLAS_RECIPES) {
      const streams = streamsForRun(root);
      const prng = streams.atlas(entry.id);
      const ctx: RecipeContext = {
        tileSize: TILE_SIZE as 16,
        slotName: entry.slot,
        atlasSeed: ATLAS_SEED_DEFAULT,
      };
      const out = entry.recipe(prng, CYBERPUNK_NEON_V1, ctx);
      for (let i = 0; i < out.length; i++) {
        expect(out[i]!).toBeLessThan(16);
      }
    }
  });

  it("recipes are deterministic — same inputs → identical bytes", () => {
    const entry = ATLAS_RECIPES[0]!;
    const ctx: RecipeContext = {
      tileSize: TILE_SIZE as 16,
      slotName: entry.slot,
      atlasSeed: ATLAS_SEED_DEFAULT,
    };
    const root = atlasSeedToBytes(ATLAS_SEED_DEFAULT);
    const a = entry.recipe(streamsForRun(root).atlas(entry.id), CYBERPUNK_NEON_V1, ctx);
    const b = entry.recipe(streamsForRun(root).atlas(entry.id), CYBERPUNK_NEON_V1, ctx);
    expect([...a]).toEqual([...b]);
  });
});

describe("getAtlasRecipe — lookup", () => {
  it("returns the entry for a registered ID", () => {
    const r = getAtlasRecipe("atlas-recipe.cyberpunk.tile.floor");
    expect(r.slot).toBe("tile.floor.cyberfloor_01");
  });

  it("throws on an unknown ID", () => {
    expect(() => getAtlasRecipe("atlas-recipe.cyberpunk.tile.no-such")).toThrowError(
      /getAtlasRecipe: unknown recipe id/,
    );
  });
});

describe("ATLAS_RECIPES — per-recipe stream isolation", () => {
  it("each recipe call records exactly one __consumed key", () => {
    const root = atlasSeedToBytes(ATLAS_SEED_DEFAULT);
    for (const entry of ATLAS_RECIPES) {
      const streams = streamsForRun(root);
      const prng = streams.atlas(entry.id);
      const ctx: RecipeContext = {
        tileSize: TILE_SIZE as 16,
        slotName: entry.slot,
        atlasSeed: ATLAS_SEED_DEFAULT,
      };
      entry.recipe(prng, CYBERPUNK_NEON_V1, ctx);
      expect(streams.__consumed.size).toBe(1);
      expect(streams.__consumed.has(`atlas:${entry.id}`)).toBe(true);
    }
  });
});
