/**
 * Phase 4 Vite plugin: read `assets/atlas.png` (if present), compute
 * its SHA-256, derive `rulesetVersion`, and inject the three values
 * (`__ATLAS_BINARY_HASH__`, `__ATLAS_MISSING__`, `__RULESET_VERSION__`)
 * into the build's `define` block.
 *
 * Pinned by `artifacts/decision-memo-phase-4.md` addendum B5 + B1 +
 * B2. The 4.A.2 commit lands `assets/atlas.png` AND flips the
 * `__RULESET_VERSION__` injection from `PLACEHOLDER_RULESET_VERSION`
 * to `deriveRulesetVersion(rulesText, atlasBinaryHash)` — same commit
 * (atomic flip per addendum B1).
 *
 * Hook responsibilities (pinned):
 *   - `configResolved`: the **single** hook that reads `assets/atlas.png`
 *     and the `RULES_FILES` source contents.
 *   - `config`: exposes the three `__ATLAS_BINARY_HASH__` /
 *     `__ATLAS_MISSING__` / `__RULESET_VERSION__` keys, each wrapped in
 *     `JSON.stringify` per addendum N17.
 *   - `handleHotUpdate`: in dev mode, watches `assets/atlas.png` and
 *     triggers a `full-reload` on regen.
 *
 * Empty-atlas fallback: when `assets/atlas.png` is absent the plugin
 * injects `__ATLAS_BINARY_HASH__ = EMPTY_SHA256`, `__ATLAS_MISSING__
 * = true`, and `__RULESET_VERSION__ = PLACEHOLDER_RULESET_VERSION`
 * ("no transient sentinel" per addendum B1).
 */

import { existsSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";

const ATLAS_PATH = "assets/atlas.png";
const MANIFEST_PATH = "assets/atlas.json";

/** SHA-256 of the empty byte string. Pinned literally. */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const PLACEHOLDER_RULESET_VERSION = "phase1-placeholder-do-not-share";

/**
 * Canonical alphabetical-sorted list of rules-text source paths, kept
 * in lock-step with `src/build-info.ts:RULES_FILES`. Duplicated here so
 * the plugin (a `.mjs` consumed by vite.config.ts at config-load time)
 * does not have to transit the TypeScript pipeline. The
 * `tests/build/rules-text.test.ts` companion test asserts the path
 * lists agree.
 */
export const RULES_FILES_PATHS = Object.freeze([
  "src/atlas/palette.ts",
  "src/atlas/params.ts",
  "src/registries/atlas-recipes.ts",
  "src/registries/encounters.ts",
  "src/registries/items.ts",
  "src/registries/monsters.ts",
  "src/registries/rooms.ts",
  "src/sim/ai.ts",
  "src/sim/combat.ts",
  "src/sim/params.ts",
  "src/sim/run.ts",
  "src/sim/turn.ts",
]);

const HEX = "0123456789abcdef";
const NUL = new Uint8Array([0x00]);
const PIPE = new Uint8Array([0x7c]);

/** Convert a `Uint8Array` to a lowercase hex string. */
function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[b >> 4] + HEX[b & 0xf];
  }
  return out;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeForHash(content) {
  return utf8(stripBom(content).replace(/\r\n/g, "\n"));
}

/**
 * Compute `rulesetTextHash` from the on-disk file contents per the
 * addendum-B2 alphabetically-sorted `(utf8(path), 0x00,
 * sha256(normalizeForHash(content)), 0x00)` tuple encoding. Mirrors
 * `src/build-info.ts:rulesetTextHash` byte-for-byte.
 */
function computeRulesetTextHash(root) {
  const parts = [];
  for (const path of RULES_FILES_PATHS) {
    const full = resolve(root, path);
    if (!existsSync(full)) {
      // The file isn't on disk yet (4.A.1 path; some entries are
      // marked "4.A.2"). Skip it — the rules-text test enforces the
      // 4.A.2 entries land in the same commit as `assets/atlas.png`.
      // Skipping means the pre-image differs from the "all files
      // present" case; this is intentional in 4.A.1 and irrelevant in
      // 4.A.2 because every file then exists.
      continue;
    }
    const content = readFileSync(full, "utf8");
    parts.push(utf8(path));
    parts.push(NUL);
    parts.push(sha256(normalizeForHash(content)));
    parts.push(NUL);
  }
  return sha256(concatBytes(parts));
}

