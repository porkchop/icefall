import { fingerprint } from "../core/fingerprint";
import type { FingerprintInputs } from "../core/fingerprint";
import {
  parseShareUrl,
  type ParseResult,
} from "./url-parse";
import {
  parseReleaseIndex,
  type ReleaseEntry,
  type ReleaseIndex,
} from "./release-index-parse";
import {
  ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED,
  ROUTE_ERR_FP_TAMPERED,
  ROUTE_ERR_NO_MATCHING_RELEASE,
  ROUTE_ERR_RELEASE_INDEX_FETCH,
  escapeForDisplay,
  fillTemplate,
} from "./messages";

/**
 * Phase 8 router redirect logic. Per
 * `artifacts/decision-memo-phase-8.md` decision 5 + addendum B3 + B5
 * + B9.
 *
 * Two-layer design:
 *   - Pure decision: `decideRouting(href, build, indexJsonOrNull)`
 *     returns a discriminated `RoutingDecision` describing what to
 *     do. Side-effect-free; testable without DOM or fetch.
 *   - Side effect: `runRedirect()` is the thin wrapper that calls
 *     `fetch` and `window.location.replace`. The ONLY function in
 *     `src/router/**` that touches `window.*` (memo decision 6).
 */

/**
 * Build context: the current build's commitHash + rulesetVersion +
 * the canonical "latest" base path. Pass-through from `src/build-info.ts`.
 */
export type BuildContext = {
  readonly commitHash: string;
  readonly rulesetVersion: string;
  /** e.g. "/icefall/" — the root URL where `latest/` is served. */
  readonly basePath: string;
};

export type RoutingDecision =
  | {
      readonly kind: "boot-fresh";
      readonly seed: string | null;
    }
  | {
      readonly kind: "boot-replay";
      readonly inputs: FingerprintInputs;
      readonly claimedFingerprint: string;
      readonly logWire: string | null;
    }
  | {
      readonly kind: "redirect";
      readonly target: string; // absolute URL string
    }
  | {
      readonly kind: "error";
      readonly code: string;
      readonly message: string;
    };

/**
 * The canonical URL where `releases/index.json` is served (memo
 * addendum B5). The router ALWAYS fetches the index from
 * `${origin}${basePath}releases/index.json`, never from the
 * per-release subtree's relative path — eliminating the
 * `<base href>` interaction the red-team flagged.
 */
export function buildReleasesIndexUrl(
  origin: string,
  basePath: string,
): string {
  const trailing = basePath.endsWith("/") ? basePath : basePath + "/";
  return `${origin}${trailing}releases/index.json`;
}

function buildRedirectTarget(
  origin: string,
  basePath: string,
  commitShort: string,
  preservedSearch: string,
  preservedHash: string,
): string {
  const trailing = basePath.endsWith("/") ? basePath : basePath + "/";
  const search = preservedSearch.startsWith("?")
    ? preservedSearch
    : preservedSearch.length > 0
      ? `?${preservedSearch}`
      : "";
  const hash = preservedHash.startsWith("#")
    ? preservedHash
    : preservedHash.length > 0
      ? `#${preservedHash}`
      : "";
  return `${origin}${trailing}releases/${commitShort}/${search}${hash}`;
}

function fingerprintShort(
  inputs: FingerprintInputs,
): string {
  return fingerprint(inputs).slice(0, 22);
}

/**
 * Pure router decision. Given:
 *   - `href`: the current page URL (typically `window.location.href`)
 *   - `build`: the current build's BuildContext
 *   - `indexJson`: the contents of `releases/index.json` if fetched,
 *     or `null` if the fetch failed (or hasn't fired yet — bare
 *     bootstrapping case where no `?run=` is present).
 *
 * Returns the routing decision. Side-effect-free; the caller
 * (`runRedirect`) is responsible for applying the decision.
 */
