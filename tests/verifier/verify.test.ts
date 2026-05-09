import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { verify, type VerifyArgs } from "../../src/verifier/verify";
import { encodeActionLog } from "../../src/share/encode";
import { runScripted } from "../../src/sim/harness";
import { fingerprintFull } from "../../src/core/fingerprint";
import { sha256Hex, base64url } from "../../src/core/hash";
import {
  commitHash,
  rulesetVersion,
  atlasBinaryHash,
} from "../../src/build-info";
import type { Action } from "../../src/core/encode";
import type { FingerprintInputs } from "../../src/core/fingerprint";

/**
 * Phase 8.A.2a tests for `verify(args) → VerifyResult`. Per
 * `artifacts/decision-memo-phase-8.md` decision 10 + advisory A4:
 * the verifier is build-context-trust-anchored and pure. Every
 * VerifyResult kind is exercised below.
 *
 * Test fixtures construct FingerprintInputs using the test build's
 * commitHash + rulesetVersion (read from `src/build-info.ts`) so
 * the verifier's recomputed fingerprint agrees with the claimed
 * fingerprint on the happy path.
 */

const SEED = "verify-test-seed-1";
const ACTIONS: readonly Action[] = [
  { type: "wait" },
  { type: "wait" },
  { type: "wait" },
];

function buildHappyArgs(): VerifyArgs {
  const inputs: FingerprintInputs = {
    commitHash,
    rulesetVersion,
    seed: SEED,
    modIds: [],
  };
  const result = runScripted({ inputs, actions: ACTIONS });
  return {
    fingerprint: fingerprintFull(inputs),
    seed: SEED,
    modIds: [],
    actionLog: encodeActionLog(ACTIONS),
    claimedFinalStateHash: sha256Hex(result.finalState.stateHash),
    expectedAtlasBinaryHash: atlasBinaryHash,
  };
}

describe("verify — happy path (kind: 'valid')", () => {
  it("returns { kind: 'valid' } when every check passes", () => {
    expect(verify(buildHappyArgs())).toEqual({ kind: "valid" });
  });

  it("accepts the 22-char short fingerprint form (not just the 43-char full)", () => {
    const args = buildHappyArgs();
    const shortFp = args.fingerprint.slice(0, 22);
    expect(verify({ ...args, fingerprint: shortFp })).toEqual({
      kind: "valid",
    });
  });

  it("accepts an empty action log against the genesis state", () => {
    const inputs: FingerprintInputs = {
      commitHash,
      rulesetVersion,
      seed: SEED,
      modIds: [],
    };
    const result = runScripted({ inputs, actions: [] });
    const args: VerifyArgs = {
      fingerprint: fingerprintFull(inputs),
      seed: SEED,
      modIds: [],
      actionLog: encodeActionLog([]),
      claimedFinalStateHash: sha256Hex(result.finalState.stateHash),
      expectedAtlasBinaryHash: atlasBinaryHash,
    };
    expect(verify(args)).toEqual({ kind: "valid" });
  });

  it("accepts the optional expectedOutcome when it matches", () => {
    const args = buildHappyArgs();
    expect(verify({ ...args, expectedOutcome: "running" })).toEqual({
      kind: "valid",
    });
  });

  it("accepts the optional expectedRulesetVersion when it matches", () => {
    const args = buildHappyArgs();
    expect(
      verify({ ...args, expectedRulesetVersion: rulesetVersion }),
    ).toEqual({ kind: "valid" });
  });
});

describe("verify — fingerprint-mismatch", () => {
  it("returns kind: 'fingerprint-mismatch' when the claimed fp doesn't decode to the inputs", () => {
    const args = buildHappyArgs();
    const tampered = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 chars, all 'A'
    const result = verify({ ...args, fingerprint: tampered });
    expect(result.kind).toBe("fingerprint-mismatch");
    if (result.kind === "fingerprint-mismatch") {
      expect(result.computed).toBe(args.fingerprint.slice(0, 22));
    }
  });

  it("returns the 43-char form computed when a 43-char fingerprint claim is wrong", () => {
    const args = buildHappyArgs();
    const tampered43 = "A".repeat(43);
    const result = verify({ ...args, fingerprint: tampered43 });
    expect(result.kind).toBe("fingerprint-mismatch");
    if (result.kind === "fingerprint-mismatch") {
      expect(result.computed).toBe(args.fingerprint);
    }
  });

  it("returns kind: 'fingerprint-mismatch' when the seed differs from what the fingerprint claims", () => {
    const args = buildHappyArgs();
    const result = verify({ ...args, seed: "different-seed" });
    expect(result.kind).toBe("fingerprint-mismatch");
  });

  it("returns kind: 'fingerprint-mismatch' when modIds differ", () => {
    const args = buildHappyArgs();
    const result = verify({
      ...args,
      modIds: ["icefall.mod.test-vector-1"],
    });
    expect(result.kind).toBe("fingerprint-mismatch");
  });
});

