import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import {
  encodeActionLog,
  buildActionLogEnvelope,
  ACTION_LOG_MAGIC,
  ACTION_LOG_VERSION,
} from "../../src/share/encode";
import {
  decodeActionLog,
  parseActionLogEnvelope,
} from "../../src/share/decode";
import { base64url, decodeBase64Url } from "../../src/core/hash";
import {
  ACTION_VERSION,
  TAG_DIR,
  TAG_ITEM,
  TAG_TARGET,
  type Action,
  type Direction,
} from "../../src/core/encode";
import { SELF_TEST_WIN_LOG } from "../../src/sim/self-test-win-log";

/**
 * Phase 8.A.2a tests for the action-log codec
 * (`src/share/encode.ts` + `src/share/decode.ts`). Per
 * `artifacts/decision-memo-phase-8.md` decision 2 + addendum B1, B2:
 *
 *   - Round-trip property: `decodeActionLog(encodeActionLog(a)) === a`
 *   - Pinned-vector test: `SELF_TEST_WIN_LOG` (1217 actions) round-trips
 *     byte-identically; the wire form's length is asserted within the
 *     URL_FULL_LENGTH_HARD_CAP budget.
 *   - Magic mismatch / version mismatch / trailing-bytes / truncated /
 *     count-mismatch error fixtures with byte-exact pinned messages.
 *   - Action-log envelope wire shape (header layout) matches addendum B1.
 */

const EMPTY_LOG_GOLDEN_ENVELOPE = new Uint8Array([
  0x49,
  0x43,
  0x45, // "ICE"
  0x01, // version
  0x00,
  0x00,
  0x00,
  0x00, // actionCount = 0 LE
]);

describe("encodeActionLog — wire-form shape", () => {
  it("the empty-log envelope has the pinned 8-byte header layout", () => {
    expect(buildActionLogEnvelope([])).toEqual(EMPTY_LOG_GOLDEN_ENVELOPE);
  });

  it("encodes magic + version + count in the documented byte order", () => {
    const env = buildActionLogEnvelope([{ type: "wait" }]);
    // Header: 0x49 0x43 0x45 0x01 [count u32 LE = 1: 0x01 0x00 0x00 0x00]
    expect(env[0]).toBe(0x49);
    expect(env[1]).toBe(0x43);
    expect(env[2]).toBe(0x45);
    expect(env[3]).toBe(ACTION_LOG_VERSION);
    expect(env[4]).toBe(0x01);
    expect(env[5]).toBe(0x00);
    expect(env[6]).toBe(0x00);
    expect(env[7]).toBe(0x00);
    // Then: [ACTION_VERSION=0x01][type_len=4]['w','a','i','t']
    expect(env[8]).toBe(ACTION_VERSION);
    expect(env[9]).toBe(4);
    expect(env[10]).toBe(0x77); // 'w'
    expect(env[11]).toBe(0x61); // 'a'
    expect(env[12]).toBe(0x69); // 'i'
    expect(env[13]).toBe(0x74); // 't'
    expect(env.length).toBe(14);
  });

  it("ACTION_LOG_MAGIC is the ASCII bytes for 'ICE'", () => {
    expect(ACTION_LOG_MAGIC).toEqual(Uint8Array.from([0x49, 0x43, 0x45]));
  });

  it("encodeActionLog uses zlibSync (CMF=0x78 zlib header visible after base64url decode)", () => {
    const wire = encodeActionLog([{ type: "wait" }]);
    // zlibSync emits a 2-byte CMF/FLG zlib header — CMF=0x78
    // (deflate with 32 KiB window) is the universal zlib indicator.
    // FLG carries the FCHECK bits which make CMF*256+FLG divisible
    // by 31; fflate-level-1 emits 0x5e here in practice. The
    // raw-`deflateSync` path would emit no header at all.
    const reconstructed = decodeBase64Url(wire);
    expect(reconstructed[0]).toBe(0x78);
    // Validate the FCHECK bits (CMF*256 + FLG % 31 === 0)
    const flg = reconstructed[1]!;
    expect((0x78 * 256 + flg) % 31).toBe(0);
  });
});

describe("encodeActionLog → decodeActionLog round-trip", () => {
  it("round-trips an empty log", () => {
    const wire = encodeActionLog([]);
    expect(decodeActionLog(wire)).toEqual([]);
  });

  it("round-trips a single action", () => {
    const a: Action = { type: "wait" };
    expect(decodeActionLog(encodeActionLog([a]))).toEqual([a]);
  });

  it("round-trips a long synthetic action sequence covering all field combinations", () => {
    const dirs: readonly Direction[] = [0, 1, 2, 3, 4, 5, 6, 7];
    const actions: Action[] = [];
    let i = 0;
    for (const t of ["wait", "move", "attack", "use", "buy", "sell"]) {
      for (const incTarget of [false, true]) {
        for (const incItem of [false, true]) {
          for (const incDir of [false, true]) {
            const a: Action = { type: t };
            if (incTarget) (a as { target?: number }).target = (i % 17) - 8;
            if (incItem) {
              (a as { item?: string }).item = `item.${t}-${i}`;
            }
            if (incDir) {
              (a as { dir?: Direction }).dir = dirs[i % 8]!;
            }
            actions.push(a);
            i++;
          }
        }
      }
    }
    expect(actions.length).toBeGreaterThan(40);
    const wire = encodeActionLog(actions);
    expect(decodeActionLog(wire)).toEqual(actions);
  });

  it("round-trips SELF_TEST_WIN_LOG (1217 actions)", () => {
    const wire = encodeActionLog(SELF_TEST_WIN_LOG as readonly Action[]);
    const decoded = decodeActionLog(wire);
    expect(decoded.length).toBe(SELF_TEST_WIN_LOG.length);
    expect(decoded).toEqual(SELF_TEST_WIN_LOG);
  });

  it("SELF_TEST_WIN_LOG wire form fits within the URL_FULL_LENGTH_HARD_CAP budget", () => {
    // Memo addendum B7 hard cap is 32000 chars on the FULL URL; the
    // log alone must be well under this.
    const wire = encodeActionLog(SELF_TEST_WIN_LOG as readonly Action[]);
    expect(wire.length).toBeLessThan(32000);
    // Expected ~3.5–5 KB compressed → ~5–7 KB base64url.
    expect(wire.length).toBeGreaterThan(1000);
    expect(wire.length).toBeLessThan(20000);
  });

  it("is byte-stable across two calls (deterministic encoding)", () => {
    const wire1 = encodeActionLog(SELF_TEST_WIN_LOG as readonly Action[]);
    const wire2 = encodeActionLog(SELF_TEST_WIN_LOG as readonly Action[]);
    expect(wire1).toBe(wire2);
  });
});

