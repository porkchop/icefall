import { describe, expect, it } from "vitest";
import { generateBossFloor } from "./boss-floor";
import { sfc32 } from "../core/prng";
import { bfsReachable } from "./reachability";
import { BOSS_FLOOR_WIDTH, BOSS_FLOOR_HEIGHT, BOSS_ARENA_MIN_SIZE } from "./params";

describe("generateBossFloor (frozen contract floor 10 layout)", () => {
  it("returns a floor with the boss-floor dimensions", () => {
    const r = sfc32(1, 2, 3, 4);
    const f = generateBossFloor(r);
    expect(f.width).toBe(BOSS_FLOOR_WIDTH);
    expect(f.height).toBe(BOSS_FLOOR_HEIGHT);
    expect(f.floor).toBe(10);
  });

  it("has bossArena set to a rectangle of at least 16x16", () => {
    const r = sfc32(7, 8, 9, 10);
    const f = generateBossFloor(r);
    expect(f.bossArena).not.toBeNull();
    const ba = f.bossArena!;
    expect(ba.w).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
    expect(ba.h).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
  });

  it("has exit === null and entrance set", () => {
    const r = sfc32(11, 12, 13, 14);
    const f = generateBossFloor(r);
    expect(f.exit).toBeNull();
    expect(f.entrance).toBeDefined();
  });

  it("has at least an antechamber room and an arena room", () => {
    const r = sfc32(99, 99, 99, 99);
    const f = generateBossFloor(r);
    const kinds = f.rooms.map((r) => r.kind);
    expect(kinds).toContain("room.boss-antechamber");
    expect(kinds).toContain("room.boss-arena");
  });

  it("has exactly one encounter slot, the boss-arena.entry", () => {
    const r = sfc32(31, 32, 33, 34);
    const f = generateBossFloor(r);
    expect(f.encounters).toHaveLength(1);
    expect(f.encounters[0]!.kind).toBe("encounter.boss-arena.entry");
  });

  it("is fully reachable from the entrance", () => {
    const r = sfc32(41, 43, 47, 53);
    const f = generateBossFloor(r);
    expect(bfsReachable(f.tiles, f.width, f.height, f.entrance)).toBe(true);
  });

  it("is reproducible from the PRNG", () => {
    const a = sfc32(101, 103, 107, 109);
    const b = sfc32(101, 103, 107, 109);
    const fa = generateBossFloor(a);
    const fb = generateBossFloor(b);
    expect([...fa.tiles]).toEqual([...fb.tiles]);
    expect(fa.entrance).toEqual(fb.entrance);
    expect(fa.bossArena).toEqual(fb.bossArena);
  });
});
