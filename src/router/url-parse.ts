import type { FingerprintInputs } from "../core/fingerprint";
import { isWellFormedUtf16 } from "../core/hash";
import { decodeActionLog } from "../share/decode";
import type { Action } from "../core/encode";
import {
  ROUTE_ERR_FP_BAD_CHAR,
  ROUTE_ERR_FP_INVALID,
  ROUTE_ERR_LOG_DECODE,
  ROUTE_ERR_MODS_INVALID,
  ROUTE_ERR_SEED_INVALID,
  ROUTE_ERR_SEED_MISSING,
  escapeForDisplay,
  fillTemplate,
} from "./messages";

/**
 * Phase 8 URL parser. Per `artifacts/decision-memo-phase-8.md`
 * decision 6: pure function `parseShareUrl(href) -> ParseResult`.
 *
 * Returns a discriminated union — the parser never throws on
 * malformed input; errors are surfaced via the `error` variant
 * with a pinned `code` (one of the `ROUTE_ERR_*` constants) and
 * a user-facing `message` (the substituted template).
 *
 * URL syntax (memo decision 3):
 *   `?run=<22-char>&seed=<encoded>[&mods=<csv>][#log=<base64url>]`
 *
 * Validation rules:
 *   - `?run=` is exactly 22 base64url chars when present.
 *   - `?run=` requires `?seed=` to also be present.
 *   - `?seed=` is non-empty, well-formed UTF-16, no NUL byte.
 *   - `?mods=` is comma-joined `sortedModIds`; each entry is
 *     well-formed UTF-16 and contains no NUL byte (the comma is
 *     the separator and is excluded by construction).
 *   - `#log=` is the action-log wire form; on decode failure the
 *     parser surfaces `ROUTE_ERR_LOG_DECODE` rather than
 *     proceeding.
 */

const FP_SHORT_LEN = 22;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const FP_BAD_CHAR_RE = /[^A-Za-z0-9_-]/;
const NUL_CHAR = "\x00";

export type ParseResult =
  | { readonly kind: "no-run-param"; readonly seed: string | null }
  | {
      readonly kind: "ok";
      readonly inputs: FingerprintInputs;
      readonly claimedFingerprint: string; // 22-char short
      readonly actionLog: readonly Action[] | null; // null if no #log=
      readonly logWire: string | null; // raw wire form for verifier
    }
  | {
      readonly kind: "error";
      readonly code: string; // pinned ROUTE_ERR_* constant value
      readonly message: string; // substituted message
    };

function parseModsParam(modsParam: string | null): {
  ok: true;
  modIds: readonly string[];
} | { ok: false; bad: number } {
  if (modsParam === null || modsParam === "") {
    return { ok: true, modIds: [] };
  }
  const raw = modsParam.split(",");
  const modIds: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i]!;
    if (m === "") {
      // Empty entries from `?mods=,a,b` or `?mods=a,,b` are stripped
      // (advisory A5: `[""]` and `[]` resolve to the same empty
      // pre-image segment after URL parsing).
      continue;
    }
    if (m.indexOf(NUL_CHAR) !== -1) {
      return { ok: false, bad: i };
    }
    if (!isWellFormedUtf16(m)) {
      return { ok: false, bad: i };
    }
    modIds.push(m);
  }
  return { ok: true, modIds };
}

function isValidSeed(seed: string): boolean {
  if (seed.length === 0) return false;
  if (!isWellFormedUtf16(seed)) return false;
  // NUL is the fingerprint pre-image separator (Phase 1 frozen);
  // a seed containing NUL would collide with the separator.
  if (seed.indexOf(NUL_CHAR) !== -1) return false;
  return true;
}

/**
 * Parse a share URL into its constituent parts. Pure function
 * (no DOM, no `window.*`, no `localStorage`); cross-runtime stable
 * via the WHATWG `URL` constructor.
 */
