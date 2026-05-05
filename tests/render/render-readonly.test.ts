/**
 * Phase 5.A.2 architectural test — the renderer is a read-only sink on
 * sim state.
 *
 * Per `docs/ARCHITECTURE.md` "Phase 5 frozen contracts (renderer +
 * input + ui)": "A runtime architectural test in
 * tests/render/render-readonly.test.ts calls the renderer with a
 * deeply-frozen RunState and confirms no mutation throws."
 *
 * If the renderer ever attempts to assign a property on the frozen
 * state, V8 in strict mode (which all source modules under `src/` run
 * under, since they are ESM) throws a `TypeError`. This test pins the
 * read-only discipline at runtime; the import-boundary lint rule
 * (`src/render/**` cannot import `src/sim/turn.ts` etc.) pins it at
 * edit time. Defense-in-depth.
 */
import { describe, expect, it } from "vitest";
import { drawScene, type RenderTarget } from "../../src/render/canvas";
import type { LoadedAtlas } from "../../src/atlas/loader";
import type { AtlasManifest } from "../../src/atlas/generate";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS, SELF_TEST_LOG_100 } from "../../src/sim/self-test-log";

function deepFreeze<T>(o: T, seen = new WeakSet<object>()): T {
  if (o === null || typeof o !== "object") return o;
  if (seen.has(o as object)) return o;
  seen.add(o as object);
  // ArrayBuffer-backed views cannot be frozen by V8. Skip them; the
  // renderer never assigns to typed-array elements (read-only contract
  // is enforced by the import-boundary lint rule — the renderer cannot
  // import sim write paths — and by this test asserting the parent
  // RunState shape stays frozen).
  if (ArrayBuffer.isView(o)) return o;
  for (const k of Object.keys(o as Record<string, unknown>)) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object") {
      deepFreeze(v, seen);
    }
  }
  Object.freeze(o);
  return o;
}

function stubManifest(): AtlasManifest {
  const sprites = new Map();
  for (const slot of [
    "tile.floor.cyberfloor_01",
    "tile.wall.cyberfloor_01",
    "tile.door.cyberdoor",
    "monster.ice.daemon",
    "monster.boss.black-ice-v0",
    "item.cred-chip",
    "npc.fixer",
    "npc.info-broker",
    "npc.ripperdoc",
    "player",
  ] as const) {
    sprites.set(slot, {
      atlasX: 0,
      atlasY: 0,
      recipeId: "atlas-recipe.cyberpunk.tile.floor",
      tilesHigh: 1,
      tilesWide: 1,
    });
  }
  return {
    atlasBinaryHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
    atlasSeed: "test",
    generator: {
      primitiveSetVersion: 1,
      tilePadding: 1,
      tileSize: 16,
      tilesHigh: 8,
      tilesWide: 16,
    },
    palette: { id: "cyberpunk-neon-v1", size: 16 },
    schemaVersion: 1,
    sprites,
  };
}

class StubContext {
  imageSmoothingEnabled = true;
  fillStyle = "";
  drawImage(): void {
    // no-op
  }
  fillRect(): void {
    // no-op
  }
}

class StubCanvas {
  width = 0;
  height = 0;
  getContext(kind: string): StubContext | null {
    if (kind !== "2d") return null;
    return new StubContext();
  }
}

describe("renderer read-only contract", () => {
  it("does not mutate a deeply-frozen RunState produced by the harness", () => {
    // Build a real state via the harness — same state shape the
    // playable game produces at runtime, not a hand-rolled fixture.
    const result = runScripted({
      inputs: SELF_TEST_INPUTS,
      actions: SELF_TEST_LOG_100,
    });
    const state = deepFreeze(result.finalState);

    const atlas: LoadedAtlas = {
      png: new Uint8Array(0),
      manifest: stubManifest(),
    };
    const target: RenderTarget = {
      canvas: new StubCanvas() as unknown as HTMLCanvasElement,
      atlas,
      atlasImage: {} as unknown as CanvasImageSource,
    };

    // Any attempt to mutate a frozen field would throw in strict mode.
    expect(() => drawScene(target, state)).not.toThrow();
  });

  it("does not mutate the canvas's loaded atlas (manifest is read-only)", () => {
    const result = runScripted({ inputs: SELF_TEST_INPUTS, actions: [] });
    const atlas: LoadedAtlas = deepFreeze({
      png: new Uint8Array(0),
      manifest: stubManifest(),
    });
    const target: RenderTarget = {
      canvas: new StubCanvas() as unknown as HTMLCanvasElement,
      atlas,
      atlasImage: {} as unknown as CanvasImageSource,
    };
    expect(() => drawScene(target, result.finalState)).not.toThrow();
  });
});
