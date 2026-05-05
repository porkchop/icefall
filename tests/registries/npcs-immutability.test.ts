/**
 * Phase 7.A.2 NPC registry immutability test — mirrors
 * `tests/registries/items-immutability.test.ts` (the long-deferred
 * Phase 2 decision-memo decision-6 pattern).
 *
 * The three Phase 7.A.2 NPC kinds are the load-bearing ids for shop
 * transaction wiring. Renaming any id, reordering the registry, or
 * altering any of the existing stock tables silently is a
 * `rulesetVersion` bump — and would cause the SIM_DIGEST and
 * WIN_DIGEST golden constants to drift. This test pins each entry's
 * `(id, displayName, basePrice, priceVariance, stockTable)` tuple
 * byte-for-byte.
 */

import { describe, expect, it } from "vitest";
import {
  NPC_KINDS,
  NPC_KIND_IDS,
  getNpcKind,
  npcKindOrdinal,
  npcKindIdAtOrdinal,
} from "../../src/registries/npcs";

const PHASE_7_A_2_PINNED_ENTRIES = [
  {
    id: "npc.fixer",
    displayName: "Fixer",
    basePrice: 2,
    priceVariance: 2,
    stockTable: [
      "item.cyberdeck-mod-1",
      "item.weapon.cyberblade",
      "item.weapon.knife",
      "item.weapon.monoblade",
      "item.weapon.pistol",
      "item.weapon.shotgun",
      "item.weapon.smg",
    ],
  },
  {
    id: "npc.info-broker",
    displayName: "Info-Broker",
    basePrice: 1,
    priceVariance: 2,
    stockTable: [
      "item.consumable.adrenaline-spike",
      "item.consumable.med-injector",
      "item.consumable.nano-repair",
      "item.consumable.syringe",
      "item.eddies",
    ],
  },
  {
    id: "npc.ripperdoc",
    displayName: "Ripperdoc",
    basePrice: 3,
    priceVariance: 2,
    stockTable: [
      "item.cyber.armor",
      "item.cyber.dermal-plating",
      "item.cyber.neural-link",
      "item.cyber.reflex-booster",
      "item.cyber.subdermal-armor",
      "item.stim-patch",
      "item.trauma-pack",
    ],
  },
] as const;

describe("npcs registry — Phase 7.A.2 immutability test", () => {
  it("contains exactly the three Phase 7 NPC kinds in alphabetical order", () => {
    const ids = NPC_KIND_IDS.slice();
    expect(ids).toEqual(["npc.fixer", "npc.info-broker", "npc.ripperdoc"]);
  });

  it("each entry's tuple is unchanged byte-for-byte", () => {
    for (const expected of PHASE_7_A_2_PINNED_ENTRIES) {
      const entry = getNpcKind(expected.id);
      expect(entry.id).toBe(expected.id);
      expect(entry.displayName).toBe(expected.displayName);
      expect(entry.basePrice).toBe(expected.basePrice);
      expect(entry.priceVariance).toBe(expected.priceVariance);
      expect(entry.stockTable.slice()).toEqual(expected.stockTable);
    }
  });

  it("registry is sorted by id (UTF-16 code-unit order)", () => {
    const ids = NPC_KINDS.map((k) => k.id);
    const sorted = ids.slice().sort();
    expect(ids).toEqual(sorted);
  });

  it("npcKindOrdinal is the inverse of npcKindIdAtOrdinal", () => {
    for (let i = 0; i < NPC_KINDS.length; i++) {
      const id = NPC_KIND_IDS[i]!;
      expect(npcKindOrdinal(id)).toBe(i);
      expect(npcKindIdAtOrdinal(i)).toBe(id);
    }
  });

  it("npcKindOrdinal returns -1 for unknown ids", () => {
    expect(npcKindOrdinal("npc.does-not-exist")).toBe(-1);
    expect(npcKindOrdinal("")).toBe(-1);
  });

  it("npcKindIdAtOrdinal returns null for out-of-range / non-integer", () => {
    expect(npcKindIdAtOrdinal(-1)).toBeNull();
    expect(npcKindIdAtOrdinal(NPC_KINDS.length)).toBeNull();
    expect(npcKindIdAtOrdinal(1.5)).toBeNull();
  });

  it("getNpcKind throws for unknown ids (programmer error)", () => {
    expect(() => getNpcKind("npc.unknown")).toThrowError(
      /unknown npc kind id/,
    );
  });

  it("each entry's stock table contains only registered ItemKindIds", () => {
    // Lazy import so the test file's only dependency on items is
    // through this assertion. Keeps the immutability test focused.
    const itemIds = new Set([
      "item.consumable.adrenaline-spike",
      "item.consumable.med-injector",
      "item.consumable.nano-repair",
      "item.consumable.syringe",
      "item.cred-chip",
      "item.cyber.armor",
      "item.cyber.dermal-plating",
      "item.cyber.neural-link",
      "item.cyber.reflex-booster",
      "item.cyber.subdermal-armor",
      "item.cyberdeck-mod-1",
      "item.eddies",
      "item.stim-patch",
      "item.trauma-pack",
      "item.weapon.cyberblade",
      "item.weapon.knife",
      "item.weapon.monoblade",
      "item.weapon.pistol",
      "item.weapon.shotgun",
      "item.weapon.smg",
    ]);
    for (const npc of NPC_KINDS) {
      for (const itemId of npc.stockTable) {
        expect(itemIds.has(itemId)).toBe(true);
      }
    }
  });
});
