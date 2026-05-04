/**
 * TypeScript declarations for the Phase 4 atlas-binary-hash Vite
 * plugin (addendum B5). The implementation is `.mjs` so it can be
 * imported by `vite.config.ts`, `vitest.config.ts`, AND a sibling
 * Node script without going through the TS compiler; this file
 * provides the typed surface.
 */

export const EMPTY_SHA256: string;

export type AtlasBinaryHashResult = {
  readonly hash: string;
  readonly missing: boolean;
};

export function computeAtlasBinaryHash(root: string): AtlasBinaryHashResult;

export type AtlasBinaryHashPlugin = {
  readonly name: "icefall-atlas-binary-hash";
  configResolved(): void;
  config(): {
    define: {
      __ATLAS_BINARY_HASH__: string;
      __ATLAS_MISSING__: string;
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
