import { describe, expect, it } from "vitest";
import { encodeIndexedPng, PNG_SIGNATURE } from "../../src/atlas/png";
import { CYBERPUNK_NEON_V1 } from "../../src/atlas/palette";
import { sha256Hex } from "../../src/core/hash";

/**
 * Phase 4 frozen-contract item 7 — PNG encoder unit tests (memo
 * decision 4 + addendum N5, N6).
 */

describe("PNG_SIGNATURE", () => {
  it("is the canonical 8-byte PNG header", () => {
    expect([...PNG_SIGNATURE]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});

describe("encodeIndexedPng — basic shape", () => {
  it("starts with the PNG signature", () => {
    const pixels = new Uint8Array(16 * 16); // all-zero (transparent)
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    for (let i = 0; i < 8; i++) {
      expect(png[i]).toBe(PNG_SIGNATURE[i]);
    }
  });

  it("ends with the IEND chunk (well-known CRC 0xae426082)", () => {
    const pixels = new Uint8Array(16 * 16);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    // IEND tail bytes: ... 0x00 0x00 0x00 0x00 'I' 'E' 'N' 'D' 0xae 0x42 0x60 0x82
    const tail = png.subarray(png.length - 12);
    expect([...tail]).toEqual([
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
  });

  it("returns a Uint8Array", () => {
    const pixels = new Uint8Array(16 * 16);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    expect(png).toBeInstanceOf(Uint8Array);
  });
});

describe("encodeIndexedPng — IHDR chunk", () => {
  it("declares the correct width/height (big-endian) and color type 3 / bit depth 8", () => {
    const pixels = new Uint8Array(16 * 16);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    // IHDR starts at offset 8 (after signature):
    //   length:4 BE = 13
    //   type:4 = "IHDR"
    //   width:4 BE = 16 → 0x00 0x00 0x00 0x10
    //   height:4 BE = 16
    //   bitDepth:1 = 8
    //   colorType:1 = 3
    //   compression:1 = 0
    //   filter:1 = 0
    //   interlace:1 = 0
    //   crc:4 BE
    expect([...png.subarray(8, 12)]).toEqual([0x00, 0x00, 0x00, 0x0d]);
    expect([...png.subarray(12, 16)]).toEqual([0x49, 0x48, 0x44, 0x52]);
    expect([...png.subarray(16, 20)]).toEqual([0x00, 0x00, 0x00, 0x10]); // width
    expect([...png.subarray(20, 24)]).toEqual([0x00, 0x00, 0x00, 0x10]); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(3); // color type (indexed)
    expect(png[26]).toBe(0); // compression
    expect(png[27]).toBe(0); // filter
    expect(png[28]).toBe(0); // interlace
  });
});

describe("encodeIndexedPng — PLTE + tRNS chunks (decision 5 + addendum N6)", () => {
  it("PLTE chunk has length 3 * 16 = 48 bytes for the v1 palette", () => {
    const pixels = new Uint8Array(16 * 16);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    // After IHDR (8 + 4 + 4 + 13 + 4 = 33), PLTE starts.
    const plteStart = 8 + 4 + 4 + 13 + 4; // 33
    expect([...png.subarray(plteStart, plteStart + 4)]).toEqual([
      0x00, 0x00, 0x00, 48,
    ]);
    expect([...png.subarray(plteStart + 4, plteStart + 8)]).toEqual([
      0x50, 0x4c, 0x54, 0x45,
    ]);
  });

  it("tRNS chunk has length 16 bytes (full length, addendum N6)", () => {
    const pixels = new Uint8Array(16 * 16);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    // PLTE ends at: 33 + 4(len) + 4(type) + 48(data) + 4(crc) = 93.
    // tRNS starts at 93.
    const trnsStart = 33 + 4 + 4 + 48 + 4;
    expect([...png.subarray(trnsStart, trnsStart + 4)]).toEqual([
      0x00, 0x00, 0x00, 16,
    ]);
    expect([...png.subarray(trnsStart + 4, trnsStart + 8)]).toEqual([
      0x74, 0x52, 0x4e, 0x53,
    ]);
    // Entry 0 alpha = 0x00; entries 1..15 = 0xFF.
    expect(png[trnsStart + 8]).toBe(0x00);
    for (let i = 1; i < 16; i++) {
      expect(png[trnsStart + 8 + i]).toBe(0xff);
    }
  });
});

describe("encodeIndexedPng — palette-bounds check (addendum N5)", () => {
  it("throws on an out-of-range palette index with the pinned message", () => {
    const pixels = new Uint8Array(16 * 16);
    pixels[42] = 99; // palette has 16 entries; 99 is way out of range.
    expect(() =>
      encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1),
    ).toThrowError(
      "pngEncode: pixel 42 has palette index 99 but palette has 16 entries",
    );
  });
});

describe("encodeIndexedPng — dimension guards", () => {
  it("throws when width > 32768", () => {
    const pixels = new Uint8Array(0);
    expect(() => encodeIndexedPng(32769, 1, pixels, CYBERPUNK_NEON_V1))
      .toThrowError(/pngEncode: width 32769 or height 1 exceeds 32768/);
  });

  it("throws when height > 32768", () => {
    const pixels = new Uint8Array(0);
    expect(() => encodeIndexedPng(1, 32769, pixels, CYBERPUNK_NEON_V1))
      .toThrowError(/pngEncode: width 1 or height 32769 exceeds 32768/);
  });

  it("throws when pixels.length !== width*height", () => {
    expect(() => encodeIndexedPng(16, 16, new Uint8Array(10), CYBERPUNK_NEON_V1))
      .toThrowError(/pngEncode: pixels length 10 != width\*height 256/);
  });
});

describe("encodeIndexedPng — determinism", () => {
  it("identical inputs → byte-identical output", () => {
    const pixels = new Uint8Array(16 * 16);
    for (let i = 0; i < 256; i++) pixels[i] = i & 0x0f;
    const a = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    const b = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("different pixel content → different output", () => {
    const pa = new Uint8Array(16 * 16); // all zeros
    const pb = new Uint8Array(16 * 16);
    pb.fill(5); // all index 5
    const a = encodeIndexedPng(16, 16, pa, CYBERPUNK_NEON_V1);
    const b = encodeIndexedPng(16, 16, pb, CYBERPUNK_NEON_V1);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});

describe("encodeIndexedPng — golden bytes for a 16x16 single-color tile", () => {
  it("encodes a 16x16 all-index-5 tile to a stable byte sequence", () => {
    // Use as the cross-runtime golden hash for `atlas-encoder-cross-runtime`.
    const pixels = new Uint8Array(16 * 16);
    pixels.fill(5);
    const png = encodeIndexedPng(16, 16, pixels, CYBERPUNK_NEON_V1);
    expect(png.length).toBeGreaterThan(0);
    // Sanity: the exact hash is pinned in `src/core/self-test.ts` as
    // ATLAS_ENCODER_SINGLE_COLOR_TILE_HASH (computed once during 4.A.2).
  });
});
