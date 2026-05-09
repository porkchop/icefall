/**
 * Phase 8 `releases/index.json` parser. Per
 * `artifacts/decision-memo-phase-8.md` decision 7 + addendum B4 + B5
 * + B9.
 *
 * **Schema v1** (memo addendum B4):
 *
 * ```ts
 * type ReleaseEntry = {
 *   commitShort:    string;   // /^[0-9a-f]{12}$/
 *   commitHash:     string;   // /^[0-9a-f]{12}$/ — alias for v1
 *   rulesetVersion: string;   // /^[0-9a-f]{64}$/
 *   atlasBinaryHash: string;  // /^[0-9a-f]{64}$/
 *   publishedAt:    string;   // ISO-8601 UTC, /^\d{4}-..Z$/
 * };
 *
 * type ReleaseIndex = {
 *   schemaVersion: 1;
 *   releases: ReleaseEntry[];   // newest-first by publishedAt
 * };
 * ```
 *
 * **Advisory A1.** This file is the ONE in `src/router/**` allowed
 * to use `Date` (lifted in `eslint.config.js`'s narrower override
 * scope). The `publishedAt` field is read-only consumption: parse
 * the ISO-8601 string with `new Date(s)` and call `.toISOString()`
 * to round-trip-verify it normalizes to the same string. No
 * wall-clock reads (`Date.now()` remains banned).
 *
 * Any rejection produces an `Error` whose message is prefixed
 * `release-index:` for callers (router/redirect) to distinguish
 * envelope-shape failures from runtime errors.
 */

const SCHEMA_VERSION = 1;
const COMMIT_HEX_RE = /^[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export type ReleaseEntry = {
  readonly commitShort: string;
  readonly commitHash: string;
  readonly rulesetVersion: string;
  readonly atlasBinaryHash: string;
  readonly publishedAt: string;
};

export type ReleaseIndex = {
  readonly schemaVersion: 1;
  readonly releases: readonly ReleaseEntry[];
};

function fail(msg: string): never {
  throw new Error(`release-index: ${msg}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireStringField(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    fail(`${context}: field '${key}' must be a string (got ${typeof v})`);
  }
  return v;
}

/**
 * Parse a `releases/index.json` document. Throws on schema-shape
 * mismatch with a `release-index:`-prefixed error message.
 *
 * Caller is responsible for fetching the JSON text (typically via
 * `fetch(RELEASES_INDEX_URL).then(r => r.text())`) — keeping the
 * parser pure means the same function is callable from tests
 * (Vitest in Node) and from the router's redirect logic (browser).
 */
export function parseReleaseIndex(json: string): ReleaseIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    fail(`JSON parse failed: ${(e as Error).message}`);
  }
  if (!isObj(raw)) {
    fail(`top-level value must be an object (got ${typeof raw})`);
  }
  const schemaVersion = raw["schemaVersion"];
  if (schemaVersion !== SCHEMA_VERSION) {
    fail(
      `unsupported schemaVersion ${String(schemaVersion)} (this build supports schemaVersion=1)`,
    );
  }
  const releasesRaw = raw["releases"];
  if (!Array.isArray(releasesRaw)) {
    fail(`field 'releases' must be an array`);
  }

  const releases: ReleaseEntry[] = [];
  for (let i = 0; i < releasesRaw.length; i++) {
    const entry = releasesRaw[i];
    if (!isObj(entry)) {
      fail(`releases[${i}] must be an object (got ${typeof entry})`);
    }
    const ctx = `releases[${i}]`;
    const commitShort = requireStringField(entry, "commitShort", ctx);
    const commitHash = requireStringField(entry, "commitHash", ctx);
    const rulesetVersion = requireStringField(entry, "rulesetVersion", ctx);
    const atlasBinaryHash = requireStringField(entry, "atlasBinaryHash", ctx);
    const publishedAt = requireStringField(entry, "publishedAt", ctx);

    if (!COMMIT_HEX_RE.test(commitShort)) {
      fail(`${ctx}.commitShort must match /^[0-9a-f]{12}$/ (got '${commitShort}')`);
    }
    if (!COMMIT_HEX_RE.test(commitHash)) {
      fail(`${ctx}.commitHash must match /^[0-9a-f]{12}$/ (got '${commitHash}')`);
    }
    if (!SHA256_HEX_RE.test(rulesetVersion)) {
      fail(`${ctx}.rulesetVersion must match /^[0-9a-f]{64}$/`);
    }
    if (!SHA256_HEX_RE.test(atlasBinaryHash)) {
      fail(`${ctx}.atlasBinaryHash must match /^[0-9a-f]{64}$/`);
    }
    if (!ISO_8601_UTC_RE.test(publishedAt)) {
      fail(
        `${ctx}.publishedAt must match /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/ (got '${publishedAt}')`,
      );
    }
    // Advisory A1: round-trip-validate the ISO-8601 string against
    // Date to defend against e.g. '2026-13-32T25:99:99Z' which
    // matches the regex syntactically but is semantically invalid.
    // `new Date(s).toISOString()` throws RangeError on an invalid
    // calendar date (e.g. month=13); catch that and surface our
    // pinned message.
    let roundTruncated: string;
    try {
      roundTruncated = new Date(publishedAt).toISOString().replace(/\.\d{3}Z$/, "Z");
    } catch {
      fail(
        `${ctx}.publishedAt is not a valid ISO-8601 UTC timestamp (got '${publishedAt}')`,
      );
    }
    if (roundTruncated !== publishedAt) {
      fail(
        `${ctx}.publishedAt is not a valid ISO-8601 UTC timestamp (got '${publishedAt}', round-trip yielded '${roundTruncated}')`,
      );
    }
    releases.push({
      commitShort,
      commitHash,
      rulesetVersion,
      atlasBinaryHash,
      publishedAt,
    });
  }

  return { schemaVersion: SCHEMA_VERSION, releases };
}
