import { describe, expect, it } from "vitest";
import {
  fingerprint,
  fingerprintFull,
  fingerprintBytes,
  FINGERPRINT_SHORT_LEN,
  DEV_PREFIX,
} from "./fingerprint";
import { PLACEHOLDER_RULESET_VERSION } from "../build-info";
import { sha256Hex } from "./hash";

const REAL_RULESET = "ruleset-v1-test";

const baseInputs = {
  commitHash: "abcd123def56",
  rulesetVersion: REAL_RULESET,
  seed: "2026-05-03",
  modIds: [],
};

describe("fingerprintBytes", () => {
  it("returns 32 bytes", () => {
    expect(fingerprintBytes(baseInputs).length).toBe(32);
  });

  it("is deterministic", () => {
    expect(sha256Hex(fingerprintBytes(baseInputs))).toBe(
      sha256Hex(fingerprintBytes(baseInputs)),
    );
  });

  it("changes when commitHash changes", () => {
    const a = sha256Hex(fingerprintBytes(baseInputs));
    const b = sha256Hex(
      fingerprintBytes({ ...baseInputs, commitHash: "ffff999aaaaa" }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when rulesetVersion changes", () => {
    const a = sha256Hex(fingerprintBytes(baseInputs));
    const b = sha256Hex(
      fingerprintBytes({ ...baseInputs, rulesetVersion: "v2" }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when seed changes", () => {
    const a = sha256Hex(fingerprintBytes(baseInputs));
    const b = sha256Hex(fingerprintBytes({ ...baseInputs, seed: "x" }));
    expect(a).not.toBe(b);
  });

  it("is invariant under modIds permutation (sorted before hashing)", () => {
    const a = sha256Hex(
      fingerprintBytes({ ...baseInputs, modIds: ["alpha", "beta", "gamma"] }),
    );
    const b = sha256Hex(
      fingerprintBytes({ ...baseInputs, modIds: ["gamma", "alpha", "beta"] }),
    );
    const c = sha256Hex(
      fingerprintBytes({ ...baseInputs, modIds: ["beta", "gamma", "alpha"] }),
    );
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("distinguishes empty modIds from a single empty-string modId", () => {
    const a = sha256Hex(fingerprintBytes({ ...baseInputs, modIds: [] }));
    const b = sha256Hex(fingerprintBytes({ ...baseInputs, modIds: [""] }));
    expect(a).toBe(b); // both encode as empty string after join
    // But two empty modIds vs one empty modId differ:
    const c = sha256Hex(fingerprintBytes({ ...baseInputs, modIds: ["", ""] }));
    expect(a).not.toBe(c);
  });

  it("rejects NUL in any field", () => {
    expect(() =>
      fingerprintBytes({ ...baseInputs, commitHash: "a\x00b" }),
    ).toThrowError(/NUL/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, rulesetVersion: "a\x00b" }),
    ).toThrowError(/NUL/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, seed: "a\x00b" }),
    ).toThrowError(/NUL/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, modIds: ["a\x00b"] }),
    ).toThrowError(/NUL/);
  });

  it("rejects comma in any modId", () => {
    expect(() =>
      fingerprintBytes({ ...baseInputs, modIds: ["a,b"] }),
    ).toThrowError(/comma/);
  });

  it("rejects unpaired surrogates in any field", () => {
    expect(() =>
      fingerprintBytes({ ...baseInputs, commitHash: "\uD800" }),
    ).toThrowError(/surrogate/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, rulesetVersion: "\uDC00" }),
    ).toThrowError(/surrogate/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, seed: "\uD800" }),
    ).toThrowError(/surrogate/);
    expect(() =>
      fingerprintBytes({ ...baseInputs, modIds: ["\uD800"] }),
    ).toThrowError(/surrogate/);
  });
});

describe("fingerprint", () => {
  it("is 22 characters under a real ruleset version", () => {
    const f = fingerprint(baseInputs);
    expect(f.length).toBe(FINGERPRINT_SHORT_LEN);
    expect(f).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is prefixed with DEV- under the placeholder ruleset", () => {
    const f = fingerprint({
      ...baseInputs,
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
    });
    expect(f.startsWith(DEV_PREFIX)).toBe(true);
    expect(f.length).toBe(DEV_PREFIX.length + FINGERPRINT_SHORT_LEN);
  });

  it("is stable across calls", () => {
    expect(fingerprint(baseInputs)).toBe(fingerprint(baseInputs));
  });

  it("distinguishes real-ruleset vs placeholder fingerprints byte-for-byte", () => {
    const real = fingerprint(baseInputs);
    const dev = fingerprint({
      ...baseInputs,
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
    });
    expect(real).not.toBe(dev);
  });

  it("matches a hardcoded golden value", () => {
    expect(fingerprint(baseInputs)).toBe("iyFf_akWHbsMe8lprGyrH6");
  });

  // Phase 8.A.1 addendum B4: 12-char commit hash form is the
  // forever-collision-resistant pin (vite.config.ts:7 `--short=12`).
  // The pre-image is byte-changed from the previous 7-char form;
  // this golden is the new pinned vector under the 12-char build.
  it("matches the 12-char-commit golden for the canonical baseInputs", () => {
    expect(baseInputs.commitHash.length).toBe(12);
    expect(baseInputs.commitHash).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint(baseInputs)).toBe("iyFf_akWHbsMe8lprGyrH6");
  });

  // Phase 8.A.1 addendum B4 + decision 1 + decision 1a: the mod-ID
  // slot is part of the fingerprint pre-image (Phase 1 frozen
  // contract); Phase 8 exercises it with a synthetic mod-ID and
  // pins the resulting golden so the empty-mods vs single-mod path
  // is byte-distinct. The Phase 9 mod loader inherits this surface
  // unchanged.
  it("matches the synthetic-mod-ID golden (Phase 8 mod-slot exercise)", () => {
    const withMod = {
      ...baseInputs,
      modIds: ["icefall.mod.test-vector-1"],
    };
    expect(fingerprint(withMod)).toBe("lTehjjHQfSlG1G9okHmwhT");
    expect(fingerprint(withMod)).not.toBe(fingerprint(baseInputs));
  });
});

describe("fingerprintFull", () => {
  it("is 43 characters", () => {
    expect(fingerprintFull(baseInputs).length).toBe(43);
  });

  it("never has the DEV- prefix even under placeholder ruleset", () => {
    const f = fingerprintFull({
      ...baseInputs,
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
    });
    expect(f.startsWith(DEV_PREFIX)).toBe(false);
    expect(f.length).toBe(43);
  });

  it("starts with the same 22 chars as fingerprint(...) under a real ruleset", () => {
    const short = fingerprint(baseInputs);
    const full = fingerprintFull(baseInputs);
    expect(full.startsWith(short)).toBe(true);
  });
});
