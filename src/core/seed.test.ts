import { describe, expect, it } from "vitest";
import { seedToBytes } from "./seed";
import { sha256, sha256Hex, utf8 } from "./hash";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

describe("seedToBytes (frozen contract 12)", () => {
  it("returns 32 bytes for any input", () => {
    expect(seedToBytes("").length).toBe(32);
    expect(seedToBytes("a").length).toBe(32);
    expect(seedToBytes("a".repeat(10000)).length).toBe(32);
  });

  it("equals sha256(utf8(seed))", () => {
    const seed = "diagnostic-sample";
    expect(sha256Hex(seedToBytes(seed))).toBe(
      sha256Hex(sha256(utf8(seed))),
    );
  });

  it("is deterministic", () => {
    expect(sha256Hex(seedToBytes("foo"))).toBe(sha256Hex(seedToBytes("foo")));
  });

  it("differs across distinct seeds", () => {
    expect(sha256Hex(seedToBytes("foo"))).not.toBe(
      sha256Hex(seedToBytes("bar")),
    );
  });

  it("matches a hardcoded golden digest for the diagnostic seed", () => {
    // Pinned independently of the implementation: this is sha256 of the
    // UTF-8 bytes of "diagnostic-sample", computed externally. If
    // seedToBytes ever drifts from sha256(utf8(...)), this test fails
    // even if the equation-based test elsewhere still passes.
    expect(toHex(seedToBytes("diagnostic-sample"))).toBe(
      "4a56dbf8d49965ca89ae3ce2ebdb74258109ae7c12ab4ec38caf43e314eb86ff",
    );
  });

  it("uses byte length, not codepoint length, for non-ASCII seeds", () => {
    const a = sha256Hex(seedToBytes("💩"));
    const b = sha256Hex(sha256(new Uint8Array([0xf0, 0x9f, 0x92, 0xa9])));
    expect(a).toBe(b);
  });
});
