/**
 * Phase 4 atlas-manifest serializer + strict parser (memo decision 6 +
 * addendum N15, N16). Top-level keys, per-sprite keys, and per-sprite
 * map keys are emitted in alphabetical order. Mirrors the Phase 2
 * floor-JSON discipline (`src/mapgen/serialize.ts`).
 *
 * Strict-parse rules:
 *   - Unknown top-level keys throw.
 *   - Missing required keys throw.
 *   - `schemaVersion !== 1` throws.
 *   - Invalid `recipeId` (regex mismatch) throws.
 *   - `atlasX` / `atlasY` out of grid throws.
 *
 * The parser does NOT validate that every `recipeId` is registered —
 * that is a runtime registry check at atlas-load time
 * (`src/atlas/loader.ts`). Same separation as Phase 2's `parseFloor`
 * vs runtime registry checks.
 */

import {
  ATLAS_TILES_HIGH,
  ATLAS_TILES_WIDE,
  TILE_PADDING,
  TILE_SIZE,
} from "./params";
import {
  ATLAS_RECIPE_ID_REGEX,
  type AtlasSlotId,
} from "../registries/atlas-recipes";
import type { AtlasManifest, AtlasSpriteEntry } from "./generate";

export const ATLAS_SCHEMA_VERSION = 1 as const;

const TOP_LEVEL_KEYS: readonly string[] = [
  "atlasBinaryHash",
  "atlasSeed",
  "generator",
  "palette",
  "schemaVersion",
  "sprites",
];

const GENERATOR_KEYS: readonly string[] = [
  "primitiveSetVersion",
  "tilePadding",
  "tileSize",
  "tilesHigh",
  "tilesWide",
];

const PALETTE_KEYS: readonly string[] = ["id", "size"];

const SPRITE_KEYS: readonly string[] = [
  "atlasX",
  "atlasY",
  "recipeId",
  "tilesHigh",
  "tilesWide",
];

const ALLOWED_TILE_DIMS: ReadonlySet<number> = new Set([1, 2, 4]);

/* ------------------------------------------------------------------ */
/* Serialize                                                          */
/* ------------------------------------------------------------------ */

function jsonStringAscii(s: string): string {
  // ASCII-only manifest fields (recipeId, slot ID, palette id, hex
  // hash). Hand-encode quotes / backslashes; reject control or
  // non-ASCII to keep the output byte-stable across runtimes.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) {
      out += "\\\"";
    } else if (c === 0x5c) {
      out += "\\\\";
    } else if (c < 0x20 || c > 0x7e) {
      throw new Error(
        `serializeAtlasManifest: refused non-ASCII or control char at index ${i}`,
      );
    } else {
      out += s.charAt(i);
    }
  }
  out += '"';
  return out;
}

function asInt(n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error(`serializeAtlasManifest: non-integer ${n}`);
  }
  return String(n | 0);
}

/**
 * Serialize an `AtlasManifest` to canonical JSON. Keys at every level
 * are emitted in alphabetical order; the `sprites` map is sorted by
 * `AtlasSlotId` ASCII-ascending.
 */
export function serializeAtlasManifest(m: AtlasManifest): string {
  const parts: string[] = [];
  parts.push("{");
  parts.push(`"atlasBinaryHash":${jsonStringAscii(m.atlasBinaryHash)}`);
  parts.push(`,"atlasSeed":${jsonStringAscii(m.atlasSeed)}`);
  parts.push(`,"generator":{`);
  parts.push(`"primitiveSetVersion":${asInt(m.generator.primitiveSetVersion)}`);
  parts.push(`,"tilePadding":${asInt(m.generator.tilePadding)}`);
  parts.push(`,"tileSize":${asInt(m.generator.tileSize)}`);
  parts.push(`,"tilesHigh":${asInt(m.generator.tilesHigh)}`);
  parts.push(`,"tilesWide":${asInt(m.generator.tilesWide)}`);
  parts.push(`}`);
  parts.push(`,"palette":{`);
  parts.push(`"id":${jsonStringAscii(m.palette.id)}`);
  parts.push(`,"size":${asInt(m.palette.size)}`);
  parts.push(`}`);
  parts.push(`,"schemaVersion":${asInt(m.schemaVersion)}`);
  parts.push(`,"sprites":{`);
  const slots = [...m.sprites.keys()].sort();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const sprite = m.sprites.get(slot)!;
    if (i > 0) parts.push(",");
    parts.push(jsonStringAscii(slot));
    parts.push(":{");
    parts.push(`"atlasX":${asInt(sprite.atlasX)}`);
    parts.push(`,"atlasY":${asInt(sprite.atlasY)}`);
    parts.push(`,"recipeId":${jsonStringAscii(sprite.recipeId)}`);
    parts.push(`,"tilesHigh":${asInt(sprite.tilesHigh)}`);
    parts.push(`,"tilesWide":${asInt(sprite.tilesWide)}`);
    parts.push("}");
  }
  parts.push("}");
  parts.push("}");
  return parts.join("");
}

