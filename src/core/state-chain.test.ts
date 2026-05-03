import { describe, expect, it } from "vitest";
import { genesis, advance } from "./state-chain";
import { sha256Hex } from "./hash";

describe("genesis", () => {
  it("is 32 bytes", () => {
    expect(genesis().length).toBe(32);
  });

  it("is deterministic", () => {
    expect(sha256Hex(genesis())).toBe(sha256Hex(genesis()));
  });

  it("matches a hardcoded golden digest", () => {
    expect(sha256Hex(genesis())).toBe(
      "4a995768f847051972cb7d792df8726bb0dc864458ef45eb2a4409fe8f0b0f67",
    );
  });

  it("returns a fresh array each call (defensive copy)", () => {
    const g1 = genesis();
    g1[0] = 0xff;
    const g2 = genesis();
    expect(g2[0]).not.toBe(0xff);
  });
});

describe("advance", () => {
  it("returns a 32-byte successor", () => {
    expect(advance(genesis(), { type: "wait" }).length).toBe(32);
  });

  it("is deterministic", () => {
    const a = advance(genesis(), { type: "move", dir: 1 });
    const b = advance(genesis(), { type: "move", dir: 1 });
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("is sensitive to action contents", () => {
    const a = advance(genesis(), { type: "move", dir: 1 });
    const b = advance(genesis(), { type: "move", dir: 2 });
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  it("is order-sensitive", () => {
    const A = { type: "move", dir: 1 } as const;
    const B = { type: "move", dir: 2 } as const;
    const ab = advance(advance(genesis(), A), B);
    const ba = advance(advance(genesis(), B), A);
    expect(sha256Hex(ab)).not.toBe(sha256Hex(ba));
  });

  it("the same action from the same state always yields the same successor", () => {
    const s0 = genesis();
    const s1a = advance(s0, { type: "wait" });
    const s1b = advance(s0, { type: "wait" });
    expect(sha256Hex(s1a)).toBe(sha256Hex(s1b));
  });

  it("rejects state of wrong length", () => {
    expect(() => advance(new Uint8Array(31), { type: "x" })).toThrowError(/32/);
    expect(() => advance(new Uint8Array(33), { type: "x" })).toThrowError(/32/);
  });

  it("matches a hardcoded golden digest after a fixed action sequence", () => {
    let s = genesis();
    s = advance(s, { type: "move", dir: 0 });
    s = advance(s, { type: "move", dir: 1 });
    s = advance(s, { type: "use", item: "stim" });
    s = advance(s, { type: "attack", target: 42 });
    expect(sha256Hex(s)).toBe(
      "d4d87f1028abbd81e41e9be2606e2de42438c7ebbfcf7c8e7a54cd7042110f22",
    );
  });
});
