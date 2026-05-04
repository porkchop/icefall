/**
 * Phase 4 atlas loader (memo decision 7 + addendum N7, B4). Refuses
 * placeholder-ruleset builds (`DEV-` fingerprint refusal) and
 * missing-atlas builds, then asserts that the served `assets/atlas.png`
 * SHA-256 matches the build-time `__ATLAS_BINARY_HASH__`.
 *
 * SHA-256 path goes exclusively through `@noble/hashes/sha256` via
 * `src/core/hash.ts` — no `crypto.subtle`, no `node:crypto` (B4).
 *
 * `loadAtlasFromBytes` is the Node-side helper used by self-tests and
 * unit tests; `loadAtlas` (browser) fetches the file. Both paths
 * funnel through the same hash + manifest validation so behavior is
 * identical across runtimes.
 */

import { sha256Hex } from "../core/hash";
import {
  PLACEHOLDER_RULESET_VERSION,
  atlasBinaryHash as buildAtlasBinaryHash,
  atlasMissing as buildAtlasMissing,
  rulesetVersion as buildRulesetVersion,
} from "../build-info";
import { parseAtlasJson } from "./manifest";
import type { AtlasManifest } from "./generate";

export const PLACEHOLDER_REFUSAL_MESSAGE =
  "atlas-loader: refusing to load build with placeholder ruleset (DEV- fingerprint) — re-build with 'npm run build' to inject the real rulesetVersion";

export const ATLAS_MISSING_MESSAGE =
  "atlas-loader: assets/atlas.png is missing from this build — ruleset derivation cannot complete";

export type LoadedAtlas = {
  readonly png: Uint8Array;
  readonly manifest: AtlasManifest;
};

export type LoaderEnv = {
  readonly rulesetVersion: string;
  readonly atlasBinaryHash: string;
  readonly atlasMissing: boolean;
};

/**
 * Loader-from-bytes — the unit-testable / Node-side core. Validates
 * placeholder-ruleset, missing-atlas, and hash-mismatch conditions
 * against the supplied build-time environment, then parses the
 * already-decoded manifest object. Throws with the pinned messages on
 * every failure path.
 *
 * Per memo decision 6 + the `src/atlas/**` data-ingestion boundary
 * rule, callers `JSON.parse` outside this module and pass the result
 * here. Mirrors `parseFloor(unknown)`.
 */
export function loadAtlasFromBytes(
  pngBytes: Uint8Array,
  manifestObject: unknown,
  env: LoaderEnv,
): LoadedAtlas {
  if (env.rulesetVersion === PLACEHOLDER_RULESET_VERSION) {
    throw new Error(PLACEHOLDER_REFUSAL_MESSAGE);
  }
  if (env.atlasMissing) {
    throw new Error(ATLAS_MISSING_MESSAGE);
  }
  const actualHash = sha256Hex(pngBytes);
  if (actualHash !== env.atlasBinaryHash) {
    throw new Error(
      `atlas-loader: atlas.png hash mismatch — got ${actualHash}, expected ${env.atlasBinaryHash} (rebuild required)`,
    );
  }
  const manifest = parseAtlasJson(manifestObject);
  return { png: pngBytes, manifest };
}

/**
 * Build the loader environment from the Vite-injected `src/build-info.ts`
 * exports. Exported separately so tests can pin a synthetic env when
 * exercising the placeholder / missing / hash-mismatch branches without
 * having to monkey-patch the build-info module.
 */
export function buildLoaderEnv(): LoaderEnv {
  return {
    rulesetVersion: buildRulesetVersion,
    atlasBinaryHash: buildAtlasBinaryHash,
    atlasMissing: buildAtlasMissing,
  };
}

/**
 * Browser-side loader. Fetches `assets/atlas.png` and `assets/atlas.json`
 * relative to the document base, JSON-parses the manifest text, then
 * defers to `loadAtlasFromBytes`. The JSON-parse step lives outside
 * `src/atlas/**` interiors (it is async and lives in this `loadAtlas`
 * orchestrator which is itself the data-ingestion boundary; the inner
 * `loadAtlasFromBytes` is sync + integer-arithmetic-clean).
 *
 * The build-time environment (`rulesetVersion`, `atlasBinaryHash`,
 * `atlasMissing`) defaults to `src/build-info.ts` (Vite-injected); the
 * `env` parameter is exposed so tests / callers can override.
 */
export async function loadAtlas(
  basePath = "assets",
  env: LoaderEnv = buildLoaderEnv(),
): Promise<LoadedAtlas> {
  // Pre-flight checks (avoid the fetch on placeholder/missing).
  if (env.rulesetVersion === PLACEHOLDER_RULESET_VERSION) {
    throw new Error(PLACEHOLDER_REFUSAL_MESSAGE);
  }
  if (env.atlasMissing) {
    throw new Error(ATLAS_MISSING_MESSAGE);
  }
  const [pngResp, jsonResp] = await Promise.all([
    fetch(`${basePath}/atlas.png`),
    fetch(`${basePath}/atlas.json`),
  ]);
  const pngBytes = new Uint8Array(await pngResp.arrayBuffer());
  const manifestText = await jsonResp.text();
  // JSON.parse at the data-ingestion boundary. `determinism/no-float-arithmetic`
  // bans JSON.parse inside sim/mapgen/atlas *interior* code (data should
  // be ingested at module boundaries and validated structurally before
  // reaching deterministic code paths). The loader IS that boundary;
  // `loadAtlasFromBytes` validates the parsed object via `parseAtlasJson`.
  // eslint-disable-next-line determinism/no-float-arithmetic
  const parsed: unknown = JSON.parse(manifestText);
  return loadAtlasFromBytes(pngBytes, parsed, env);
}
