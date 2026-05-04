import { describe, expect, it } from "vitest";
import {
  ATLAS_PIXEL_HEIGHT,
  ATLAS_PIXEL_WIDTH,
  ATLAS_SEED_DEFAULT,
  ATLAS_TILES_HIGH,
  ATLAS_TILES_WIDE,
  TILE_PADDING,
  TILE_SIZE,
} from "../../src/atlas/params";

/**
 * Phase 4 frozen-contract item 5 (memo decision 3 + addendum B6). The
 * tile-grid constants are byte-load-bearing — any bump is binary-
 * unstable and requires architecture-red-team review at a
 * `rulesetVersion` boundary. The test is the trip-wire that forces the
 * review.
 */

describe("atlas layout constants (frozen-contract item 5)", () => {
  it("TILE_SIZE is 16", () => {
    expect(TILE_SIZE).toBe(16);
  });

  it("TILE_PADDING is 1", () => {
    expect(TILE_PADDING).toBe(1);
  });

  it("ATLAS_TILES_WIDE is 16", () => {
    expect(ATLAS_TILES_WIDE).toBe(16);
  });

  it("ATLAS_TILES_HIGH is 8", () => {
    expect(ATLAS_TILES_HIGH).toBe(8);
  });

  it("ATLAS_PIXEL_WIDTH = 272 (16 * (16 + 1))", () => {
    expect(ATLAS_PIXEL_WIDTH).toBe(272);
    expect(ATLAS_PIXEL_WIDTH).toBe(ATLAS_TILES_WIDE * (TILE_SIZE + TILE_PADDING));
  });

  it("ATLAS_PIXEL_HEIGHT = 136 (8 * (16 + 1))", () => {
    expect(ATLAS_PIXEL_HEIGHT).toBe(136);
    expect(ATLAS_PIXEL_HEIGHT).toBe(ATLAS_TILES_HIGH * (TILE_SIZE + TILE_PADDING));
  });
});

describe("ATLAS_SEED_DEFAULT (memo decision 8)", () => {
  it("is the pinned placeholder string", () => {
    expect(ATLAS_SEED_DEFAULT).toBe("icefall-phase4-placeholder-atlas-seed");
  });
});
