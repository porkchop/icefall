/**
 * Phase 8.A.3 publish-dual script. Per
 * `artifacts/decision-memo-phase-8.md` decision 7 + addendum B5 + B9
 * + advisory A7.
 *
 * Reads the previous deploy's `releases/index.json`, merges the new
 * commit's entry, and writes the updated index to
 * `dist-final/releases/index.json`. The new entry is prepended (the
 * router enumerates newest-first per addendum B5).
 *
 * **Bootstrap-from-local fallback (advisory A7).** When fetching the
 * previous deploy's index fails (HTTP error, DNS failure, the very
 * first 8.A.3 deploy when the URL doesn't exist), the script falls
 * back to the local `dist-final/releases/index.json` if present,
 * else seeds an empty index. Failures are logged.
 *
 * **Re-deploy of the same commit-short** (rare but possible — manual
 * workflow_dispatch trigger): the existing entry is replaced rather
 * than duplicated. The `publishedAt` timestamp is updated to the
 * current run's value.
 *
 * Usage:
 *   node scripts/publish-dual.mjs \
 *     --commit-short=<12-hex> \
 *     --published-at=<ISO-8601 UTC> \
 *     --dist-final=<path> \
 *     [--prior-index-url=<URL>] \
 *     [--root=<repo-root>]
 *
 * `rulesetVersion` and `atlasBinaryHash` are NOT passed as args —
 * the script computes them directly from `RULES_FILES` content +
 * `assets/atlas.png` via `computeDefinePayload(root)` (the same
 * helper the Vite atlas-binary-hash plugin uses). This avoids
 * brittle bundle-grep extraction of build-time constants.
 *
 * The script is invoked from `.github/workflows/deploy.yml` after
 * `build-dual.mjs` has assembled `dist-final/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { computeDefinePayload } from "./vite-plugin-atlas-binary-hash.mjs";

export const SCHEMA_VERSION = 1;
export const COMMIT_HEX_RE = /^[0-9a-f]{12}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Pure merge logic. Takes the parsed prior `ReleaseIndex` (or `null`
 * for bootstrap) plus the new `ReleaseEntry`, returns the updated
 * `ReleaseIndex` with the new entry prepended (newest-first) and any
 * existing same-commitShort entry replaced.
 *
 * Exposed for tests; no I/O.
 */
export function mergeReleaseIndex(prior, newEntry) {
  validateEntry(newEntry);
  const releases = [];
  releases.push(newEntry);
  if (prior !== null && prior !== undefined) {
    if (prior.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `mergeReleaseIndex: prior schemaVersion ${prior.schemaVersion} unsupported`,
      );
    }
    for (const entry of prior.releases) {
      if (entry.commitShort === newEntry.commitShort) continue;
      releases.push(entry);
    }
  }
  return { schemaVersion: SCHEMA_VERSION, releases };
}

function validateEntry(entry) {
  if (typeof entry !== "object" || entry === null) {
    throw new Error("mergeReleaseIndex: entry must be an object");
  }
  for (const [field, regex] of [
    ["commitShort", COMMIT_HEX_RE],
    ["commitHash", COMMIT_HEX_RE],
    ["rulesetVersion", SHA256_HEX_RE],
    ["atlasBinaryHash", SHA256_HEX_RE],
    ["publishedAt", ISO_8601_UTC_RE],
  ]) {
    const v = entry[field];
    if (typeof v !== "string" || !regex.test(v)) {
      throw new Error(
        `mergeReleaseIndex: entry.${field} must match ${regex} (got ${JSON.stringify(v)})`,
      );
    }
  }
}

/**
 * Pure validation of a parsed prior-index (e.g. from a fetch).
 * Returns the prior index if valid, or `null` (treating it as a
 * bootstrap case — the script logs a warning).
 */
