import { describe, expect, it } from "vitest";
import { carveRoom, carveLCorridor, placeDoor } from "./corridors";
import { TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_VOID } from "./tiles";

function makeGrid(w: number, h: number): {
  tiles: Uint8Array;
  width: number;
  height: number;
} {
  return { tiles: new Uint8Array(w * h), width: w, height: h };
}

function get(g: { tiles: Uint8Array; width: number }, x: number, y: number): number {
  return g.tiles[y * g.width + x]!;
}

describe("carveRoom", () => {
  it("fills room interior with floor and outlines with wall", () => {
    const g = makeGrid(10, 8);
    carveRoom(g.tiles, g.width, g.height, { x: 2, y: 1, w: 5, h: 4 });
    // Interior cell
    expect(get(g, 3, 2)).toBe(TILE_FLOOR);
    expect(get(g, 5, 3)).toBe(TILE_FLOOR);
    // Wall at the outer ring of the room rect
    expect(get(g, 2, 1)).toBe(TILE_WALL);
    expect(get(g, 6, 1)).toBe(TILE_WALL);
    expect(get(g, 2, 4)).toBe(TILE_WALL);
    expect(get(g, 6, 4)).toBe(TILE_WALL);
    // Outside untouched (still VOID)
    expect(get(g, 0, 0)).toBe(TILE_VOID);
    expect(get(g, 9, 7)).toBe(TILE_VOID);
  });
});

describe("carveLCorridor", () => {
  it("connects two points via an L-shape, replacing wall/void with floor", () => {
    const g = makeGrid(20, 10);
    carveLCorridor(g.tiles, g.width, g.height, { x: 1, y: 1 }, { x: 18, y: 8 }, true);
    // Endpoints walkable
    expect(get(g, 1, 1)).toBe(TILE_FLOOR);
    expect(get(g, 18, 8)).toBe(TILE_FLOOR);
    // The horizontal segment first (since horizontalFirst=true)
    for (let x = 1; x <= 18; x++) expect(get(g, x, 1)).toBe(TILE_FLOOR);
    for (let y = 1; y <= 8; y++) expect(get(g, 18, y)).toBe(TILE_FLOOR);
  });

  it("supports vertical-first orientation as well", () => {
    const g = makeGrid(20, 10);
    carveLCorridor(g.tiles, g.width, g.height, { x: 2, y: 1 }, { x: 17, y: 7 }, false);
    for (let y = 1; y <= 7; y++) expect(get(g, 2, y)).toBe(TILE_FLOOR);
    for (let x = 2; x <= 17; x++) expect(get(g, x, 7)).toBe(TILE_FLOOR);
  });

  it("does not turn floor into something else", () => {
    const g = makeGrid(10, 10);
    g.tiles[5 * g.width + 5] = TILE_FLOOR;
    carveLCorridor(g.tiles, g.width, g.height, { x: 1, y: 1 }, { x: 8, y: 8 }, true);
    expect(get(g, 5, 5)).toBe(TILE_FLOOR);
  });
});

describe("placeDoor", () => {
  it("turns a wall cell adjacent to floor into a door tile", () => {
    const g = makeGrid(10, 10);
    // Set up: room interior at (2..6, 2..6) with walls at the edges
    carveRoom(g.tiles, g.width, g.height, { x: 1, y: 1, w: 7, h: 7 });
    // Carve a corridor that reaches the wall at (1, 4)
    g.tiles[4 * g.width + 0] = TILE_FLOOR;
    g.tiles[4 * g.width + 1] = TILE_WALL; // boundary wall
    const door = placeDoor(g.tiles, g.width, g.height, { x: 1, y: 4 });
    expect(door.x).toBe(1);
    expect(door.y).toBe(4);
    expect(get(g, 1, 4)).toBe(TILE_DOOR);
  });
});
