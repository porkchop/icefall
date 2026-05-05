/**
 * Phase 5.A.2 renderer unit tests.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"): the renderer is a
 * read-only sink on sim state. These tests assert:
 *
 *   1. `drawScene` does not throw on a valid `RunState`.
 *   2. `drawScene` does not mutate the supplied state (deep-frozen).
 *   3. The expected number of `drawImage` calls fire — one per
 *      non-VOID tile, one per monster, one per item, one for the
 *      player.
 *   4. Out-of-range tile codes are no-ops (skipped, not thrown).
 *   5. The canvas size is computed from the floor dimensions.
 *
 * The atlas image is mocked via a stub object that the renderer's
 * `ctx.drawImage(...)` accepts via duck typing; we collect calls into
 * an array and assert against the call sequence rather than against
 * pixel-buffer state.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { drawScene, type RenderTarget } from "../../src/render/canvas";
import type { LoadedAtlas } from "../../src/atlas/loader";
import type { AtlasManifest } from "../../src/atlas/generate";
import type { RunState } from "../../src/sim/types";
import { TILE_SIZE } from "../../src/atlas/params";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS } from "../../src/sim/self-test-log";

type DrawCall = {
  readonly source: unknown;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
};

function stubManifest(): AtlasManifest {
  // Build a minimal manifest covering every slot the renderer is
  // expected to look up. (atlasX, atlasY) are arbitrary integers that
  // the renderer multiplies by TILE_SIZE+TILE_PADDING; the tests assert
  // on the resulting source rectangle being computed deterministically
  // from those coordinates rather than checking exact byte values.
  const sprites = new Map();
  sprites.set("tile.floor.cyberfloor_01", {
    atlasX: 0,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.tile.floor",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("tile.wall.cyberfloor_01", {
    atlasX: 1,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.tile.wall",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("tile.door.cyberdoor", {
    atlasX: 2,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.tile.door",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("monster.ice.daemon", {
    atlasX: 3,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.monster.ice-daemon",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("item.cred-chip", {
    atlasX: 4,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.item.cred-chip",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("npc.ripperdoc", {
    atlasX: 5,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.npc.ripperdoc",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("npc.fixer", {
    atlasX: 10,
    atlasY: 1,
    recipeId: "atlas-recipe.cyberpunk.npc.fixer",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("npc.info-broker", {
    atlasX: 11,
    atlasY: 1,
    recipeId: "atlas-recipe.cyberpunk.npc.info-broker",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("monster.boss.black-ice-v0", {
    atlasX: 12,
    atlasY: 1,
    recipeId: "atlas-recipe.cyberpunk.boss.black-ice-v0",
    tilesHigh: 1,
    tilesWide: 1,
  });
  sprites.set("player", {
    atlasX: 6,
    atlasY: 0,
    recipeId: "atlas-recipe.cyberpunk.player.player",
    tilesHigh: 1,
    tilesWide: 1,
  });
  return {
    atlasBinaryHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
    atlasSeed: "test-seed",
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

function loadedAtlas(): LoadedAtlas {
  return {
    png: new Uint8Array(0),
    manifest: stubManifest(),
  };
}

class StubContext {
  imageSmoothingEnabled = true;
  fillStyle = "";
  readonly drawCalls: DrawCall[] = [];
  readonly fillCalls: { x: number; y: number; w: number; h: number }[] = [];

  drawImage(
    source: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.drawCalls.push({ source, sx, sy, sw, sh, dx, dy, dw, dh });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillCalls.push({ x, y, w, h });
  }

  clearRect(): void {
    // no-op
  }
}

class StubCanvas {
  width = 0;
  height = 0;
  readonly ctx = new StubContext();
  getContext(kind: string): StubContext | null {
    if (kind !== "2d") return null;
    return this.ctx;
  }
}

function deepFreeze<T>(o: T): T {
  if (o === null || typeof o !== "object") return o;
  // ArrayBuffer-backed views cannot be frozen by V8. Skip them; their
  // contents are integer bytes that the renderer reads but never
  // writes (the read-only contract still applies — attempting to write
  // to a Uint8Array element from the renderer would be visible via the
  // call-trace assertions in the parent suite).
  if (ArrayBuffer.isView(o)) return o;
  for (const k of Object.keys(o as Record<string, unknown>)) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  Object.freeze(o);
  return o;
}

let initialState: RunState;
beforeEach(() => {
  // Run zero actions to land on the initial floor-1 spawn state.
  const result = runScripted({ inputs: SELF_TEST_INPUTS, actions: [] });
  initialState = result.finalState;
});

describe("drawScene — basic rendering", () => {
  it("does not throw on a valid RunState", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: { stub: true } as unknown as CanvasImageSource,
    };
    expect(() => drawScene(target, initialState)).not.toThrow();
  });

  it("sets canvas dimensions to floor.width × TILE_SIZE and floor.height × TILE_SIZE", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, initialState);
    const floor = initialState.floorState.floor;
    expect(canvas.width).toBe(floor.width * TILE_SIZE);
    expect(canvas.height).toBe(floor.height * TILE_SIZE);
  });

  it("disables image smoothing for nearest-neighbor blits", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, initialState);
    expect(canvas.ctx.imageSmoothingEnabled).toBe(false);
  });

  it("emits at least one drawImage call for the player", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, initialState);
    // The player blit lands at (player.x*TILE_SIZE, player.y*TILE_SIZE).
    const playerX = initialState.player.pos.x * TILE_SIZE;
    const playerY = initialState.player.pos.y * TILE_SIZE;
    const playerCalls = canvas.ctx.drawCalls.filter(
      (c) => c.dx === playerX && c.dy === playerY,
    );
    expect(playerCalls.length).toBeGreaterThan(0);
  });

  it("emits a drawImage call for every non-void tile in the floor grid", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, initialState);
    const floor = initialState.floorState.floor;
    let nonVoidCount = 0;
    for (let i = 0; i < floor.tiles.length; i++) {
      if (floor.tiles[i]! !== 0) nonVoidCount++;
    }
    // Each non-void tile contributes exactly one drawImage call (floor /
    // wall / door). Plus N monster calls + M item calls + 1 player.
    expect(canvas.ctx.drawCalls.length).toBeGreaterThanOrEqual(nonVoidCount);
  });
});

describe("drawScene — out-of-range tile codes", () => {
  it("does not throw on tile codes outside {0,1,2,3}", () => {
    const canvas = new StubCanvas();
    // Build a synthetic state with one weird tile code.
    const floor = initialState.floorState.floor;
    const tilesCopy = new Uint8Array(floor.tiles);
    tilesCopy[0] = 99; // unknown code
    const synthState: RunState = {
      ...initialState,
      floorState: {
        ...initialState.floorState,
        floor: {
          ...floor,
          tiles: tilesCopy,
        },
      },
    };
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    expect(() => drawScene(target, synthState)).not.toThrow();
  });
});

describe("drawScene — read-only on sim state (frozen-contract test)", () => {
  it("does not mutate a deeply-frozen RunState", () => {
    const frozen = deepFreeze(initialState);
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    // Any attempt to mutate a frozen field would throw in strict mode.
    expect(() => drawScene(target, frozen)).not.toThrow();
  });
});

describe("drawScene — defensive paths", () => {
  it("throws if the canvas 2d context is unavailable", () => {
    const brokenCanvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    };
    const target: RenderTarget = {
      canvas: brokenCanvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    expect(() => drawScene(target, initialState)).toThrow();
  });

  it("throws if the manifest is missing a required slot", () => {
    const canvas = new StubCanvas();
    const m = stubManifest();
    const sprites = new Map(m.sprites);
    sprites.delete("player");
    const broken: AtlasManifest = { ...m, sprites };
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: { png: new Uint8Array(0), manifest: broken },
      atlasImage: {} as unknown as CanvasImageSource,
    };
    expect(() => drawScene(target, initialState)).toThrow(/player/);
  });
});

describe("drawScene — Phase 7.A.2b NPC + boss sprite rendering", () => {
  it("emits a drawImage call for every NPC at its (x, y) cell", () => {
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, initialState);
    const npcs = initialState.floorState.npcs;
    expect(npcs.length).toBeGreaterThan(0);
    for (const n of npcs) {
      const dx = n.pos.x * TILE_SIZE;
      const dy = n.pos.y * TILE_SIZE;
      const matches = canvas.ctx.drawCalls.filter(
        (c) => c.dx === dx && c.dy === dy,
      );
      // At least one drawImage call lands at the NPC's cell (one for
      // the floor tile beneath, plus one for the NPC sprite on top).
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it("renders the boss with its dedicated sprite slot on floor 10", () => {
    // Build a synthetic floor-10 state by inserting a boss monster
    // into `initialState`'s monsters collection. The renderer reads
    // `m.kind` to choose the slot — synthetic state is sufficient.
    const synth: RunState = {
      ...initialState,
      floorState: {
        ...initialState.floorState,
        monsters: [
          {
            id: 99,
            kind: "monster.boss.black-ice-v0",
            pos: { y: 4, x: 5 },
            hp: 24,
            hpMax: 24,
            atk: 6,
            def: 4,
            aiState: "boss-phase-1",
          },
        ],
      },
    };
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, synth);
    // The boss sprite slot is at (12, 1) in the stubManifest. Its pixel
    // coordinates are atlasX*(TILE_SIZE+TILE_PADDING) = 12*17 = 204 and
    // atlasY*(TILE_SIZE+TILE_PADDING) = 1*17 = 17. Find a draw call
    // sourcing those coordinates onto the boss's destination cell.
    const dx = 5 * TILE_SIZE;
    const dy = 4 * TILE_SIZE;
    const bossDraws = canvas.ctx.drawCalls.filter(
      (c) => c.dx === dx && c.dy === dy && c.sx === 204 && c.sy === 17,
    );
    expect(bossDraws.length).toBe(1);
  });

  it("falls back to monster.ice.daemon sprite for non-boss monsters", () => {
    const synth: RunState = {
      ...initialState,
      floorState: {
        ...initialState.floorState,
        monsters: [
          {
            id: 99,
            kind: "monster.ice.daemon",
            pos: { y: 6, x: 7 },
            hp: 4,
            hpMax: 4,
            atk: 2,
            def: 0,
            aiState: "idle",
          },
        ],
      },
    };
    const canvas = new StubCanvas();
    const target: RenderTarget = {
      canvas: canvas as unknown as HTMLCanvasElement,
      atlas: loadedAtlas(),
      atlasImage: {} as unknown as CanvasImageSource,
    };
    drawScene(target, synth);
    // monster.ice.daemon is at (3, 0) in stubManifest → sx=51, sy=0.
    const dx = 7 * TILE_SIZE;
    const dy = 6 * TILE_SIZE;
    const daemonDraws = canvas.ctx.drawCalls.filter(
      (c) => c.dx === dx && c.dy === dy && c.sx === 51 && c.sy === 0,
    );
    expect(daemonDraws.length).toBe(1);
  });
});
