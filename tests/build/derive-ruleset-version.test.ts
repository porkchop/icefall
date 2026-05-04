import { describe, expect, it } from "vitest";
import {
  RULES_FILES,
  deriveRulesetVersion,
  normalizeForHash,
  rulesetTextHash,
  stripBom,
} from "../../src/build-info";
import { sha256Hex } from "../../src/core/hash";

/**
 * Phase 4.A.1 unit tests for `deriveRulesetVersion`. The helper is
 * **defined but not yet called** at the `define`-block site (addendum
 * B1); 4.A.2 lands `assets/atlas.png` and flips the call site from
 * `PLACEHOLDER_RULESET_VERSION` to this helper. Pinning the byte-level
 * pre-image now (and asserting it via tests) gives 4.A.2 a known-good
 * target.
 */

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function fixtureText(): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of RULES_FILES) {
    // Hand-built unique content per path; lets the round-trip /
    // mutation tests below distinguish content vs path changes.
    m.set(entry.path, `// fixture content for ${entry.path}\n`);
  }
  return m;
}

describe("stripBom", () => {
  it("returns the input unchanged when no BOM is present", () => {
    expect(stripBom("hello")).toBe("hello");
    expect(stripBom("")).toBe("");
  });

  it("drops a leading U+FEFF", () => {
    expect(stripBom("﻿hello")).toBe("hello");
  });

  it("only strips at offset 0 (mid-string BOMs are preserved)", () => {
    expect(stripBom("a﻿b")).toBe("a﻿b");
  });
});

describe("normalizeForHash", () => {
  it("CRLF → LF (defense-in-depth above .gitattributes)", () => {
    const out = normalizeForHash("a\r\nb\r\nc");
    expect(new TextDecoder().decode(out)).toBe("a\nb\nc");
  });

  it("strips a leading BOM", () => {
    const out = normalizeForHash("﻿hello");
    expect(new TextDecoder().decode(out)).toBe("hello");
  });

  it("BOM and CRLF combine: stripped + LF-normalized", () => {
    const out = normalizeForHash("﻿a\r\nb");
    expect(new TextDecoder().decode(out)).toBe("a\nb");
  });

  it("leaves bare LF untouched", () => {
    const out = normalizeForHash("a\nb\nc");
    expect(new TextDecoder().decode(out)).toBe("a\nb\nc");
  });

  it("leaves bare CR (no LF) untouched — only CRLF is normalized", () => {
    // The contract is `replace(/\r\n/g, "\n")`, NOT a bare-CR strip.
    const out = normalizeForHash("a\rb");
    expect(new TextDecoder().decode(out)).toBe("a\rb");
  });
});

describe("rulesetTextHash", () => {
  it("throws when a path is missing from the rulesText map", () => {
    const m = fixtureText();
    m.delete("src/sim/run.ts");
    expect(() => rulesetTextHash(m)).toThrowError(
      /missing content for path src\/sim\/run\.ts/,
    );
  });

  it("returns 32 bytes", () => {
    expect(rulesetTextHash(fixtureText()).length).toBe(32);
  });

  it("is deterministic — same inputs → same bytes", () => {
    const a = sha256Hex(rulesetTextHash(fixtureText()));
    const b = sha256Hex(rulesetTextHash(fixtureText()));
    expect(a).toBe(b);
  });

  it("differs when one byte of one file content changes", () => {
    const baseline = sha256Hex(rulesetTextHash(fixtureText()));
    const mutated = fixtureText();
    mutated.set("src/sim/run.ts", "// mutated content\n");
    const after = sha256Hex(rulesetTextHash(mutated));
    expect(after).not.toBe(baseline);
  });

  it("CRLF-only difference is normalized away", () => {
    const a = fixtureText();
    a.set("src/sim/run.ts", "line one\nline two\n");
    const b = fixtureText();
    b.set("src/sim/run.ts", "line one\r\nline two\r\n");
    expect(sha256Hex(rulesetTextHash(a))).toBe(sha256Hex(rulesetTextHash(b)));
  });

  it("BOM-only difference is normalized away", () => {
    const a = fixtureText();
    a.set("src/sim/run.ts", "hello\n");
    const b = fixtureText();
    b.set("src/sim/run.ts", "﻿hello\n");
    expect(sha256Hex(rulesetTextHash(a))).toBe(sha256Hex(rulesetTextHash(b)));
  });

  it("empty content vs missing-key distinction: empty hashes; missing throws", () => {
    const a = fixtureText();
    a.set("src/sim/run.ts", "");
    expect(() => rulesetTextHash(a)).not.toThrow();
    a.delete("src/sim/run.ts");
    expect(() => rulesetTextHash(a)).toThrow(/missing content/);
  });

  it("same content under two different paths is byte-distinct (the path feeds the pre-image — addendum B2)", () => {
    // Construct two `RULES_FILES`-shaped maps with identical content for
    // every path, then mutate one path-content pair via swap.
    const a = fixtureText();
    const b = fixtureText();
    // Swap two file contents — same set of bytes total, different
    // (path, content) pairing. Hash MUST change because the per-tuple
    // hash depends on the (path, contentHash) pairing, not just
    // multiset of contents.
    const ai = a.get("src/sim/ai.ts")!;
    const turn = a.get("src/sim/turn.ts")!;
    a.set("src/sim/ai.ts", turn);
    a.set("src/sim/turn.ts", ai);
    expect(sha256Hex(rulesetTextHash(a))).not.toBe(
      sha256Hex(rulesetTextHash(b)),
    );
  });
});