/**
 * Compute `rulesetVersion` per addendum B2:
 *   sha256(utf8(rulesetTextHashHex) ‖ utf8("|") ‖ utf8(atlasBinaryHash))
 */
function computeRulesetVersion(root, atlasBinaryHash) {
  const textHashHex = bytesToHex(computeRulesetTextHash(root));
  return bytesToHex(
    sha256(concatBytes([utf8(textHashHex), PIPE, utf8(atlasBinaryHash)])),
  );
}

/** Resolve `assets/atlas.png` against a project root. */
function defaultRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

/**
 * Pure helper: compute the `__ATLAS_BINARY_HASH__` and
 * `__ATLAS_MISSING__` values for a given project root.
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
 * Pure helper: compute the full `define`-block payload (atlas hash,
 * atlas-missing flag, derived ruleset version) for a given project
 * root. Per addendum B1, when the atlas binary is absent the
 * `__RULESET_VERSION__` value reverts to the Phase 1 placeholder
 * sentinel — there is no transient third state.
 */
export function computeDefinePayload(root) {
  const { hash, missing } = computeAtlasBinaryHash(root);
  const rulesetVersion = missing
    ? PLACEHOLDER_RULESET_VERSION
    : computeRulesetVersion(root, hash);
  return { hash, missing, rulesetVersion };
}

/**
 * The Vite plugin factory. Pass `{ root }` to override the project
 * root used to resolve `assets/atlas.png` (defaults to the repo root).
 */
export function atlasBinaryHashPlugin(options = {}) {
  const root = options.root ?? defaultRoot();
  let computed = {
    hash: EMPTY_SHA256,
    missing: true,
    rulesetVersion: PLACEHOLDER_RULESET_VERSION,
  };

  function recompute() {
    computed = computeDefinePayload(root);
  }

  return {
    name: "icefall-atlas-binary-hash",
    config() {
      // Compute eagerly inside `config()` so the returned `define`
      // payload is the real values (not the initial-empty placeholders).
      // `configResolved` would be too late — vite has already merged
      // the user's `define` block by then. `JSON.stringify` per
      // addendum N17 (vite substitutes literally).
      recompute();
      return {
        define: {
          __ATLAS_BINARY_HASH__: JSON.stringify(computed.hash),
          __ATLAS_MISSING__: JSON.stringify(computed.missing),
          __RULESET_VERSION__: JSON.stringify(computed.rulesetVersion),
        },
      };
    },
    configResolved() {
      // Re-read the file in case `config()` ran before any external
      // process (e.g. CI's gen-atlas) wrote it. Idempotent.
      recompute();
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith("/assets/atlas.png")) {
        recompute();
        server.ws.send({ type: "full-reload" });
      }
    },
    /**
     * After Vite writes the bundle to `dist/`, copy `assets/atlas.png`
     * and `assets/atlas.json` into `dist/assets/` so the production
     * build serves them at `/icefall/assets/atlas.png` (the URL the
     * preview UI and the future Phase 5 atlas-loader fetch). Vite's
     * default `publicDir: "public"` does not match our addendum-pinned
     * `assets/` path; copying here keeps the URL convention intact
     * without forcing a directory rename. No-op when the source file
     * is missing (the empty-atlas fallback path).
     */
    closeBundle() {
      const distAssetsDir = resolve(root, "dist", "assets");
      mkdirSync(distAssetsDir, { recursive: true });
      const atlasSrc = resolve(root, ATLAS_PATH);
      const manifestSrc = resolve(root, MANIFEST_PATH);
      if (existsSync(atlasSrc)) {
        copyFileSync(atlasSrc, resolve(distAssetsDir, "atlas.png"));
      }
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, resolve(distAssetsDir, "atlas.json"));
      }
    },
  };
}
