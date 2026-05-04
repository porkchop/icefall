import { describe, expect, it } from "vitest";
import { sfc32 } from "../../src/core/prng";
import { CYBERPUNK_NEON_V1 } from "../../src/atlas/palette";
import {
  bayerThreshold,
  circleMask,
  columnShift,
  hash2D,
  lineMask,
  paletteGradient,
  paletteIndex,
  paletteSwap,
  rectMask,
  scanlineResidue,
  valueNoise2D,
} from "../../src/atlas/primitives";

/**
 * Phase 4 frozen-contract item 1 — primitive set unit tests (memo
 * decisions 1, 1a + addendum N3, N4). Each primitive is integer-only,
 * pure, and has hardcoded golden expectations to catch silent drift.
 */

const PALETTE = CYBERPUNK_NEON_V1;

describe("paletteIndex", () => {
  it("looks up a named palette index", () => {
    expect(paletteIndex(PALETTE, "transparent")).toBe(0);
    expect(paletteIndex(PALETTE, "neon-cyan")).toBe(7);
  });

  it("throws on an unknown name", () => {
    // @ts-expect-error — testing the runtime error path
    expect(() => paletteIndex(PALETTE, "no-such-color")).toThrowError(
      /paletteIndex: unknown name/,
    );
  });
});

describe("paletteSwap", () => {
  it("replaces every `from` index with `to`, leaves others alone", () => {
    const buf = new Uint8Array([0, 1, 2, 1, 0, 1]);
    const out = paletteSwap(buf, 1, 5);
    expect([...out]).toEqual([0, 5, 2, 5, 0, 5]);
  });

  it("returns a new buffer (does not mutate input)", () => {
    const buf = new Uint8Array([0, 1, 0]);
    const out = paletteSwap(buf, 1, 7);
    expect([...buf]).toEqual([0, 1, 0]);
    expect([...out]).toEqual([0, 7, 0]);
    expect(out).not.toBe(buf);
  });
});

describe("paletteGradient (addendum N4)", () => {
  it("steps=2 yields [from, to]", () => {
    expect([...paletteGradient(PALETTE, "void-black", "neon-cyan", 2)]).toEqual([
      1, 7,
    ]);
  });

  it("steps=3 yields a 3-element gradient", () => {
    const g = paletteGradient(PALETTE, "void-black", "neon-cyan", 3);
    expect(g.length).toBe(3);
    expect(g[0]).toBe(1);
    expect(g[2]).toBe(7);
    // Middle entry uses integer interpolation: (1*1 + 7*1) / 2 = 4
    expect(g[1]).toBe(4);
  });

  it("throws on steps=0 with the pinned message", () => {
    expect(() =>
      paletteGradient(PALETTE, "void-black", "neon-cyan", 0),
    ).toThrowError(
      "paletteGradient: steps must be >= 2 (got 0); use paletteIndex directly for a single-color result",
    );
  });

  it("throws on steps=1 with the pinned message", () => {
    expect(() =>
      paletteGradient(PALETTE, "void-black", "neon-cyan", 1),
    ).toThrowError(
      "paletteGradient: steps must be >= 2 (got 1); use paletteIndex directly for a single-color result",
    );
  });

  it("returns a Uint8Array", () => {
    const g = paletteGradient(PALETTE, "void-black", "neon-cyan", 4);
    expect(g).toBeInstanceOf(Uint8Array);
  });
});

describe("bayerThreshold", () => {
  it("size=2 yields the canonical 2x2 Bayer matrix", () => {
    // Canonical 2×2 Bayer (range 0..3): [[0,2],[3,1]]
    expect(bayerThreshold(2, 0, 0)).toBe(0);
    expect(bayerThreshold(2, 1, 0)).toBe(2);
    expect(bayerThreshold(2, 0, 1)).toBe(3);
    expect(bayerThreshold(2, 1, 1)).toBe(1);
  });

  it("size=4 yields values in [0, 15]", () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = bayerThreshold(4, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(16);
      }
    }
  });

  it("size=8 yields values in [0, 63]", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = bayerThreshold(8, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(64);
      }
    }
  });

  it("wraps coordinates modulo size", () => {
    expect(bayerThreshold(2, 2, 2)).toBe(bayerThreshold(2, 0, 0));
    expect(bayerThreshold(4, 5, 7)).toBe(bayerThreshold(4, 1, 3));
  });
});

