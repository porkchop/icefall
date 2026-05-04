import { describe, expect, it } from "vitest";
import {
  MONSTER_KINDS,
  MONSTER_KIND_IDS,
  eligibleMonstersForFloor,
  getMonsterKind,
} from "../../src/registries/monsters";

describe("monster registry — Phase 3 decision 12", () => {
  it("ships exactly 7 entries (6 normal + 1 boss)", () => {
    expect(MONSTER_KINDS.length).toBe(7);
    const bossCount = MONSTER_KINDS.filter((k) => k.isBoss).length;
    expect(bossCount).toBe(1);
  });

  it("MONSTER_KIND_IDS exactly mirrors MONSTER_KINDS in order", () => {
    expect(MONSTER_KIND_IDS).toEqual(MONSTER_KINDS.map((k) => k.id));
  });

  it("registry is sorted by id (deterministic iteration)", () => {
    const ids = MONSTER_KINDS.map((k) => k.id);
    const sorted = ids.slice().sort();
    expect(ids).toEqual(sorted);
  });

  it("all stats are integer-only", () => {
    for (const k of MONSTER_KINDS) {
      expect(Number.isInteger(k.hpMax)).toBe(true);
      expect(Number.isInteger(k.atk)).toBe(true);
      expect(Number.isInteger(k.def)).toBe(true);
      expect(k.hpMax).toBeGreaterThan(0);
      expect(k.atk).toBeGreaterThanOrEqual(0);
      expect(k.def).toBeGreaterThanOrEqual(0);
    }
  });

  it("ids are pairwise distinct", () => {
    const ids = MONSTER_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the boss is monster.boss.black-ice-v0 with floor 10 only", () => {
    const boss = MONSTER_KINDS.find((k) => k.isBoss)!;
    expect(boss.id).toBe("monster.boss.black-ice-v0");
    expect([...boss.allowedFloors]).toEqual([10]);
    expect(boss.hpMax).toBeGreaterThan(20);
  });

  it("getMonsterKind resolves a known id", () => {
    const k = getMonsterKind("monster.ice.daemon");
    expect(k.hpMax).toBe(4);
    expect(k.atk).toBe(2);
    expect(k.def).toBe(0);
  });

  it("getMonsterKind throws on unknown id", () => {
    expect(() => getMonsterKind("monster.does-not-exist")).toThrowError(
      /unknown monster kind id/,
    );
  });

  it("eligibleMonstersForFloor(1) yields ice.daemon (floors 1..3)", () => {
    const elig = eligibleMonstersForFloor(1);
    expect(elig.map((m) => m.id)).toEqual(["monster.ice.daemon"]);
  });

  it("eligibleMonstersForFloor(5) includes mid-floor mix and excludes boss", () => {
    const elig = eligibleMonstersForFloor(5);
    const ids = elig.map((m) => m.id);
    expect(ids).toContain("monster.ice.spider");
    expect(ids).toContain("monster.corp.sec-veteran");
    expect(ids).toContain("monster.drone.sentry");
    expect(ids).not.toContain("monster.boss.black-ice-v0");
  });

  it("eligibleMonstersForFloor(10) is empty (boss spawns separately)", () => {
    expect(eligibleMonstersForFloor(10)).toEqual([]);
  });

  it("eligibleMonstersForFloor(99) is empty (no kind allows that floor)", () => {
    expect(eligibleMonstersForFloor(99)).toEqual([]);
  });

  it("eligibleMonstersForFloor result is sorted by id (deterministic)", () => {
    for (const floor of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const elig = eligibleMonstersForFloor(floor);
      const ids = elig.map((m) => m.id);
      expect(ids).toEqual(ids.slice().sort());
    }
  });
});
