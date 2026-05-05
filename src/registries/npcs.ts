/**
 * Phase 7.A.2 NPC registry. Stable string IDs from day one; structure
 * mirrors `src/registries/items.ts` and `src/registries/monsters.ts`.
 *
 * Frozen contract (`docs/ARCHITECTURE.md` "Phase 7 frozen contracts
 * (NPCs + shops + boss)"):
 *   - The NPC kind union is `"npc.fixer" | "npc.info-broker" |
 *     "npc.ripperdoc"` — three entries, alphabetical order.
 *   - Each entry exposes a `stockTable: readonly ItemKindId[]` —
 *     the eligible items the NPC can offer when its stock is rolled
 *     at floor-spawn time. The roll lives in `src/sim/run.ts`'s
 *     `spawnFloorEntities` block (consuming `streams.npcStock(floorN)`
 *     so SIM_DIGEST stays preserved — Phase 7.A.2 frozen contract
 *     amendment).
 *   - Adding an NPC kind is additive; removing or renaming one is a
 *     `rulesetVersion` bump. The long-deferred Phase 2 decision-memo
 *     immutability test pattern is mirrored at landing in
 *     `tests/registries/npcs-immutability.test.ts`.
 */

import type { ItemKindId } from "./items";

export type NpcKindId =
  | "npc.fixer"
  | "npc.info-broker"
  | "npc.ripperdoc";

export type NpcKind = {
  readonly id: NpcKindId;
  readonly displayName: string;
  readonly stockTable: readonly ItemKindId[];
  /**
   * Base price in `item.cred-chip` units when an item is offered for
   * sale. Variance is added at action time via the `shop:price`
   * roll-domain (Phase 7 frozen contract). `0` means a fixed price
   * with no variance roll.
   */
  readonly basePrice: number;
  readonly priceVariance: number;
};

function freezeKind(k: NpcKind): NpcKind {
  return Object.freeze({ ...k, stockTable: Object.freeze([...k.stockTable]) });
}

/**
 * Stock-table per NPC kind. Programmer choice (Phase 7.A.2 design pass):
 *   - `npc.fixer`        — weapons + cyberdeck-mod-1
 *   - `npc.info-broker`  — consumables + currency
 *   - `npc.ripperdoc`    — cyberware + medical consumables (the
 *     ripperdoc heals / installs cyberware in the cyberpunk fiction)
 *
 * Stock tables are pinned alphabetically by `ItemKindId`. Adding an
 * entry to a stock table is additive (the per-floor stock roll is
 * deterministic on the table contents); removing one is a
 * `rulesetVersion` bump.
 */
export const NPC_KINDS: readonly NpcKind[] = Object.freeze([
  freezeKind({
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
  }),
  freezeKind({
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
  }),
  freezeKind({
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
  }),
]);

export const NPC_KIND_IDS: readonly NpcKindId[] = Object.freeze(
  NPC_KINDS.map((k) => k.id),
);

/**
 * Lookup an `NpcKind` by id. Throws on unknown id — programmer error
 * (every code path that produces an `NpcKindId` should be using a
 * registered id).
 */
export function getNpcKind(id: string): NpcKind {
  for (let i = 0; i < NPC_KINDS.length; i++) {
    const k = NPC_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getNpcKind: unknown npc kind id "${id}"`);
}

/**
 * Map an `NpcKindId` to its array index in `NPC_KINDS` (alphabetical
 * order). Used by the Phase 7 action vocabulary's `target` field, which
 * encodes the NPC kind ordinal as an `int32` via the existing
 * `TAG_TARGET = 0x10` wire tag (no `ACTION_VERSION` bump).
 *
 * Returns `-1` for unknown ids.
 */
export function npcKindOrdinal(id: string): number {
  for (let i = 0; i < NPC_KINDS.length; i++) {
    if (NPC_KINDS[i]!.id === id) return i;
  }
  return -1;
}

/**
 * Inverse of `npcKindOrdinal`. Returns the registered `NpcKindId` at
 * the given ordinal, or `null` if out of range. The shop-action handlers
 * in `tick()` use this to resolve the encoded `target` field back to a
 * stable id without trusting external input.
 */
export function npcKindIdAtOrdinal(ord: number): NpcKindId | null {
  if (!Number.isInteger(ord) || ord < 0 || ord >= NPC_KINDS.length) {
    return null;
  }
  return NPC_KINDS[ord]!.id;
}
