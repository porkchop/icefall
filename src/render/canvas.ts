/**
 * Phase 5.A.2 tile renderer — `drawScene(target, state)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The renderer is a **read-only sink** on sim state. It MUST NOT
 *     mutate any field of `RunState`, MUST NOT advance the state-hash
 *     chain, MUST NOT consume any `RunStreams` cursor, MUST NOT call
 *     `tick()` or any sim write path.
 *   - The only legal value imports from `src/sim/**` are read-only
 *     `Readonly<...>` values (none currently exist); type imports from
 *     `src/sim/types` only.
 *   - The renderer cannot import `src/core/streams.ts` or
 *     `src/sim/combat.ts` (lint-enforced).
 *   - Pixel coordinates are integer-only (no float arithmetic; the
 *     `determinism/no-float-arithmetic` rule applies via the
 *     `src/render/**` lint scope in `eslint.config.js`).
 *
 * The renderer reads:
 *   - `state.floorState.floor.tiles`          — the row-major tile grid
 *   - `state.floorState.floor.{width,height}` — for canvas dimensions
 *   - `state.floorState.monsters`             — sorted by id
 *   - `state.floorState.items`                — sorted by (y, x, kind)
 *   - `state.player.pos`                      — player cell
 *
 * Tile→slot mapping:
 *   - TILE_VOID  (0) — no draw (transparent)
 *   - TILE_FLOOR (1) — `tile.floor.cyberfloor_01`
 *   - TILE_WALL  (2) — `tile.wall.cyberfloor_01`
 *   - TILE_DOOR  (3) — `tile.door.cyberdoor`
 *   - other          — no draw (defensive; codes 4..255 reserved)
 *
 * Monster→slot: every monster maps to `monster.ice.daemon` in Phase 5
 * (the registry has more entries but only one recipe ships in the
 * atlas; Phase 6+ extends this).
 *
 * Item→slot: the FloorItem's `kind` (an `ItemKindId` like
 * `item.cred-chip`) is used directly as the atlas slot id. Phase 5
 * ships only `item.cred-chip` placeholders.
 *
 * Player→slot: `player`.
 */

import type { RunState } from "../sim/types";
import type { LoadedAtlas } from "../atlas/loader";
import {
  ATLAS_TILES_WIDE,
  ATLAS_TILES_HIGH,
  TILE_PADDING,
  TILE_SIZE,
} from "../atlas/params";

/**
 * The set of object types `CanvasRenderingContext2D.drawImage` accepts.
 * In a real browser this is `HTMLImageElement | ImageBitmap | etc.`;
 * the renderer is duck-typed against `ctx.drawImage(source, ...)`.
 */
export type AtlasImage = CanvasImageSource;

/** Render target — the canvas, the loaded atlas, and the decoded image. */
export type RenderTarget = {
  readonly canvas: HTMLCanvasElement;
  readonly atlas: LoadedAtlas;
  /**
   * The decoded atlas image source. Caller is responsible for turning
   * the loader's PNG bytes into an `HTMLImageElement` / `ImageBitmap`
   * (the renderer does not perform async decoding inside its hot path).
   */
  readonly atlasImage: AtlasImage;
};

// Tile codes — frozen contract from `src/mapgen/tiles.ts`. Inlined as
// integer literals here so the renderer does not import from
// `src/mapgen/**` (the layer table forbids it).
const TILE_VOID = 0;
const TILE_FLOOR = 1;
const TILE_WALL = 2;
const TILE_DOOR = 3;

/** Atlas slot ids the renderer needs at frame draw time. */
const SLOT_TILE_FLOOR = "tile.floor.cyberfloor_01";
const SLOT_TILE_WALL = "tile.wall.cyberfloor_01";
const SLOT_TILE_DOOR = "tile.door.cyberdoor";
const SLOT_PLAYER = "player";
const SLOT_MONSTER_DEFAULT = "monster.ice.daemon";

