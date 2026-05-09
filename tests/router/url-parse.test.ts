import { describe, expect, it } from "vitest";
import { parseShareUrl, formatShareUrl } from "../../src/router/url-parse";
import { encodeActionLog } from "../../src/share/encode";
import type { Action } from "../../src/core/encode";
import type { FingerprintInputs } from "../../src/core/fingerprint";

const BASE = "https://porkchop.github.io/icefall/";

describe("parseShareUrl — no `?run=` parameter", () => {
  it("returns kind:'no-run-param' on the bare URL with no params", () => {
    expect(parseShareUrl(BASE)).toEqual({ kind: "no-run-param", seed: null });
  });

  it("returns kind:'no-run-param' with the seed when only ?seed= is present (decision 11 daily-seed)", () => {
    expect(parseShareUrl(`${BASE}?seed=alpha-123`)).toEqual({
      kind: "no-run-param",
      seed: "alpha-123",
    });
  });

  it("rejects an empty ?seed= even without ?run= (clean error rather than silent boot from '')", () => {
    const r = parseShareUrl(`${BASE}?seed=`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.code).toMatch(/ROUTE_ERR_SEED_INVALID|seed= invalid/);
    }
  });

  it("falls through to no-run-param on an un-parseable href", () => {
    expect(parseShareUrl("not a url")).toEqual({
      kind: "no-run-param",
      seed: null,
    });
  });
});

describe("parseShareUrl — `?run=` validation", () => {
  it("rejects a fingerprint that's not 22 chars", () => {
    const r = parseShareUrl(`${BASE}?run=tooShort&seed=s`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/got 8: tooShort/);
    }
  });

  it("rejects a fingerprint with a non-base64url char (e.g. '@')", () => {
    const fp = "AAAAAAAAAAAAAAAAAAAA@A"; // 22 chars, '@' at index 20
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/non-base64url character at position 20/);
    }
  });

  it("requires ?seed= when ?run= is present", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/cannot reconstruct run/);
    }
  });

  it("rejects a NUL-containing seed (separator collision)", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=${encodeURIComponent("a\x00b")}`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/seed= invalid/);
    }
  });

  it("accepts the happy path — 22-char fp + valid seed + no mods + no log", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=alpha-1`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.claimedFingerprint).toBe(fp);
      expect(r.inputs.seed).toBe("alpha-1");
      expect(r.inputs.modIds).toEqual([]);
      expect(r.actionLog).toBeNull();
      expect(r.logWire).toBeNull();
    }
  });
});

describe("parseShareUrl — `?mods=` parsing", () => {
  it("returns empty modIds for absent ?mods=", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.inputs.modIds).toEqual([]);
  });

  it("returns empty modIds for empty ?mods=", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s&mods=`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.inputs.modIds).toEqual([]);
  });

  it("strips empty entries from `?mods=,a,b`", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s&mods=,a,b,`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.inputs.modIds).toEqual(["a", "b"]);
  });

  it("rejects a mod entry containing NUL", () => {
    const fp = "A".repeat(22);
    const modsParam = encodeURIComponent("a,b\x00c");
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s&mods=${modsParam}`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/entry 1 contains forbidden character/);
    }
  });
});

describe("parseShareUrl — `#log=` decode", () => {
  it("decodes a valid hash-fragment action log", () => {
    const actions: readonly Action[] = [{ type: "wait" }, { type: "wait" }];
    const wire = encodeActionLog(actions);
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s#log=${wire}`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.actionLog).toEqual(actions);
      expect(r.logWire).toBe(wire);
    }
  });

  it("returns null actionLog when no `#log=` is present", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.actionLog).toBeNull();
      expect(r.logWire).toBeNull();
    }
  });

  it("surfaces ROUTE_ERR_LOG_DECODE on a malformed `#log=` (kind:'error')", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s#log=@@@invalid`);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/#log= failed to decode —/);
    }
  });

  it("ignores an empty `#log=` (treats as no log)", () => {
    const fp = "A".repeat(22);
    const r = parseShareUrl(`${BASE}?run=${fp}&seed=s#log=`);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.actionLog).toBeNull();
  });
});

describe("formatShareUrl (round-trip with parseShareUrl)", () => {
  it("round-trips inputs + claimed fingerprint", () => {
    const inputs: FingerprintInputs = {
      commitHash: "deadbeef0000",
      rulesetVersion: "x".repeat(64),
      seed: "alpha-123",
      modIds: ["m1", "m2"],
    };
    const fp = "A".repeat(22);
    const url = formatShareUrl(inputs, fp, null, BASE);
    const parsed = parseShareUrl(url);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.claimedFingerprint).toBe(fp);
      expect(parsed.inputs.seed).toBe("alpha-123");
      expect(parsed.inputs.modIds).toEqual(["m1", "m2"]);
    }
  });

  it("round-trips with a `#log=` fragment", () => {
    const inputs: FingerprintInputs = {
      commitHash: "deadbeef0000",
      rulesetVersion: "x".repeat(64),
      seed: "alpha-123",
      modIds: [],
    };
    const fp = "A".repeat(22);
    const actions: readonly Action[] = [{ type: "wait" }];
    const wire = encodeActionLog(actions);
    const url = formatShareUrl(inputs, fp, wire, BASE);
    const parsed = parseShareUrl(url);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") {
      expect(parsed.logWire).toBe(wire);
      expect(parsed.actionLog).toEqual(actions);
    }
  });

  it("sorts modIds before joining (mirrors the canonical fingerprint pre-image)", () => {
    const inputs: FingerprintInputs = {
      commitHash: "deadbeef0000",
      rulesetVersion: "x".repeat(64),
      seed: "s",
      modIds: ["zzz", "aaa", "mmm"],
    };
    const fp = "A".repeat(22);
    const url = formatShareUrl(inputs, fp, null, BASE);
    const u = new URL(url);
    expect(u.searchParams.get("mods")).toBe("aaa,mmm,zzz");
  });

  // Phase 8.A.3 regression test (code-review-phase-8-A-3.md B2). The
  // applyRouting canonicalization step calls formatShareUrl with the
  // FULL existing href (not origin + pathname). Unrecognized query
  // params — most importantly `?mode=replay` which the Replay-this-run
  // section reads later — must be preserved through the round-trip.
  it("preserves unrecognized query params (e.g. ?mode=replay) when canonicalizing", () => {
    const inputs: FingerprintInputs = {
      commitHash: "deadbeef0000",
      rulesetVersion: "x".repeat(64),
      seed: "s",
      modIds: [],
    };
    const fp = "A".repeat(22);
    const inputUrl = `${BASE}?run=${fp}&seed=s&mode=replay`;
    const canonical = formatShareUrl(inputs, fp, null, inputUrl);
    const u = new URL(canonical);
    expect(u.searchParams.get("run")).toBe(fp);
    expect(u.searchParams.get("seed")).toBe("s");
    // The critical assertion: ?mode=replay survives canonicalization.
    expect(u.searchParams.get("mode")).toBe("replay");
  });
});
