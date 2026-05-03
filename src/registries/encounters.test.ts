import { describe, expect, it } from "vitest";
import {
  ENCOUNTER_KINDS,
  getEncounterKind,
  ENCOUNTER_KIND_IDS,
} from "./encounters";

describe("encounters registry (frozen contract 10)", () => {
  it("exposes exactly the four frozen encounter slot IDs", () => {
    const ids = ENCOUNTER_KINDS.map((k) => k.id).sort();
    expect(ids).toEqual([
      "encounter.boss-arena.entry",
      "encounter.combat.basic",
      "encounter.combat.elite",
      "encounter.loot.basic",
    ]);
  });

  it("ENCOUNTER_KIND_IDS matches the registry IDs", () => {
    expect([...ENCOUNTER_KIND_IDS].sort()).toEqual(
      ENCOUNTER_KINDS.map((k) => k.id).sort(),
    );
  });

  it("each entry has weight, allowedFloors, placement", () => {
    const placements = new Set(["in-room", "corridor", "door-adjacent"]);
    for (const k of ENCOUNTER_KINDS) {
      expect(Number.isInteger(k.weight)).toBe(true);
      expect(k.weight).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(k.allowedFloors)).toBe(true);
      for (const f of k.allowedFloors) {
        expect(Number.isInteger(f)).toBe(true);
      }
      expect(placements.has(k.placement)).toBe(true);
    }
  });

  it("getEncounterKind returns the matching entry by id", () => {
    expect(getEncounterKind("encounter.combat.basic").id).toBe(
      "encounter.combat.basic",
    );
  });

  it("getEncounterKind throws for an unknown id", () => {
    expect(() => getEncounterKind("encounter.unknown")).toThrow();
  });

  it("registry array and entries are frozen at runtime", () => {
    expect(Object.isFrozen(ENCOUNTER_KINDS)).toBe(true);
    for (const k of ENCOUNTER_KINDS) expect(Object.isFrozen(k)).toBe(true);
  });

  it("entries are listed in id-sorted order", () => {
    const ids = ENCOUNTER_KINDS.map((k) => k.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("boss-arena.entry is restricted to floor 10", () => {
    expect(getEncounterKind("encounter.boss-arena.entry").allowedFloors).toEqual(
      [10],
    );
  });

  it("combat.elite is allowed on later floors only", () => {
    const elite = getEncounterKind("encounter.combat.elite");
    for (const f of elite.allowedFloors) expect(f).toBeGreaterThanOrEqual(4);
  });
});
