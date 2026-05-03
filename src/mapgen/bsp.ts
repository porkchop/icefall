/**
 * BSP partitioning. Recursively splits a rectangle along an alternating
 * axis at an integer split position drawn from the supplied PRNG. Stops
 * when both axes are below the min-leaf size or when the depth cap is
 * reached.
 *
 * The function is **deterministic from the PRNG** — every random choice
 * routes through `prng()`. No `Math.random`, no time-based input, no
 * floating-point arithmetic.
 *
 * Helpers receive the PRNG by parameter; nothing in this file looks at
 * `RunStreams` directly. Stream isolation is enforced at the
 * `generateFloor` boundary, not here. (memo decision 7 + 7a)
 */

import type { PRNG } from "../core/prng";
import type { Rect } from "./types";
import {
  BSP_MIN_LEAF_WIDTH,
  BSP_MIN_LEAF_HEIGHT,
  BSP_MAX_DEPTH,
} from "./params";

export type BspNode =
  | { readonly kind: "leaf"; readonly rect: Rect }
  | {
      readonly kind: "split";
      readonly rect: Rect;
      readonly axis: "x" | "y";
      readonly splitAt: number;
      readonly left: BspNode;
      readonly right: BspNode;
    };

/**
 * Partition `root` into a BSP tree. The PRNG is consulted to pick the
 * split axis (when both are eligible) and the split position.
 */
export function partition(root: Rect, prng: PRNG): BspNode {
  return partitionAt(root, prng, 0, "x");
}

function partitionAt(
  rect: Rect,
  prng: PRNG,
  depth: number,
  preferredAxis: "x" | "y",
): BspNode {
  const canSplitX = rect.w >= BSP_MIN_LEAF_WIDTH * 2;
  const canSplitY = rect.h >= BSP_MIN_LEAF_HEIGHT * 2;

  if (depth >= BSP_MAX_DEPTH || (!canSplitX && !canSplitY)) {
    return { kind: "leaf", rect };
  }

  // Pick an axis. Prefer the axis specified by the caller (alternating
  // through the recursion) but fall back to the only one available.
  let axis: "x" | "y";
  if (canSplitX && canSplitY) {
    // Alternate by depth and inject one PRNG bit so the layout has
    // some variability without losing determinism.
    const bit = prng() & 1;
    axis = bit === 0 ? preferredAxis : preferredAxis === "x" ? "y" : "x";
  } else if (canSplitX) {
    axis = "x";
  } else {
    axis = "y";
  }

  const min = axis === "x" ? BSP_MIN_LEAF_WIDTH : BSP_MIN_LEAF_HEIGHT;
  const span = axis === "x" ? rect.w : rect.h;
  const range = span - min - min;
  // Draw an offset uniformly in 0..range inclusive using PRNG bits.
  const offset = uniformU32(prng, range + 1);
  const splitAt = min + offset;

  const leftRect: Rect =
    axis === "x"
      ? { x: rect.x, y: rect.y, w: splitAt, h: rect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: splitAt };
  const rightRect: Rect =
    axis === "x"
      ? { x: rect.x + splitAt, y: rect.y, w: rect.w - splitAt, h: rect.h }
      : { x: rect.x, y: rect.y + splitAt, w: rect.w, h: rect.h - splitAt };

  const nextAxis: "x" | "y" = axis === "x" ? "y" : "x";
  const left = partitionAt(leftRect, prng, depth + 1, nextAxis);
  const right = partitionAt(rightRect, prng, depth + 1, nextAxis);
  return { kind: "split", rect, axis, splitAt, left, right };
}

/**
 * Sample a non-negative integer uniformly in `[0, n)` from a u32 PRNG
 * stream. Uses rejection on the upper end of the u32 range to keep the
 * distribution exactly uniform — no float division involved.
 */
export function uniformU32(prng: PRNG, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`uniformU32: n must be a positive integer (got ${n})`);
  }
  if (n === 1) return 0;
  // Largest multiple of n that fits in 2^32. We reject draws above this
  // to avoid a modulo bias.
  const u32 = 0x100000000;
  const limit = u32 - (u32 % n);
  while (true) {
    const v = prng() >>> 0;
    if (v < limit) return v % n;
  }
}

/**
 * In-order leaf traversal. The order is stable across runs because the
 * tree is built deterministically and the traversal is left-then-right.
 */
export function leaves(tree: BspNode): Rect[] {
  const out: Rect[] = [];
  walk(tree, out);
  return out;
}

function walk(node: BspNode, out: Rect[]): void {
  if (node.kind === "leaf") {
    out.push(node.rect);
  } else {
    walk(node.left, out);
    walk(node.right, out);
  }
}