export function parseShareUrl(href: string): ParseResult {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // An un-parseable href falls through to "no-run-param" — there
    // is no URL to extract anything from. Treat as bare boot.
    return { kind: "no-run-param", seed: null };
  }
  const params = url.searchParams;
  const runParam = params.get("run");
  const seedParam = params.get("seed");
  const modsParam = params.get("mods");

  if (runParam === null) {
    // `?seed=` may appear standalone (memo decision 11 — the
    // daily-seed convention); validate it minimally so callers
    // know whether to boot from it.
    if (seedParam !== null && !isValidSeed(seedParam)) {
      return {
        kind: "error",
        code: ROUTE_ERR_SEED_INVALID,
        message: ROUTE_ERR_SEED_INVALID,
      };
    }
    return { kind: "no-run-param", seed: seedParam };
  }

  // `?run=` present — validate length first, then alphabet.
  if (runParam.length !== FP_SHORT_LEN) {
    return {
      kind: "error",
      code: ROUTE_ERR_FP_INVALID,
      message: fillTemplate(ROUTE_ERR_FP_INVALID, {
        "<N>": String(runParam.length),
        "<repr>": escapeForDisplay(runParam),
      }),
    };
  }
  if (!BASE64URL_RE.test(runParam)) {
    const badIdx = runParam.search(FP_BAD_CHAR_RE);
    return {
      kind: "error",
      code: ROUTE_ERR_FP_BAD_CHAR,
      message: fillTemplate(ROUTE_ERR_FP_BAD_CHAR, {
        "<i>": String(badIdx),
      }),
    };
  }

  if (seedParam === null) {
    return {
      kind: "error",
      code: ROUTE_ERR_SEED_MISSING,
      message: ROUTE_ERR_SEED_MISSING,
    };
  }
  if (!isValidSeed(seedParam)) {
    return {
      kind: "error",
      code: ROUTE_ERR_SEED_INVALID,
      message: ROUTE_ERR_SEED_INVALID,
    };
  }

  const modsResult = parseModsParam(modsParam);
  if (!modsResult.ok) {
    return {
      kind: "error",
      code: ROUTE_ERR_MODS_INVALID,
      message: fillTemplate(ROUTE_ERR_MODS_INVALID, {
        "<i>": String(modsResult.bad),
      }),
    };
  }

  // The fingerprint pre-image needs commitHash + rulesetVersion. The
  // URL parser is pure and does NOT consult build-info. The caller
  // (router/redirect.ts or verifier) supplies those via
  // `FingerprintInputs`. Here we expose `inputs` populated with the
  // URL-derived fields and stub commit/ruleset; the caller fills.
  const inputs: FingerprintInputs = {
    commitHash: "",
    rulesetVersion: "",
    seed: seedParam,
    modIds: modsResult.modIds,
  };

  // Action log lives in the URL hash fragment as `#log=<base64url>`.
  // url.hash is "#log=..." with the leading `#`; strip and split.
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  let actionLog: readonly Action[] | null = null;
  let logWire: string | null = null;
  if (hash.length > 0) {
    const hashParams = new URLSearchParams(hash);
    const logParam = hashParams.get("log");
    if (logParam !== null && logParam.length > 0) {
      logWire = logParam;
      try {
        actionLog = decodeActionLog(logParam);
      } catch (e) {
        return {
          kind: "error",
          code: ROUTE_ERR_LOG_DECODE,
          message: fillTemplate(ROUTE_ERR_LOG_DECODE, {
            "<inner-error>": (e as Error).message,
          }),
        };
      }
    }
  }

  return {
    kind: "ok",
    inputs,
    claimedFingerprint: runParam,
    actionLog,
    logWire,
  };
}

/**
 * Format a share URL from inputs + optional action log + base URL.
 * Inverse of `parseShareUrl` for the non-error variant. Used by the
 * 8.A.3 "Share This Run" button + tests; Phase 8.A.2b ships only
 * the URL-formatter surface (the user-visible button is deferred
 * to 8.A.3 per memo addendum B9).
 */
export function formatShareUrl(
  inputs: FingerprintInputs,
  claimedFingerprint: string,
  logWire: string | null,
  baseUrl: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("run", claimedFingerprint);
  url.searchParams.set("seed", inputs.seed);
  if (inputs.modIds.length > 0) {
    url.searchParams.set("mods", [...inputs.modIds].sort().join(","));
  }
  if (logWire !== null && logWire.length > 0) {
    url.hash = "log=" + logWire;
  }
  return url.toString();
}
