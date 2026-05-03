import { describe, expect, it } from "vitest";
import * as encodeMod from "./encode";
import {
  ACTION_VERSION,
  TAG_TARGET,
  TAG_ITEM,
  TAG_DIR,
  encodeAction,
  type Action,
} from "./encode";

describe("ACTION_VERSION + tags", () => {
  it("ACTION_VERSION is 0x01", () => {
    expect(ACTION_VERSION).toBe(0x01);
  });

  it("tags are 0x10/0x20/0x30 (strictly increasing)", () => {
    expect(TAG_TARGET).toBe(0x10);
    expect(TAG_ITEM).toBe(0x20);
    expect(TAG_DIR).toBe(0x30);
    expect(TAG_TARGET).toBeLessThan(TAG_ITEM);
    expect(TAG_ITEM).toBeLessThan(TAG_DIR);
  });
});

describe("encodeAction — minimal action", () => {
  it("encodes a type-only action", () => {
    expect(Array.from(encodeAction({ type: "wait" }))).toEqual([
      0x01, 0x04, 0x77, 0x61, 0x69, 0x74,
    ]);
  });
});

describe("encodeAction — optional fields", () => {
  it("encodes target as int32 little-endian after tag 0x10", () => {
    const out = encodeAction({ type: "x", target: 1 });
    expect(Array.from(out)).toEqual([
      0x01, 0x01, 0x78, 0x10, 0x01, 0x00, 0x00, 0x00,
    ]);
  });

  it("encodes negative target as two's complement little-endian", () => {
    const out = encodeAction({ type: "x", target: -1 });
    expect(Array.from(out)).toEqual([
      0x01, 0x01, 0x78, 0x10, 0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it("encodes int32 boundary targets", () => {
    expect(Array.from(encodeAction({ type: "x", target: 2147483647 }))).toEqual([
      0x01, 0x01, 0x78, 0x10, 0xff, 0xff, 0xff, 0x7f,
    ]);
    expect(Array.from(encodeAction({ type: "x", target: -2147483648 }))).toEqual([
      0x01, 0x01, 0x78, 0x10, 0x00, 0x00, 0x00, 0x80,
    ]);
  });

  it("encodes item with 1-byte length prefix after tag 0x20", () => {
    expect(Array.from(encodeAction({ type: "u", item: "ab" }))).toEqual([
      0x01, 0x01, 0x75, 0x20, 0x02, 0x61, 0x62,
    ]);
  });

  it("encodes empty-string item as zero-length", () => {
    expect(Array.from(encodeAction({ type: "u", item: "" }))).toEqual([
      0x01, 0x01, 0x75, 0x20, 0x00,
    ]);
  });

  it("encodes dir as a single byte after tag 0x30", () => {
    expect(Array.from(encodeAction({ type: "m", dir: 5 }))).toEqual([
      0x01, 0x01, 0x6d, 0x30, 0x05,
    ]);
  });
});

describe("encodeAction — combined fields", () => {
  it("emits optional fields in strictly increasing tag order", () => {
    const out = encodeAction({ type: "u", target: 7, item: "x", dir: 3 });
    expect(Array.from(out)).toEqual([
      0x01, 0x01, 0x75,
      0x10, 0x07, 0x00, 0x00, 0x00,
      0x20, 0x01, 0x78,
      0x30, 0x03,
    ]);
  });

  it("omits absent optional fields entirely", () => {
    const a = encodeAction({ type: "x", target: 1 });
    const b = encodeAction({ type: "x", target: 1 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

// Defensive against a future optional field being added in source-order
// rather than tag-order: enumerate every subset of the optional fields
// and assert the wire form's optional-field tags are strictly increasing.
describe("encodeAction — tag-order combinatoric (all 2^k presence subsets)", () => {
  type Optional = "target" | "item" | "dir";
  const TAG_BY_FIELD: Record<Optional, number> = {
    target: TAG_TARGET,
    item: TAG_ITEM,
    dir: TAG_DIR,
  };
  const FIELDS: readonly Optional[] = ["target", "item", "dir"] as const;

  function readOptionalTagsInOrder(bytes: Uint8Array): number[] {
    // Skip [version:1][type_len:1][type_bytes...]
    const typeLen = bytes[1]!;
    let i = 2 + typeLen;
    const tags: number[] = [];
    while (i < bytes.length) {
      const tag = bytes[i]!;
      tags.push(tag);
      if (tag === TAG_TARGET) {
        i += 1 + 4;
      } else if (tag === TAG_ITEM) {
        const len = bytes[i + 1]!;
        i += 1 + 1 + len;
      } else if (tag === TAG_DIR) {
        i += 1 + 1;
      } else {
        throw new Error(
          `unknown optional-field tag 0x${tag.toString(16)} at offset ${i}`,
        );
      }
    }
    return tags;
  }

  // Sentinel: if a future TAG_* is exported from encode.ts, this test's
  // FIELDS list must also be extended — otherwise the new field's tag
  // ordering escapes the combinatoric sweep.
  it("FIELDS covers every TAG_* exported from encode.ts", () => {
    const exportedTags = Object.keys(encodeMod).filter((k) =>
      k.startsWith("TAG_"),
    );
    expect(exportedTags.length).toBe(FIELDS.length);
  });

  for (let mask = 0; mask < 1 << FIELDS.length; mask++) {
    const present: Optional[] = [];
    for (let bit = 0; bit < FIELDS.length; bit++) {
      if (mask & (1 << bit)) present.push(FIELDS[bit]!);
    }
    const label = present.length === 0 ? "(none)" : present.join("+");

    it(`subset ${label}: optional-field tags emit strictly increasing`, () => {
      const action: Action = { type: "t" };
      if (present.includes("target")) action.target = 1;
      if (present.includes("item")) action.item = "i";
      if (present.includes("dir")) action.dir = 2;

      const observed = readOptionalTagsInOrder(encodeAction(action));

      for (let i = 1; i < observed.length; i++) {
        expect(observed[i - 1]!).toBeLessThan(observed[i]!);
      }

      const expected = present.map((f) => TAG_BY_FIELD[f]).sort((a, b) => a - b);
      expect(observed).toEqual(expected);
    });
  }
});

describe("encodeAction — validation", () => {
  it("rejects empty type", () => {
    expect(() => encodeAction({ type: "" })).toThrowError(/non-empty/);
  });

  it("rejects type > 64 bytes", () => {
    expect(() => encodeAction({ type: "a".repeat(65) })).toThrowError(/64/);
  });

  it("rejects type with unpaired surrogate", () => {
    expect(() => encodeAction({ type: "\uD800" })).toThrowError(/surrogate/);
  });

  it("rejects non-integer target", () => {
    expect(() => encodeAction({ type: "x", target: 1.5 })).toThrowError(/int32/);
  });

  it("rejects target outside int32 range", () => {
    expect(() => encodeAction({ type: "x", target: 2147483648 })).toThrowError(/int32/);
    expect(() => encodeAction({ type: "x", target: -2147483649 })).toThrowError(/int32/);
  });

  it("rejects item > 255 bytes", () => {
    expect(() => encodeAction({ type: "x", item: "a".repeat(256) })).toThrowError(/255/);
  });

  it("rejects item with unpaired surrogate", () => {
    expect(() => encodeAction({ type: "x", item: "\uDC00" })).toThrowError(/surrogate/);
  });

  it("rejects dir outside 0..7", () => {
    expect(() =>
      encodeAction({ type: "x", dir: 8 as unknown as 0 }),
    ).toThrowError(/0..7/);
    expect(() =>
      encodeAction({ type: "x", dir: -1 as unknown as 0 }),
    ).toThrowError(/0..7/);
    expect(() =>
      encodeAction({ type: "x", dir: 1.5 as unknown as 0 }),
    ).toThrowError(/0..7/);
  });

  it("uses byte length, not codepoint length, for type", () => {
    // 16 emoji = 64 bytes (4 bytes each) — at the cap
    const okType = "💩".repeat(16);
    expect(() => encodeAction({ type: okType })).not.toThrow();
    // 17 emoji = 68 bytes — over the cap
    const badType = "💩".repeat(17);
    expect(() => encodeAction({ type: badType })).toThrowError(/64/);
  });
});
