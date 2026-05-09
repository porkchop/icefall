import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { encodeActionLog } from "../src/share/encode";
import { runScripted } from "../src/sim/harness";
import { fingerprintFull } from "../src/core/fingerprint";
import { sha256Hex } from "../src/core/hash";
import {
  PLACEHOLDER_RULESET_VERSION,
  EMPTY_SHA256,
} from "../src/build-info";
import type { Action } from "../src/core/encode";
import type { FingerprintInputs } from "../src/core/fingerprint";

/**
 * Phase 8.A.2a smoke test for `tools/verify.ts`. Spawns the CLI as a
 * child process via `npx tsx tools/verify.ts`, pipes JSON args on
 * stdin, and asserts the JSON result on stdout + the exit code.
 *
 * The CLI runs without the vitest atlas-binary-hash plugin, so its
 * `src/build-info.ts` constants fall back to:
 *   - commitHash: "dev000000000"            (Phase 8.A.1 12-char pin)
 *   - rulesetVersion: PLACEHOLDER_RULESET_VERSION
 *   - atlasBinaryHash: EMPTY_SHA256
 *
 * To avoid context-mismatch with the vitest runtime, the test
 * constructs `inputs` using these CLI fallback values directly so
 * the CLI's recomputed fingerprint agrees with the claim.
 */

const repoRoot = resolve(import.meta.dirname, "..");
const VERIFY_CLI = resolve(repoRoot, "tools/verify.ts");

const CLI_COMMIT_HASH = "dev000000000";
const CLI_RULESET_VERSION = PLACEHOLDER_RULESET_VERSION;
const CLI_ATLAS_BINARY_HASH = EMPTY_SHA256;

const SEED = "verify-cli-test";
const ACTIONS: readonly Action[] = [{ type: "wait" }, { type: "wait" }];

function happyArgsJson(): string {
  const inputs: FingerprintInputs = {
    commitHash: CLI_COMMIT_HASH,
    rulesetVersion: CLI_RULESET_VERSION,
    seed: SEED,
    modIds: [],
  };
  const result = runScripted({ inputs, actions: ACTIONS });
  return JSON.stringify({
    fingerprint: fingerprintFull(inputs),
    seed: SEED,
    modIds: [],
    actionLog: encodeActionLog(ACTIONS),
    claimedFinalStateHash: sha256Hex(result.finalState.stateHash),
    expectedAtlasBinaryHash: CLI_ATLAS_BINARY_HASH,
  });
}

function runCli(stdin: string): { stdout: string; status: number } {
  try {
    const stdout = execSync(`npx tsx ${VERIFY_CLI}`, {
      input: stdin,
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString("utf8");
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer };
    return {
      stdout: err.stdout ? err.stdout.toString("utf8") : "",
      status: typeof err.status === "number" ? err.status : -1,
    };
  }
}

describe("tools/verify.ts CLI smoke test", () => {
  it("exits 0 with kind: 'valid' when args are correct", () => {
    const { stdout, status } = runCli(happyArgsJson());
    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ kind: "valid" });
  });

  it("exits 1 with kind: 'fingerprint-mismatch' when fingerprint is wrong", () => {
    const args = JSON.parse(happyArgsJson()) as Record<string, unknown>;
    args["fingerprint"] = "AAAAAAAAAAAAAAAAAAAAAA";
    const { stdout, status } = runCli(JSON.stringify(args));
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as { kind: string };
    expect(parsed.kind).toBe("fingerprint-mismatch");
  });

  it("exits 2 when stdin is not valid JSON", () => {
    const { status } = runCli("not-json");
    expect(status).toBe(2);
  });
}, 60_000);
