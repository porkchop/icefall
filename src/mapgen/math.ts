/**
 * Integer arithmetic helpers used throughout `src/mapgen/`.
 *
 * The `no-float-arithmetic` lint rule bans the `/` operator entirely, even
 * the `(a/b)|0` idiom. These helpers implement integer division and
 * modulus without ever invoking JavaScript's `/` — they use the standard
 * unsigned-binary long-division algorithm, which keeps every intermediate
 * value an integer.
 *
 * Both inputs must be non-negative integers in the safe int32 range; the
 * divisor must be positive. Out-of-range inputs throw rather than
 * silently producing a non-integer.
 */

function checkOperand(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: not an integer (${value})`);
  }
  if (value < 0) {
    throw new Error(`${label}: negative (${value})`);
  }
  if (value > 0x7fffffff) {
    throw new Error(`${label}: out of int32 range (${value})`);
  }
}

/**
 * Floor integer division of two non-negative integers. Throws on zero
 * divisor or out-of-range inputs.
 */
export function idiv(a: number, b: number): number {
  checkOperand(a, "idiv: dividend");
  if (!Number.isInteger(b) || b <= 0 || b > 0x7fffffff) {
    throw new Error(`idiv: divisor must be a positive int32 (got ${b})`);
  }
  let q = 0;
  let r = 0;
  for (let i = 31; i >= 0; i--) {
    r = ((r << 1) | ((a >>> i) & 1)) >>> 0;
    if (r >= b) {
      r = (r - b) >>> 0;
      q = (q | (1 << i)) >>> 0;
    }
  }
  // q fits in 31 bits because dividend fits in 31 bits.
  return q | 0;
}

/**
 * Non-negative integer modulus. Throws on zero divisor or out-of-range
 * inputs.
 */
export function imod(a: number, b: number): number {
  checkOperand(a, "imod: dividend");
  if (!Number.isInteger(b) || b <= 0 || b > 0x7fffffff) {
    throw new Error(`imod: divisor must be a positive int32 (got ${b})`);
  }
  return a % b;
}
