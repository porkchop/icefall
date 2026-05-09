/**
 * Phase 8.A.2a Node CLI wrapper for `src/verifier/verify.ts`. Per
 * `artifacts/decision-memo-phase-8.md` decision 10 + addendum B9.
 *
 * Reads a JSON-encoded `VerifyArgs` object from stdin, calls
 * `verify(...)`, and prints the JSON-encoded `VerifyResult` to stdout.
 * Exit code is 0 on `kind: "valid"`, 1 on any other kind, 2 on a
 * stdin-parse error.
 *
 * Usage:
 *   echo '{"fingerprint":"...","seed":"...","modIds":[],...}' | npx tsx tools/verify.ts
 *
 * The CLI runs in the same Node build context as the host repo's
 * `src/build-info.ts` (commitHash, rulesetVersion, atlasBinaryHash
 * read from the local checkout). To verify a URL minted against a
 * different commit, `git checkout <commit-short>` first; the
 * content-addressed `releases/<commit-short>/` layout provides
 * pinned visuals + pinned binary, but for verification the checkout
 * is the source of truth.
 */

import { verify, type VerifyArgs } from "../src/verifier/verify";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch (e) {
    process.stderr.write(
      `verify: failed to read stdin: ${(e as Error).message}\n`,
    );
    process.exit(2);
  }
  let args: VerifyArgs;
  try {
    args = JSON.parse(raw) as VerifyArgs;
  } catch (e) {
    process.stderr.write(
      `verify: stdin is not valid JSON: ${(e as Error).message}\n`,
    );
    process.exit(2);
  }
  const result = verify(args);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.kind === "valid" ? 0 : 1);
}

main().catch((e: Error) => {
  process.stderr.write(`verify: unexpected error: ${e.message}\n`);
  process.exit(3);
});