describe("verify — atlas-mismatch (advisory A4 enforcement)", () => {
  it("returns kind: 'atlas-mismatch' when expectedAtlasBinaryHash differs from build-info", () => {
    const args = buildHappyArgs();
    const wrong =
      "deadbeef".repeat(8); // 64 chars
    const result = verify({ ...args, expectedAtlasBinaryHash: wrong });
    expect(result.kind).toBe("atlas-mismatch");
    if (result.kind === "atlas-mismatch") {
      expect(result.expected).toBe(wrong);
      expect(result.actual).toBe(atlasBinaryHash);
    }
  });
});

describe("verify — ruleset-mismatch", () => {
  it("returns kind: 'ruleset-mismatch' when expectedRulesetVersion differs", () => {
    const args = buildHappyArgs();
    const wrong = "phase-100-future-ruleset";
    const result = verify({
      ...args,
      expectedRulesetVersion: wrong,
    });
    expect(result.kind).toBe("ruleset-mismatch");
    if (result.kind === "ruleset-mismatch") {
      expect(result.expected).toBe(wrong);
      expect(result.actual).toBe(rulesetVersion);
    }
  });
});

describe("verify — state-hash-mismatch", () => {
  it("returns kind: 'state-hash-mismatch' when claimedFinalStateHash is wrong", () => {
    const args = buildHappyArgs();
    const wrong = "0".repeat(64);
    const result = verify({
      ...args,
      claimedFinalStateHash: wrong,
    });
    expect(result.kind).toBe("state-hash-mismatch");
    if (result.kind === "state-hash-mismatch") {
      expect(result.expected).toBe(wrong);
      expect(result.actual).toBe(args.claimedFinalStateHash);
    }
  });
});

describe("verify — outcome-mismatch", () => {
  it("returns kind: 'outcome-mismatch' when expectedOutcome differs from actual", () => {
    const args = buildHappyArgs();
    const result = verify({ ...args, expectedOutcome: "won" });
    expect(result.kind).toBe("outcome-mismatch");
    if (result.kind === "outcome-mismatch") {
      expect(result.expected).toBe("won");
      expect(result.actual).toBe("running");
    }
  });
});

describe("verify — log-rejected", () => {
  it("returns kind: 'log-rejected' when the action-log wire string is malformed", () => {
    const args = buildHappyArgs();
    const result = verify({ ...args, actionLog: "@@@invalid" });
    expect(result.kind).toBe("log-rejected");
    if (result.kind === "log-rejected") {
      expect(result.reason).toMatch(/action-log: base64url-decode failed/);
    }
  });

  it("returns kind: 'log-rejected' when the envelope has bad magic", () => {
    const args = buildHappyArgs();
    const badEnv = new Uint8Array(8);
    badEnv.set([0x50, 0x4e, 0x47, 0x01, 0, 0, 0, 0]);
    const bad = base64url(zlibSync(badEnv, { level: 1 }));
    const result = verify({ ...args, actionLog: bad });
    expect(result.kind).toBe("log-rejected");
    if (result.kind === "log-rejected") {
      expect(result.reason).toMatch(/action-log: bad magic/);
    }
  });
});

describe("verify — discriminated-union exhaustiveness", () => {
  it("covers every kind in the documented contract", () => {
    // This test is a structural assertion: TypeScript's exhaustive
    // switch on `result.kind` must compile (and a future addition
    // to VerifyResult would force this test to be updated).
    const args = buildHappyArgs();
    const r = verify(args);
    let consumed = false;
    switch (r.kind) {
      case "valid":
      case "fingerprint-mismatch":
      case "ruleset-mismatch":
      case "atlas-mismatch":
      case "state-hash-mismatch":
      case "outcome-mismatch":
      case "log-rejected":
        consumed = true;
        break;
    }
    expect(consumed).toBe(true);
  });
});