/* ------------------------------------------------------------------ */
/* Parse                                                              */
/* ------------------------------------------------------------------ */

function expectObject(v: unknown, label: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`parseAtlasJson: ${label} must be a JSON object`);
  }
  return v as Record<string, unknown>;
}

function expectKnownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const k of Object.keys(obj).sort()) {
    if (!allowedSet.has(k)) {
      throw new Error(`parseAtlasJson: unknown key '${k}' in ${label}`);
    }
  }
  for (const k of allowed) {
    if (!(k in obj)) {
      throw new Error(`parseAtlasJson: missing required key '${k}' in ${label}`);
    }
  }
}

function expectInt(
  v: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(
      `parseAtlasJson: ${label} not an integer in [${min},${max}] (got ${String(v)})`,
    );
  }
  return v;
}

function expectString(v: unknown, label: string): string {
  if (typeof v !== "string") {
    throw new Error(`parseAtlasJson: ${label} must be a string`);
  }
  return v;
}

/**
 * Strict parser for `assets/atlas.json`. Mirrors `parseFloor`'s
 * discipline. Accepts an `unknown`; callers `JSON.parse` outside this
 * module and pass the result here.
 */
export function parseAtlasJson(input: unknown): AtlasManifest {
  const top = expectObject(input, "manifest");
  expectKnownKeys(top, TOP_LEVEL_KEYS, "manifest");

  const schemaVersion = top["schemaVersion"];
  if (schemaVersion !== ATLAS_SCHEMA_VERSION) {
    throw new Error(
      `parseAtlasJson: unsupported schemaVersion (got ${String(schemaVersion)}, expected 1)`,
    );
  }

  const atlasBinaryHash = expectString(top["atlasBinaryHash"], "atlasBinaryHash");
  if (!/^[0-9a-f]{64}$/.test(atlasBinaryHash)) {
    throw new Error(
      `parseAtlasJson: atlasBinaryHash must be 64-char lowercase hex (got '${atlasBinaryHash}')`,
    );
  }
  const atlasSeed = expectString(top["atlasSeed"], "atlasSeed");

  const generator = expectObject(top["generator"], "generator");
  expectKnownKeys(generator, GENERATOR_KEYS, "generator");
  const gen = {
    primitiveSetVersion: expectInt(
      generator["primitiveSetVersion"],
      "generator.primitiveSetVersion",
      1,
      1,
    ) as 1,
    tilePadding: expectInt(
      generator["tilePadding"],
      "generator.tilePadding",
      TILE_PADDING,
      TILE_PADDING,
    ) as 1,
    tileSize: expectInt(
      generator["tileSize"],
      "generator.tileSize",
      TILE_SIZE,
      TILE_SIZE,
    ) as 16,
    tilesHigh: expectInt(generator["tilesHigh"], "generator.tilesHigh", 1, 256),
    tilesWide: expectInt(generator["tilesWide"], "generator.tilesWide", 1, 256),
  };

  const paletteObj = expectObject(top["palette"], "palette");
  expectKnownKeys(paletteObj, PALETTE_KEYS, "palette");
  const palette = {
    id: expectString(paletteObj["id"], "palette.id"),
    size: expectInt(paletteObj["size"], "palette.size", 1, 256),
  };

  const spritesObj = expectObject(top["sprites"], "sprites");
  const sprites = new Map<AtlasSlotId, AtlasSpriteEntry>();
  for (const slot of Object.keys(spritesObj).sort()) {
    const spriteRaw = expectObject(
      spritesObj[slot],
      `sprites['${slot}']`,
    );
    expectKnownKeys(spriteRaw, SPRITE_KEYS, `sprites['${slot}']`);
    const recipeId = expectString(spriteRaw["recipeId"], `sprites['${slot}'].recipeId`);
    if (!ATLAS_RECIPE_ID_REGEX.test(recipeId)) {
      throw new Error(`parseAtlasJson: invalid recipeId '${recipeId}'`);
    }
    const atlasX = expectInt(
      spriteRaw["atlasX"],
      `sprites['${slot}'].atlasX`,
      0,
      ATLAS_TILES_WIDE - 1,
    );
    const atlasY = expectInt(
      spriteRaw["atlasY"],
      `sprites['${slot}'].atlasY`,
      0,
      ATLAS_TILES_HIGH - 1,
    );
    const tilesHigh = spriteRaw["tilesHigh"];
    const tilesWide = spriteRaw["tilesWide"];
    if (
      typeof tilesHigh !== "number" ||
      !ALLOWED_TILE_DIMS.has(tilesHigh) ||
      typeof tilesWide !== "number" ||
      !ALLOWED_TILE_DIMS.has(tilesWide)
    ) {
      throw new Error(
        `parseAtlasJson: sprites['${slot}'].tilesWide / tilesHigh must be in {1,2,4}`,
      );
    }
    sprites.set(slot as AtlasSlotId, {
      atlasX,
      atlasY,
      recipeId,
      tilesHigh,
      tilesWide,
    });
  }

  return {
    atlasBinaryHash,
    atlasSeed,
    generator: gen,
    palette,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    sprites,
  };
}
