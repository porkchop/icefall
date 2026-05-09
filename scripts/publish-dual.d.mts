/**
 * TypeScript declarations for `scripts/publish-dual.mjs`. The
 * implementation is `.mjs` so it can be invoked directly by
 * `.github/workflows/deploy.yml` without a TS-compile step; this
 * file provides the typed surface for vitest tests.
 */

export const SCHEMA_VERSION: 1;
export const COMMIT_HEX_RE: RegExp;
export const SHA256_HEX_RE: RegExp;
export const ISO_8601_UTC_RE: RegExp;

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

export function mergeReleaseIndex(
  prior: ReleaseIndex | null | undefined,
  newEntry: ReleaseEntry,
): ReleaseIndex;

export function tryParsePriorIndex(text: string): ReleaseIndex | null;

export function parseArgs(argv: readonly string[]): Record<string, string>;

export function fetchPriorIndex(url: string): Promise<ReleaseIndex | null>;
export function readLocalIndex(distFinal: string): ReleaseIndex | null;
export function writeIndex(distFinal: string, index: ReleaseIndex): void;
