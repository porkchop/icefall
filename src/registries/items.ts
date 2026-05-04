/**
 * Item registry — content frozen in Phase 3 decision 13 (the original
 * five entries) and expanded in Phase 6.A.2 with ~15 additional items
 * across the existing categories. Stable IDs from day one.
 *
 * Phase 6 frozen contract additions (`docs/ARCHITECTURE.md` "Phase 6
 * frozen contracts"):
 *
 *   - The registry is **append-only by construction** in the sense that
 *     no existing entry's bytes are changed. Entries are listed in
 *     alphabetical order by `id`; the long-deferred Phase 2
 *     decision-memo "registry-immutability enforcement test"
 *     (decision 6) lands in 6.A.2 in
 *     `tests/registries/items-immutability.test.ts` and asserts the
 *     `(id, category, tier, effect)` tuple of each of the original
 *     five entries is unchanged byte-for-byte. Removing or renaming an
 *     entry is a `rulesetVersion` bump.
 *   - Every `ItemKind` carries an `effect` describing how the item
 *     resolves at use / equip / counter-attack time. Effects whose
 *     `kind` is `"none"` consume zero rolls — the existing five Phase
 *     3 entries get `effect: { kind: "none" }` so the per-tick
 *     `__consumed` invariant for the existing 100-action SELF_TEST_LOG
 *     remains unchanged (SIM_DIGEST stays at its Phase 3 frozen value).
 *   - Effect resolution flows through the same hash-driven combat path
 *     `rollU32(stateHashPre, action, domain, index)` with new
 *     domain anchors `item:effect:heal`, `item:effect:atk-bonus`,
 *     `item:effect:def-bonus`. No item bypasses the sim stream.
 */

export type ItemKindId =
  | "item.consumable.adrenaline-spike"
  | "item.consumable.med-injector"
  | "item.consumable.nano-repair"
  | "item.consumable.syringe"
  | "item.cred-chip"
  | "item.cyber.armor"
  | "item.cyber.dermal-plating"
  | "item.cyber.neural-link"
  | "item.cyber.reflex-booster"
  | "item.cyber.subdermal-armor"
  | "item.cyberdeck-mod-1"
  | "item.eddies"
  | "item.stim-patch"
  | "item.trauma-pack"
  | "item.weapon.cyberblade"
  | "item.weapon.knife"
  | "item.weapon.monoblade"
  | "item.weapon.pistol"
  | "item.weapon.shotgun"
  | "item.weapon.smg";

export type ItemCategory = "currency" | "consumable" | "equipment";

/**
 * Item-effect descriptor. Resolved at action time via:
 *
 *   bonus = base + (variance > 0 ? rollU32(...) % variance : 0)
 *
 * `variance === 0` consumes zero rolls (the no-roll path) — same
 * discipline as the `kind: "none"` case. `base` and `variance` MUST be
 * non-negative integers.
 */
export type ItemEffect =
  | { readonly kind: "heal"; readonly base: number; readonly variance: number }
  | { readonly kind: "atk-bonus"; readonly base: number; readonly variance: number }
  | { readonly kind: "def-bonus"; readonly base: number; readonly variance: number }
  | { readonly kind: "none" };

export type ItemKind = {
  readonly id: ItemKindId;
  readonly category: ItemCategory;
  readonly tier: number;
  readonly effect: ItemEffect;
};

function freezeKind(k: ItemKind): ItemKind {
  return Object.freeze({ ...k, effect: Object.freeze({ ...k.effect }) });
}

/**
 * The Phase 3 frozen 5 + Phase 6.A.2 additions, alphabetically sorted
 * by `id` (UTF-16 code-unit order). The original five entries' tuples
 * (`id, category, tier, effect`) are pinned by
 * `tests/registries/items-immutability.test.ts`.
 */
