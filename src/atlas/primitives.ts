/**
 * Phase 4 frozen-contract item 1 — recipe primitive set (memo decision
 * 1, 1a, addendum N3 + N4).
 *
 * Ten orthogonal pure functions over palette-index buffers and integer
 * inputs. **No floats.** `Math.imul` is the only 32-bit-truncated
 * multiply (a built-in, not a float op; permitted by the
 * `no-float-arithmetic.cjs` lint rule).
 *
 * Buffer convention: row-major, `pixels[y * width + x]`. Mirrors the
 * Phase 2 `Floor.tiles` addressing.
 */

import type { PRNG } from "../core/prng";
import { uniformIndex } from "../core/prng";
import { idiv } from "../core/intmath";
import type { Palette, PaletteColorName } from "./palette";

/* ------------------------------------------------------------------ */
/* 1. paletteIndex                                                    */
/* ------------------------------------------------------------------ */

/**
 * Look up a named palette index. Throws on an unknown name (programmer
 * error — no recipe should reach a missing color).
 */
export function paletteIndex(
  palette: Palette,
  name: PaletteColorName,
): number {
  const idx = palette.names.get(name);
  if (idx === undefined) {
    throw new Error(`paletteIndex: unknown name "${name}" in palette "${palette.id}"`);
  }
  return idx;
}

/* ------------------------------------------------------------------ */
/* 2. paletteSwap                                                     */
/* ------------------------------------------------------------------ */

/**
 * Replace every `from` index with `to`. Pure — returns a new buffer.
 */
export function paletteSwap(
  buf: Uint8Array,
  from: number,
  to: number,
): Uint8Array {
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] === from ? to : buf[i]!;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. paletteGradient (addendum N4)                                   */
/* ------------------------------------------------------------------ */

/**
 * Linear-in-palette-index gradient between two named colors. Output
 * length = `steps`. Uses integer interpolation only:
 *
 *   pixel[i] = (from * (steps - 1 - i) + to * i) / (steps - 1)
 *
 * with integer division (truncation). `steps >= 2` is required;
 * `steps < 2` throws the pinned error per addendum N4.
 */
