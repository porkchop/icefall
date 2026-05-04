import { describe, expect, it } from "vitest";
import {
  parseAtlasJson,
  serializeAtlasManifest,
} from "../../src/atlas/manifest";
import type {
  AtlasManifest,
  AtlasSpriteEntry,
} from "../../src/atlas/generate";
import type { AtlasSlotId } from "../../src/registries/atlas-recipes";

/**
 * Phase 4 frozen-contract item 9 — manifest serializer + strict parser
 * tests (memo decision 6 + addendum N15).
 */

function fixtureSprite(): AtlasSpriteEntry {
  return {
    atlasX: 1,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.tile.floor",
    tilesHigh: 1,
    tilesWide: 1,
  };
}

function fixtureManifest(): AtlasManifest {
  const sprites = new Map<AtlasSlotId, AtlasSpriteEntry>();
  sprites.set("tile.floor.cyberfloor_01", fixtureSprite());
  sprites.set("player", {
    atlasX: 4,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.player.player",
    tilesHigh: 1,
    tilesWide: 1,
  });
  return {
    atlasBinaryHash:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    atlasSeed: "icefall-phase4-placeholder-atlas-seed",
    generator: {
      primitiveSetVersion: 1,
      tilePadding: 1,
      tileSize: 16,
      tilesHigh: 8,
      tilesWide: 16,
    },
    palette: { id: "cyberpunk-neon-v1", size: 16 },
    schemaVersion: 1,
    sprites,
  };
}

describe("serializeAtlasManifest — canonical form", () => {
  it("emits top-level keys in alphabetical order", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    // Top-level keys appear in this exact order:
    const expectedOrder = [
      "atlasBinaryHash",
      "atlasSeed",
      "generator",
      "palette",
      "schemaVersion",
      "sprites",
    ];
    let lastIdx = -1;
    for (const k of expectedOrder) {
      const idx = json.indexOf(`"${k}":`);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("emits per-sprite keys in alphabetical order", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    // Within sprites["player"] (the first sprite emitted):
    //   atlasX, atlasY, recipeId, tilesHigh, tilesWide.
    const playerStart = json.indexOf(`"player":`);
    expect(playerStart).toBeGreaterThan(0);
    const playerSlice = json.slice(playerStart);
    const expectedOrder = ["atlasX", "atlasY", "recipeId", "tilesHigh", "tilesWide"];
    let lastIdx = -1;
    for (const k of expectedOrder) {
      const idx = playerSlice.indexOf(`"${k}":`);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("emits sprites map keys sorted by AtlasSlotId ASCII-ascending", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    // 'player' < 'tile.floor.cyberfloor_01' in ASCII order.
    const playerIdx = json.indexOf(`"player":`);
    const floorIdx = json.indexOf(`"tile.floor.cyberfloor_01":`);
    expect(playerIdx).toBeLessThan(floorIdx);
  });

  it("returns a valid JSON string parseable by JSON.parse", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("parseAtlasJson — round-trip", () => {
  it("a canonical fixture round-trips byte-identically", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const parsed = parseAtlasJson(JSON.parse(json));
    const reSerialized = serializeAtlasManifest(parsed);
    expect(reSerialized).toBe(json);
  });

  it("non-canonical input round-trip (addendum N15)", () => {
    // Construct a non-canonical input: keys in non-alphabetical order.
    // Parse → serialize → parse again. Output should equal a canonical
    // re-serialization of the same data.
    const noncanonical = {
      sprites: {
        "tile.floor.cyberfloor_01": {
          tilesWide: 1,
          tilesHigh: 1,
          recipeId: "atlas-recipe.cyberpunk.tile.floor",
          atlasY: 0,
          atlasX: 1,
        },
        player: {
          tilesWide: 1,
          tilesHigh: 1,
          recipeId: "atlas-recipe.cyberpunk.player.player",
          atlasY: 0,
          atlasX: 4,
        },
      },
      schemaVersion: 1,
      palette: { size: 16, id: "cyberpunk-neon-v1" },
      generator: {
        tilesWide: 16,
        tilesHigh: 8,
        tileSize: 16,
        tilePadding: 1,
        primitiveSetVersion: 1,
      },
      atlasSeed: "icefall-phase4-placeholder-atlas-seed",
      atlasBinaryHash:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };
    const parsed = parseAtlasJson(noncanonical);
    const reSerialized = serializeAtlasManifest(parsed);
    const reParsed = parseAtlasJson(JSON.parse(reSerialized));
    const reReSerialized = serializeAtlasManifest(reParsed);
    expect(reReSerialized).toBe(reSerialized);
  });
});

describe("parseAtlasJson — strict-parse rejection", () => {
  it("rejects non-object input", () => {
    expect(() => parseAtlasJson(null)).toThrowError(/manifest must be a JSON object/);
    expect(() => parseAtlasJson(42)).toThrowError(/manifest must be a JSON object/);
    expect(() => parseAtlasJson([])).toThrowError(/manifest must be a JSON object/);
  });

  it("rejects unknown top-level keys with the pinned message", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.foo = "bar";
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: unknown key 'foo' in manifest",
    );
  });

  it("rejects missing top-level keys with the pinned message", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    delete obj.atlasSeed;
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: missing required key 'atlasSeed' in manifest",
    );
  });

  it("rejects schemaVersion=2 with the pinned message (addendum N16)", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.schemaVersion = 2;
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: unsupported schemaVersion (got 2, expected 1)",
    );
  });

  it("rejects an invalid recipeId (regex mismatch) with the pinned message", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.sprites["tile.floor.cyberfloor_01"].recipeId = "no-such-recipe";
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: invalid recipeId 'no-such-recipe'",
    );
  });

  it("rejects atlasX out of [0, ATLAS_TILES_WIDE-1]", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.sprites["tile.floor.cyberfloor_01"].atlasX = 100;
    expect(() => parseAtlasJson(obj)).toThrowError(/atlasX not an integer in/);
  });

  it("rejects atlasY out of [0, ATLAS_TILES_HIGH-1]", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.sprites["tile.floor.cyberfloor_01"].atlasY = 100;
    expect(() => parseAtlasJson(obj)).toThrowError(/atlasY not an integer in/);
  });

  it("rejects atlasBinaryHash that isn't 64-char lowercase hex", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.atlasBinaryHash = "TOO_SHORT";
    expect(() => parseAtlasJson(obj)).toThrowError(
      /atlasBinaryHash must be 64-char lowercase hex/,
    );
  });

  it("rejects unknown keys inside sprites entries", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.sprites["tile.floor.cyberfloor_01"].extra = 123;
    expect(() => parseAtlasJson(obj)).toThrowError(
      /unknown key 'extra' in sprites\['tile\.floor\.cyberfloor_01'\]/,
    );
  });

  it("rejects unknown keys inside generator", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.generator.extra = 123;
    expect(() => parseAtlasJson(obj)).toThrowError(
      /unknown key 'extra' in generator/,
    );
  });

  it("rejects unknown keys inside palette", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.palette.extra = 123;
    expect(() => parseAtlasJson(obj)).toThrowError(
      /unknown key 'extra' in palette/,
    );
  });

  it("rejects tilesWide / tilesHigh outside {1, 2, 4}", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.sprites["tile.floor.cyberfloor_01"].tilesWide = 3;
    expect(() => parseAtlasJson(obj)).toThrowError(
      /tilesWide \/ tilesHigh must be in \{1,2,4\}/,
    );
  });
});

