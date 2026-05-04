import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MISSING_MESSAGE,
  PLACEHOLDER_REFUSAL_MESSAGE,
  loadAtlas,
  loadAtlasFromBytes,
  type LoaderEnv,
} from "../../src/atlas/loader";
import {
  PLACEHOLDER_RULESET_VERSION,
} from "../../src/build-info";
import { generateAtlas } from "../../src/atlas/generate";
import { serializeAtlasManifest } from "../../src/atlas/manifest";
import { ATLAS_SEED_DEFAULT } from "../../src/atlas/params";
import { sha256Hex } from "../../src/core/hash";

/**
 * Phase 4 frozen-contract item 11 — atlas-loader DEV- refusal + hash
 * check tests (memo decision 7 + addendum N7, B4).
 */

function realAtlas(): {
  png: Uint8Array;
  manifestObject: unknown;
  hash: string;
} {
  const { png, manifest } = generateAtlas(ATLAS_SEED_DEFAULT);
  const manifestText = serializeAtlasManifest(manifest);
  return { png, manifestObject: JSON.parse(manifestText), hash: sha256Hex(png) };
}

describe("loadAtlasFromBytes — placeholder ruleset refusal (addendum N7)", () => {
  it("throws with the EXACT pinned message when rulesetVersion === PLACEHOLDER_RULESET_VERSION", () => {
    const a = realAtlas();
    const env: LoaderEnv = {
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
      atlasBinaryHash: a.hash,
      atlasMissing: false,
    };
    expect(() => loadAtlasFromBytes(a.png, a.manifestObject, env)).toThrow(
      PLACEHOLDER_REFUSAL_MESSAGE,
    );
  });

  it("the pinned message contains the U+2014 em-dash (addendum N7 exact-character match)", () => {
    expect(PLACEHOLDER_REFUSAL_MESSAGE).toContain("—");
    // U+2014 EM DASH:
    expect(PLACEHOLDER_REFUSAL_MESSAGE.charCodeAt(
      PLACEHOLDER_REFUSAL_MESSAGE.indexOf("—"),
    )).toBe(0x2014);
  });

  it("matches /^atlas-loader:/ as a defense against accidental rephrasing", () => {
    const a = realAtlas();
    const env: LoaderEnv = {
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
      atlasBinaryHash: a.hash,
      atlasMissing: false,
    };
    expect(() => loadAtlasFromBytes(a.png, a.manifestObject, env)).toThrowError(
      /^atlas-loader:/,
    );
  });
});

describe("loadAtlasFromBytes — missing-atlas refusal", () => {
  it("throws with the pinned message when atlasMissing=true", () => {
    const env: LoaderEnv = {
      rulesetVersion: "deadbeef".repeat(8),
      atlasBinaryHash: "deadbeef".repeat(8),
      atlasMissing: true,
    };
    expect(() => loadAtlasFromBytes(new Uint8Array(0), {}, env)).toThrow(
      ATLAS_MISSING_MESSAGE,
    );
  });
});

describe("loadAtlasFromBytes — hash-mismatch refusal", () => {
  it("throws with the pinned message when sha256(png) !== build-time hash", () => {
    const a = realAtlas();
    const wrongHash = "0".repeat(64);
    const env: LoaderEnv = {
      rulesetVersion: "deadbeef".repeat(8),
      atlasBinaryHash: wrongHash,
      atlasMissing: false,
    };
    expect(() => loadAtlasFromBytes(a.png, a.manifestObject, env)).toThrowError(
      `atlas-loader: atlas.png hash mismatch — got ${a.hash}, expected ${wrongHash} (rebuild required)`,
    );
  });
});

describe("loadAtlasFromBytes — success path", () => {
  it("returns the parsed manifest + bytes when all checks pass", () => {
    const a = realAtlas();
    const env: LoaderEnv = {
      rulesetVersion: "deadbeef".repeat(8),
      atlasBinaryHash: a.hash,
      atlasMissing: false,
    };
    const out = loadAtlasFromBytes(a.png, a.manifestObject, env);
    expect(out.png).toBe(a.png);
    expect(out.manifest.atlasBinaryHash).toBe(a.hash);
    expect(out.manifest.atlasSeed).toBe(ATLAS_SEED_DEFAULT);
  });
});

/**
 * The async `loadAtlas` browser path. We mock `fetch` since the test
 * harness runs in Node-like environments without a real fetch
 * polyfill in every vitest version. Vitest's Vite-style `define`
 * substitution injects the real ruleset version + atlas hash for
 * `src/build-info.ts`, so the loader's pre-flight checks pass and the
 * success path is reachable.
 */
describe("loadAtlas — async browser path", () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the parsed manifest + bytes via mocked fetch", async () => {
    const { png, manifest } = generateAtlas(ATLAS_SEED_DEFAULT);
    const manifestText = serializeAtlasManifest(manifest);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("atlas.png")) {
        return {
          arrayBuffer: async () =>
            png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        } as Response;
      }
      return {
        text: async () => manifestText,
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const out = await loadAtlas("assets");
    expect(out.manifest.atlasBinaryHash).toBe(sha256Hex(png));
    expect(out.manifest.atlasSeed).toBe(ATLAS_SEED_DEFAULT);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("loadAtlas refuses on the placeholder pre-flight branch (env override)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be invoked on the placeholder path");
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const env: LoaderEnv = {
      rulesetVersion: PLACEHOLDER_RULESET_VERSION,
      atlasBinaryHash: "0".repeat(64),
      atlasMissing: false,
    };
    await expect(loadAtlas("assets", env)).rejects.toThrow(
      PLACEHOLDER_REFUSAL_MESSAGE,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loadAtlas refuses on the missing-atlas pre-flight branch (env override)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be invoked on the missing-atlas path");
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const env: LoaderEnv = {
      rulesetVersion: "deadbeef".repeat(8),
      atlasBinaryHash: "0".repeat(64),
      atlasMissing: true,
    };
    await expect(loadAtlas("assets", env)).rejects.toThrow(
      ATLAS_MISSING_MESSAGE,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildLoaderEnv", () => {
  it("returns the Vite-injected env (rulesetVersion is the derived hash; atlas not missing)", async () => {
    const { buildLoaderEnv } = await import("../../src/atlas/loader");
    const env = buildLoaderEnv();
    expect(env.rulesetVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(env.atlasBinaryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(env.atlasMissing).toBe(false);
  });
});
