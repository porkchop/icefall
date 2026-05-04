import { sha256, utf8, concat, isWellFormedUtf16 } from "../core/hash";

/**
 * Domain anchor for atlas seeds. 22 bytes, fixed ASCII literal.
 *
 * Frozen contract — Phase 4 addendum B7. The anchor byte-distinguishes
 * `atlasSeedToBytes(X)` from Phase 2's `seedToBytes(X)` for every input
 * `X`: the two pre-images differ in length (+22 bytes) AND in leading
 * bytes (the anchor). Mirrors Phase 1's `STREAM_DOMAIN = "icefall:v1:"`
 * domain-separation discipline.
 */
export const ATLAS_SEED_DOMAIN_TEXT = "icefall:atlas-seed:v1:";

const ATLAS_SEED_DOMAIN_BYTES: Uint8Array = utf8(ATLAS_SEED_DOMAIN_TEXT);

const SEED_BYTE_MIN = 1;
const SEED_BYTE_MAX = 255;

/**
 * Validate an atlas-seed string. Throws on lone surrogates (would be
 * silently U+FFFD-replaced by `TextEncoder` — a determinism hazard) or
 * on UTF-8 byte length outside the inclusive range `[1, 255]`.
 *
 * Phase 4 *addition* (red-team follow-up N19). Atlas seeds are stricter
 * than the Phase 2 `seedToBytes` precondition surface — `seedToBytes`
 * predates this validation discipline and is left unchanged so the
 * existing run-seed fingerprint surface does not bump silently. The
 * asymmetry is intentional: atlas seeds are a brand-new pre-image
 * domain (no fingerprints exist yet) so we can pin the strict check
 * from day one.
 */
export function validateSeedString(seed: string): void {
  if (!isWellFormedUtf16(seed)) {
    throw new Error(
      "atlasSeedToBytes: seed string contains an unpaired UTF-16 surrogate",
    );
  }
  const bytes = utf8(seed);
  if (bytes.length < SEED_BYTE_MIN || bytes.length > SEED_BYTE_MAX) {
    throw new Error(
      `atlasSeedToBytes: seed UTF-8 byte length must be ${SEED_BYTE_MIN}..${SEED_BYTE_MAX} (got ${bytes.length})`,
    );
  }
}

/**
 * Map an atlas-seed string to a 32-byte derived seed.
 *
 * ```
 * atlasSeedToBytes(seed) =
 *   sha256( utf8("icefall:atlas-seed:v1:") ‖ utf8(seed) )
 * ```
 *
 * Phase 4 frozen contract — addendum B7. Used by `tools/gen-atlas.ts`,
 * `src/atlas/generate.ts` (Phase 4.A.2), and `src/main.ts`'s preview-UI
 * regen path. The 22-byte ASCII anchor is byte-distinct from the
 * empty-prefix Phase 2 `seedToBytes`, so atlas-seed → atlas-PRNG
 * derivation cannot collide with run-seed → run-PRNG derivation for
 * any input string `X`.
 *
 * Throws via `validateSeedString` on lone surrogates or out-of-range
 * UTF-8 byte length (`< 1` or `> 255`).
 */
export function atlasSeedToBytes(seed: string): Uint8Array {
  validateSeedString(seed);
  return sha256(concat([ATLAS_SEED_DOMAIN_BYTES, utf8(seed)]));
}
