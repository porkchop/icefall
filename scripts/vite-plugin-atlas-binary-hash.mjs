/**
 * Phase 4 Vite plugin: read `assets/atlas.png` (if present), compute
 * its SHA-256, and inject `__ATLAS_BINARY_HASH__` and
 * `__ATLAS_MISSING__` into the build's `define` block.
 *
 * Pinned by `artifacts/decision-memo-phase-4.md` addendum B5.
 *
 * Hook responsibilities (pinned):
 *   - `configResolved`: the **single** hook that reads `assets/atlas.png`.
 *     Runs once per `vite build` / `vite preview` / `vite dev` /
 *     `vitest` invocation.
 *   - `config`: exposes `__ATLAS_BINARY_HASH__` and `__ATLAS_MISSING__`
 *     to the `define` block. Both values are wrapped in
 *     `JSON.stringify` per addendum N17 (Vite substitutes literally).
 *   - `handleHotUpdate`: in dev mode, watches `assets/atlas.png` and
 *     triggers a `full-reload` on regen. Eliminates the
 *     "edit seed → regen → stale hash on reload" trap.
 *
 * Empty-atlas fallback (4.A.1 path): `assets/atlas.png` does not exist
 * yet. The plugin injects `__ATLAS_BINARY_HASH__` =
 * `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
 * (SHA-256 of the empty byte string) and `__ATLAS_MISSING__` = `true`.
 * The constant is pinned literally so the test environment and the
 * fresh-clone-no-atlas environment produce a known hash, not an error.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";

const ATLAS_PATH = "assets/atlas.png";

/**
 * SHA-256 of the empty byte string. Pinned literally (not computed at
 * startup) so the empty-atlas path produces a known constant.
 */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const HEX = "0123456789abcdef";

/** Convert a `Uint8Array` to a lowercase hex string. */
function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[b >> 4] + HEX[b & 0xf];
  }
  return out;
}

/**
 * Resolve `assets/atlas.png` against a project root. Default root is
 * the repository root inferred from this file's location
 * (`scripts/` is at the repo root).
 */
function defaultRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

/**
 * Pure helper: compute the `__ATLAS_BINARY_HASH__` and
 * `__ATLAS_MISSING__` values for a given project root. Exported
 * separately so tests can fixture-mock the file system without
 * instantiating a full Vite plugin.
 */
export function computeAtlasBinaryHash(root) {
  const atlasFullPath = resolve(root, ATLAS_PATH);
  if (existsSync(atlasFullPath)) {
    const bytes = readFileSync(atlasFullPath);
    return {
      hash: bytesToHex(sha256(new Uint8Array(bytes))),
      missing: false,
    };
  }
  return { hash: EMPTY_SHA256, missing: true };
}

/**
 * The Vite plugin factory. Pass `{ root }` to override the project
 * root used to resolve `assets/atlas.png` (defaults to the repo root).
 */
export function atlasBinaryHashPlugin(options = {}) {
  const root = options.root ?? defaultRoot();
  let computed = { hash: EMPTY_SHA256, missing: true };

  function recompute() {
    computed = computeAtlasBinaryHash(root);
  }

  return {
    name: "icefall-atlas-binary-hash",
    configResolved() {
      // Single I/O point per Vite invocation (build/preview/dev/test).
      recompute();
    },
    config() {
      // `JSON.stringify` per addendum N17 — Vite substitutes literally.
      return {
        define: {
          __ATLAS_BINARY_HASH__: JSON.stringify(computed.hash),
          __ATLAS_MISSING__: JSON.stringify(computed.missing),
        },
      };
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith("/assets/atlas.png")) {
        recompute();
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}