describe("decodeActionLog — rejection cases (per addendum B2 pinned messages)", () => {
  function wireFromEnvelope(envelope: Uint8Array): string {
    return base64url(zlibSync(envelope, { level: 1 }));
  }

  it("rejects bad magic", () => {
    // PNG magic instead of ICE; any 3 wrong bytes at offset 0..2
    const bad = new Uint8Array([
      0x50,
      0x4e,
      0x47, // "PNG"
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    expect(() => decodeActionLog(wireFromEnvelope(bad))).toThrowError(
      /action-log: bad magic — expected 'ICE' \(49 43 45\), got '504e47'/,
    );
  });

  it("rejects unsupported version", () => {
    const bad = new Uint8Array([
      0x49,
      0x43,
      0x45, // "ICE"
      0x02, // version 2 — not supported in this build
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    expect(() => decodeActionLog(wireFromEnvelope(bad))).toThrowError(
      /action-log: unsupported version 2 \(this build supports version 1\) — load a newer release with 'releases\/<commit>\/'/,
    );
  });

  it("rejects truncated envelope (less than 8 header bytes)", () => {
    const bad = new Uint8Array([0x49, 0x43, 0x45, 0x01]); // 4 bytes
    expect(() => decodeActionLog(wireFromEnvelope(bad))).toThrowError(
      /action-log: truncated envelope \(length 4, need at least 8 for magic \+ version \+ count\)/,
    );
  });

  it("rejects trailing bytes after the final declared action", () => {
    // Encode 2 actions but bump actionCount to 1 — the second action's
    // bytes (which start with ACTION_VERSION = 0x01 so decodeAction
    // terminates cleanly at the boundary) become trailing bytes.
    const env = buildActionLogEnvelope([
      { type: "wait" },
      { type: "move", dir: 1 },
    ]);
    const bad = new Uint8Array(env);
    new DataView(bad.buffer).setUint32(4, 1, true);
    expect(() => decodeActionLog(wireFromEnvelope(bad))).toThrowError(
      /action-log: trailing bytes after final action \(offset \d+, length \d+\)/,
    );
  });

  it("rejects declared count mismatch (declared > actually present)", () => {
    // actionCount = 5 but only 1 action in the buffer.
    const oneAction = buildActionLogEnvelope([{ type: "wait" }]);
    const bad = new Uint8Array(oneAction);
    new DataView(bad.buffer).setUint32(4, 5, true);
    expect(() => decodeActionLog(wireFromEnvelope(bad))).toThrowError(
      /action-log: declared 5 actions but envelope ran out at \d+/,
    );
  });

  it("rejects malformed inner action (unknown tag inside the envelope)", () => {
    // [v=01][type_len=1]['x'][unknown 0x40][stuff]
    const innerBad = new Uint8Array([
      ACTION_VERSION,
      1,
      0x78,
      0x40,
      0x00,
    ]);
    const env = new Uint8Array(8 + innerBad.length);
    env.set(ACTION_LOG_MAGIC, 0);
    env[3] = ACTION_LOG_VERSION;
    new DataView(env.buffer).setUint32(4, 1, true);
    env.set(innerBad, 8);
    expect(() => decodeActionLog(wireFromEnvelope(env))).toThrowError(
      /action-log: action 0 of 1 at offset 8: decodeAction: unknown tag 0x40/,
    );
  });

  it("surfaces base64url-decode failure with the action-log: prefix", () => {
    expect(() => decodeActionLog("@@@invalid")).toThrowError(
      /action-log: base64url-decode failed:/,
    );
  });

  it("surfaces zlib-decompress failure with the action-log: prefix", () => {
    // Valid base64url but not valid zlib bytes — random bytes here.
    const wire = base64url(Uint8Array.from([0x00, 0x01, 0x02, 0x03]));
    expect(() => decodeActionLog(wire)).toThrowError(
      /action-log: zlib-decompress failed:/,
    );
  });
});

describe("parseActionLogEnvelope — exposed for verifier callers", () => {
  it("decodes a hand-built envelope without going through base64url+zlib", () => {
    const env = buildActionLogEnvelope([{ type: "x" }, { type: "y" }]);
    expect(parseActionLogEnvelope(env)).toEqual([
      { type: "x" },
      { type: "y" },
    ]);
  });

  it("rejects via the pinned messages identically when called directly", () => {
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]); // bad magic
    expect(() => parseActionLogEnvelope(bad)).toThrowError(
      /action-log: bad magic — expected 'ICE' \(49 43 45\), got '000102'/,
    );
  });
});

// silence the unused-import warning for tags re-exported from core/encode
void TAG_TARGET;
void TAG_ITEM;
void TAG_DIR;