function tileCodeToSlot(code: number): string | null {
  if (code === TILE_VOID) return null;
  if (code === TILE_FLOOR) return SLOT_TILE_FLOOR;
  if (code === TILE_WALL) return SLOT_TILE_WALL;
  if (code === TILE_DOOR) return SLOT_TILE_DOOR;
  // Unknown / reserved codes — render as void.
  return null;
}

/**
 * Look up a sprite entry by slot id, throwing a clear error if the
 * manifest is incomplete. The mapped (atlasX, atlasY) cell coordinates
 * are converted to pixel coordinates via `cell * (TILE_SIZE +
 * TILE_PADDING)` (the same arithmetic `src/atlas/generate.ts` uses
 * during atlas authoring — keeps coordinates in lockstep).
 */
function spritePixelCoord(
  atlas: LoadedAtlas,
  slot: string,
): { sx: number; sy: number } {
  const sprite = atlas.manifest.sprites.get(slot as never);
  if (sprite === undefined) {
    throw new Error(
      `drawScene: atlas manifest missing required slot '${slot}'`,
    );
  }
  if (
    sprite.atlasX < 0 ||
    sprite.atlasX >= ATLAS_TILES_WIDE ||
    sprite.atlasY < 0 ||
    sprite.atlasY >= ATLAS_TILES_HIGH
  ) {
    throw new Error(
      `drawScene: atlas slot '${slot}' coordinate out of grid (${sprite.atlasX},${sprite.atlasY})`,
    );
  }
  const sx = sprite.atlasX * (TILE_SIZE + TILE_PADDING);
  const sy = sprite.atlasY * (TILE_SIZE + TILE_PADDING);
  return { sx, sy };
}

/**
 * Draw the entire scene from `state` onto `target.canvas`. Pure
 * function-of-state: same `RunState` + same atlas → same canvas pixels.
 *
 * Layering: tiles → items → monsters → player. (Items can be picked up
 * in a later phase, so they live under monster sprites; the player is
 * always on top so it cannot be visually occluded.)
 */
export function drawScene(target: RenderTarget, state: RunState): void {
  const floor = state.floorState.floor;
  const canvas = target.canvas;
  canvas.width = floor.width * TILE_SIZE;
  canvas.height = floor.height * TILE_SIZE;

  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("drawScene: 2d context unavailable on supplied canvas");
  }
  ctx.imageSmoothingEnabled = false;

  // Clear before drawing so transparent (void) tiles read as background.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tiles.
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const code = floor.tiles[y * floor.width + x]!;
      const slot = tileCodeToSlot(code);
      if (slot === null) continue;
      const { sx, sy } = spritePixelCoord(target.atlas, slot);
      ctx.drawImage(
        target.atlasImage,
        sx,
        sy,
        TILE_SIZE,
        TILE_SIZE,
        x * TILE_SIZE,
        y * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }

  // Items.
  const items = state.floorState.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    // FloorItem.kind is an ItemKindId like "item.cred-chip" — the same
    // string the atlas registry uses as the slot id.
    const { sx, sy } = spritePixelCoord(target.atlas, it.kind);
    ctx.drawImage(
      target.atlasImage,
      sx,
      sy,
      TILE_SIZE,
      TILE_SIZE,
      it.x * TILE_SIZE,
      it.y * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    );
  }

  // Monsters (only living ones; hp === 0 are removed visually).
  const monsters = state.floorState.monsters;
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i]!;
    if (m.hp <= 0) continue;
    const { sx, sy } = spritePixelCoord(target.atlas, SLOT_MONSTER_DEFAULT);
    ctx.drawImage(
      target.atlasImage,
      sx,
      sy,
      TILE_SIZE,
      TILE_SIZE,
      m.pos.x * TILE_SIZE,
      m.pos.y * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    );
  }

  // Player.
  const { sx: psx, sy: psy } = spritePixelCoord(target.atlas, SLOT_PLAYER);
  ctx.drawImage(
    target.atlasImage,
    psx,
    psy,
    TILE_SIZE,
    TILE_SIZE,
    state.player.pos.x * TILE_SIZE,
    state.player.pos.y * TILE_SIZE,
    TILE_SIZE,
    TILE_SIZE,
  );
}
