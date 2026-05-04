/**
 * Long-deferred Phase 2 decision-memo decision-6 immutability test —
 * lands in Phase 6.A.2 per the architecture-red-team memo callout in
 * `docs/ARCHITECTURE.md` "Phase 6 frozen contracts" → "Registry
 * append-only invariant for items".
 *
 * Every original Phase 3 entry's `(id, category, tier, effect)` tuple
 * must remain byte-for-byte unchanged after Phase 6.A.2's expansion.
 * Inserting new entries at lexicographic positions surrounding the
 * original 5 must NOT alter the original entries' bytes — only their
 * array indices, which are not part of the contract.
 *
 * Once this test lands, the original five items are permanently
 * immutable; bumping any field is a `rulesetVersion` bump.
 */

import { describe, expect, it } from "vitest";
import { ITEM_KINDS, getItemKind } from "../../src/registries/items";

const ORIGINAL_PHASE_3_ENTRIES = [
  { id: "item.cred-chip", category: "currency", tier: 1, effect: { kind: "none" } },
  { id: "item.cyberdeck-mod-1", category: "equipment", tier: 1, effect: { kind: "none" } },
  { id: "item.stim-patch", category: "consumable", tier: 1, effect: { kind: "none" } },
  { id: "item.trauma-pack", category: "consumable", tier: 2, effect: { kind: "none" } },
  { id: "item.weapon.knife", category: "equipment", tier: 1, effect: { kind: "none" } },
] as const;

describe("items registry — Phase 2 decision-6 immutability test (lands in 6.A.2)", () => {
  it("every original Phase 3 entry is still present after the Phase 6.A.2 expansion", () => {
    for (const expected of ORIGINAL_PHASE_3_ENTRIES) {
      const entry = ITEM_KINDS.find((k) => k.id === expected.id);
      expect(entry).toBeDefined();
    }
  });

  it("every original Phase 3 entry's (id, category, tier, effect) tuple is unchanged byte-for-byte", () => {
    for (const expected of ORIGINAL_PHASE_3_ENTRIES) {
      const entry = getItemKind(expected.id);
      expect(entry.id).toBe(expected.id);
      expect(entry.category).toBe(expected.category);
      expect(entry.tier).toBe(expected.tier);
      // Effect tuple — Phase 3 originals all have `kind: "none"`.
      expect(entry.effect.kind).toBe(expected.effect.kind);
    }
  });

  it("the JSON serialization of each original entry equals the expected literal", () => {
    for (const expected of ORIGINAL_PHASE_3_ENTRIES) {
      const entry = getItemKind(expected.id);
      const expectedJson = JSON.stringify(expected);
      const actualJson = JSON.stringify({
        id: entry.id,
        category: entry.category,
        tier: entry.tier,
        effect: entry.effect,
      });
      expect(actualJson).toBe(expectedJson);
    }
  });

  it("registry is sorted by id (UTF-16 code-unit order)", () => {
    const ids = ITEM_KINDS.map((k) => k.id);
    const sorted = ids.slice().sort();
    expect(ids).toEqual(sorted);
  });
});
