import { describe, expect, it } from "vitest";
import { placeEncountersForRoom } from "./encounters";
import { sfc32 } from "../core/prng";
import { TILE_FLOOR } from "./tiles";
import type { Room } from "./types";

describe("placeEncountersForRoom", () => {
  function makeRoom(id: number): Room {
    return { id, kind: "room.regular", x: 1, y: 1, w: 6, h: 4 };
  }
  function makeGrid(w: number, h: number): {
    tiles: Uint8Array;
    width: number;
    height: number;
  } {
    const tiles = new Uint8Array(w * h);
    // Fill the room interior (1..6, 1..4) with floor.
    for (let y = 1; y < 5; y++) {
      for (let x = 1; x < 7; x++) {
        tiles[y * w + x] = TILE_FLOOR;
      }
    }
    return { tiles, width: w, height: h };
  }

  it("returns zero encounters for the entrance room (no encounter ever placed there)", () => {
    const r = sfc32(1, 2, 3, 4);
    const room: Room = {
      id: 0,
      kind: "room.entrance",
      x: 1,
      y: 1,
      w: 6,
      h: 4,
    };
    const g = makeGrid(8, 6);
    const slots = placeEncountersForRoom(g.tiles, g.width, g.height, room, r, 1);
    expect(slots).toHaveLength(0);
  });

  it("returns zero encounters for the exit room", () => {
    const r = sfc32(1, 2, 3, 4);
    const room: Room = {
      id: 1,
      kind: "room.exit",
      x: 1,
      y: 1,
      w: 6,
      h: 4,
    };
    const g = makeGrid(8, 6);
    const slots = placeEncountersForRoom(g.tiles, g.width, g.height, room, r, 1);
    expect(slots).toHaveLength(0);
  });

  it("returns at most one encounter per regular room, on a floor tile inside the room", () => {
    const r = sfc32(7, 8, 9, 10);
    const room = makeRoom(2);
    const g = makeGrid(8, 6);
    const slots = placeEncountersForRoom(g.tiles, g.width, g.height, room, r, 3);
    expect(slots.length).toBeLessThanOrEqual(1);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(room.x + 1);
      expect(s.x).toBeLessThan(room.x + room.w - 1);
      expect(s.y).toBeGreaterThanOrEqual(room.y + 1);
      expect(s.y).toBeLessThan(room.y + room.h - 1);
    }
  });

  it("is reproducible from the PRNG", () => {
    const r1 = sfc32(11, 12, 13, 14);
    const r2 = sfc32(11, 12, 13, 14);
    const room = makeRoom(2);
    const g1 = makeGrid(8, 6);
    const g2 = makeGrid(8, 6);
    expect(placeEncountersForRoom(g1.tiles, g1.width, g1.height, room, r1, 5)).toEqual(
      placeEncountersForRoom(g2.tiles, g2.width, g2.height, room, r2, 5),
    );
  });

  it("uses encounter kinds appropriate for the floor", () => {
    // Floor 1 should never produce encounter.combat.elite (allowedFloors = [4..9])
    const r = sfc32(11, 13, 17, 19);
    const room = makeRoom(2);
    const g = makeGrid(8, 6);
    const slots = placeEncountersForRoom(g.tiles, g.width, g.height, room, r, 1);
    for (const s of slots) {
      expect(s.kind).not.toBe("encounter.combat.elite");
    }
  });

  it("returns zero encounters for a room whose interior contains no TILE_FLOOR cells", () => {
    // Synthesize a regular room whose tile grid is entirely TILE_VOID, so
    // all 8 placement attempts in the inner search loop miss.
    const room = makeRoom(2);
    const w = 8;
    const h = 6;
    const tiles = new Uint8Array(w * h); // all zeros = TILE_VOID
    // PRNG fixture: first call returns 1 (placeBit = 1 → don't skip),
    // subsequent calls return 0 (kind index 0; xOff/yOff = 0). All 8
    // attempts target (room.x+1, room.y+1) = (2, 2), which is TILE_VOID.
    let n = 0;
    const fakePrng = (): number => (n++ === 0 ? 1 : 0);
    const slots = placeEncountersForRoom(tiles, w, h, room, fakePrng, 3);
    expect(slots).toHaveLength(0);
  });

  it("returns zero encounters when the inner room rectangle is degenerate (w<=2 or h<=2)", () => {
    const r = sfc32(1, 1, 1, 1);
    const tinyRoom: Room = { id: 0, kind: "room.regular", x: 0, y: 0, w: 2, h: 2 };
    const g = makeGrid(4, 4);
    expect(
      placeEncountersForRoom(g.tiles, g.width, g.height, tinyRoom, r, 3),
    ).toHaveLength(0);
  });
});
