import { describe, expect, it } from "vitest";
import { crc32 } from "../../src/atlas/png-crc";

/**
 * Phase 4 frozen-contract item 7 — PNG CRC-32 (IEEE 802.3 polynomial
 * `0xedb88320`, little-endian-poly, big-endian-emitted-on-wire). The
 * CRC table is built lazily on first use. Pinned reference vectors
 * from the PNG spec / ITU V.42 / common test corpora.
 */

describe("crc32", () => {
  it("empty input → 0x00000000", () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  });

  it("'IHDR' header bytes alone (PNG signature precondition)", () => {
    // CRC-32 of the 4 ASCII bytes "IHDR" (0x49 0x48 0x44 0x52).
    // Verified against the standard PNG spec test vectors.
    const ihdr = new Uint8Array([0x49, 0x48, 0x44, 0x52]);
    expect(crc32(ihdr) >>> 0).toBe(0xa8a1ae0a);
  });

  it("'IEND' chunk's well-known CRC is 0xae426082", () => {
    // The IEND chunk has type "IEND" and zero data length, so the CRC
    // is computed over the 4 ASCII bytes "IEND" alone.
    const iend = new Uint8Array([0x49, 0x45, 0x4e, 0x44]);
    expect(crc32(iend) >>> 0).toBe(0xae426082);
  });

  it("'123456789' (canonical CRC-32 ITU-T V.42 test vector)", () => {
    const data = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(crc32(data) >>> 0).toBe(0xcbf43926);
  });

  it("is deterministic on identical inputs", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(crc32(a)).toBe(crc32(a));
  });

  it("differs on a one-byte change", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(crc32(a)).not.toBe(crc32(b));
  });
});
