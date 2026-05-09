import { sha256Hex } from "../core/hash";
import {
  fingerprintFull,
  FINGERPRINT_SHORT_LEN,
  type FingerprintInputs,
} from "../core/fingerprint";
import {
  commitHash,
  rulesetVersion,
  atlasBinaryHash,
} from "../build-info";
import { decodeActionLog } from "../share/decode";
import { runScripted } from "../sim/harness";
import type { RunOutcome } from "../sim/types";

/**
 * Phase 8 verifier — pure function `verify(args) → VerifyResult`.
 *
 * Per `artifacts/decision-memo-phase-8.md` decision 10 + addendum
 * advisory A4. The verifier is **build-context-trust-anchored**: it
 * reads `commitHash`, `rulesetVersion`, and `atlasBinaryHash` from
 * `src/build-info.ts` (the current build's pinned constants) and
 * checks the supplied claim against them. The router layer (8.A.2b)
 * is responsible for redirecting URLs whose claimed build does not
 * match the current build BEFORE `verify(...)` is called; this
 * function does NOT enumerate `releases/index.json`.
 *
 * The `kind` discriminator on the result enumerates every failure
 * mode the verifier can produce. Adding a new kind is **additive**
 * (no `rulesetVersion` bump — the router and CLI will surface a
 * generic "unrecognized verify result" message until they're
 * updated). Removing or renaming a kind is a `rulesetVersion` bump.
 */

export type VerifyArgs = {
  /** The 22-char (short) or 43-char (full) base64url fingerprint. */
  readonly fingerprint: string;
  /** The run seed string. */
  readonly seed: string;
  /** Canonical sortedModIds — empty array for v1 (no mod loaded). */
  readonly modIds: readonly string[];
  /** Action-log wire form (`base64url(zlibSync(envelope))`). */
  readonly actionLog: string;
  /** 64-char lowercase hex SHA-256 of the claimed final state. */
  readonly claimedFinalStateHash: string;
  /**
   * Required (advisory A4 — defense-in-depth): the atlasBinaryHash
   * the URL was minted against. Verifier returns `atlas-mismatch`
   * if it differs from the current build's `atlasBinaryHash`.
   */
  readonly expectedAtlasBinaryHash: string;
  /** Optional: the rulesetVersion the URL was minted against. */
  readonly expectedRulesetVersion?: string;
  /** Optional: assert the run reached this outcome. */
  readonly expectedOutcome?: RunOutcome;
};

export type VerifyResult =
  | { readonly kind: "valid" }
  | { readonly kind: "fingerprint-mismatch"; readonly computed: string }
  | {
      readonly kind: "ruleset-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "atlas-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "state-hash-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "outcome-mismatch";
      readonly expected: RunOutcome;
      readonly actual: RunOutcome;
    }
  | { readonly kind: "log-rejected"; readonly reason: string };

/**
 * Run the verifier over the claim. Pure function: no I/O, no
 * fetch, no DOM. Safe to call from Node CLI, browser, in-page
 * replay viewer, and unit tests.
 *
 * Check order is fingerprint → atlas → ruleset → log → outcome →
 * state-hash. The atlas check fires before the ruleset check
 * because `expectedAtlasBinaryHash` is REQUIRED (advisory A4) and
 * `expectedRulesetVersion` is optional — surfacing the required-
 * field mismatch first matches the calling contract's mental model.
 */
export function verify(args: VerifyArgs): VerifyResult {
  const inputs: FingerprintInputs = {
    commitHash,
    rulesetVersion,
    seed: args.seed,
    modIds: args.modIds,
  };

  const computedFull = fingerprintFull(inputs);
  const computedShort = computedFull.slice(0, FINGERPRINT_SHORT_LEN);

  // The claim may be the 22-char short form OR the 43-char full
  // form. Compare on whichever the caller supplied; the rejection
  // surface returns whichever truthful form the caller can act on.
  if (args.fingerprint.length === 43) {
    if (args.fingerprint !== computedFull) {
      return { kind: "fingerprint-mismatch", computed: computedFull };
    }
  } else if (args.fingerprint.slice(0, FINGERPRINT_SHORT_LEN) !== computedShort) {
    return { kind: "fingerprint-mismatch", computed: computedShort };
  }

  if (args.expectedAtlasBinaryHash !== atlasBinaryHash) {
    return {
      kind: "atlas-mismatch",
      expected: args.expectedAtlasBinaryHash,
      actual: atlasBinaryHash,
    };
  }

  if (
    args.expectedRulesetVersion !== undefined &&
    args.expectedRulesetVersion !== rulesetVersion
  ) {
    return {
      kind: "ruleset-mismatch",
      expected: args.expectedRulesetVersion,
      actual: rulesetVersion,
    };
  }

  let actions;
  try {
    actions = decodeActionLog(args.actionLog);
  } catch (e) {
    return { kind: "log-rejected", reason: (e as Error).message };
  }

  const result = runScripted({ inputs, actions });

  if (
    args.expectedOutcome !== undefined &&
    result.outcome !== args.expectedOutcome
  ) {
    return {
      kind: "outcome-mismatch",
      expected: args.expectedOutcome,
      actual: result.outcome,
    };
  }

  const actualHash = sha256Hex(result.finalState.stateHash);
  if (actualHash !== args.claimedFinalStateHash) {
    return {
      kind: "state-hash-mismatch",
      expected: args.claimedFinalStateHash,
      actual: actualHash,
    };
  }

  return { kind: "valid" };
}