export function decideRouting(
  href: string,
  build: BuildContext,
  indexJson: string | null,
): RoutingDecision {
  const parsed: ParseResult = parseShareUrl(href);

  if (parsed.kind === "no-run-param") {
    return { kind: "boot-fresh", seed: parsed.seed };
  }
  if (parsed.kind === "error") {
    return {
      kind: "error",
      code: parsed.code,
      message: parsed.message,
    };
  }

  // `?run=` is present and the URL parses cleanly. Recompute the
  // fingerprint under the CURRENT build's commitHash + rulesetVersion.
  const claimedInputs: FingerprintInputs = {
    commitHash: build.commitHash,
    rulesetVersion: build.rulesetVersion,
    seed: parsed.inputs.seed,
    modIds: parsed.inputs.modIds,
  };
  const computed = fingerprintShort(claimedInputs);

  if (computed === parsed.claimedFingerprint) {
    // Fingerprint matches the current build — boot replay (or fresh
    // if no `#log=` was supplied).
    return {
      kind: "boot-replay",
      inputs: claimedInputs,
      claimedFingerprint: parsed.claimedFingerprint,
      logWire: parsed.logWire,
    };
  }

  // Mismatch. We need releases/index.json to enumerate. If the
  // fetch failed (indexJson === null), we cannot route — surface
  // `ROUTE_ERR_RELEASE_INDEX_FETCH`.
  if (indexJson === null) {
    return {
      kind: "error",
      code: ROUTE_ERR_RELEASE_INDEX_FETCH,
      message: ROUTE_ERR_RELEASE_INDEX_FETCH,
    };
  }

  let index: ReleaseIndex;
  try {
    index = parseReleaseIndex(indexJson);
  } catch (e) {
    return {
      kind: "error",
      code: ROUTE_ERR_RELEASE_INDEX_FETCH,
      message: `${ROUTE_ERR_RELEASE_INDEX_FETCH}: ${(e as Error).message}`,
    };
  }

  // Phase 1: enumerate every release with the parsed (seed, modIds).
  // First match wins (releases are newest-first per addendum B5).
  const url = new URL(href);
  const origin = url.origin;
  const search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const preservedSearch = search;
  const preservedHash = hash;

  for (let i = 0; i < index.releases.length; i++) {
    const entry: ReleaseEntry = index.releases[i]!;
    const candidate = fingerprintShort({
      commitHash: entry.commitHash,
      rulesetVersion: entry.rulesetVersion,
      seed: parsed.inputs.seed,
      modIds: parsed.inputs.modIds,
    });
    if (candidate === parsed.claimedFingerprint) {
      return {
        kind: "redirect",
        target: buildRedirectTarget(
          origin,
          build.basePath,
          entry.commitShort,
          preservedSearch,
          preservedHash,
        ),
      };
    }
  }

  // Phase 2 (memo addendum B3): retry with `modIds: []` to detect
  // "tampered/stripped mods" vs "wrong build". Only surfaces on
  // the failure path (already error-pending).
  for (let i = 0; i < index.releases.length; i++) {
    const entry: ReleaseEntry = index.releases[i]!;
    const candidate = fingerprintShort({
      commitHash: entry.commitHash,
      rulesetVersion: entry.rulesetVersion,
      seed: parsed.inputs.seed,
      modIds: [],
    });
    if (candidate === parsed.claimedFingerprint) {
      return {
        kind: "error",
        code: ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED,
        message: fillTemplate(ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED, {
          "<seed-repr>": escapeForDisplay(parsed.inputs.seed),
        }),
      };
    }
  }

  // Sub-case 5c: we may be at the right commitShort already (via
  // `releases/<commit>/` URL) but the seed/mods were tampered. Detect
  // this by comparing the URL's path against the known release subtrees.
  const pathSegments = url.pathname.split("/").filter((s) => s.length > 0);
  const releasesIdx = pathSegments.indexOf("releases");
  if (releasesIdx !== -1 && releasesIdx + 1 < pathSegments.length) {
    const urlCommitShort = pathSegments[releasesIdx + 1]!;
    const matching = index.releases.find(
      (e) => e.commitShort === urlCommitShort,
    );
    if (matching) {
      return {
        kind: "error",
        code: ROUTE_ERR_FP_TAMPERED,
        message: ROUTE_ERR_FP_TAMPERED,
      };
    }
  }

  // No match anywhere. Bootstrap-window message per addendum B9.
  return {
    kind: "error",
    code: ROUTE_ERR_NO_MATCHING_RELEASE,
    message: fillTemplate(ROUTE_ERR_NO_MATCHING_RELEASE, {
      "<seed>": escapeForDisplay(parsed.inputs.seed),
    }),
  };
}
