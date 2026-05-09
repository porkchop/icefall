import { describe, expect, it } from "vitest";
import {
  decodeAction,
  encodeAction,
  ACTION_VERSION,
  TAG_TARGET,
  TAG_ITEM,
  TAG_DIR,
  type Action,
  type Direction,
} from "../../src/core/encode";

/**
 * Phase 8.A.2a tests for `decodeAction(bytes, offset)`. Per
 * `artifacts/decision-memo-phase-8.md` addendum B2: 10 fixtures
 * cover the positive surface + every rejection branch + the
 * round-trip property against `encodeAction`. Error messages are
 * pinned with the `decodeAction:` prefix.
 */

function bytes(...vs: number[]): Uint8Array {
  return Uint8Array.from(vs);
}

describe("decodeAction — positive cases", () => {
  it("decodes an action with no optional fields (`wait`)", () => {
    const buf = encodeAction({ type: "wait" });
    const { action, bytesConsumed } = decodeAction(buf, 0);
    expect(action).toEqual({ type: "wait" });
    expect(bytesConsumed).toBe(buf.length);
  });

  it("decodes an action with TAG_DIR only (`move dir=3`)", () => {
    const original: Action = { type: "move", dir: 3 };
    const buf = encodeAction(original);
    const { action, bytesConsumed } = decodeAction(buf, 0);
    expect(action).toEqual(original);
    expect(bytesConsumed).toBe(buf.length);
  });

  it("decodes an action with TAG_TARGET only (`attack target=5`)", () => {
    const original: Action = { type: "attack", target: 5 };
    const buf = encodeAction(original);
    const { action, bytesConsumed } = decodeAction(buf, 0);
    expect(action).toEqual(original);
    expect(bytesConsumed).toBe(buf.length);
  });

  it("decodes an action with TAG_ITEM only (`use item=item.stim-patch`)", () => {
    const original: Action = { type: "use", item: "item.stim-patch" };
    const buf = encodeAction(original);
    const { action, bytesConsumed } = decodeAction(buf, 0);
    expect(action).toEqual(original);
    expect(bytesConsumed).toBe(buf.length);
  });

  it("decodes an action with TAG_TARGET + TAG_ITEM + TAG_DIR (all three)", () => {
    const original: Action = {
      type: "buy",
      target: 1,
      item: "item.cyberdeck-mod",
      dir: 0,
    };
    const buf = encodeAction(original);
    const { action, bytesConsumed } = decodeAction(buf, 0);
    expect(action).toEqual(original);
    expect(bytesConsumed).toBe(buf.length);
  });

  it("decodes negative int32 target (boundary)", () => {
    const original: Action = { type: "x", target: -2147483648 };
    const buf = encodeAction(original);
    const { action } = decodeAction(buf, 0);
    expect(action.target).toBe(-2147483648);
  });

  it("decodes max int32 target (boundary)", () => {
    const original: Action = { type: "x", target: 2147483647 };
    const buf = encodeAction(original);
    const { action } = decodeAction(buf, 0);
    expect(action.target).toBe(2147483647);
  });
});

describe("decodeAction — round-trip property", () => {
  it("encodeAction → decodeAction is identity for 100 random actions", () => {
    // Deterministic via a counter; covers permutations of {target, item, dir}
    // present/absent across many type strings.
    const dirs: readonly Direction[] = [0, 1, 2, 3, 4, 5, 6, 7];
    let i = 0;
    const fixtures: Action[] = [];
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
            fixtures.push(a);
            i++;
          }
        }
      }
    }
    expect(fixtures.length).toBeGreaterThan(40);
    for (const a of fixtures) {
      const buf = encodeAction(a);
      const { action, bytesConsumed } = decodeAction(buf, 0);
      expect(action).toEqual(a);
      expect(bytesConsumed).toBe(buf.length);
    }
  });

  it("decodes from a non-zero offset (concatenated buffer)", () => {
    const a: Action = { type: "move", dir: 2 };
    const b: Action = { type: "wait" };
    const aBuf = encodeAction(a);
    const bBuf = encodeAction(b);
    const concat = new Uint8Array(aBuf.length + bBuf.length);
    concat.set(aBuf, 0);
    concat.set(bBuf, aBuf.length);

    const r1 = decodeAction(concat, 0);
    expect(r1.action).toEqual(a);
    expect(r1.bytesConsumed).toBe(aBuf.length);

    const r2 = decodeAction(concat, r1.bytesConsumed);
    expect(r2.action).toEqual(b);
    expect(r2.bytesConsumed).toBe(bBuf.length);
  });
});

