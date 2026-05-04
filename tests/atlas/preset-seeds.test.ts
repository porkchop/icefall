import { describe, expect, it } from "vitest";
import { ATLAS_PRESET_SEEDS } from "../../src/atlas/preset-seeds";
import { generateAtlas } from "../../src/atlas/generate";
import { sha256Hex } from "../../src/core/hash";

/**
 * Phase 4 preset-seed golden hashes (addendum N12). Each preset's
 * `expectedHash` MUST equal `sha256Hex(generateAtlas(seed).png)`.
 * Bumping any value requires architecture-red-team review.
 */

describe("ATLAS_PRESET_SEEDS — golden expectedHash assertions", () => {
  for (const p of ATLAS_PRESET_SEEDS) {
    it(`${p.id} (seed=${JSON.stringify(p.seed)}) → ${p.expectedHash}`, () => {
      const { png } = generateAtlas(p.seed);
      expect(sha256Hex(png)).toBe(p.expectedHash);
    });
  }
});

describe("ATLAS_PRESET_SEEDS — shape", () => {
  it("ships exactly four presets", () => {
    expect(ATLAS_PRESET_SEEDS.length).toBe(4);
  });

  it("has the canonical id list", () => {
    expect(ATLAS_PRESET_SEEDS.map((p) => p.id)).toEqual([
      "placeholder",
      "variant-A",
      "variant-B",
      "variant-C",
    ]);
  });

  it("every expectedHash is 64-char lowercase hex", () => {
    for (const p of ATLAS_PRESET_SEEDS) {
      expect(p.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("expectedHash values are all distinct (no two seeds map to the same atlas)", () => {
    const set = new Set(ATLAS_PRESET_SEEDS.map((p) => p.expectedHash));
    expect(set.size).toBe(ATLAS_PRESET_SEEDS.length);
  });
});