describe("hash2D — Wang-hash mixer (memo decision 1a)", () => {
  it("is deterministic", () => {
    expect(hash2D(5, 7)).toBe(hash2D(5, 7));
  });

  it("(0, 0) is byte-distinct from (1, 0)", () => {
    expect(hash2D(0, 0)).not.toBe(hash2D(1, 0));
  });

  it("(x, y) is u32 range", () => {
    const v = hash2D(123, 456);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("valueNoise2D (addendum N3)", () => {
  it("consumes exactly one prng() call per invocation", () => {
    const r1 = sfc32(1, 2, 3, 4);
    const r2 = sfc32(1, 2, 3, 4);
    valueNoise2D(r1, 5, 7);
    // r2 advances one step manually — should now be aligned with r1.
    r2();
    expect(r1()).toBe(r2());
  });

  it("returns a u8 (0..255)", () => {
    const r = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 32; i++) {
      const v = valueNoise2D(r, i, i * 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("is deterministic from (prng-state, x, y)", () => {
    const r1 = sfc32(1, 2, 3, 4);
    const r2 = sfc32(1, 2, 3, 4);
    expect(valueNoise2D(r1, 5, 7)).toBe(valueNoise2D(r2, 5, 7));
  });

  it("differs at distinct (x, y) — same prng state", () => {
    const r1 = sfc32(7, 7, 7, 7);
    const r2 = sfc32(7, 7, 7, 7);
    const a = valueNoise2D(r1, 0, 0);
    const b = valueNoise2D(r2, 0, 1);
    expect(a).not.toBe(b);
  });
});

describe("rectMask", () => {
  it("returns a width*height buffer with the rect set to 1", () => {
    const m = rectMask(4, 3, 1, 0, 2, 1);
    expect(m.length).toBe(12);
    // Layout (y,x):
    //  (0,0)=0 (0,1)=1 (0,2)=1 (0,3)=0
    //  (1,0)=0 (1,1)=1 (1,2)=1 (1,3)=0
    //  (2,0)=0 (2,1)=0 (2,2)=0 (2,3)=0
    expect([...m]).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("clamps to bounds", () => {
    const m = rectMask(2, 2, -10, -10, 100, 100);
    expect([...m]).toEqual([1, 1, 1, 1]);
  });

  it("empty rect (x1<x0 or y1<y0) returns all zeros", () => {
    const m = rectMask(3, 3, 2, 2, 0, 0);
    expect([...m]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("after clipping, an out-of-bounds rect (xs > xe or ys > ye) returns all zeros", () => {
    // x0=5..x1=8 on a width=3 canvas → clipped xs=5, xe=2 → xe<xs → bail.
    const m = rectMask(3, 3, 5, 0, 8, 2);
    expect([...m]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Mirror for y axis: y0=5..y1=8 on a height=3 canvas → clipped ys=5, ye=2 → bail.
    const m2 = rectMask(3, 3, 0, 5, 2, 8);
    expect([...m2]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("circleMask (Bresenham midpoint)", () => {
  it("r=0 sets only the center pixel", () => {
    const m = circleMask(3, 3, 1, 1, 0);
    expect([...m]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it("r=1 sets a 5-pixel plus pattern at the cardinal points + interior", () => {
    const m = circleMask(5, 5, 2, 2, 1);
    // r=1 fills a small disk: a 3x3 plus-shape minimum.
    expect(m[2 * 5 + 2]).toBe(1); // center
    expect(m[1 * 5 + 2]).toBe(1); // up
    expect(m[3 * 5 + 2]).toBe(1); // down
    expect(m[2 * 5 + 1]).toBe(1); // left
    expect(m[2 * 5 + 3]).toBe(1); // right
  });

  it("returns 0 for pixels outside the circle", () => {
    const m = circleMask(5, 5, 2, 2, 1);
    // corners must be 0 for r=1
    expect(m[0]).toBe(0);
    expect(m[4]).toBe(0);
    expect(m[20]).toBe(0);
    expect(m[24]).toBe(0);
  });

  it("clips to bounds when partly off-canvas", () => {
    const m = circleMask(3, 3, 0, 0, 2);
    // Center (0,0) and adjacent pixels must be set.
    expect(m[0]).toBe(1);
  });

  it("r < 0 returns an all-zero mask", () => {
    const m = circleMask(3, 3, 1, 1, -1);
    expect([...m]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("lineMask (Bresenham segment)", () => {
  it("a horizontal line lights the row", () => {
    const m = lineMask(5, 3, 0, 1, 4, 1);
    expect([...m]).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("a vertical line lights the column", () => {
    const m = lineMask(3, 4, 1, 0, 1, 3);
    expect([...m]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  });

  it("a diagonal lights the diagonal", () => {
    const m = lineMask(4, 4, 0, 0, 3, 3);
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
  });

  it("a single point (x0=x1, y0=y1) lights only that pixel", () => {
    const m = lineMask(3, 3, 1, 1, 1, 1);
    expect([...m]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });
});

describe("columnShift (glitch)", () => {
  it("returns a buffer of the same shape", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const r = sfc32(1, 2, 3, 4);
    const out = columnShift(buf, 3, 2, r, 1);
    expect(out.length).toBe(6);
  });

  it("maxShift=0 leaves the buffer unchanged", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const r = sfc32(1, 2, 3, 4);
    const out = columnShift(buf, 3, 2, r, 0);
    expect([...out]).toEqual([...buf]);
  });

  it("a vertical column rotation preserves the multiset of column values", () => {
    const buf = new Uint8Array([
      1, 2, 3, // y=0
      4, 5, 6, // y=1
      7, 8, 9, // y=2
    ]);
    const r = sfc32(0xdead, 0xbeef, 0xcafe, 0xbabe);
    const out = columnShift(buf, 3, 3, r, 2);
    // Each column's values must be a rotation of the original.
    for (let x = 0; x < 3; x++) {
      const orig = [buf[x]!, buf[3 + x]!, buf[6 + x]!].sort();
      const next = [out[x]!, out[3 + x]!, out[6 + x]!].sort();
      expect(next).toEqual(orig);
    }
  });
});

describe("scanlineResidue (CRT glitch)", () => {
  it("period=2 replaces every 2nd row's nonzero pixels (rows 0, 2, ...)", () => {
    const buf = new Uint8Array([
      1, 2, 3, // y=0 ← replaced (nonzero)
      4, 5, 6, // y=1
      7, 8, 9, // y=2 ← replaced (nonzero)
      0, 1, 0, // y=3
    ]);
    const out = scanlineResidue(buf, 3, 4, PALETTE, "neon-yellow", 2);
    const yellow = paletteIndex(PALETTE, "neon-yellow");
    expect([...out]).toEqual([
      yellow, yellow, yellow,
      4, 5, 6,
      yellow, yellow, yellow,
      0, 1, 0,
    ]);
  });

  it("zero pixels are NOT replaced (preserves transparency)", () => {
    const buf = new Uint8Array([0, 0, 0, 1, 1, 1]);
    const out = scanlineResidue(buf, 3, 2, PALETTE, "neon-yellow", 1);
    const yellow = paletteIndex(PALETTE, "neon-yellow");
    // period=1 → every row replaced; but zero pixels stay zero.
    expect([...out]).toEqual([0, 0, 0, yellow, yellow, yellow]);
    // Re-check the zero-preservation rule on a mixed fixture.
    const buf2 = new Uint8Array([0, 1, 0, 0, 1, 0]);
    const out2 = scanlineResidue(buf2, 3, 2, PALETTE, "neon-yellow", 1);
    expect([...out2]).toEqual([0, yellow, 0, 0, yellow, 0]);
  });

  it("throws on period < 1", () => {
    const buf = new Uint8Array(4);
    expect(() => scanlineResidue(buf, 2, 2, PALETTE, "neon-yellow", 0))
      .toThrowError(/scanlineResidue: period must be >= 1/);
  });
});
