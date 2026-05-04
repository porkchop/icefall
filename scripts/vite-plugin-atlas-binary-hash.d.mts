/**
 * TypeScript declarations for the Phase 4 atlas-binary-hash Vite
 * plugin (addendum B5 + B1). The implementation is `.mjs` so it can
 * be imported by `vite.config.ts`, `vitest.config.ts`, AND a sibling
 * Node script without going through the TS compiler; this file
 * provides the typed surface.
 */

export const EMPTY_SHA256: string;
export const PLACEHOLDER_RULESET_VERSION: string;
export const RULES_FILES_PATHS: readonly string[];

export type AtlasBinaryHashResult = {
  readonly hash: string;
  readonly missing: boolean;
};

export type DefinePayload = {
  readonly hash: string;
  readonly missing: boolean;
  readonly rulesetVersion: string;
};

export function computeAtlasBinaryHash(root: string): AtlasBinaryHashResult;
export function computeDefinePayload(root: string): DefinePayload;

export type AtlasBinaryHashPlugin = {
  readonly name: "icefall-atlas-binary-hash";
  configResolved(): void;
  config(): {
    define: {
      __ATLAS_BINARY_HASH__: string;
      __ATLAS_MISSING__: string;
      __RULESET_VERSION__: string;
    };
  };
  handleHotUpdate(ctx: {
    file: string;
    server: { ws: { send(message: unknown): void } };
  }): void;
};

export function atlasBinaryHashPlugin(options?: {
  root?: string;
}): AtlasBinaryHashPlugin;
