/**
 * Phase 4 minimal indexed-PNG encoder (memo decision 4 + addendum N5,
 * N6, B4). Targets PNG color type 3, bit depth 8, single filter type
 * (None=0) on every scanline. Chunk order is fixed:
 *   IHDR, PLTE, tRNS, IDAT, IEND.
 * No ancillary chunks (no `gAMA`, no `sRGB`, no `cHRM`, no `pHYs`, no
 * `tEXt`, no `tIME`).
 *
 * Uses `Uint8Array` only — no `Buffer`, no `Buffer.concat`. Compression
 * is `fflate.zlibSync` at `level: 1` (deterministic; same bytes across
 * Node, Chromium, Firefox, WebKit per memo decision 4 + addendum-2).
 *
 * Per addendum N5 the encoder asserts `pixels[i] < palette.colors.length`
 * for every pixel before emitting IDAT; violation throws the pinned
 * error. Per addendum N6 the `tRNS` chunk is **always** the full
 * `paletteCount` bytes (16 entries for the v1 palette).
 */

import { zlibSync } from "fflate";
import type { Palette } from "./palette";
import { crc32 } from "./png-crc";

/** PNG file signature. */
export const PNG_SIGNATURE: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const TYPE_IHDR = new Uint8Array([0x49, 0x48, 0x44, 0x52]); // "IHDR"
const TYPE_PLTE = new Uint8Array([0x50, 0x4c, 0x54, 0x45]); // "PLTE"
const TYPE_TRNS = new Uint8Array([0x74, 0x52, 0x4e, 0x53]); // "tRNS"
const TYPE_IDAT = new Uint8Array([0x49, 0x44, 0x41, 0x54]); // "IDAT"
const TYPE_IEND = new Uint8Array([0x49, 0x45, 0x4e, 0x44]); // "IEND"

const MAX_DIM = 32768; // 2^15

function writeU32BE(dst: Uint8Array, off: number, val: number): void {
  dst[off] = (val >>> 24) & 0xff;
  dst[off + 1] = (val >>> 16) & 0xff;
  dst[off + 2] = (val >>> 8) & 0xff;
  dst[off + 3] = val & 0xff;
}

/**
 * Build one PNG chunk: `[length:4 BE][type:4][data:N][crc:4 BE]`. The
 * CRC is computed over `type ‖ data` per the PNG spec.
 */
function makeChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4);
  writeU32BE(out, 0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  // CRC over type + data.
  const tmp = new Uint8Array(type.length + data.length);
  tmp.set(type, 0);
  tmp.set(data, type.length);
  writeU32BE(out, 8 + data.length, crc32(tmp));
  return out;
}

/**
 * Encode a paletted-PNG (color type 3) for the given pixel buffer.
 *
 * - `width × height` pixels, row-major (`pixels[y * width + x]`).
 * - `palette.colors` may have ≤ 256 entries; each pixel index must be
 *   `< palette.colors.length` (addendum N5).
 * - The `tRNS` chunk emits exactly `palette.colors.length` bytes — the
 *   spec-allowed truncation is forbidden (addendum N6).
 *
 * Returns the complete PNG byte stream as a fresh `Uint8Array`.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  pixels: Uint8Array,
  palette: Palette,
): Uint8Array {
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new Error(
      `pngEncode: width ${width} or height ${height} exceeds ${MAX_DIM}`,
    );
  }
  const expected = width * height;
  if (pixels.length !== expected) {
    throw new Error(
      `pngEncode: pixels length ${pixels.length} != width*height ${expected}`,
    );
  }
  // Per-pixel palette-bounds check (addendum N5). Throws on the first
  // out-of-range pixel with the pinned error format.
  const paletteCount = palette.colors.length;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]!;
    if (v >= paletteCount) {
      throw new Error(
        `pngEncode: pixel ${i} has palette index ${v} but palette has ${paletteCount} entries`,
      );
    }
  }

  // ---------- IHDR ----------
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type (indexed)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method
  const ihdrChunk = makeChunk(TYPE_IHDR, ihdr);

  // ---------- PLTE ----------
  // 3 bytes per palette entry: r, g, b. Alpha goes into tRNS.
  const plteData = new Uint8Array(paletteCount * 3);
  for (let i = 0; i < paletteCount; i++) {
    const c = palette.colors[i]!;
    plteData[i * 3] = c.r;
    plteData[i * 3 + 1] = c.g;
    plteData[i * 3 + 2] = c.b;
  }
  const plteChunk = makeChunk(TYPE_PLTE, plteData);

  // ---------- tRNS (full length per addendum N6) ----------
  const trnsData = new Uint8Array(paletteCount);
  for (let i = 0; i < paletteCount; i++) {
    trnsData[i] = palette.colors[i]!.a;
  }
  const trnsChunk = makeChunk(TYPE_TRNS, trnsData);

  // ---------- IDAT ----------
  // Filter type 0 ("None") on every scanline; just prepend a 0x00 byte
  // before each row of pixel bytes.
  const filtered = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const dstOff = y * (1 + width);
    filtered[dstOff] = 0; // filter byte
    filtered.set(pixels.subarray(y * width, (y + 1) * width), dstOff + 1);
  }
  // zlibSync produces a zlib container around DEFLATE bytes (CMF/FLG
  // header + adler32 trailer) — exactly what the PNG IDAT requires.
  const compressed = zlibSync(filtered, { level: 1 });
  const idatChunk = makeChunk(TYPE_IDAT, compressed);

  // ---------- IEND ----------
  const iendChunk = makeChunk(TYPE_IEND, new Uint8Array(0));

  // ---------- assemble ----------
  const total =
    PNG_SIGNATURE.length +
    ihdrChunk.length +
    plteChunk.length +
    trnsChunk.length +
    idatChunk.length +
    iendChunk.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(PNG_SIGNATURE, off);
  off += PNG_SIGNATURE.length;
  png.set(ihdrChunk, off);
  off += ihdrChunk.length;
  png.set(plteChunk, off);
  off += plteChunk.length;
  png.set(trnsChunk, off);
  off += trnsChunk.length;
  png.set(idatChunk, off);
  off += idatChunk.length;
  png.set(iendChunk, off);
  return png;
}
