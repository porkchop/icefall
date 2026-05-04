import { describe, expect, it } from "vitest";
import {
  ITEM_KINDS,
  ITEM_KIND_IDS,
  getItemKind,
} from "../../src/registries/items";

describe("item registry — Phase 3 decision 13 + Phase 6.A.2 expansion", () => {
  it("ships 20 entries — original 5 from Phase 3 + 15 expansions in Phase 6.A.2", () => {
    expect(ITEM_KINDS.length).toBe(20);
  });

  it("ITEM_KIND_IDS exactly mirrors ITEM_KINDS in order", () => {
    expect(ITEM_KIND_IDS).toEqual(ITEM_KINDS.map((k) => k.id));
  });

  it("registry is sorted by id (deterministic iteration)", () => {
    const ids = ITEM_KINDS.map((k) => k.id);
    expect(ids).toEqual(ids.slice().sort());
  });

  it("ids are pairwise distinct", () => {
    const ids = ITEM_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has integer tier and a valid category", () => {
    for (const k of ITEM_KINDS) {
      expect(Number.isInteger(k.tier)).toBe(true);
      expect(k.tier).toBeGreaterThan(0);
      expect(["currency", "consumable", "equipment"]).toContain(k.category);
    }
  });

  it("every entry's effect is a recognized variant with non-negative integer fields", () => {
    for (const k of ITEM_KINDS) {
      expect(["heal", "atk-bonus", "def-bonus", "none"]).toContain(k.effect.kind);
      if (k.effect.kind !== "none") {
        expect(Number.isInteger(k.effect.base)).toBe(true);
        expect(k.effect.base).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(k.effect.variance)).toBe(true);
        expect(k.effect.variance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("contains the five expected ids per memo decision 13", () => {
    const ids = new Set(ITEM_KINDS.map((k) => k.id));
    expect(ids.has("item.cred-chip")).toBe(true);
    expect(ids.has("item.stim-patch")).toBe(true);
    expect(ids.has("item.trauma-pack")).toBe(true);
    expect(ids.has("item.cyberdeck-mod-1")).toBe(true);
    expect(ids.has("item.weapon.knife")).toBe(true);
  });

  it("trauma-pack is tier 2 (bigger heal than stim-patch)", () => {
    const trauma = ITEM_KINDS.find((k) => k.id === "item.trauma-pack")!;
    const stim = ITEM_KINDS.find((k) => k.id === "item.stim-patch")!;
    expect(trauma.tier).toBeGreaterThan(stim.tier);
  });

  it("getItemKind resolves a known id", () => {
    expect(getItemKind("item.cred-chip").category).toBe("currency");
  });

  it("getItemKind throws on unknown id", () => {
    expect(() => getItemKind("item.does-not-exist")).toThrowError(
      /unknown item kind id/,
    );
  });
});
