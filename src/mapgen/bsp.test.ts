import { describe, expect, it } from "vitest";
import { partition, leaves, uniformU32 } from "./bsp";
import { sfc32 } from "../core/prng";
import {
  BSP_MIN_LEAF_HEIGHT,
  BSP_MIN_LEAF_WIDTH,
  BSP_MAX_DEPTH,
} from "./params";

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

describe("BSP partition", () => {
  it("returns a single leaf for a rect smaller than min-leaf-size on both axes", () => {
    const r = sfc32(1, 2, 3, 4);
    const tree = partition(
      { x: 0, y: 0, w: BSP_MIN_LEAF_WIDTH - 1, h: BSP_MIN_LEAF_HEIGHT - 1 },
      r,
    );
    const ls = leaves(tree);
    expect(ls.length).toBe(1);
    expect(ls[0]!.x).toBe(0);
    expect(ls[0]!.y).toBe(0);
  });

  it("returns more than one leaf for a typical 60x24 floor", () => {
    const r = sfc32(0xdead, 0xbeef, 0xcafe, 0xbabe);
    const tree = partition({ x: 0, y: 0, w: 60, h: 24 }, r);
    const ls = leaves(tree);
    expect(ls.length).toBeGreaterThan(2);
    expect(ls.length).toBeLessThanOrEqual(1 << BSP_MAX_DEPTH);
  });

  it("produces leaves that tile the input rect with no gaps and no overlaps", () => {
    const r = sfc32(7, 11, 13, 17);
    const root = { x: 0, y: 0, w: 60, h: 24 };
    const tree = partition(root, r);
    const ls = leaves(tree);
    // No overlaps
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        expect(rectsOverlap(ls[i]!, ls[j]!)).toBe(false);
      }
    }
    // Total area equals root area
    let totalArea = 0;
    for (const l of ls) totalArea += l.w * l.h;
    expect(totalArea).toBe(root.w * root.h);
  });

  it("every leaf has integer coordinates and a positive size", () => {
    const r = sfc32(101, 103, 107, 109);
    const tree = partition({ x: 0, y: 0, w: 60, h: 24 }, r);
    const ls = leaves(tree);
    for (const l of ls) {
      expect(Number.isInteger(l.x)).toBe(true);
      expect(Number.isInteger(l.y)).toBe(true);
      expect(Number.isInteger(l.w)).toBe(true);
      expect(Number.isInteger(l.h)).toBe(true);
      expect(l.w).toBeGreaterThan(0);
      expect(l.h).toBeGreaterThan(0);
    }
  });

  it("is reproducible: same PRNG seed → identical leaf list", () => {
    const r1 = sfc32(1, 2, 3, 4);
    const r2 = sfc32(1, 2, 3, 4);
    const t1 = partition({ x: 0, y: 0, w: 60, h: 24 }, r1);
    const t2 = partition({ x: 0, y: 0, w: 60, h: 24 }, r2);
    const ls1 = leaves(t1);
    const ls2 = leaves(t2);
    expect(ls1).toEqual(ls2);
  });

  it("leaf list traversal is left-then-right, deterministic across runs", () => {
    const r1 = sfc32(99, 99, 99, 99);
    const r2 = sfc32(99, 99, 99, 99);
    const t1 = partition({ x: 0, y: 0, w: 30, h: 12 }, r1);
    const t2 = partition({ x: 0, y: 0, w: 30, h: 12 }, r2);
    expect(leaves(t1)).toEqual(leaves(t2));
  });

  it("respects depth cap: leaf count never exceeds 2^BSP_MAX_DEPTH", () => {
    const r = sfc32(2025, 5, 3, 7);
    const tree = partition({ x: 0, y: 0, w: 200, h: 200 }, r);
    expect(leaves(tree).length).toBeLessThanOrEqual(1 << BSP_MAX_DEPTH);
  });
});

describe("uniformU32", () => {
  it("returns 0 when n === 1", () => {
    const r = sfc32(1, 2, 3, 4);
    expect(uniformU32(r, 1)).toBe(0);
  });

  it("throws on non-positive or non-integer n", () => {
    const r = sfc32(1, 2, 3, 4);
    expect(() => uniformU32(r, 0)).toThrow();
    expect(() => uniformU32(r, -3)).toThrow();
    expect(() => uniformU32(r, 1.5)).toThrow();
  });

  it("rejects out-of-range draws to avoid modulo bias", () => {
    // Construct a PRNG that returns 0xffffffff first (which exceeds
    // any limit not equal to a power of two of the u32 range), then a
    // small value. The function must skip the first and accept the
    // second.
    let i = 0;
    const r: () => number = () => {
      i++;
      if (i === 1) return 0xffffffff;
      return 0;
    };
    expect(uniformU32(r, 7)).toBe(0);
  });

  it("yields a near-uniform distribution over 4 buckets in 1000 draws", () => {
    const r = sfc32(11, 13, 17, 19);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) counts[uniformU32(r, 4)]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(150);
      expect(c).toBeLessThan(350);
    }
  });
});
