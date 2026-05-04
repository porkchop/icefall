import { describe, expect, it } from "vitest";
import { streamsForRun, streamPrng } from "../../src/core/streams";

/**
 * Phase 4.A.2 unit tests for `RunStreams.atlas(recipeId)` (memo decision
 * 1a + frozen-contract item 4 + addendum B8). Per-call invariant: a
 * single `streams.atlas(recipeId)` call advances `__consumed.size` by
 * exactly 1 and records the key `"atlas:" + recipeId`. Repeat calls to
 * the same `recipeId` are Set-deduplicated (advance by 0).
 */

const ROOT = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

describe("streams.atlas — per-call __consumed invariant (addendum B8)", () => {
  it("a single call advances __consumed.size by exactly 1", () => {
    const streams = streamsForRun(ROOT);
    expect(streams.__consumed.size).toBe(0);
    streams.atlas("atlas-recipe.cyberpunk.tile.floor");
    expect(streams.__consumed.size).toBe(1);
    expect(streams.__consumed.has("atlas:atlas-recipe.cyberpunk.tile.floor")).toBe(true);
  });

  it("repeat calls with the same recipeId Set-dedupe (advance by 0)", () => {
    const streams = streamsForRun(ROOT);
    streams.atlas("atlas-recipe.cyberpunk.tile.floor");
    streams.atlas("atlas-recipe.cyberpunk.tile.floor");
    expect(streams.__consumed.size).toBe(1);
  });

  it("distinct recipeIds advance __consumed by 1 each", () => {
    const streams = streamsForRun(ROOT);
    streams.atlas("atlas-recipe.cyberpunk.tile.floor");
    streams.atlas("atlas-recipe.cyberpunk.tile.wall");
    expect(streams.__consumed.size).toBe(2);
    expect(streams.__consumed.has("atlas:atlas-recipe.cyberpunk.tile.floor")).toBe(true);
    expect(streams.__consumed.has("atlas:atlas-recipe.cyberpunk.tile.wall")).toBe(true);
  });
});

describe("streams.atlas — recipeId validation (decision 1a)", () => {
  it("rejects the empty string", () => {
    const streams = streamsForRun(ROOT);
    expect(() => streams.atlas("")).toThrowError(
      /atlas: recipeId must be 7-bit ASCII, 1\.\.64 utf8 bytes/,
    );
  });

  it("rejects > 64 utf8 bytes", () => {
    const streams = streamsForRun(ROOT);
    const big = "a".repeat(65);
    expect(() => streams.atlas(big)).toThrowError(
      /atlas: recipeId must be 7-bit ASCII, 1\.\.64 utf8 bytes \(got 65/,
    );
  });

  it("accepts exactly 64 utf8 bytes (boundary)", () => {
    const streams = streamsForRun(ROOT);
    const ok = "a".repeat(64);
    expect(() => streams.atlas(ok)).not.toThrow();
  });

  it("rejects non-ASCII (multibyte UTF-8)", () => {
    const streams = streamsForRun(ROOT);
    expect(() => streams.atlas("café")).toThrowError(
      /atlas: recipeId must be 7-bit ASCII, 1\.\.64 utf8 bytes/,
    );
  });

  it("rejects a lone UTF-16 surrogate", () => {
    const streams = streamsForRun(ROOT);
    expect(() => streams.atlas("a\uD800b")).toThrowError(
      /atlas: recipeId must be 7-bit ASCII, 1\.\.64 utf8 bytes/,
    );
  });
});

describe("streams.atlas — distinct PRNG outputs (decision 1a)", () => {
  it("distinct recipeIds produce distinct first-PRNG outputs", () => {
    const sa = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const sb = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.wall");
    let collisions = 0;
    for (let i = 0; i < 8; i++) if (sa() === sb()) collisions++;
    expect(collisions).toBeLessThan(4);
  });

  it("same recipeId on the same root → byte-identical PRNG sequence", () => {
    const sa = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const sb = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    for (let i = 0; i < 8; i++) expect(sa()).toBe(sb());
  });

  it("matches streamPrng(root, 'atlas', recipeId) by construction", () => {
    const recipeId = "atlas-recipe.cyberpunk.tile.floor";
    const a = streamsForRun(ROOT).atlas(recipeId);
    const b = streamPrng(ROOT, "atlas", recipeId);
    for (let i = 0; i < 8; i++) expect(a()).toBe(b());
  });
});

describe("streams.atlas — non-collision with sim/mapgen/ui (memo decision 1a)", () => {
  it("byte-distinct from streams.sim()", () => {
    const a = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const b = streamsForRun(ROOT).sim();
    let collisions = 0;
    for (let i = 0; i < 8; i++) if (a() === b()) collisions++;
    expect(collisions).toBeLessThan(4);
  });

  it("byte-distinct from streams.simFloor(N)", () => {
    const a = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const b = streamsForRun(ROOT).simFloor(1);
    let collisions = 0;
    for (let i = 0; i < 8; i++) if (a() === b()) collisions++;
    expect(collisions).toBeLessThan(4);
  });

  it("byte-distinct from streams.mapgen(N)", () => {
    const a = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const b = streamsForRun(ROOT).mapgen(0);
    let collisions = 0;
    for (let i = 0; i < 8; i++) if (a() === b()) collisions++;
    expect(collisions).toBeLessThan(4);
  });

  it("byte-distinct from streams.ui()", () => {
    const a = streamsForRun(ROOT).atlas("atlas-recipe.cyberpunk.tile.floor");
    const b = streamsForRun(ROOT).ui();
    let collisions = 0;
    for (let i = 0; i < 8; i++) if (a() === b()) collisions++;
    expect(collisions).toBeLessThan(4);
  });
});
