import { describe, expect, it } from "vitest";
import {
  placeRecipes,
  type AtlasPlacementEntry,
  type SpritePlacement,
} from "../../src/atlas/layout";
import {
  ATLAS_CELLS,
  ATLAS_TILES_HIGH,
  ATLAS_TILES_WIDE,
} from "../../src/atlas/params";

/**
 * Phase 4 frozen-contract item 6 — atlas-grid placement function (memo
 * decision 3a + addendum N9). Registry-declaration order, row-major,
 * multi-tile rectangles never split, no backfill.
 *
 * Pinned invariant: adding a recipe at the *end* of the registry never
 * moves any earlier recipe's `(atlasX, atlasY)`.
 */

function entry(
  id: string,
  tilesWide: 1 | 2 | 4,
  tilesHigh: 1 | 2 | 4,
): AtlasPlacementEntry {
  return { id, tilesWide, tilesHigh };
}

describe("placeRecipes — empty + single", () => {
  it("placing zero entries returns an empty array", () => {
    expect(placeRecipes([])).toEqual([]);
  });

  it("placing one 1×1 entry puts it at (0, 0)", () => {
    const out = placeRecipes([entry("a", 1, 1)]);
    expect(out).toEqual<SpritePlacement[]>([
      { id: "a", atlasX: 0, atlasY: 0, tilesWide: 1, tilesHigh: 1 },
    ]);
  });
});

describe("placeRecipes — row-major, declaration order, no compaction", () => {
  it("packs 1×1 sprites left-to-right across a row", () => {
    const out = placeRecipes([
      entry("a", 1, 1),
      entry("b", 1, 1),
      entry("c", 1, 1),
    ]);
    expect(out.map((p) => [p.id, p.atlasX, p.atlasY])).toEqual([
      ["a", 0, 0],
      ["b", 1, 0],
      ["c", 2, 0],
    ]);
  });

  it("a 2×1 sprite occupies cols (0..1) on the same row", () => {
    const out = placeRecipes([entry("a", 2, 1)]);
    expect(out[0]!.atlasX).toBe(0);
    expect(out[0]!.atlasY).toBe(0);
    expect(out[0]!.tilesWide).toBe(2);
    expect(out[0]!.tilesHigh).toBe(1);
  });

  it("a 2×2 sprite then a 1×1 sprite places the 1×1 next to the 2×2", () => {
    const out = placeRecipes([entry("big", 2, 2), entry("small", 1, 1)]);
    expect(out[0]!.atlasX).toBe(0);
    expect(out[0]!.atlasY).toBe(0);
    expect(out[1]!.atlasX).toBe(2);
    expect(out[1]!.atlasY).toBe(0);
  });
});

describe("placeRecipes — wrap to next row when current row exhausted", () => {
  it(`wraps after ATLAS_TILES_WIDE 1×1 sprites`, () => {
    const N = ATLAS_TILES_WIDE;
    const entries: AtlasPlacementEntry[] = [];
    for (let i = 0; i < N + 1; i++) entries.push(entry(`e${i}`, 1, 1));
    const out = placeRecipes(entries);
    // Last entry wraps to row 1.
    expect(out[N - 1]!.atlasY).toBe(0);
    expect(out[N - 1]!.atlasX).toBe(N - 1);
    expect(out[N]!.atlasY).toBe(1);
    expect(out[N]!.atlasX).toBe(0);
  });
});

describe("placeRecipes — wrap-with-skip edge case (addendum N9)", () => {
  /**
   * The wrap-with-skip case: after placing N-1 single-tile sprites in
   * a row of width N, a 2-tile-wide sprite cannot fit in the single
   * remaining cell. The placer must wrap to the next row, leaving the
   * tail cell of the previous row empty (transparent).
   */
  it("a 2-wide sprite that cannot fit on the current row wraps to the next row", () => {
    const N = ATLAS_TILES_WIDE;
    const entries: AtlasPlacementEntry[] = [];
    // Fill all but the last column of row 0 with 1×1.
    for (let i = 0; i < N - 1; i++) entries.push(entry(`fill${i}`, 1, 1));
    // The next entry is 2-wide and can NOT fit in column N-1.
    entries.push(entry("wide", 2, 1));
    const out = placeRecipes(entries);
    // The 2-wide sprite must land at row 1, col 0 (skipping col N-1 of row 0).
    const widePlacement = out.find((p) => p.id === "wide")!;
    expect(widePlacement.atlasY).toBe(1);
    expect(widePlacement.atlasX).toBe(0);
    // The pre-existing 1×1s on row 0 keep their slots (no compaction).
    expect(out[N - 2]!.atlasY).toBe(0);
    expect(out[N - 2]!.atlasX).toBe(N - 2);
  });
});

describe("placeRecipes — coordinate stability under additive growth", () => {
  it("removing the last entry leaves earlier coordinates unchanged", () => {
    const base: AtlasPlacementEntry[] = [
      entry("a", 1, 1),
      entry("b", 2, 1),
      entry("c", 1, 2),
      entry("d", 2, 2),
    ];
    const fullOut = placeRecipes(base);
    const trimmedOut = placeRecipes(base.slice(0, -1));
    for (let i = 0; i < trimmedOut.length; i++) {
      expect(trimmedOut[i]).toEqual(fullOut[i]);
    }
  });
});

describe("placeRecipes — hardcoded golden coordinate map (12-entry mixed)", () => {
  it("places the 12-entry decision-3a fixture deterministically", () => {
    const out = placeRecipes([
      entry("a-1x1", 1, 1),
      entry("b-1x1", 1, 1),
      entry("c-2x1", 2, 1),
      entry("d-1x2", 1, 2),
      entry("e-1x1", 1, 1),
      entry("f-2x2", 2, 2),
      entry("g-1x1", 1, 1),
      entry("h-2x1", 2, 1),
      entry("i-1x1", 1, 1),
      entry("j-1x1", 1, 1),
      entry("k-1x1", 1, 1),
      entry("l-1x1", 1, 1),
    ]);
    // Walk through the algorithm:
    //   row 0: a(0,0), b(1,0), c(2-3,0), d(4,0..1), e(5,0), f(6-7,0..1),
    //          g(8,0), h(9-10,0), i(11,0), j(12,0), k(13,0), l(14,0)
    expect(out.map((p) => `${p.id}@(${p.atlasX},${p.atlasY})`)).toEqual([
      "a-1x1@(0,0)",
      "b-1x1@(1,0)",
      "c-2x1@(2,0)",
      "d-1x2@(4,0)",
      "e-1x1@(5,0)",
      "f-2x2@(6,0)",
      "g-1x1@(8,0)",
      "h-2x1@(9,0)",
      "i-1x1@(11,0)",
      "j-1x1@(12,0)",
      "k-1x1@(13,0)",
      "l-1x1@(14,0)",
    ]);
  });
});

describe("placeRecipes — overflow throws with the pinned message", () => {
  it("registry that exceeds the cell budget throws", () => {
    // Pack ATLAS_TILES_WIDE * ATLAS_TILES_HIGH 1×1 sprites — fills the
    // grid exactly. One more 1×1 must overflow.
    const entries: AtlasPlacementEntry[] = [];
    for (let i = 0; i < ATLAS_TILES_WIDE * ATLAS_TILES_HIGH; i++) {
      entries.push(entry(`fill${i}`, 1, 1));
    }
    entries.push(entry("overflow", 1, 1));
    expect(() => placeRecipes(entries)).toThrowError(
      `atlas: registry exceeds atlas grid (got ${entries.length}, max ${ATLAS_CELLS})`,
    );
  });
});