describe("decodeAction — rejection cases (per addendum B2 pinned messages)", () => {
  it("rejects unsupported action version", () => {
    expect(() => decodeAction(bytes(0x02), 0)).toThrowError(
      /decodeAction: unsupported action version 2 at offset 0/,
    );
  });

  it("rejects type_len = 0", () => {
    expect(() => decodeAction(bytes(ACTION_VERSION, 0x00), 0)).toThrowError(
      /decodeAction: type_len 0 out of range \[1, 64\] at offset 1/,
    );
  });

  it("rejects type_len = 65", () => {
    expect(() => decodeAction(bytes(ACTION_VERSION, 65), 0)).toThrowError(
      /decodeAction: type_len 65 out of range \[1, 64\] at offset 1/,
    );
  });

  it("rejects truncated type bytes", () => {
    // ACTION_VERSION + type_len=4 + only 2 type bytes provided
    expect(() =>
      decodeAction(
        bytes(ACTION_VERSION, 4, 0x77, 0x61),
        0,
      ),
    ).toThrowError(/decodeAction: truncated type at offset 2/);
  });

  it("rejects unknown tag 0x40 (forward-compat)", () => {
    // [0x01][type_len=1]['x'][0x40][...]
    expect(() =>
      decodeAction(bytes(ACTION_VERSION, 1, 0x78, 0x40, 0x00), 0),
    ).toThrowError(
      /decodeAction: unknown tag 0x40 at offset 3 \(this build supports v1 tags 0x10, 0x20, 0x30 only — load 'releases\/<commit>\/' for the build that produced this log\)/,
    );
  });

  it("rejects TAG_DIR (0x30) appearing before TAG_ITEM (0x20)", () => {
    // [0x01][type_len=1]['x'][0x30][dir=2][0x20][item_len=1]['a']
    expect(() =>
      decodeAction(
        bytes(
          ACTION_VERSION,
          1,
          0x78,
          TAG_DIR,
          2,
          TAG_ITEM,
          1,
          0x61,
        ),
        0,
      ),
    ).toThrowError(
      /decodeAction: tag 0x20 appears after tag 0x30 at offset 5 \(tags must be strictly increasing\)/,
    );
  });

  it("rejects TAG_DIR appearing twice (strictly-increasing violation)", () => {
    // [0x01][type_len=1]['x'][0x30][dir=2][0x30][dir=3]
    expect(() =>
      decodeAction(
        bytes(
          ACTION_VERSION,
          1,
          0x78,
          TAG_DIR,
          2,
          TAG_DIR,
          3,
        ),
        0,
      ),
    ).toThrowError(
      /decodeAction: tag 0x30 appears after tag 0x30 at offset 5/,
    );
  });

  it("rejects truncated TAG_TARGET payload (need 4 bytes)", () => {
    // [0x01][1]['x'][0x10][only 2 of 4 int32 bytes]
    expect(() =>
      decodeAction(
        bytes(ACTION_VERSION, 1, 0x78, TAG_TARGET, 0xff, 0xff),
        0,
      ),
    ).toThrowError(/decodeAction: truncated tag 0x10 payload at offset 4/);
  });

  it("rejects TAG_ITEM with item_len causing read past buffer end", () => {
    // [0x01][1]['x'][0x20][item_len=10][only 2 item bytes]
    expect(() =>
      decodeAction(
        bytes(ACTION_VERSION, 1, 0x78, TAG_ITEM, 10, 0x61, 0x62),
        0,
      ),
    ).toThrowError(/decodeAction: truncated tag 0x20 payload at offset 5/);
  });

  it("rejects TAG_DIR with out-of-range payload (dir > 7)", () => {
    // [0x01][1]['x'][0x30][8] — dir must be 0..7
    expect(() =>
      decodeAction(bytes(ACTION_VERSION, 1, 0x78, TAG_DIR, 8), 0),
    ).toThrowError(/decodeAction: truncated tag 0x30 payload at offset 4/);
  });

  it("rejects empty buffer at the version-byte read", () => {
    expect(() => decodeAction(new Uint8Array(0), 0)).toThrowError(
      /decodeAction: truncated at offset 0 \(need version byte\)/,
    );
  });

  it("rejects buffer containing only the version byte (need type_len)", () => {
    expect(() => decodeAction(bytes(ACTION_VERSION), 0)).toThrowError(
      /decodeAction: truncated at offset 1 \(need type_len byte\)/,
    );
  });

  it("rejects truncated TAG_DIR with no payload byte (buffer ends after the tag)", () => {
    // [v=01][type_len=1]['x'][TAG_DIR] — buffer ends before the dir
    // payload. cursor should be at bytes.length when the inner check
    // fires.
    expect(() =>
      decodeAction(bytes(ACTION_VERSION, 1, 0x78, TAG_DIR), 0),
    ).toThrowError(/decodeAction: truncated tag 0x30 payload at offset 4/);
  });

  it("rejects truncated TAG_ITEM with no item_len byte (buffer ends after the tag)", () => {
    // [v=01][type_len=1]['x'][TAG_ITEM] — buffer ends before item_len.
    expect(() =>
      decodeAction(bytes(ACTION_VERSION, 1, 0x78, TAG_ITEM), 0),
    ).toThrowError(/decodeAction: truncated tag 0x20 payload at offset 4/);
  });

  it("rejects TAG_ITEM with invalid UTF-8 item bytes", () => {
    // [v=01][type_len=1]['x'][TAG_ITEM][item_len=2][0xff 0xfe] —
    // 0xFF 0xFE is not a valid UTF-8 sequence (lone continuation
    // bytes / invalid leading byte).
    expect(() =>
      decodeAction(
        bytes(ACTION_VERSION, 1, 0x78, TAG_ITEM, 2, 0xff, 0xfe),
        0,
      ),
    ).toThrowError(/decodeAction: item at offset 5 is not valid UTF-8/);
  });

  it("rejects type bytes that are invalid UTF-8", () => {
    // [v=01][type_len=2][0xff 0xfe]
    expect(() =>
      decodeAction(bytes(ACTION_VERSION, 2, 0xff, 0xfe), 0),
    ).toThrowError(/decodeAction: type at offset 2 is not valid UTF-8/);
  });
});