describe("serializeAtlasManifest — guards", () => {
  it("rejects non-ASCII strings in serializable fields", () => {
    const m = fixtureManifest();
    const bad: AtlasManifest = {
      ...m,
      atlasSeed: "café",
    };
    expect(() => serializeAtlasManifest(bad)).toThrowError(
      /refused non-ASCII or control char/,
    );
  });

  it("rejects non-integer numeric fields", () => {
    const m = fixtureManifest();
    const sprites = new Map(m.sprites);
    sprites.set("tile.floor.cyberfloor_01", {
      ...m.sprites.get("tile.floor.cyberfloor_01")!,
      atlasX: 1.5,
    });
    const bad = { ...m, sprites };
    expect(() => serializeAtlasManifest(bad)).toThrowError(/non-integer/);
  });

  it("escapes embedded ASCII quotes in atlasSeed", () => {
    // Quote chars (0x22) and backslashes (0x5c) are valid ASCII; the
    // serializer must escape them rather than reject them.
    const m = fixtureManifest();
    const bad: AtlasManifest = { ...m, atlasSeed: 'with"quote' };
    const json = serializeAtlasManifest(bad);
    expect(json).toContain(`"atlasSeed":"with\\"quote"`);
  });

  it("escapes embedded backslashes in atlasSeed", () => {
    const m = fixtureManifest();
    const bad: AtlasManifest = { ...m, atlasSeed: "with\\slash" };
    const json = serializeAtlasManifest(bad);
    expect(json).toContain(`"atlasSeed":"with\\\\slash"`);
  });
});

describe("parseAtlasJson — type guards", () => {
  it("rejects atlasSeed that isn't a string", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.atlasSeed = 42;
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: atlasSeed must be a string",
    );
  });

  it("rejects atlasBinaryHash that isn't a string", () => {
    const m = fixtureManifest();
    const json = serializeAtlasManifest(m);
    const obj = JSON.parse(json);
    obj.atlasBinaryHash = 42;
    expect(() => parseAtlasJson(obj)).toThrowError(
      "parseAtlasJson: atlasBinaryHash must be a string",
    );
  });
});
