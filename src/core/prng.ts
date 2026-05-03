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
