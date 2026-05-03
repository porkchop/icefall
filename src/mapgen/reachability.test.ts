import { describe, expect, it } from "vitest";
import { bfsReachable } from "./reachability";
import { TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_VOID } from "./tiles";

function makeGrid(rows: string[]): {
  tiles: Uint8Array;
  width: number;
  height: number;
} {
  const height = rows.length;
  const width = rows[0]!.length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = rows[y]!.charAt(x);
      tiles[y * width + x] =
        c === "."
          ? TILE_FLOOR
          : c === "#"
            ? TILE_WALL
            : c === "+"
              ? TILE_DOOR
              : TILE_VOID;
    }
  }
  return { tiles, width, height };
}

describe("bfsReachable", () => {
  it("returns true if every floor/door cell is reachable from the start", () => {
    const g = makeGrid(["#####", "#...#", "#.+.#", "#...#", "#####"]);
    expect(bfsReachable(g.tiles, g.width, g.height, { x: 1, y: 1 })).toBe(
      true,
    );
  });

  it("treats walls and void as blocking", () => {
    const g = makeGrid([
      "#####",
      "#...#",
      "#.#.#", // wall in the middle column splits the room
      "#...#",
      "#####",
    ]);
    // Reachable since BFS can route around the wall
    expect(bfsReachable(g.tiles, g.width, g.height, { x: 1, y: 1 })).toBe(
      true,
    );
  });

  it("returns false if a floor cell is isolated", () => {
    const g = makeGrid([
      "######",
      "#...##",
      "###.##", // isolation
      "#.####",
      "#.####",
      "######",
    ]);
    expect(bfsReachable(g.tiles, g.width, g.height, { x: 1, y: 1 })).toBe(
      false,
    );
  });

  it("door cells are walkable", () => {
    const g = makeGrid(["####", "#.+.", "####"]);
    expect(bfsReachable(g.tiles, g.width, g.height, { x: 1, y: 1 })).toBe(
      true,
    );
  });

  it("throws if the start cell itself is not walkable", () => {
    const g = makeGrid(["#####", "#...#", "#####"]);
    expect(() =>
      bfsReachable(g.tiles, g.width, g.height, { x: 0, y: 0 }),
    ).toThrow();
  });

  it("returns true for a single-cell walkable grid", () => {
    const g = makeGrid(["."]);
    expect(bfsReachable(g.tiles, g.width, g.height, { x: 0, y: 0 })).toBe(
      true,
    );
  });
});
