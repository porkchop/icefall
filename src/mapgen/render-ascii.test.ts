import { describe, expect, it } from "vitest";
import { renderAscii, tileChar, rankOf } from "./render-ascii";
import type { Floor } from "./types";
import { TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_VOID } from "./tiles";

function tinyFloor(): Floor {
  // 4 wide, 3 tall: a tiny room with one door, entrance/exit slots, no overlay
  const tiles = new Uint8Array(12);
  tiles[0] = TILE_VOID;
  tiles[1] = TILE_WALL;
  tiles[2] = TILE_WALL;
  tiles[3] = TILE_VOID;
  tiles[4] = TILE_WALL;
  tiles[5] = TILE_FLOOR;
  tiles[6] = TILE_DOOR;
  tiles[7] = TILE_FLOOR;
  tiles[8] = TILE_VOID;
  tiles[9] = TILE_WALL;
  tiles[10] = TILE_WALL;
  tiles[11] = TILE_VOID;
  return {
    floor: 1,
    width: 4,
    height: 3,
    tiles,
    rooms: [
      { id: 0, kind: "room.entrance", x: 0, y: 0, w: 3, h: 3 },
      { id: 1, kind: "room.exit", x: 1, y: 0, w: 3, h: 3 },
    ],
    doors: [{ x: 2, y: 1 }],
    encounters: [{ kind: "encounter.combat.basic", x: 1, y: 1 }],
    entrance: { x: 1, y: 1 },
    exit: { x: 3, y: 1 },
    bossArena: null,
  };
}

describe("renderAscii (frozen contract 13)", () => {
  it("uses the frozen char mapping", () => {
    // bare floor (no overlays) — strip overlays
    const f: Floor = {
      ...tinyFloor(),
      encounters: [],
      // pick entrance/exit at non-existent tile to test base mapping
      // by using positions that are walls (so they get overridden).
    };
    const ascii = renderAscii({ ...f, entrance: { x: 1, y: 0 } });
    // Wall at (1,0) is overridden by '<'.
    expect(ascii.charAt(1)).toBe("<");
  });

  it("ends with exactly one trailing newline", () => {
    const a = renderAscii(tinyFloor());
    expect(a.endsWith("\n")).toBe(true);
    expect(a.endsWith("\n\n")).toBe(false);
  });

  it("uses LF (no carriage returns)", () => {
    const a = renderAscii(tinyFloor());
    expect(a.includes("\r")).toBe(false);
  });

  it("renders width chars per line plus newline; height lines", () => {
    const f = tinyFloor();
    const a = renderAscii(f);
    const lines = a.split("\n");
    // last element is empty due to trailing newline
    expect(lines.length).toBe(f.height + 1);
    expect(lines[f.height]).toBe("");
    for (let i = 0; i < f.height; i++) {
      expect(lines[i]!.length).toBe(f.width);
    }
  });

  it("entrance < beats encounter e and tile codes; exit > likewise", () => {
    const f = tinyFloor();
    const a = renderAscii(f);
    const lines = a.split("\n");
    // entrance at (1,1) — beats the floor tile and encounter at (1,1)
    expect(lines[1]!.charAt(1)).toBe("<");
    // exit at (3,1) — beats the wall tile (none here)
    expect(lines[1]!.charAt(3)).toBe(">");
  });

  it("encounter e overrides tile but not entrance/exit/B", () => {
    const f: Floor = {
      ...tinyFloor(),
      encounters: [{ kind: "encounter.combat.basic", x: 2, y: 1 }],
      // 2,1 is a TILE_DOOR which should be overridden by 'e'
    };
    const a = renderAscii(f);
    const lines = a.split("\n");
    expect(lines[1]!.charAt(2)).toBe("e");
  });

  it("renders boss arena B over its rectangle on floor 10", () => {
    const f: Floor = {
      ...tinyFloor(),
      floor: 10,
      bossArena: { x: 2, y: 0, w: 2, h: 2 },
      exit: null,
      // entrance off the arena rectangle
      entrance: { x: 0, y: 1 },
    };
    const a = renderAscii(f);
    const lines = a.split("\n");
    expect(lines[0]!.charAt(2)).toBe("B");
    expect(lines[0]!.charAt(3)).toBe("B");
    expect(lines[1]!.charAt(2)).toBe("B");
  });

  it("throws if two top-tier overlays collide on the same cell", () => {
    const bad: Floor = {
      ...tinyFloor(),
      floor: 10,
      bossArena: { x: 1, y: 1, w: 2, h: 2 },
      exit: null,
      // entrance at (1,1) — collides with B
      entrance: { x: 1, y: 1 },
    };
    expect(() => renderAscii(bad)).toThrow();
  });

  it("renders void as space and wall as #", () => {
    const f: Floor = {
      ...tinyFloor(),
      encounters: [],
      // entrance moved off (0,0) and (0,1); exit also moved away.
      entrance: { x: 1, y: 1 },
      exit: { x: 3, y: 1 },
      bossArena: null,
    };
    const a = renderAscii(f);
    const lines = a.split("\n");
    expect(lines[0]!.charAt(0)).toBe(" ");
    expect(lines[0]!.charAt(1)).toBe("#");
  });
});

describe("tileChar — direct mapping (frozen contract 13)", () => {
  it("returns the canonical char for each known tile code", () => {
    expect(tileChar(TILE_FLOOR)).toBe(".");
    expect(tileChar(TILE_WALL)).toBe("#");
    expect(tileChar(TILE_DOOR)).toBe("+");
    expect(tileChar(TILE_VOID)).toBe(" ");
  });

  it("returns '?' for an unknown future tile code", () => {
    expect(tileChar(99)).toBe("?");
    expect(tileChar(255)).toBe("?");
  });
});

describe("rankOf — overlay precedence", () => {
  it("ranks top-tier overlays at 3", () => {
    expect(rankOf("<")).toBe(3);
    expect(rankOf(">")).toBe(3);
    expect(rankOf("B")).toBe(3);
  });

  it("ranks encounter at 2", () => {
    expect(rankOf("e")).toBe(2);
  });

  it("ranks any other char at 1", () => {
    expect(rankOf(".")).toBe(1);
    expect(rankOf("#")).toBe(1);
    expect(rankOf("+")).toBe(1);
    expect(rankOf(" ")).toBe(1);
    expect(rankOf("?")).toBe(1);
  });
});
