import { describe, expect, it } from "vitest";
import { ROOM_KINDS, getRoomKind, ROOM_KIND_IDS } from "./rooms";

describe("rooms registry (frozen contract 9)", () => {
  it("exposes exactly the five frozen room kind IDs", () => {
    const ids = ROOM_KINDS.map((k) => k.id).sort();
    expect(ids).toEqual([
      "room.boss-antechamber",
      "room.boss-arena",
      "room.entrance",
      "room.exit",
      "room.regular",
    ]);
  });

  it("ROOM_KIND_IDS matches the registry IDs", () => {
    expect([...ROOM_KIND_IDS].sort()).toEqual(
      ROOM_KINDS.map((k) => k.id).sort(),
    );
  });

  it("registry entries each have positive integer min/max dimensions and an allowedFloors set", () => {
    for (const k of ROOM_KINDS) {
      expect(typeof k.id).toBe("string");
      expect(Number.isInteger(k.minWidth)).toBe(true);
      expect(Number.isInteger(k.minHeight)).toBe(true);
      expect(Number.isInteger(k.maxWidth)).toBe(true);
      expect(Number.isInteger(k.maxHeight)).toBe(true);
      expect(k.minWidth).toBeGreaterThan(0);
      expect(k.minHeight).toBeGreaterThan(0);
      expect(k.maxWidth).toBeGreaterThanOrEqual(k.minWidth);
      expect(k.maxHeight).toBeGreaterThanOrEqual(k.minHeight);
      expect(k.allowedFloors instanceof Array).toBe(true);
      for (const f of k.allowedFloors) {
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(1);
        expect(f).toBeLessThanOrEqual(10);
      }
    }
  });

  it("getRoomKind returns the matching entry by id", () => {
    expect(getRoomKind("room.entrance").id).toBe("room.entrance");
    expect(getRoomKind("room.boss-arena").id).toBe("room.boss-arena");
  });

  it("getRoomKind throws for an unknown id", () => {
    expect(() => getRoomKind("room.unknown")).toThrow();
  });

  it("registry array is frozen and append-only by convention (cannot mutate at runtime)", () => {
    expect(Object.isFrozen(ROOM_KINDS)).toBe(true);
    for (const k of ROOM_KINDS) expect(Object.isFrozen(k)).toBe(true);
  });

  it("entries are listed in id-sorted order for stable iteration", () => {
    const ids = ROOM_KINDS.map((k) => k.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("boss-arena and boss-antechamber are restricted to floor 10", () => {
    expect(getRoomKind("room.boss-arena").allowedFloors).toEqual([10]);
    expect(getRoomKind("room.boss-antechamber").allowedFloors).toEqual([10]);
  });

  it("entrance is allowed on every floor 1..10", () => {
    expect(getRoomKind("room.entrance").allowedFloors).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("exit is allowed only on floors 1..9", () => {
    expect(getRoomKind("room.exit").allowedFloors).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});
