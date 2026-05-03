import { sha256, utf8 } from "./hash";

/**
 * Map a user-facing seed string to a 32-byte root seed. Frozen contract 12.
 *
 *   seedToBytes(seed) = sha256(utf8(seed))
 *
 * This normalizes input length to 32 bytes regardless of seed-string size
 * and is the single function mapgen, the diagnostic page, and the CLI all
 * call before passing entropy into `streamsForRun`. See
 * `artifacts/decision-memo-phase-2.md` addendum N2.
 */
export function seedToBytes(seed: string): Uint8Array {
  return sha256(utf8(seed));
}
