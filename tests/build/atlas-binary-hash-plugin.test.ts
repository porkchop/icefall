import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  EMPTY_SHA256,
  PLACEHOLDER_RULESET_VERSION,
  RULES_FILES_PATHS,
  atlasBinaryHashPlugin,
  computeAtlasBinaryHash,
  computeDefinePayload,
} from "../../scripts/vite-plugin-atlas-binary-hash.mjs";
import { sha256Hex } from "../../src/core/hash";
import {
  RULES_FILES,
  EMPTY_SHA256 as BUILD_INFO_EMPTY_SHA256,
  PLACEHOLDER_RULESET_VERSION as BUILD_INFO_PLACEHOLDER_RULESET_VERSION,
} from "../../src/build-info";

/**
 * Phase 4.A.1 unit tests for the atlas-binary-hash Vite plugin
 * (addendum B5). The 4.A.1 path has no `assets/atlas.png` on disk;
 * the plugin must fall back to `EMPTY_SHA256` and surface
 * `__ATLAS_MISSING__ = true`. The 4.A.2 path will write the real
 * atlas binary; the plugin must read it and compute its SHA-256.
 */

const tempRoots: string[] = [];

afterEach(() => {
  for (const r of tempRoots.splice(0)) {
    rmSync(r, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "icefall-atlas-plugin-"));
  tempRoots.push(dir);
  mkdirSync(resolve(dir, "assets"), { recursive: true });
  return dir;
}

describe("EMPTY_SHA256", () => {
  it("equals SHA-256 of the empty byte string (addendum B5 pinned constant)", () => {
    expect(EMPTY_SHA256).toBe(sha256Hex(new Uint8Array(0)));
  });
});

/**
 * Phase 5.A.1 drift-sweep dual-source equality (Phase 4.A.2 code-review
 * nit N5). `EMPTY_SHA256` and `PLACEHOLDER_RULESET_VERSION` are
 * duplicated between the .mjs Vite plugin (loaded at config-load time;
 * cannot transit `@noble/hashes` through the TypeScript pipeline) and
 * `src/build-info.ts` (the runtime export). The duplication is forced
 * by the build pipeline; this test asserts byte-equality so silent
 * drift between the two sources fails loudly.
 */
describe("dual-source constant equality (build-info ↔ vite plugin)", () => {
  it("EMPTY_SHA256 matches between scripts/vite-plugin-atlas-binary-hash.mjs and src/build-info.ts", () => {
    expect(EMPTY_SHA256).toBe(BUILD_INFO_EMPTY_SHA256);
  });
  it("PLACEHOLDER_RULESET_VERSION matches between scripts/vite-plugin-atlas-binary-hash.mjs and src/build-info.ts", () => {
    expect(PLACEHOLDER_RULESET_VERSION).toBe(
      BUILD_INFO_PLACEHOLDER_RULESET_VERSION,
    );
  });
});

describe("computeAtlasBinaryHash", () => {
  it("returns EMPTY_SHA256 + missing=true when assets/atlas.png is absent", () => {
    const root = freshRoot();
    const r = computeAtlasBinaryHash(root);
    expect(r.hash).toBe(EMPTY_SHA256);
    expect(r.missing).toBe(true);
  });

  it("returns the SHA-256 of the file + missing=false when assets/atlas.png exists", () => {
    const root = freshRoot();
    const fixture = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(resolve(root, "assets", "atlas.png"), fixture);
    const r = computeAtlasBinaryHash(root);
    expect(r.missing).toBe(false);
    expect(r.hash).toBe(sha256Hex(fixture));
  });

  it("is deterministic on identical inputs", () => {
    const root = freshRoot();
    const fixture = new Uint8Array([1, 2, 3, 4, 5]);
    writeFileSync(resolve(root, "assets", "atlas.png"), fixture);
    const a = computeAtlasBinaryHash(root);
    const b = computeAtlasBinaryHash(root);
    expect(a).toEqual(b);
  });
});

describe("atlasBinaryHashPlugin — 4.A.1 fallback path (no atlas)", () => {
  it("config() returns the empty-atlas define block after configResolved()", () => {
    const root = freshRoot();
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    const cfg = plugin.config();
    // Per addendum N17, every define value must be JSON.stringify-quoted.
    expect(cfg.define.__ATLAS_BINARY_HASH__).toBe(`"${EMPTY_SHA256}"`);
    expect(cfg.define.__ATLAS_MISSING__).toBe("true");
  });

  it("falls back to PLACEHOLDER_RULESET_VERSION when the atlas is missing (addendum B1: no transient sentinel)", () => {
    const root = freshRoot();
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    const cfg = plugin.config();
    expect(cfg.define.__RULESET_VERSION__).toBe(
      `"${PLACEHOLDER_RULESET_VERSION}"`,
    );
  });

  it("plugin name matches the pinned identifier", () => {
    const plugin = atlasBinaryHashPlugin({ root: freshRoot() });
    expect(plugin.name).toBe("icefall-atlas-binary-hash");
  });
});

describe("atlasBinaryHashPlugin — 4.A.2 real-atlas path", () => {
  it("config() reflects the file's hash after configResolved()", () => {
    const root = freshRoot();
    const fixture = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    writeFileSync(resolve(root, "assets", "atlas.png"), fixture);
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    const cfg = plugin.config();
    expect(cfg.define.__ATLAS_BINARY_HASH__).toBe(`"${sha256Hex(fixture)}"`);
    expect(cfg.define.__ATLAS_MISSING__).toBe("false");
  });

  it("handleHotUpdate triggers a full-reload on assets/atlas.png changes", () => {
    const root = freshRoot();
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    let sentMessage: unknown = null;
    const server = { ws: { send: (m: unknown) => (sentMessage = m) } };
    plugin.handleHotUpdate({
      file: "/some/path/assets/atlas.png",
      server,
    });
    expect(sentMessage).toEqual({ type: "full-reload" });
  });

  it("handleHotUpdate is a no-op for unrelated files", () => {
    const root = freshRoot();
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    let sent = false;
    const server = { ws: { send: () => (sent = true) } };
    plugin.handleHotUpdate({ file: "/some/path/src/main.ts", server });
    expect(sent).toBe(false);
  });

  it("handleHotUpdate refreshes the cached hash", () => {
    const root = freshRoot();
    const a = new Uint8Array([1]);
    writeFileSync(resolve(root, "assets", "atlas.png"), a);
    const plugin = atlasBinaryHashPlugin({ root });
    plugin.configResolved();
    expect(plugin.config().define.__ATLAS_BINARY_HASH__).toBe(
      `"${sha256Hex(a)}"`,
    );
    const b = new Uint8Array([2]);
    writeFileSync(resolve(root, "assets", "atlas.png"), b);
    plugin.handleHotUpdate({
      file: "/x/assets/atlas.png",
      server: { ws: { send: () => {} } },
    });
    expect(plugin.config().define.__ATLAS_BINARY_HASH__).toBe(
      `"${sha256Hex(b)}"`,
    );
  });
});

describe("atlasBinaryHashPlugin — atomic flip (addendum B1)", () => {
  it("RULES_FILES_PATHS in the plugin matches RULES_FILES in build-info (no drift)", () => {
    expect(RULES_FILES_PATHS).toEqual(RULES_FILES.map((r) => r.path));
  });

  it("computeDefinePayload returns derived rulesetVersion when the atlas exists", () => {
    // Use the actual repo root so RULES_FILES paths resolve.
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const payload = computeDefinePayload(repoRoot);
    expect(payload.missing).toBe(false);
    // Real ruleset is a 64-char lowercase hex string (NOT the placeholder).
    expect(payload.rulesetVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.rulesetVersion).not.toBe(PLACEHOLDER_RULESET_VERSION);
  });

  it("define-block injection has no transient sentinel — exactly placeholder OR 64-hex", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const plugin = atlasBinaryHashPlugin({ root: repoRoot });
    plugin.configResolved();
    const cfg = plugin.config();
    const value = cfg.define.__RULESET_VERSION__;
    // The injection is JSON.stringify(...)'d, so the value is "..." with quotes.
    const placeholderInjection = JSON.stringify(PLACEHOLDER_RULESET_VERSION);
    const isPlaceholder = value === placeholderInjection;
    const isHex64 = /^"[0-9a-f]{64}"$/.test(value);
    expect(isPlaceholder || isHex64).toBe(true);
  });
});

describe("atlas-recipes presence — RULES_FILES 4.A.2 entries land in 4.A.2", () => {
  it("every RULES_FILES path exists on disk in 4.A.2", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    for (const entry of RULES_FILES) {
      const full = resolve(repoRoot, entry.path);
      // After 4.A.2 lands `src/atlas/palette.ts`, `src/atlas/params.ts`,
      // and `src/registries/atlas-recipes.ts`, every entry should exist.
      const bytes = readFileSync(full);
      expect(bytes.length).toBeGreaterThan(0);
    }
  });
});
