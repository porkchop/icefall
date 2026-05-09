import { unzlibSync } from "fflate";
import { decodeBase64Url } from "../core/hash";
import { decodeAction, type Action } from "../core/encode";
import {
  ACTION_LOG_MAGIC,
  ACTION_LOG_VERSION,
} from "./encode";

/**
 * Phase 8 action-log codec — decoder side. Inverse of `encodeActionLog`.
 *
 * Decoder pipeline:
 *   1. base64url-decode the wire string → compressed bytes
 *   2. `unzlibSync` → uncompressed envelope
 *   3. parse magic + version + actionCount header
 *   4. loop `decodeAction(...)` for each declared action
 *   5. assert no trailing bytes
 *
 * Pinned error-message prefix: `"action-log: "` (per
 * `artifacts/decision-memo-phase-8.md` decision 2 + addendum B1, B2).
 *
 * The decoder REJECTS:
 *   - Wrong magic ("got '<hex>'")
 *   - Unsupported version ("supports version 1")
 *   - Truncated header (< 8 bytes)
 *   - Trailing bytes after the final declared action
 *   - Action count mismatch (declared > actually decoded)
 *
 * Forward compatibility is via release pinning, not silent skips: a
 * Phase 9 build that ships `ACTION_LOG_VERSION = 0x02` publishes its
 * own `releases/<commit>/` subtree, and a v1 user clicking that URL
 * is redirected (memo decision 5) before the decoder runs.
 */

const HEX = "0123456789abcdef";
function bytesToHex(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i++) {
    out += HEX[b[i]! >> 4]! + HEX[b[i]! & 0xf]!;
  }
  return out;
}

function fail(msg: string): never {
  throw new Error(`action-log: ${msg}`);
}

/**
 * Inverse of `buildActionLogEnvelope` — parse an already-decompressed
 * envelope back into its action sequence. Exposed for tests; production
 * callers usually use {@link decodeActionLog}.
 */
export function parseActionLogEnvelope(envelope: Uint8Array): Action[] {
  if (envelope.length < 8) {
    fail(
      `truncated envelope (length ${envelope.length}, need at least 8 for magic + version + count)`,
    );
  }
  for (let i = 0; i < 3; i++) {
    if (envelope[i] !== ACTION_LOG_MAGIC[i]) {
      const got = bytesToHex(envelope.subarray(0, 3));
      fail(
        `bad magic — expected 'ICE' (49 43 45), got '${got}'`,
      );
    }
  }
  const ver = envelope[3]!;
  if (ver !== ACTION_LOG_VERSION) {
    fail(
      `unsupported version ${ver} (this build supports version 1) — load a newer release with 'releases/<commit>/'`,
    );
  }

  const dv = new DataView(
    envelope.buffer,
    envelope.byteOffset + 4,
    4,
  );
  const actionCount = dv.getUint32(0, true);

  const actions: Action[] = [];
  let offset = 8;
  for (let i = 0; i < actionCount; i++) {
    if (offset >= envelope.length) {
      fail(
        `declared ${actionCount} actions but envelope ran out at ${i}`,
      );
    }
    let r: { action: Action; bytesConsumed: number };
    try {
      r = decodeAction(envelope, offset);
    } catch (e) {
      // Surface the underlying decodeAction error with the
      // action-log: prefix so callers can distinguish envelope vs
      // payload failures.
      const inner = (e as Error).message;
      fail(
        `action ${i} of ${actionCount} at offset ${offset}: ${inner}`,
      );
    }
    actions.push(r.action);
    offset += r.bytesConsumed;
  }

  if (offset !== envelope.length) {
    fail(
      `trailing bytes after final action (offset ${offset}, length ${envelope.length})`,
    );
  }

  return actions;
}

/**
 * Decode a base64url-encoded action-log wire string back into actions.
 * Throws an Error with `actionLogError: true` and a pinned
 * `"action-log: "`-prefixed message on every failure mode.
 */
export function decodeActionLog(wire: string): Action[] {
  let compressed: Uint8Array;
  try {
    compressed = decodeBase64Url(wire);
  } catch (e) {
    fail(`base64url-decode failed: ${(e as Error).message}`);
  }
  let envelope: Uint8Array;
  try {
    envelope = unzlibSync(compressed);
  } catch (e) {
    fail(`zlib-decompress failed: ${(e as Error).message}`);
  }
  return parseActionLogEnvelope(envelope);
}