export const ITEM_KINDS: readonly ItemKind[] = Object.freeze([
  // Consumables — heal effects (Phase 6.A.2).
  freezeKind({
    id: "item.consumable.adrenaline-spike",
    category: "consumable",
    tier: 1,
    effect: { kind: "heal", base: 4, variance: 3 },
  }),
  freezeKind({
    id: "item.consumable.med-injector",
    category: "consumable",
    tier: 2,
    effect: { kind: "heal", base: 8, variance: 4 },
  }),
  freezeKind({
    id: "item.consumable.nano-repair",
    category: "consumable",
    tier: 1,
    effect: { kind: "heal", base: 3, variance: 2 },
  }),
  freezeKind({
    id: "item.consumable.syringe",
    category: "consumable",
    tier: 1,
    effect: { kind: "heal", base: 3, variance: 0 },
  }),
  // Phase 3 frozen — `item.cred-chip`.
  freezeKind({
    id: "item.cred-chip",
    category: "currency",
    tier: 1,
    effect: { kind: "none" },
  }),
  // Cyberware — equipment-category items distinguished by
  // `item.cyber.*` id prefix at equip time (Phase 6.A.2).
  freezeKind({
    id: "item.cyber.armor",
    category: "equipment",
    tier: 1,
    effect: { kind: "def-bonus", base: 1, variance: 0 },
  }),
  freezeKind({
    id: "item.cyber.dermal-plating",
    category: "equipment",
    tier: 2,
    effect: { kind: "def-bonus", base: 2, variance: 2 },
  }),
  freezeKind({
    id: "item.cyber.neural-link",
    category: "equipment",
    tier: 1,
    effect: { kind: "none" },
  }),
  freezeKind({
    id: "item.cyber.reflex-booster",
    category: "equipment",
    tier: 2,
    effect: { kind: "atk-bonus", base: 1, variance: 2 },
  }),
  freezeKind({
    id: "item.cyber.subdermal-armor",
    category: "equipment",
    tier: 3,
    effect: { kind: "def-bonus", base: 3, variance: 2 },
  }),
  // Phase 3 frozen — `item.cyberdeck-mod-1`.
  freezeKind({
    id: "item.cyberdeck-mod-1",
    category: "equipment",
    tier: 1,
    effect: { kind: "none" },
  }),
  // Currency — finer-grain than cred-chip (Phase 6.A.2).
  freezeKind({
    id: "item.eddies",
    category: "currency",
    tier: 1,
    effect: { kind: "none" },
  }),
  // Phase 3 frozen — `item.stim-patch`.
  freezeKind({
    id: "item.stim-patch",
    category: "consumable",
    tier: 1,
    effect: { kind: "none" },
  }),
  // Phase 3 frozen — `item.trauma-pack`.
  freezeKind({
    id: "item.trauma-pack",
    category: "consumable",
    tier: 2,
    effect: { kind: "none" },
  }),
  // Weapons — equipment-category items distinguished by
  // `item.weapon.*` id prefix at equip time (Phase 6.A.2 expansions).
  freezeKind({
    id: "item.weapon.cyberblade",
    category: "equipment",
    tier: 2,
    effect: { kind: "atk-bonus", base: 2, variance: 2 },
  }),
  // Phase 3 frozen — `item.weapon.knife`.
  freezeKind({
    id: "item.weapon.knife",
    category: "equipment",
    tier: 1,
    effect: { kind: "none" },
  }),
  freezeKind({
    id: "item.weapon.monoblade",
    category: "equipment",
    tier: 3,
    effect: { kind: "atk-bonus", base: 3, variance: 3 },
  }),
  freezeKind({
    id: "item.weapon.pistol",
    category: "equipment",
    tier: 2,
    effect: { kind: "atk-bonus", base: 2, variance: 3 },
  }),
  freezeKind({
    id: "item.weapon.shotgun",
    category: "equipment",
    tier: 3,
    effect: { kind: "atk-bonus", base: 3, variance: 4 },
  }),
  freezeKind({
    id: "item.weapon.smg",
    category: "equipment",
    tier: 2,
    effect: { kind: "atk-bonus", base: 2, variance: 2 },
  }),
]);

export const ITEM_KIND_IDS: readonly ItemKindId[] = Object.freeze(
  ITEM_KINDS.map((k) => k.id),
);

/**
 * Lookup an `ItemKind` by id. Throws on unknown id — programmer error
 * (every code path that produces an `ItemKindId` should be using a
 * registered id).
 */
export function getItemKind(id: string): ItemKind {
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const k = ITEM_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getItemKind: unknown item kind id "${id}"`);
}

/**
 * Equipment sub-categorization for `item.weapon.*` vs `item.cyber.*`.
 * Phase 6 frozen contract: items in the `equipment` category dispatch
 * to a slot by `id` prefix. The `tick()` equip handler enforces this.
 *
 * Returns `null` when the item is not an equipment-category item or
 * when the prefix is unrecognized (e.g. `item.cyberdeck-mod-1` from
 * Phase 3 — the original cyberdeck mod has no slot mapping; equipping
 * it is a no-op until a future phase expands the slot list).
 */
export function equipmentSlotForItem(id: ItemKindId): "weapon" | "cyberware" | null {
  if (id.startsWith("item.weapon.")) return "weapon";
  if (id.startsWith("item.cyber.")) return "cyberware";
  return null;
}
