import { describe, expect, it } from "vitest";
import {
  ATLAS_SEED_DOMAIN_TEXT,
  atlasSeedToBytes,
  validateSeedString,
} from "../../src/atlas/seed";
import { seedToBytes } from "../../src/core/seed";
import { sha256, sha256Hex, utf8, concat } from "../../src/core/hash";

/**
 * Phase 4.A.1 unit tests for `atlasSeedToBytes` (addendum B7) and
 * `validateSeedString` (red-team follow-up N19).
 */

describe("ATLAS_SEED_DOMAIN_TEXT", () => {
  it("is the pinned 22-byte ASCII anchor", () => {
    expect(ATLAS_SEED_DOMAIN_TEXT).toBe("icefall:atlas-seed:v1:");
    expect(utf8(ATLAS_SEED_DOMAIN_TEXT).length).toBe(22);
    // Each byte must be 7-bit ASCII (no multibyte sequences).
    for (const b of utf8(ATLAS_SEED_DOMAIN_TEXT)) {
      expect(b).toBeLessThan(0x80);
    }
  });

  it("matches the byte-for-byte ASCII pin in addendum B7 test 3", () => {
    // 0x69 0x63 0x65 0x66 0x61 0x6c 0x6c 0x3a 0x61 0x74 0x6c 0x61
    // 0x73 0x2d 0x73 0x65 0x65 0x64 0x3a 0x76 0x31 0x3a
    expect([...utf8(ATLAS_SEED_DOMAIN_TEXT)]).toEqual([
      0x69, 0x63, 0x65, 0x66, 0x61, 0x6c, 0x6c, 0x3a, 0x61, 0x74, 0x6c, 0x61,
      0x73, 0x2d, 0x73, 0x65, 0x65, 0x64, 0x3a, 0x76, 0x31, 0x3a,
    ]);
  });
});

describe("atlasSeedToBytes — determinism and shape", () => {
  it("returns 32 bytes", () => {
    expect(atlasSeedToBytes("hello").length).toBe(32);
  });

  it("same input → same output", () => {
    const a = sha256Hex(atlasSeedToBytes("ATLAS_SEED_DEFAULT"));
    const b = sha256Hex(atlasSeedToBytes("ATLAS_SEED_DEFAULT"));
    expect(a).toBe(b);
  });

  it("different inputs → different outputs", () => {
    const a = sha256Hex(atlasSeedToBytes("variant-A"));
    const b = sha256Hex(atlasSeedToBytes("variant-B"));
    expect(a).not.toBe(b);
  });
});

describe("atlasSeedToBytes — pre-image format (addendum B7)", () => {
  it("matches sha256(utf8(domain) || utf8(seed)) for a non-trivial input", () => {
    const seed = "test";
    const expected = sha256Hex(
      sha256(concat([utf8(ATLAS_SEED_DOMAIN_TEXT), utf8(seed)])),
    );
    expect(sha256Hex(atlasSeedToBytes(seed))).toBe(expected);
  });

  it("the pre-image starts with the 22-byte 'icefall:atlas-seed:v1:' anchor", () => {
    // We re-derive the pre-image bytes here and check the prefix —
    // this is what the addendum's regression test 3 asserts.
    const seed = "test";
    const preImage = concat([utf8(ATLAS_SEED_DOMAIN_TEXT), utf8(seed)]);
    expect([...preImage.subarray(0, 22)]).toEqual([
      0x69, 0x63, 0x65, 0x66, 0x61, 0x6c, 0x6c, 0x3a, 0x61, 0x74, 0x6c, 0x61,
      0x73, 0x2d, 0x73, 0x65, 0x65, 0x64, 0x3a, 0x76, 0x31, 0x3a,
    ]);
  });
});

describe("atlasSeedToBytes vs seedToBytes — domain separation (addendum B7)", () => {
  it("produces a byte-distinct result from seedToBytes for ATLAS_SEED_DEFAULT", () => {
    const x = "ATLAS_SEED_DEFAULT";
    expect(sha256Hex(atlasSeedToBytes(x))).not.toBe(sha256Hex(seedToBytes(x)));
  });

  it("collision-free across a battery of inputs", () => {
    for (const x of ["a", "abc", "icefall", "  ", "x".repeat(100)]) {
      expect(sha256Hex(atlasSeedToBytes(x))).not.toBe(
        sha256Hex(seedToBytes(x)),
      );
    }
  });
});

describe("validateSeedString — preconditions (red-team follow-up N19)", () => {
  it("accepts a non-empty ASCII string", () => {
    expect(() => validateSeedString("hello")).not.toThrow();
    expect(() => validateSeedString("a")).not.toThrow();
    expect(() => validateSeedString("x".repeat(255))).not.toThrow();
  });

  it("accepts a multibyte UTF-8 string within the 255-byte limit", () => {
    // `é` is 2 bytes in UTF-8.
    expect(() => validateSeedString("café")).not.toThrow();
  });

  it("rejects the empty string (UTF-8 byte length < 1)", () => {
    expect(() => validateSeedString("")).toThrowError(/byte length must be 1\.\.255/);
  });

  it("rejects strings whose UTF-8 byte length exceeds 255", () => {
    expect(() => validateSeedString("x".repeat(256))).toThrowError(
      /byte length must be 1\.\.255 \(got 256\)/,
    );
  });

  it("rejects a lone high surrogate (UTF-16 well-formedness)", () => {
    expect(() => validateSeedString("\uD800")).toThrowError(
      /unpaired UTF-16 surrogate/,
    );
    expect(() => validateSeedString("a\uD800b")).toThrowError(
      /unpaired UTF-16 surrogate/,
    );
  });

  it("rejects a lone low surrogate", () => {
    expect(() => validateSeedString("\uDC00")).toThrowError(
      /unpaired UTF-16 surrogate/,
    );
  });

  it("accepts a properly-paired surrogate (real emoji code point)", () => {
    // U+1F600 GRINNING FACE = surrogate pair D83D DE00. Well-formed.
    expect(() => validateSeedString("😀")).not.toThrow();
  });

  it("atlasSeedToBytes propagates the validation error class", () => {
    expect(() => atlasSeedToBytes("")).toThrowError(/byte length must be 1\.\.255/);
    expect(() => atlasSeedToBytes("x".repeat(256))).toThrowError(
      /byte length must be 1\.\.255/,
    );
    expect(() => atlasSeedToBytes("\uD800")).toThrowError(
      /unpaired UTF-16 surrogate/,
    );
  });
});
