import { describe, expect, it } from "vitest";
import {
  CYBERPUNK_NEON_V1,
  PALETTE_NAMES,
  type PaletteColorName,
} from "../../src/atlas/palette";

/**
 * Phase 4 frozen-contract item 8 (memo decision 5). The 16-entry
 * indexed palette: entry 0 is fully transparent, entries 1..15 are
 * fully opaque. No partial alpha. Palette ID `cyberpunk-neon-v1`.
 *
 * Per-entry RGB values are pinned in `src/atlas/palette.ts` and any
 * change is a `rulesetVersion` bump. The test catches accidental
 * shape-changes (length, alpha rule, transparency-slot rule).
 */

describe("CYBERPUNK_NEON_V1 palette shape", () => {
  it("has palette id 'cyberpunk-neon-v1'", () => {
    expect(CYBERPUNK_NEON_V1.id).toBe("cyberpunk-neon-v1");
  });

  it("contains exactly 16 entries", () => {
    expect(CYBERPUNK_NEON_V1.colors.length).toBe(16);
  });

  it("entry 0 is fully transparent ({r:0, g:0, b:0, a:0})", () => {
    const c = CYBERPUNK_NEON_V1.colors[0]!;
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("entries 1..15 are fully opaque (a===255)", () => {
    for (let i = 1; i < 16; i++) {
      const c = CYBERPUNK_NEON_V1.colors[i]!;
      expect(c.a).toBe(255);
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(255);
      expect(c.g).toBeGreaterThanOrEqual(0);
      expect(c.g).toBeLessThanOrEqual(255);
      expect(c.b).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeLessThanOrEqual(255);
    }
  });
});

describe("PALETTE_NAMES — named lookup table", () => {
  it("maps 'transparent' → 0", () => {
    expect(CYBERPUNK_NEON_V1.names.get("transparent")).toBe(0);
  });

  it("contains every named color expected by Phase 4 recipes", () => {
    const required: PaletteColorName[] = [
      "transparent",
      "neon-cyan",
      "neon-magenta",
      "neon-yellow",
      "neon-green",
      "deep-blue",
      "deep-purple",
      "dark-grey",
    ];
    for (const name of required) {
      const idx = CYBERPUNK_NEON_V1.names.get(name);
      expect(idx).toBeDefined();
      expect(idx!).toBeGreaterThanOrEqual(0);
      expect(idx!).toBeLessThan(16);
    }
  });

  it("re-exports the same Map under PALETTE_NAMES (helper symbol)", () => {
    expect(PALETTE_NAMES).toBe(CYBERPUNK_NEON_V1.names);
  });

  it("named indices are unique (no two names point at the same slot)", () => {
    const seen = new Set<number>();
    for (const idx of CYBERPUNK_NEON_V1.names.values()) {
      expect(seen.has(idx)).toBe(false);
      seen.add(idx);
    }
  });

  it("every named index is in [0, 15]", () => {
    for (const idx of CYBERPUNK_NEON_V1.names.values()) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(16);
    }
  });
});
