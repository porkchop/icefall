import { zlibSync } from "fflate";
import { base64url, concat } from "../core/hash";
import { encodeAction, type Action } from "../core/encode";

/**
 * Phase 8 action-log codec — encoder side. Per
 * `artifacts/decision-memo-phase-8.md` decision 2 + addendum B1, B2.
 *
 * Wire form:
 *   `base64url(fflate.zlibSync(envelope, { level: 1 }))`
 *
 * Envelope (uncompressed):
 *   [ACTION_LOG_MAGIC: "ICE" = 0x49 0x43 0x45]
 *   [ACTION_LOG_VERSION: 0x01]
 *   [actionCount: u32 LE]
 *   [encodeAction(actions[0])] ... [encodeAction(actions[N-1])]
 *
 * `zlibSync` (NOT `deflateSync`) inherits the cross-runtime
 * byte-identity guarantee from `src/atlas/png.ts:19` and the Phase 4.B
 * `cross-os-atlas-equality` matrix. The lint scope at `src/share/**`
 * bans `deflateSync`/`inflateSync` to make the contract structurally
 * enforced (see `eslint.config.js`).
 */

export const ACTION_LOG_MAGIC: Uint8Array = Uint8Array.from([
  0x49,
  0x43,
  0x45,
]);
export const ACTION_LOG_VERSION = 0x01;

const HEADER_BYTES = 8; // 3 magic + 1 version + 4 actionCount

/**
 * Build the uncompressed envelope byte sequence (the input to
 * `zlibSync`). Exposed for `src/verifier/**` and tests; production
 * callers should usually use {@link encodeActionLog}.
 *
 * The header writes `actions.length >>> 0` as a u32 LE — JS arrays
 * are bounded to length ≤ 2³²−1 by spec (the same bound as the u32
 * field), so no explicit overflow guard is needed.
 */
export function buildActionLogEnvelope(
  actions: readonly Action[],
): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(ACTION_LOG_MAGIC, 0);
  header[3] = ACTION_LOG_VERSION;
  // u32 LE actionCount at offset 4
  new DataView(header.buffer).setUint32(4, actions.length >>> 0, true);

  const parts: Uint8Array[] = [header];
  for (let i = 0; i < actions.length; i++) {
    parts.push(encodeAction(actions[i]!));
  }
  return concat(parts);
}

/**
 * Encode an action sequence to its base64url wire form. The output is
 * a string ready for placement inside the URL hash fragment
 * (`#log=<wire>`) or for clipboard transport.
 *
 * Determinism: `zlibSync` at `level: 1` is byte-identical across Node,
 * Chromium, Firefox, WebKit (the same property the Phase 4 atlas PNG
 * encoder relies on; the Phase 4.B `cross-os-atlas-equality` matrix
 * exercises it cross-OS). The Phase 8.A.2 `action-log-cross-runtime`
 * self-test entry pins a small golden envelope across the same matrix.
 */
export function encodeActionLog(actions: readonly Action[]): string {
  const envelope = buildActionLogEnvelope(actions);
  const compressed = zlibSync(envelope, { level: 1 });
  return base64url(compressed);
}