export function paletteGradient(
  palette: Palette,
  fromName: PaletteColorName,
  toName: PaletteColorName,
  steps: number,
): Uint8Array {
  if (steps < 2) {
    throw new Error(
      `paletteGradient: steps must be >= 2 (got ${steps}); use paletteIndex directly for a single-color result`,
    );
  }
  const from = paletteIndex(palette, fromName);
  const to = paletteIndex(palette, toName);
  const out = new Uint8Array(steps);
  const denom = steps - 1;
  for (let i = 0; i < steps; i++) {
    out[i] = idiv(from * (denom - i) + to * i, denom);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. bayerThreshold                                                  */
/* ------------------------------------------------------------------ */

// 2×2 Bayer (range 0..3): the canonical recursive base case.
// prettier-ignore
const BAYER_2 = new Uint8Array([
  0, 2,
  3, 1,
]);

// 4×4 Bayer (range 0..15) derived from B(n+1) = 4·B(n) + base.
// prettier-ignore
const BAYER_4 = new Uint8Array([
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
]);

// 8×8 Bayer (range 0..63).
// prettier-ignore
const BAYER_8 = new Uint8Array([
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

/**
 * Look up the Bayer-matrix threshold value at `(x, y)` for a 2×2, 4×4,
 * or 8×8 ordered-dither matrix. Coordinates wrap modulo size.
 */
export function bayerThreshold(
  size: 2 | 4 | 8,
  x: number,
  y: number,
): number {
  const m = size === 2 ? BAYER_2 : size === 4 ? BAYER_4 : BAYER_8;
  const xi = ((x % size) + size) % size;
  const yi = ((y % size) + size) % size;
  return m[yi * size + xi]!;
}

/* ------------------------------------------------------------------ */
/* 5. valueNoise2D + hash2D (decision 1a; addendum N3)                */
/* ------------------------------------------------------------------ */

function rotateLeft32(n: number, k: number): number {
  return ((n << k) | (n >>> (32 - k))) >>> 0;
}

/**
 * Wang-hash 32-bit integer mixer pinned by memo decision 1a. Constants
 * `0x1f1f1f1f`, `0x9e3779b1`, `0x45d9f3b`, rotation `13`. `Math.imul`
 * is the only 32-bit-truncated multiply.
 */
export function hash2D(x: number, y: number): number {
  const a = Math.imul(x | 0, 0x1f1f1f1f);
  const b = Math.imul(y | 0, 0x9e3779b1);
  const mixed = (a ^ rotateLeft32(b, 13)) >>> 0;
  return Math.imul(mixed, 0x45d9f3b) >>> 0;
}

/**
 * Integer hash-based 2D value noise; output `[0, 255]`. Consumes
 * **exactly one** `prng.next()` call per invocation (addendum N3).
 *
 *   valueNoise2D(prng, x, y) = ((prng() ^ hash2D(x, y)) & 0xff)
 */
export function valueNoise2D(
  prng: PRNG,
  x: number,
  y: number,
): number {
  const r = prng() >>> 0;
  return (r ^ hash2D(x, y)) & 0xff;
}

/* ------------------------------------------------------------------ */
/* 6. rectMask                                                        */
/* ------------------------------------------------------------------ */

/**
 * Returns a `width × height` 0/1 mask with rectangle
 * `[x0..x1] × [y0..y1]` set to 1 (inclusive endpoints). Pixels outside
 * the canvas are skipped. If `x1 < x0` or `y1 < y0` the range is empty
 * and the mask is all-zero.
 */
export function rectMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  if (x1 < x0 || y1 < y0) return out;
  const xs = x0 < 0 ? 0 : x0;
  const xe = x1 >= width ? width - 1 : x1;
  const ys = y0 < 0 ? 0 : y0;
  const ye = y1 >= height ? height - 1 : y1;
  if (xe < xs || ye < ys) return out;
  for (let y = ys; y <= ye; y++) {
    for (let x = xs; x <= xe; x++) {
      out[y * width + x] = 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 7. circleMask (Bresenham midpoint, filled)                         */
/* ------------------------------------------------------------------ */

/**
 * Returns a `width × height` 0/1 mask of a midpoint-circle (filled
 * disk) of radius `r` centered at `(cx, cy)`. Pure integer arithmetic.
 * Pixels outside the canvas are skipped.
 */
export function circleMask(
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  if (r < 0) return out;
  // Filled-disk via the standard distance-squared test (integer-only).
  const r2 = r * r;
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) {
        out[y * width + x] = 1;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 8. lineMask (Bresenham segment)                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns a `width × height` 0/1 mask of a Bresenham line segment from
 * `(x0, y0)` to `(x1, y1)`. Pixels outside the canvas are skipped.
 */
export function lineMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // Hard cap on iterations as a defensive bound (lint requires no
  // `while (true)` without an obvious termination proof).
  const maxIter = (dx - dy) + 1;
  for (let i = 0; i < maxIter; i++) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      out[y * width + x] = 1;
    }
    if (x === x1 && y === y1) break;
    const e2 = err << 1;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 9. columnShift (glitch effect)                                     */
/* ------------------------------------------------------------------ */

/**
 * For each column, draw a per-column shift in `[0, maxShift]` from
 * `prng` (rejection-sampled per `uniformIndex`) and rotate that column
 * vertically. Returns a new buffer.
 */
export function columnShift(
  buf: Uint8Array,
  width: number,
  height: number,
  prng: PRNG,
  maxShift: number,
): Uint8Array {
  const out = new Uint8Array(buf.length);
  // uniformIndex(prng, n) returns [0, n). We want [0, maxShift] inclusive.
  const n = maxShift + 1;
  for (let x = 0; x < width; x++) {
    const shift = uniformIndex(prng, n);
    for (let y = 0; y < height; y++) {
      const srcY = ((y - shift) % height + height) % height;
      out[y * width + x] = buf[srcY * width + x]!;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 10. scanlineResidue (CRT glitch)                                   */
/* ------------------------------------------------------------------ */

/**
 * For every `period`-th row, replace nonzero (opaque) pixels with the
 * `residueColorName`. Zero pixels (transparent) are preserved so the
 * silhouette outline is not lost.
 */
export function scanlineResidue(
  buf: Uint8Array,
  width: number,
  height: number,
  palette: Palette,
  residueColorName: PaletteColorName,
  period: number,
): Uint8Array {
  if (period < 1) {
    throw new Error(`scanlineResidue: period must be >= 1 (got ${period})`);
  }
  const out = new Uint8Array(buf);
  const residue = paletteIndex(palette, residueColorName);
  for (let y = 0; y < height; y++) {
    if (y % period !== 0) continue;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (buf[i] !== 0) out[i] = residue;
    }
  }
  return out;
}