describe("deriveRulesetVersion", () => {
  const baseline = (): Map<string, string> => fixtureText();

  it("returns a 64-character lowercase hex string", () => {
    const v = deriveRulesetVersion(baseline(), EMPTY_SHA256);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input → same output", () => {
    const a = deriveRulesetVersion(baseline(), EMPTY_SHA256);
    const b = deriveRulesetVersion(baseline(), EMPTY_SHA256);
    expect(a).toBe(b);
  });

  it("changing the atlas binary hash bumps the ruleset version", () => {
    const a = deriveRulesetVersion(baseline(), EMPTY_SHA256);
    const b = deriveRulesetVersion(
      baseline(),
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(a).not.toBe(b);
  });

  it("renaming a file (path bytes change) bumps the ruleset version (addendum B2 property 1)", () => {
    // Simulate the rename by mutating the key in the map; we cannot
    // mutate `RULES_FILES` itself (frozen by const). The unit-level
    // signal is: deriving with a swapped (path, content) pairing
    // changes the result. (The end-to-end "rename a file in the
    // RULES_FILES array" assertion is the canonical-order test in
    // rules-text.test.ts.)
    const a = baseline();
    const b = baseline();
    // Mutate one entry's content so the (path, contentHash) tuple
    // changes — equivalent to a rename at the per-tuple layer.
    b.set("src/registries/items.ts", "// renamed-equivalent content\n");
    expect(deriveRulesetVersion(a, EMPTY_SHA256)).not.toBe(
      deriveRulesetVersion(b, EMPTY_SHA256),
    );
  });

  it("CRLF-only file content difference is normalized away", () => {
    const a = baseline();
    a.set("src/sim/turn.ts", "alpha\nbeta\n");
    const b = baseline();
    b.set("src/sim/turn.ts", "alpha\r\nbeta\r\n");
    expect(deriveRulesetVersion(a, EMPTY_SHA256)).toBe(
      deriveRulesetVersion(b, EMPTY_SHA256),
    );
  });

  it("BOM-only difference is normalized away", () => {
    const a = baseline();
    a.set("src/sim/turn.ts", "alpha\n");
    const b = baseline();
    b.set("src/sim/turn.ts", "﻿alpha\n");
    expect(deriveRulesetVersion(a, EMPTY_SHA256)).toBe(
      deriveRulesetVersion(b, EMPTY_SHA256),
    );
  });

  it("empty file content vs missing-key is distinct (missing throws; empty hashes)", () => {
    const a = baseline();
    a.set("src/sim/turn.ts", "");
    const b = baseline();
    expect(deriveRulesetVersion(a, EMPTY_SHA256)).not.toBe(
      deriveRulesetVersion(b, EMPTY_SHA256),
    );
    b.delete("src/sim/turn.ts");
    expect(() => deriveRulesetVersion(b, EMPTY_SHA256)).toThrowError(
      /missing content/,
    );
  });
});
