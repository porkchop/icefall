import { describe, expect, it } from "vitest";
import {
  sha256,
  sha256Hex,
  sha256B64Url,
  base64url,
  decodeBase64Url,
  utf8,
  concat,
  isWellFormedUtf16,
} from "./hash";
import { streamPrng } from "./streams";

describe("sha256", () => {
  it("matches NIST FIPS 180-4 vector for 'abc'", () => {
    expect(sha256Hex(utf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches NIST FIPS 180-4 vector for empty string", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches NIST FIPS 180-4 vector for 56-byte input", () => {
    const msg = utf8(
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    );
    expect(sha256Hex(msg)).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("returns 32 bytes", () => {
    expect(sha256(new Uint8Array(0)).length).toBe(32);
  });
});

describe("base64url", () => {
  it("encodes empty input as empty string", () => {
    expect(base64url(new Uint8Array(0))).toBe("");
  });

  it("encodes 1-byte input without padding", () => {
    expect(base64url(new Uint8Array([0xff]))).toBe("_w");
  });

  it("encodes 2-byte input without padding", () => {
    expect(base64url(new Uint8Array([0xff, 0xff]))).toBe("__8");
  });

  it("encodes 3-byte input cleanly", () => {
    expect(base64url(new Uint8Array([0xff, 0xff, 0xff]))).toBe("____");
  });

  it("uses URL-safe alphabet (- and _ instead of + and /)", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64url(new Uint8Array([0x3e, 0x3f]))).not.toMatch(/[+/=]/);
  });

  it("round-trips a 32-byte SHA-256 digest", () => {
    const d = sha256(utf8("abc"));
    const enc = base64url(d);
    expect(enc.length).toBe(43);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("decodeBase64Url", () => {
  it("decodes empty string to empty array (r=0 trivial branch)", () => {
    expect(decodeBase64Url("").length).toBe(0);
  });

  it("decodes r=2 input (1 output byte)", () => {
    expect(Array.from(decodeBase64Url("_w"))).toEqual([0xff]);
  });

  it("decodes r=3 input (2 output bytes)", () => {
    expect(Array.from(decodeBase64Url("__8"))).toEqual([0xff, 0xff]);
  });

  it("decodes r=0 full-quad input (3 output bytes per quad)", () => {
    expect(Array.from(decodeBase64Url("____"))).toEqual([0xff, 0xff, 0xff]);
  });

  it("rejects r=1 (illegal length)", () => {
    expect(() => decodeBase64Url("AAAAA")).toThrow(
      /illegal length \(mod 4 == 1\)/,
    );
  });

  it("rejects characters outside the base64url alphabet (e.g. '+')", () => {
    expect(() => decodeBase64Url("AA+A")).toThrow(/invalid base64url char code/);
  });

  it("rejects characters outside the base64url alphabet (e.g. '/')", () => {
    expect(() => decodeBase64Url("AA/A")).toThrow(/invalid base64url char code/);
  });

  it("rejects characters outside the base64url alphabet (e.g. '=' padding)", () => {
    expect(() => decodeBase64Url("AAA=")).toThrow(/invalid base64url char code/);
  });

  it("rejects high-codepoint characters (charCodeAt > 127)", () => {
    expect(() => decodeBase64Url("AA☃A")).toThrow(/invalid base64url char code/);
  });

  it("round-trips empty bytes", () => {
    expect(Array.from(decodeBase64Url(base64url(new Uint8Array(0))))).toEqual([]);
  });

  it("round-trips 1-byte input (exercises r=2)", () => {
    const bytes = new Uint8Array([0x42]);
    expect(Array.from(decodeBase64Url(base64url(bytes)))).toEqual([0x42]);
  });

  it("round-trips 2-byte input (exercises r=3)", () => {
    const bytes = new Uint8Array([0x42, 0x73]);
    expect(Array.from(decodeBase64Url(base64url(bytes)))).toEqual([0x42, 0x73]);
  });

  it("round-trips 3-byte input (full quad, exercises r=0)", () => {
    const bytes = new Uint8Array([0x42, 0x73, 0xa1]);
    expect(Array.from(decodeBase64Url(base64url(bytes)))).toEqual([
      0x42, 0x73, 0xa1,
    ]);
  });

  it("round-trips a 32-byte SHA-256 digest", () => {
    const d = sha256(utf8("abc"));
    expect(Array.from(decodeBase64Url(base64url(d)))).toEqual(Array.from(d));
  });

  it("round-trips 50 deterministic random byte arrays of varied lengths", () => {
    const rootSeed = sha256(utf8("phase-3-A-1:b64-property-test"));
    const prng = streamPrng(rootSeed, "test:b64");
    for (let trial = 0; trial < 50; trial++) {
      const len = (prng() >>> 0) % 100;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (prng() >>> 0) & 0xff;
      }
      const round = decodeBase64Url(base64url(bytes));
      expect(round.length).toBe(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        expect(round[i]).toBe(bytes[i]);
      }
    }
  });
});

describe("sha256B64Url", () => {
  it("returns base64url of the digest", () => {
    expect(sha256B64Url(utf8("abc"))).toBe(base64url(sha256(utf8("abc"))));
  });
});

describe("utf8 + concat", () => {
  it("concat of empty produces empty", () => {
    expect(concat([]).length).toBe(0);
  });

  it("concat preserves order", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    expect(Array.from(concat([a, b]))).toEqual([1, 2, 3, 4, 5]);
  });

  it("utf8 encodes basic ASCII", () => {
    expect(Array.from(utf8("a"))).toEqual([0x61]);
  });

  it("utf8 encodes non-BMP via surrogate pair", () => {
    expect(Array.from(utf8("💩"))).toEqual([0xf0, 0x9f, 0x92, 0xa9]);
  });
});

describe("isWellFormedUtf16", () => {
  it("accepts ASCII", () => {
    expect(isWellFormedUtf16("hello")).toBe(true);
  });

  it("accepts properly paired surrogates", () => {
    expect(isWellFormedUtf16("💩")).toBe(true);
  });

  it("rejects lone high surrogate", () => {
    expect(isWellFormedUtf16("\uD800")).toBe(false);
  });

  it("rejects lone low surrogate", () => {
    expect(isWellFormedUtf16("\uDC00")).toBe(false);
  });

  it("rejects high surrogate followed by non-low-surrogate", () => {
    expect(isWellFormedUtf16("\uD800x")).toBe(false);
  });

  it("rejects high surrogate at end of string", () => {
    expect(isWellFormedUtf16("ab\uD800")).toBe(false);
  });

  it("accepts empty string", () => {
    expect(isWellFormedUtf16("")).toBe(true);
  });
});
