import { describe, expect, it } from "vitest";
import { placeRoomInLeaf } from "./rooms";
import { sfc32 } from "../core/prng";
import { ROOM_PADDING } from "./params";

describe("placeRoomInLeaf", () => {
  it("returns a rectangle strictly inside the leaf with padding on every side", () => {
    const r = sfc32(1, 2, 3, 4);
    const leaf = { x: 5, y: 5, w: 16, h: 12 };
    const room = placeRoomInLeaf(leaf, r, "room.regular");
    expect(room.x).toBeGreaterThanOrEqual(leaf.x + ROOM_PADDING);
    expect(room.y).toBeGreaterThanOrEqual(leaf.y + ROOM_PADDING);
    expect(room.x + room.w).toBeLessThanOrEqual(leaf.x + leaf.w - ROOM_PADDING);
    expect(room.y + room.h).toBeLessThanOrEqual(leaf.y + leaf.h - ROOM_PADDING);
  });

  it("respects the room kind's min and max dimensions", () => {
    const r = sfc32(99, 88, 77, 66);
    const leaf = { x: 0, y: 0, w: 30, h: 20 };
    const room = placeRoomInLeaf(leaf, r, "room.regular");
    expect(room.w).toBeGreaterThanOrEqual(4);
    expect(room.h).toBeGreaterThanOrEqual(3);
  });

  it("is reproducible from the PRNG", () => {
    const a = sfc32(7, 7, 7, 7);
    const b = sfc32(7, 7, 7, 7);
    const leaf = { x: 0, y: 0, w: 16, h: 12 };
    expect(placeRoomInLeaf(leaf, a, "room.regular")).toEqual(
      placeRoomInLeaf(leaf, b, "room.regular"),
    );
  });

  it("returns integer coordinates", () => {
    const r = sfc32(11, 13, 17, 19);
    const room = placeRoomInLeaf(
      { x: 3, y: 4, w: 18, h: 11 },
      r,
      "room.regular",
    );
    expect(Number.isInteger(room.x)).toBe(true);
    expect(Number.isInteger(room.y)).toBe(true);
    expect(Number.isInteger(room.w)).toBe(true);
    expect(Number.isInteger(room.h)).toBe(true);
  });

  it("throws if the leaf is too small to host the kind's minimum room", () => {
    const r = sfc32(1, 1, 1, 1);
    expect(() =>
      placeRoomInLeaf({ x: 0, y: 0, w: 4, h: 3 }, r, "room.regular"),
    ).toThrow();
  });
});