export function tryParsePriorIndex(text) {
  try {
    const obj = JSON.parse(text);
    if (
      typeof obj !== "object" ||
      obj === null ||
      obj.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(obj.releases)
    ) {
      return null;
    }
    // Per-entry shape validation; reject the whole prior index on the
    // first malformed entry (defensive — a tampered or partially-
    // written index could otherwise leak garbage forward).
    for (const e of obj.releases) {
      validateEntry(e);
    }
    return obj;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-z-]+)=(.+)$/);
    if (!m) {
      throw new Error(`publish-dual: unrecognized argument '${a}'`);
    }
    args[m[1]] = m[2];
  }
  for (const required of [
    "commit-short",
    "published-at",
    "dist-final",
  ]) {
    if (!(required in args)) {
      throw new Error(`publish-dual: missing required arg --${required}=...`);
    }
  }
  return args;
}

async function fetchPriorIndex(url) {
  if (typeof fetch !== "function") {
    console.warn(
      "publish-dual: global fetch is unavailable; skipping prior-index fetch",
    );
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) {
      console.warn(
        `publish-dual: prior-index fetch ${url} returned HTTP ${res.status}`,
      );
      return null;
    }
    const text = await res.text();
    const parsed = tryParsePriorIndex(text);
    if (parsed === null) {
      console.warn(
        `publish-dual: prior-index at ${url} parsed as malformed`,
      );
    }
    return parsed;
  } catch (e) {
    console.warn(
      `publish-dual: prior-index fetch ${url} failed: ${e.message}`,
    );
    return null;
  }
}

function readLocalIndex(distFinal) {
  const p = join(distFinal, "releases", "index.json");
  if (!existsSync(p)) return null;
  try {
    return tryParsePriorIndex(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeIndex(distFinal, index) {
  const dir = join(distFinal, "releases");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, "index.json");
  writeFileSync(p, JSON.stringify(index, null, 2) + "\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const root = args["root"] ? resolve(args["root"]) : process.cwd();

  // Compute rulesetVersion + atlasBinaryHash from the source of truth
  // (RULES_FILES + assets/atlas.png) using the same helper the Vite
  // plugin uses. This guarantees the entry's hashes match what the
  // built bundle injected.
  const payload = computeDefinePayload(root);
  if (payload.missing) {
    throw new Error(
      "publish-dual: assets/atlas.png is missing — cannot compute atlasBinaryHash for the new release entry",
    );
  }

  const newEntry = {
    commitShort: args["commit-short"],
    commitHash: args["commit-short"],
    rulesetVersion: payload.rulesetVersion,
    atlasBinaryHash: payload.hash,
    publishedAt: args["published-at"],
  };

  let prior = null;
  if (args["prior-index-url"]) {
    prior = await fetchPriorIndex(args["prior-index-url"]);
  }
  if (prior === null) {
    console.warn(
      "publish-dual: falling back to local dist-final/releases/index.json (advisory A7)",
    );
    prior = readLocalIndex(args["dist-final"]);
  }
  if (prior === null) {
    console.warn(
      "publish-dual: bootstrap mode — seeding releases/index.json from local-only state",
    );
  }

  const merged = mergeReleaseIndex(prior, newEntry);
  writeIndex(args["dist-final"], merged);

  console.log(
    `publish-dual: wrote ${merged.releases.length} entries to ${join(args["dist-final"], "releases", "index.json")}`,
  );
  console.log(`publish-dual: newest entry: ${newEntry.commitShort}`);
}

// Only run main() when this script is invoked directly (not when
// imported by tests). Vitest imports the module to test the pure
// functions; CI invokes it as `node scripts/publish-dual.mjs ...`.
const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("publish-dual.mjs");
if (isCli) {
  main().catch((e) => {
    console.error(`publish-dual: ${e.message}`);
    process.exit(1);
  });
}

// Re-exported for the build-dual orchestrator and tests.
export { fetchPriorIndex, readLocalIndex, writeIndex, parseArgs };

// silence unused-import warning for `dirname` in case downstream
// importers want to use it without a separate import.
void dirname;
