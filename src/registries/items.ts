/**
 * Item registry — frozen content from Phase 3 decision memo
 * decision 13. Five item kinds, data-only — no inventory mechanics
 * fire in Phase 3 (no `use` action, no equip slot, no `tick`-side
 * effects). Phase 6 wires in inventory mechanics. Stable IDs from
 * day one.
 */

export type ItemKindId =
  | "item.cred-chip"
  | "item.stim-patch"
  | "item.trauma-pack"
  | "item.cyberdeck-mod-1"
  | "item.weapon.knife";

export type ItemCategory = "currency" | "consumable" | "equipment";

export type ItemKind = {
  readonly id: ItemKindId;
  readonly category: ItemCategory;
  readonly tier: number;
};

function freezeKind(k: ItemKind): ItemKind {
  return Object.freeze({ ...k });
}

export const ITEM_KINDS: readonly ItemKind[] = Object.freeze([
  freezeKind({ id: "item.cred-chip", category: "currency", tier: 1 }),
  freezeKind({ id: "item.cyberdeck-mod-1", category: "equipment", tier: 1 }),
  freezeKind({ id: "item.stim-patch", category: "consumable", tier: 1 }),
  freezeKind({ id: "item.trauma-pack", category: "consumable", tier: 2 }),
  freezeKind({ id: "item.weapon.knife", category: "equipment", tier: 1 }),
]);

export const ITEM_KIND_IDS: readonly ItemKindId[] = Object.freeze(
  ITEM_KINDS.map((k) => k.id),
);

export function getItemKind(id: string): ItemKind {
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const k = ITEM_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getItemKind: unknown item kind id "${id}"`);
}
