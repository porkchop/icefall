import { describe, expect, it } from "vitest";
import { sfc32, uniformIndex } from "../../src/core/prng";

/**
 * Focused unit tests for `uniformIndex` after its Phase 4.A.1 relocation
 * from `src/sim/run.ts` to `src/core/prng.ts`. The Phase 4 atlas pipeline
 * needs the same primitive in `src/atlas/**` for palette and glyph
 * variant selection; `core/` is the right home (peer of `sfc32`).
 *
 * Coverage of the original sim-side rejection-sampling test surface
 * lives at `tests/sim/run.test.ts`; this file owns the focused
 * termination, distribution, boundary, and error-path assertions.
 */
describe("uniformIndex (core/prng) — relocation focused tests", () => {
  // ---- Termination ----------------------------------------------------
  describe("termination", () => {
    it("terminates on n=1 immediately (no rejection branch reachable)", () => {
      // For n=1 the rejection threshold collapses to 0 and the result
      // is always 0, but the function must still consume one PRNG draw.
      const r = sfc32(1, 2, 3, 4);
      for (let i = 0; i < 10; i++) {
        expect(uniformIndex(r, 1)).toBe(0);
      }
    });

    it("terminates on a power-of-two n with exactly one PRNG draw", () => {
      // For n that exactly divides 2^32 (n=2,4,...) the rejection
      // threshold tail is 0 and no draw is rejected.
      const a = sfc32(1, 2, 3, 4);
      const b = sfc32(1, 2, 3, 4);
      for (let i = 0; i < 100; i++) {
        const v = uniformIndex(a, 4);
        const expected = b() % 4;
        expect(v).toBe(expected);
      }
    });

    it("terminates on a non-power-of-two n (rejection branch reachable)", () => {
      // n=7 has a non-zero rejection tail; the loop must terminate
      // within a small bounded number of iterations with overwhelming
      // probability. We just exercise it many times and check no hang.
      const r = sfc32(0xdeadbeef, 0x12345678, 0xcafebabe, 0x0badf00d);
      for (let i = 0; i < 10_000; i++) {
        const v = uniformIndex(r, 7);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(7);
      }
    });

    it("terminates with a fixture PRNG that emits high-end values (rejection branch)", () => {
      // Construct a PRNG that initially emits values just above the
      // rejection threshold (`m`), forcing the re-draw loop to execute
      // at least once. For n=3, `tail = ((0xFFFFFFFF % 3) + 1) % 3 = 1`
      // so `m = 0xFFFFFFFE`; an initial `0xFFFFFFFF` must be rejected,
      // and the next draw must be accepted. 0xFFFFFFFE % 3 = 2.
      const queue = [0xffffffff, 0xfffffffe, 0x00000000];
      let i = 0;
      const fakePrng = (): number => queue[i++ % queue.length]!;
      expect(uniformIndex(fakePrng, 3)).toBe(2);
      // The rejection-branch counter advanced past index 0 → 1; a
      // second invocation that draws 0x00000000 returns 0.
      expect(uniformIndex(fakePrng, 3)).toBe(0);
    });
  });

  // ---- Distribution (chi-square-style histogram) ----------------------
  describe("unbiased distribution", () => {
    it("produces a roughly uniform histogram over 60_000 draws of n=10", () => {
      // Expected frequency per bucket: 6000. Chi-square with 9 df has
      // critical value ~27.88 at p=0.001, ~21.67 at p=0.01. The PRNG
      // is deterministic and the seed is pinned, so this test is
      // either always-pass or always-fail (no flakes).
      const r = sfc32(0xa1b2c3d4, 0x55aa55aa, 0x12340000, 0xfeedface);
      const counts = new Array<number>(10).fill(0);
      const N = 60_000;
      for (let i = 0; i < N; i++) {
        const v = uniformIndex(r, 10);
        counts[v] = counts[v]! + 1;
      }
      const expected = N / 10;
      let chi = 0;
      for (let k = 0; k < 10; k++) {
        const diff = counts[k]! - expected;
        // Integer-only arithmetic: square via Math.imul, then divide as
        // a final scalar (test-side, no determinism rule applies).
        chi += (diff * diff) / expected;
      }
      // Loose threshold (p ~ 0.001 for df=9 is ~27.88). With a pinned
      // seed the value is fixed; the threshold guards against silent
      // breakage of `uniformIndex` modulo bias.
      expect(chi).toBeLessThan(28);
    });

    it("produces a roughly uniform histogram over 70_000 draws of n=7 (non-power-of-two)", () => {
      // n=7 exercises the rejection-sampling branch the most.
      const r = sfc32(0x01010101, 0x02020202, 0x03030303, 0x04040404);
      const counts = new Array<number>(7).fill(0);
      const N = 70_000;
      for (let i = 0; i < N; i++) {
        const v = uniformIndex(r, 7);
        counts[v] = counts[v]! + 1;
      }
      const expected = N / 7;
      let chi = 0;
      for (let k = 0; k < 7; k++) {
        const diff = counts[k]! - expected;
        chi += (diff * diff) / expected;
      }
      // df=6, p~0.001 critical value ~22.46.
      expect(chi).toBeLessThan(23);
    });
  });

  // ---- n=1 boundary ---------------------------------------------------
  describe("n=1 boundary", () => {
    it("always returns 0 for n=1", () => {
      const r = sfc32(7, 8, 9, 10);
      for (let i = 0; i < 1000; i++) expect(uniformIndex(r, 1)).toBe(0);
    });
  });

  // ---- Error path: non-positive / non-integer -------------------------
  describe("error path — non-positive / non-integer n", () => {
    const r = sfc32(1, 2, 3, 4);

    it("throws on n=0", () => {
      expect(() => uniformIndex(r, 0)).toThrowError(
        /uniformIndex: n must be positive integer \(got 0\)/,
      );
    });

    it("throws on negative n", () => {
      expect(() => uniformIndex(r, -1)).toThrowError(
        /uniformIndex: n must be positive integer \(got -1\)/,
      );
      expect(() => uniformIndex(r, -1000)).toThrowError(
        /uniformIndex: n must be positive integer/,
      );
    });

    it("throws on non-integer n", () => {
      expect(() => uniformIndex(r, 1.5)).toThrowError(
        /uniformIndex: n must be positive integer \(got 1\.5\)/,
      );
      expect(() => uniformIndex(r, 0.5)).toThrowError(/positive integer/);
      expect(() => uniformIndex(r, Math.PI)).toThrowError(/positive integer/);
    });

    it("throws on NaN / Infinity", () => {
      expect(() => uniformIndex(r, Number.NaN)).toThrowError(/positive integer/);
      expect(() => uniformIndex(r, Number.POSITIVE_INFINITY)).toThrowError(
        /positive integer/,
      );
    });
  });
});
