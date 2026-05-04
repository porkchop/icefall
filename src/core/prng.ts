export type PRNG = () => number;

/**
 * sfc32 — small fast counter PRNG. 128-bit state, period ≥ 2^32 with
 * average 2^127, passes PractRand to multi-TB. Standard reference:
 * http://pracrand.sourceforge.net/RNG_engines.txt
 *
 * Returns an unsigned 32-bit integer per call.
 */
export function sfc32(a: number, b: number, c: number, d: number): PRNG {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return function next(): number {
    const t = (((s0 + s1) >>> 0) + s3) >>> 0;
    s3 = (s3 + 1) >>> 0;
    s0 = (s1 ^ (s1 >>> 9)) >>> 0;
    s1 = (s2 + (s2 << 3)) >>> 0;
    s2 = ((s2 << 21) | (s2 >>> 11)) >>> 0;
    s2 = (s2 + t) >>> 0;
    return t;
  };
}

/**
 * Seed an sfc32 from the first 16 bytes of a Uint8Array, treated as
 * four little-endian u32s. Throws if the input is shorter than 16
 * bytes.
 */
export function sfc32FromBytes(bytes: Uint8Array): PRNG {
  if (bytes.length < 16) {
    throw new Error(`sfc32FromBytes: need ≥16 bytes, got ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
  const a = view.getUint32(0, true);
  const b = view.getUint32(4, true);
  const c = view.getUint32(8, true);
  const d = view.getUint32(12, true);
  return sfc32(a, b, c, d);
}

/**
 * Drive a PRNG `n` times and return the values as a Uint32Array.
 */
export function drawN(prng: PRNG, n: number): Uint32Array {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = prng();
  return out;
}

/**
 * Rejection-sampled uniform integer in `[0, n)`. Integer-only — no
 * `Math.floor`, no `/`. The largest u32 with `(m + 1)` divisible by
 * `n` is `m = 0xFFFFFFFF - tail` where
 * `tail = ((0xFFFFFFFF % n) + 1) % n`.
 *
 * For `n` ≤ ~10 the rejection probability is < 1e-8 per draw; for
 * non-power-of-two `n` it's bounded by `n / 2^32`.
 *
 * Originated in `src/sim/run.ts` (Phase 3) and was relocated to
 * `src/core/prng.ts` in Phase 4.A.1 because the atlas pipeline needs
 * the same primitive in `src/atlas/**` recipe code paths (palette and
 * glyph variant selection). `core/` is the right home — peer of
 * `sfc32`, no upward layer dependencies.
 */
export function uniformIndex(prng: PRNG, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`uniformIndex: n must be positive integer (got ${n})`);
  }
  const tail = ((0xffffffff % n) + 1) % n;
  const m = (0xffffffff - tail) >>> 0;
  let r = prng() >>> 0;
  while (r > m) r = prng() >>> 0;
  return r % n;
}
