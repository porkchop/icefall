import { describe, expect, it } from "vitest";
import {
  sha256,
  sha256Hex,
  sha256B64Url,
  base64url,
  utf8,
  concat,
  isWellFormedUtf16,
} from "./hash";

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
