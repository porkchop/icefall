/**
 * Phase 3 turn loop — `tick(state, action): RunState`.
 *
 * Frozen-contract item 9: per-`tick` `__consumed` delta is empty by
 * construction. This function takes `RunState` and `Action` only — no
 * `RunStreams` parameter — so it is structurally incapable of consuming
 * any PRNG cursor. Floor-entry spawn (`generateFloor` +
 * `spawnFloorEntities`) happens in the run loop (`runScripted` and
 * Phase 5+'s input-driven equivalent) outside `tick`.
 *
 * On a successful `descend`, `tick` sets
 * `RunState.__pendingFloorEntry = true` and advances `floorN`. The
 * harness sees the flag and runs the floor-entry block on the next
 * loop iteration before resolving the next player action.
 *
 * State-hash advance is one per *player action* (frozen-contract item
 * 6) — monster tick decisions do not appear on the chain.
 */

import { advance } from "../core/state-chain";
import type { Action } from "../core/encode";
import { TILE_FLOOR, TILE_DOOR } from "../mapgen/tiles";
import {
  ACTION_TYPE_WAIT,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_DESCEND,
  ACTION_TYPE_PICKUP,
  ACTION_TYPE_DROP,
  ACTION_TYPE_EQUIP,
  ACTION_TYPE_UNEQUIP,
  ACTION_TYPE_USE,
  ACTION_TYPE_TALK,
  ACTION_TYPE_BUY,
  ACTION_TYPE_SELL,
  DIR_DELTAS,
} from "./params";
import {
  damageBonus,
  damageAmount,
  clampHp,
  rollU32,
  ROLL_DOMAIN_ATK_BONUS,
  ROLL_DOMAIN_COUNTER_BONUS,
  ROLL_DOMAIN_ITEM_HEAL,
  ROLL_DOMAIN_ITEM_ATK_BONUS,
  ROLL_DOMAIN_ITEM_DEF_BONUS,
  ROLL_DOMAIN_SHOP_PRICE,
} from "./combat";
import {
  getNpcKind,
  npcKindIdAtOrdinal,
  type NpcKindId,
} from "../registries/npcs";
import {
  bfsDistanceMapFromPlayer,
  decideMonsterAction,
} from "./ai";
import {
  getItemKind,
  equipmentSlotForItem,
  type ItemKind,
  type ItemKindId,
} from "../registries/items";
import {
  inventoryAdd,
  inventoryRemove,
  inventoryCount,
} from "./inventory";
import type { Floor } from "../mapgen/types";
import type {
  Equipment,
  FloorItem,
  FloorNpc,
  InventoryEntry,
  Monster,
  MonsterAIState,
  Player,
  Point,
  RunOutcome,
  RunState,
} from "./types";

function isPlayerOn(player: Player, x: number, y: number): boolean {
  return player.pos.x === x && player.pos.y === y;
}

function isPassable(floor: Floor, y: number, x: number): boolean {
  if (x < 0 || x >= floor.width || y < 0 || y >= floor.height) return false;
  const t = floor.tiles[y * floor.width + x]!;
  return t === TILE_FLOOR || t === TILE_DOOR;
}

function findMonsterAt(
  monsters: readonly Monster[],
  y: number,
  x: number,
): Monster | undefined {
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i]!;
    if (m.hp > 0 && m.pos.y === y && m.pos.x === x) return m;
  }
  return undefined;
}

function isMonsterAt(
  monsters: readonly Monster[],
  y: number,
  x: number,
): boolean {
  return findMonsterAt(monsters, y, x) !== undefined;
}

/**
 * Return the index of the first FloorItem at `(x, y)`, or `-1` if none.
 * Items are sorted by `(y, x, kind)` (Phase 3 frozen contract); the
 * scan terminates as soon as we pass the row.
 */
function findFloorItemIndexAt(
  items: readonly FloorItem[],
  y: number,
  x: number,
): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.y === y && it.x === x) return i;
    // Items are sorted by (y, x, kind). Once we pass the row, no match
    // can exist further in the array.
    if (it.y > y || (it.y === y && it.x > x)) return -1;
  }
  return -1;
}

/**
 * Insert a FloorItem preserving the (y, x, kind) sort. Pure — returns
 * a fresh frozen array. Mirrors the discipline in `src/sim/run.ts`
 * `spawnFloorEntities`.
 */
function floorItemsInsert(
  items: readonly FloorItem[],
  y: number,
  x: number,
  kind: ItemKindId,
): readonly FloorItem[] {
  const next: FloorItem[] = items.slice();
  next.push({ y, x, kind });
  next.sort(
    (a, b) =>
      a.y - b.y ||
      a.x - b.x ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  return Object.freeze(next);
}

/**
 * Resolve the integer effect-bonus from a registered `ItemEffect` at a
 * given roll index. Phase 6 frozen contract: when `variance > 0` the
 * bonus consumes one `rollU32` call against the matching domain;
 * `variance === 0` (or `kind === "none"`) consumes zero rolls.
 */
function resolveEffectBonus(
  effect: ItemKind["effect"],
  domain:
    | typeof ROLL_DOMAIN_ITEM_HEAL
    | typeof ROLL_DOMAIN_ITEM_ATK_BONUS
    | typeof ROLL_DOMAIN_ITEM_DEF_BONUS,
  stateHashPre: Uint8Array,
  action: Action,
  index: number,
): number {
  if (effect.kind === "none") return 0;
  if (effect.variance === 0) return effect.base;
  const r = rollU32(stateHashPre, action, domain, index);
  return effect.base + (r % effect.variance);
}

/**
 * Find the index of an NPC of the given kind that is within Chebyshev
 * distance 1 of the player's position. Returns `-1` if no matching NPC
 * is adjacent. Phase 7.A.2 frozen contract: shop actions require the
 * player to be adjacent to the target NPC; non-adjacent calls no-op.
 */
function findAdjacentNpcIndex(
  npcs: readonly FloorNpc[],
  player: Player,
  kindId: NpcKindId,
): number {
  for (let i = 0; i < npcs.length; i++) {
    const n = npcs[i]!;
    if (n.kind !== kindId) continue;
    const dy = n.pos.y - player.pos.y;
    const dx = n.pos.x - player.pos.x;
    const ady = dy < 0 ? -dy : dy;
    const adx = dx < 0 ? -dx : dx;
    // Adjacent or co-located (same cell at floor entry — see
    // `pickNpcPos`'s fallback in `run.ts`).
    if (ady <= 1 && adx <= 1) return i;
  }
  return -1;
}

/**
 * Sum the count of `item.cred-chip` entries in an inventory. Used by
 * the shop transaction handlers. The Phase 6 inventory shape stacks
 * by kind so this is at most one entry's count, but iterating
 * defensively is cheap and correct under any future stack-splitting.
 */
function credChipCount(inv: readonly InventoryEntry[]): number {
  for (let i = 0; i < inv.length; i++) {
    if (inv[i]!.kind === "item.cred-chip") return inv[i]!.count;
  }
  return 0;
}

/**
 * Compute the effective buy/sell price for an NPC offering an item.
 * Per the Phase 7 frozen "Deterministic shop-transaction resolution":
 * `price = base + rollU32(stateHashPre, action, "shop:price", 0) %
 * variance` when `variance > 0`, else `price = base`. Sell price is
 * half the buy price (floor 1 minimum). All integer arithmetic.
 */
function shopBuyPrice(
  basePrice: number,
  variance: number,
  stateHashPre: Uint8Array,
  action: Action,
): number {
  if (variance <= 0) return basePrice;
  const r = rollU32(stateHashPre, action, ROLL_DOMAIN_SHOP_PRICE, 0);
  return basePrice + (r % variance);
}

function shopSellPrice(buyPrice: number): number {
  // Integer half, floor at 1 — `>>> 1` is integer divide-by-2.
  const half = buyPrice >>> 1;
  return half < 1 ? 1 : half;
}

/**
 * Replace the i-th entry in an `npcs` array, returning a new frozen
 * array. Pure — preserves the Phase 7 frozen sort discipline.
 */
function npcsReplaceAt(
  npcs: readonly FloorNpc[],
  i: number,
  replacement: FloorNpc,
): readonly FloorNpc[] {
  const next = npcs.slice();
  next[i] = replacement;
  return Object.freeze(next);
}

/**
 * Add one unit of `kind` to the NPC's inventory, preserving the
 * Phase 6 sorted-inventory comparator (kind ASC, count DESC). Pure —
 * delegates to a local copy of the comparator (the `inventoryAdd`
 * helper from `src/sim/inventory.ts` is the canonical implementation;
 * inlined here against `FloorNpc.inventory` to avoid a circular
 * import path).
 */
function npcInventoryAdd(
  inv: readonly InventoryEntry[],
  kind: import("../registries/items").ItemKindId,
  count: number,
): readonly InventoryEntry[] {
  // Re-uses the Phase 6 inventoryAdd contract via direct call.
  return inventoryAdd(inv, kind, count);
}

function npcInventoryRemove(
  inv: readonly InventoryEntry[],
  kind: import("../registries/items").ItemKindId,
  count: number,
): readonly InventoryEntry[] {
  return inventoryRemove(inv, kind, count);
}

/**
 * Phase 7.A.2 boss FSM transition table. Returns the `MonsterAIState`
 * the boss should occupy given its current phase + integer HP / hpMax.
 * Transitions are deterministic — no random — and trigger purely on
 * threshold crossings: `hp * 100 < hpMax * 66` for phase-1→phase-2,
 * `hp * 100 < hpMax * 33` for phase-2→phase-3.
 *
 * The boss's effective atk/def for damage calculation is derived from
 * this state at counter-attack time (phase 1 = +0/+0, phase 2 = +1/+0,
 * phase 3 = +2/+1) — see `bossPhaseScaling` below.
 */
function bossPhaseTransition(
  current: MonsterAIState,
  hp: number,
  hpMax: number,
): MonsterAIState {
  // Integer threshold compare — no float.
  const hpPct100 = hp * 100;
  if (current === "boss-phase-1" && hpPct100 < hpMax * 66) {
    return "boss-phase-2";
  }
  if (current === "boss-phase-2" && hpPct100 < hpMax * 33) {
    return "boss-phase-3";
  }
  return current;
}

/**
 * Per-phase atk/def increments applied at counter-attack time. Phase 1
 * is the registry baseline; phases 2/3 add deterministic flat
 * modifiers. Returns a `(atkBonus, defBonus)` tuple as integers.
 */
function bossPhaseScaling(
  state: MonsterAIState,
): { readonly atkBonus: number; readonly defBonus: number } {
  if (state === "boss-phase-2") return { atkBonus: 1, defBonus: 0 };
  if (state === "boss-phase-3") return { atkBonus: 2, defBonus: 1 };
  // phase-1 / non-boss states: zero scaling.
  return { atkBonus: 0, defBonus: 0 };
}

/**
 * True iff this monster is the floor-10 boss (used to gate the FSM
 * transition logic — non-boss monsters never carry a `boss-phase-*`
 * aiState; the union is shared structurally but only the boss
 * transitions through it).
 */
function isBossKind(kind: string): boolean {
  return kind === "monster.boss.black-ice-v0";
}

/**
 * Returns the player's equipped weapon `ItemKind`, or `null` if no
 * weapon is equipped or the equipped id is not registered.
 */
function equippedWeaponKind(equipment: Equipment): ItemKind | null {
  const id = equipment.weapon;
  if (id === null) return null;
  return getItemKind(id);
}

/**
 * Returns the player's equipped cyberware `ItemKind`, or `null` if no
 * cyberware is equipped or the equipped id is not registered.
 */
function equippedCyberwareKind(equipment: Equipment): ItemKind | null {
  const id = equipment.cyberware;
  if (id === null) return null;
  return getItemKind(id);
}

/**
 * The single action resolver. Returns the new `RunState`.
 *
 * - Asserts the state hash is advanced exactly once per call (frozen
 *   contract — caller observes via `state.actionLogLength` increment).
 * - Does NOT mutate any input.
 * - Uses only Phase 1's `advance(state, action)` and the per-roll
 *   subhash from `combat.ts`.
 */
export function tick(state: RunState, action: Action): RunState {
  if (state.outcome !== "running") {
    // Terminal — trailing actions are no-ops (memo decision 11 + N2).
    return state;
  }
  if (state.__pendingFloorEntry) {
    throw new Error(
      "tick: cannot call tick while __pendingFloorEntry is true; harness must run floor-entry block first",
    );
  }

  const stateHashPre = state.stateHash;
  const stateHashPost = advance(stateHashPre, action);
  const floor = state.floorState.floor;
  const player = state.player;

  let nextPlayer: Player = player;
  let nextMonsters: readonly Monster[] = state.floorState.monsters;
  let nextFloorItems: readonly FloorItem[] = state.floorState.items;
  let nextFloorN = state.floorN;
  let pendingFloorEntry = false;
  let outcome: RunOutcome = state.outcome;
  // Phase 7.A.2 shop write-path: when a `buy` / `sell` action mutates
  // the NPC inventory, the new array is staged here and merged into
  // the returned FloorState below. Most actions don't touch NPCs, so
  // the default is to forward `state.floorState.npcs` unchanged.
  let _shopNextNpcs: readonly FloorNpc[] = state.floorState.npcs;
  let _shopNpcsTouched = false;

  // Resolve player action. Switch/case on action.type so Phase 6+
  // additions register as explicit cases — Phase 3.A.2 carry-forward
  // landed in 6.A.1 ahead of 6.A.2's pickup/drop/equip/unequip/use
  // additions. The `default` no-op preserves the Phase 1 frozen
  // "additive vocabulary" contract: an unknown type does NOT throw at
  // runtime (so verifiers can replay logs that include
  // forward-compatible types), but a Phase-N developer who forgets to
  // wire a newly-added type into this switch will see the no-op
  // immediately during dev-loop testing rather than chasing a silent
  // missed-write later.
  switch (action.type) {
    case ACTION_TYPE_WAIT:
      // pass
      break;
    case ACTION_TYPE_MOVE: {
      const dir = action.dir;
      if (dir !== undefined) {
        const delta = DIR_DELTAS[dir]!;
        const ny = player.pos.y + delta.dy;
        const nx = player.pos.x + delta.dx;
        if (
          isPassable(floor, ny, nx) &&
          !isMonsterAt(nextMonsters, ny, nx)
        ) {
          nextPlayer = {
            ...player,
            pos: { y: ny, x: nx },
          };
        }
      }
      break;
    }
    case ACTION_TYPE_ATTACK: {
      const dir = action.dir;
      if (dir !== undefined) {
        const delta = DIR_DELTAS[dir]!;
        const ny = player.pos.y + delta.dy;
        const nx = player.pos.x + delta.dx;
        const target = findMonsterAt(nextMonsters, ny, nx);
        if (target !== undefined) {
          // Phase 3 base atk-bonus roll (combat:atk-bonus, index 0).
          const baseBonus = damageBonus(
            stateHashPre,
            action,
            ROLL_DOMAIN_ATK_BONUS,
            0,
          );
          // Phase 6 equipment-modifier injection: when a weapon is
          // equipped AND its effect is `atk-bonus`, add the
          // item-effect roll (item:effect:atk-bonus, index 0) to the
          // existing combat bonus. Integer addition only — the damage
          // formula `dmg = max(1, atk - def + bonus)` is unchanged.
          const weapon = equippedWeaponKind(player.equipment);
          let weaponBonus = 0;
          if (weapon !== null && weapon.effect.kind === "atk-bonus") {
            weaponBonus = resolveEffectBonus(
              weapon.effect,
              ROLL_DOMAIN_ITEM_ATK_BONUS,
              stateHashPre,
              action,
              0,
            );
          }
          const dmg = damageAmount(
            player.atk,
            target.def,
            baseBonus + weaponBonus,
          );
          const newHp = clampHp(target.hp, dmg);
          // Phase 7.A.2 boss FSM transition: when the target is the
          // boss and HP > 0 after damage, advance the phase based on
          // integer threshold crossing. Non-boss targets retain their
          // existing aiState path (idle/chasing) handled by the
          // monster-tick block below.
          let nextAiState: MonsterAIState = target.aiState;
          if (isBossKind(target.kind) && newHp > 0) {
            nextAiState = bossPhaseTransition(target.aiState, newHp, target.hpMax);
          }
          nextMonsters = nextMonsters.map((m) =>
            m.id === target.id
              ? { ...m, hp: newHp, aiState: nextAiState }
              : m,
          );
        }
      }
      break;
    }
    case ACTION_TYPE_DESCEND: {
      const exit = floor.exit;
      if (
        state.floorN < 10 &&
        exit !== null &&
        isPlayerOn(player, exit.x, exit.y)
      ) {
        nextFloorN = state.floorN + 1;
        pendingFloorEntry = true;
      }
      break;
    }
    case ACTION_TYPE_PICKUP: {
      // Phase 6: pick up the FloorItem at the player's current cell.
      // No-op if the cell has no item. Items stack into inventory by
      // kind (sorted insertion).
      const idx = findFloorItemIndexAt(
        nextFloorItems,
        player.pos.y,
        player.pos.x,
      );
      if (idx >= 0) {
        const it = nextFloorItems[idx]!;
        const nextItems: FloorItem[] = nextFloorItems.slice();
        nextItems.splice(idx, 1);
        nextFloorItems = Object.freeze(nextItems);
        nextPlayer = {
          ...nextPlayer,
          inventory: inventoryAdd(nextPlayer.inventory, it.kind),
        };
      }
      break;
    }
    case ACTION_TYPE_DROP: {
      // Phase 6: drop one unit of the requested kind from inventory
      // onto the player's current cell. No-op if the kind isn't held
      // or if `action.item` is missing.
      const itemId = action.item as ItemKindId | undefined;
      if (
        itemId !== undefined &&
        inventoryCount(nextPlayer.inventory, itemId) >= 1
      ) {
        nextPlayer = {
          ...nextPlayer,
          inventory: inventoryRemove(nextPlayer.inventory, itemId),
        };
        nextFloorItems = floorItemsInsert(
          nextFloorItems,
          player.pos.y,
          player.pos.x,
          itemId,
        );
      }
      break;
    }
    case ACTION_TYPE_EQUIP: {
      // Phase 6: move one unit of the requested kind from inventory
      // to the matching equipment slot. If the slot is occupied, the
      // displaced item returns to inventory atomically. No-op if the
      // item kind doesn't dispatch to a slot (e.g. consumables,
      // currency, or `item.cyberdeck-mod-1` which has no slot mapping
      // until Phase 7+).
      const itemId = action.item as ItemKindId | undefined;
      if (itemId !== undefined) {
        const slot = equipmentSlotForItem(itemId);
        if (
          slot !== null &&
          inventoryCount(nextPlayer.inventory, itemId) >= 1
        ) {
          // Remove one unit from inventory.
          let nextInv = inventoryRemove(nextPlayer.inventory, itemId);
          // If a different item is currently in the slot, put it back
          // into inventory.
          const displaced = nextPlayer.equipment[slot];
          if (displaced !== null && displaced !== itemId) {
            nextInv = inventoryAdd(nextInv, displaced);
          }
          const nextEquip: Equipment = {
            ...nextPlayer.equipment,
            [slot]: itemId,
          };
          nextPlayer = {
            ...nextPlayer,
            inventory: nextInv,
            equipment: Object.freeze(nextEquip),
          };
        }
      }
      break;
    }
    case ACTION_TYPE_UNEQUIP: {
      // Phase 6: move the requested kind from its slot back to
      // inventory. No-op if the item isn't equipped.
      const itemId = action.item as ItemKindId | undefined;
      if (itemId !== undefined) {
        const slot = equipmentSlotForItem(itemId);
        if (slot !== null && nextPlayer.equipment[slot] === itemId) {
          const nextEquip: Equipment = {
            ...nextPlayer.equipment,
            [slot]: null,
          };
          nextPlayer = {
            ...nextPlayer,
            inventory: inventoryAdd(nextPlayer.inventory, itemId),
            equipment: Object.freeze(nextEquip),
          };
        }
      }
      break;
    }
    case ACTION_TYPE_USE: {
      // Phase 6: consume one unit of the requested kind, applying its
      // effect. Phase 6.A.2 ships only `consumable`-category items
      // with `kind: "heal"` effects; other categories no-op.
      const itemId = action.item as ItemKindId | undefined;
      if (
        itemId !== undefined &&
        inventoryCount(nextPlayer.inventory, itemId) >= 1
      ) {
        const kind = getItemKind(itemId);
        if (kind.category === "consumable" && kind.effect.kind === "heal") {
          const healAmt = resolveEffectBonus(
            kind.effect,
            ROLL_DOMAIN_ITEM_HEAL,
            stateHashPre,
            action,
            0,
          );
          const newHp = Math.min(
            nextPlayer.hpMax,
            nextPlayer.hp + healAmt,
          );
          nextPlayer = {
            ...nextPlayer,
            hp: newHp,
            inventory: inventoryRemove(nextPlayer.inventory, itemId),
          };
        } else if (kind.category === "consumable") {
          // Consumable with non-heal effect — still consume the item.
          // (Phase 3 `item.stim-patch` / `item.trauma-pack` have
          // `effect: { kind: "none" }` so this branch fires for them
          // too — using a Phase-3 consumable is a no-op heal but the
          // item is consumed, mirroring real-world sim semantics.)
          nextPlayer = {
            ...nextPlayer,
            inventory: inventoryRemove(nextPlayer.inventory, itemId),
          };
        }
        // Non-consumable categories (currency, equipment) — using is
        // a no-op (item not consumed). Phase 7+ may add behaviors.
      }
      break;
    }
    case ACTION_TYPE_TALK: {
      // Phase 7.A.2: a state-hash-anchored "I'm interacting" marker.
      // Validates that the player is adjacent to the encoded NPC kind;
      // otherwise no-op. The dialog itself is a UI-side concern. The
      // action's bytes still flow through the state-chain (advance has
      // already been called above), so replays remain byte-identical.
      const targetOrd = action.target;
      if (targetOrd !== undefined) {
        const npcKindId = npcKindIdAtOrdinal(targetOrd);
        if (npcKindId !== null) {
          // No-op on missing/non-adjacent — `findAdjacentNpcIndex`
          // returns -1 in those cases. The mere existence of the call
          // documents the contract; we do not branch on the result.
          findAdjacentNpcIndex(state.floorState.npcs, player, npcKindId);
        }
      }
      break;
    }
    case ACTION_TYPE_BUY: {
      // Phase 7.A.2: purchase one unit of `action.item` from the NPC
      // at `action.target` (kind ordinal). Validates: NPC exists, NPC
      // is adjacent, NPC's stock contains the requested item, player
      // has enough cred-chips. No-op on any failure — the state-hash
      // chain still advances (advance was called above) so replays
      // remain byte-identical.
      const targetOrd = action.target;
      const itemId = action.item as
        | import("../registries/items").ItemKindId
        | undefined;
      let nextNpcs: readonly FloorNpc[] = state.floorState.npcs;
      if (targetOrd !== undefined && itemId !== undefined) {
        const npcKindId = npcKindIdAtOrdinal(targetOrd);
        if (npcKindId !== null) {
          const idx = findAdjacentNpcIndex(nextNpcs, nextPlayer, npcKindId);
          if (idx >= 0) {
            const npc = nextNpcs[idx]!;
            const stockCount = inventoryCount(npc.inventory, itemId);
            if (stockCount >= 1) {
              const npcKind = getNpcKind(npc.kind);
              const price = shopBuyPrice(
                npcKind.basePrice,
                npcKind.priceVariance,
                stateHashPre,
                action,
              );
              const playerChips = credChipCount(nextPlayer.inventory);
              if (playerChips >= price) {
                // Transfer: NPC inventory -= itemId; player += itemId.
                // Player chips -= price; NPC chips += price.
                const newNpcInv = npcInventoryAdd(
                  npcInventoryRemove(npc.inventory, itemId, 1),
                  "item.cred-chip",
                  price,
                );
                nextNpcs = npcsReplaceAt(nextNpcs, idx, {
                  ...npc,
                  inventory: newNpcInv,
                });
                let newPlayerInv = inventoryRemove(
                  nextPlayer.inventory,
                  "item.cred-chip",
                  price,
                );
                newPlayerInv = inventoryAdd(newPlayerInv, itemId, 1);
                nextPlayer = {
                  ...nextPlayer,
                  inventory: newPlayerInv,
                };
              }
            }
          }
        }
      }
      // Carry the (possibly mutated) npcs through the FloorState write
      // path below.
      _shopNextNpcs = nextNpcs;
      _shopNpcsTouched = true;
      break;
    }
    case ACTION_TYPE_SELL: {
      // Phase 7.A.2: sell one unit of `action.item` to the NPC at
      // `action.target`. Validates: NPC exists, adjacent, player has
      // the item. NPC pays out half the buy price (floor 1) in cred-
      // chip currency. No-op on missing/invalid; state hash still
      // advances unconditionally.
      const targetOrd = action.target;
      const itemId = action.item as
        | import("../registries/items").ItemKindId
        | undefined;
      let nextNpcs: readonly FloorNpc[] = state.floorState.npcs;
      if (targetOrd !== undefined && itemId !== undefined) {
        const npcKindId = npcKindIdAtOrdinal(targetOrd);
        if (npcKindId !== null) {
          const idx = findAdjacentNpcIndex(nextNpcs, nextPlayer, npcKindId);
          if (idx >= 0) {
            const npc = nextNpcs[idx]!;
            if (inventoryCount(nextPlayer.inventory, itemId) >= 1) {
              const npcKind = getNpcKind(npc.kind);
              const buyPrice = shopBuyPrice(
                npcKind.basePrice,
                npcKind.priceVariance,
                stateHashPre,
                action,
              );
              const sellPrice = shopSellPrice(buyPrice);
              // Transfer: player inventory -= itemId; player += chips.
              // NPC inventory += itemId; NPC -= chips iff NPC has them
              // (floor 0 — NPC may go into "credit" without chips).
              let newPlayerInv = inventoryRemove(
                nextPlayer.inventory,
                itemId,
                1,
              );
              newPlayerInv = inventoryAdd(
                newPlayerInv,
                "item.cred-chip",
                sellPrice,
              );
              let newNpcInv = npcInventoryAdd(npc.inventory, itemId, 1);
              const npcChips = credChipCount(newNpcInv);
              if (npcChips >= sellPrice) {
                newNpcInv = npcInventoryRemove(
                  newNpcInv,
                  "item.cred-chip",
                  sellPrice,
                );
              }
              nextNpcs = npcsReplaceAt(nextNpcs, idx, {
                ...npc,
                inventory: newNpcInv,
              });
              nextPlayer = {
                ...nextPlayer,
                inventory: newPlayerInv,
              };
            }
          }
        }
      }
      _shopNextNpcs = nextNpcs;
      _shopNpcsTouched = true;
      break;
    }
    default:
      // Unknown action type — no-op per the additive-vocabulary
      // contract (Phase 1 frozen contract; addendum decision 3). The
      // Phase 1 binary encoding still accepts the action; verifiers
      // may flag.
      break;
  }

  // Detect win: floor-10 boss with hp == 0.
  if (state.floorN === 10 && nextFloorN === 10) {
    let bossDead = false;
    let sawBoss = false;
    for (let i = 0; i < nextMonsters.length; i++) {
      const m = nextMonsters[i]!;
      if (isBossKind(m.kind)) {
        sawBoss = true;
        if (m.hp === 0) bossDead = true;
      }
    }
    if (sawBoss && bossDead) outcome = "won";
  }

  // Resolve monster ticks (zero-PRNG, zero-roll AI). Only proceed if
  // outcome is still running (a descend ended the player turn cleanly,
  // and a win was just set above; in either case skip monster ticks).
  let counterIndex = 0;
  if (outcome === "running" && !pendingFloorEntry) {
    const distMap = bfsDistanceMapFromPlayer(
      floor,
      nextPlayer.pos,
      nextMonsters,
    );
    const aliveMonsters = nextMonsters.filter((m) => m.hp > 0);
    // Iterate monsters in ascending id order. nextMonsters is already
    // sorted by id at construction (frozen contract); preserve order.
    const monstersById = aliveMonsters
      .slice()
      .sort((a, b) => a.id - b.id);

    let workingMonsters = nextMonsters.slice();
    let workingPlayer = nextPlayer;

    for (let i = 0; i < monstersById.length; i++) {
      const m = monstersById[i]!;
      // Find its current state in workingMonsters.
      const cur = workingMonsters.find((x) => x.id === m.id);
      if (cur === undefined || cur.hp <= 0) continue;

      const decision = decideMonsterAction(
        cur,
        workingPlayer.pos,
        distMap,
        floor,
      );

      // Phase 7.A.2: the boss carries a `boss-phase-N` aiState
      // pinned by the player-attack-handler FSM. The legacy
      // `decideMonsterAction` (Phase 3 contract) returns
      // `newAiState: "idle" | "chasing"` from its idle/chasing FSM.
      // For the boss, we keep its current `boss-phase-*` state on the
      // move/stay paths (only the player-attack handler advances the
      // boss FSM); for non-boss monsters we apply the AI's decision.
      const isBoss = isBossKind(cur.kind);
      const newAiStateForMonster: MonsterAIState = isBoss
        ? cur.aiState
        : (decision.newAiState as MonsterAIState);

      if (decision.kind === "stay") {
        if (cur.aiState !== newAiStateForMonster) {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  aiState: newAiStateForMonster,
                }
              : x,
          );
        }
      } else if (decision.kind === "move") {
        // Re-check the target cell isn't occupied by a since-moved monster
        // or the player.
        if (
          !isMonsterAt(workingMonsters, decision.to.y, decision.to.x) &&
          !(
            workingPlayer.pos.y === decision.to.y &&
            workingPlayer.pos.x === decision.to.x
          )
        ) {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  pos: decision.to as Point,
                  aiState: newAiStateForMonster,
                }
              : x,
          );
        } else {
          // Target became blocked — stay put but keep newAiState.
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  aiState: newAiStateForMonster,
                }
              : x,
          );
        }
      } else {
        // attack — counterattack the player.
        const bonus = damageBonus(
          stateHashPre,
          action,
          ROLL_DOMAIN_COUNTER_BONUS,
          counterIndex,
        );
        // Phase 6 equipment-modifier injection: when cyberware with a
        // `def-bonus` effect is equipped, the bonus is ADDED to the
        // player's effective `def` (so the attacker's effective
        // `atk - def` shrinks). The roll uses
        // `item:effect:def-bonus` at the same index as the
        // counter-bonus roll for this monster.
        // Per-domain index discipline — each rollU32 call within a
        // tick uses a UNIQUE (domain, index) tuple. Counter-bonus
        // and item-def-bonus share the same `counterIndex` because
        // they live in DIFFERENT domains; the (domain, index) pair
        // is unique per call (Phase 6.A.2 N5 carry-forward).
        const cyber = equippedCyberwareKind(workingPlayer.equipment);
        let defBonus = 0;
        if (cyber !== null && cyber.effect.kind === "def-bonus") {
          defBonus = resolveEffectBonus(
            cyber.effect,
            ROLL_DOMAIN_ITEM_DEF_BONUS,
            stateHashPre,
            action,
            counterIndex,
          );
        }
        counterIndex++;
        // Phase 7.A.2 boss FSM scaling — when this monster is the
        // floor-10 boss, add the per-phase atk/def increments.
        // Phase 1 = +0/+0, phase 2 = +1/+0, phase 3 = +2/+1.
        let bossAtkBonus = 0;
        let bossDefBonus = 0;
        if (isBossKind(cur.kind)) {
          const scaling = bossPhaseScaling(cur.aiState);
          bossAtkBonus = scaling.atkBonus;
          bossDefBonus = scaling.defBonus;
        }
        const dmg = damageAmount(
          cur.atk + bossAtkBonus,
          workingPlayer.def + defBonus + bossDefBonus,
          bonus,
        );
        const newHp = clampHp(workingPlayer.hp, dmg);
        workingPlayer = {
          ...workingPlayer,
          hp: newHp,
        };
        // Phase 7.A.2: the boss does NOT transition aiState through
        // the legacy idle/chasing path; it stays in its boss-phase-N
        // state set by the player-attack handler. Non-boss monsters
        // follow the existing chasing transition.
        if (cur.aiState !== "chasing" && !isBossKind(cur.kind)) {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id ? { ...x, aiState: "chasing" } : x,
          );
        }
        if (newHp === 0) {
          outcome = "dead";
          break; // short-circuit per N7.
        }
      }
    }

    nextMonsters = workingMonsters;
    nextPlayer = workingPlayer;
  }

  return {
    fingerprintInputs: state.fingerprintInputs,
    stateHash: stateHashPost,
    floorN: nextFloorN,
    floorState: pendingFloorEntry
      ? state.floorState // unchanged; harness will overwrite on entry
      : {
          floor: state.floorState.floor,
          monsters: nextMonsters,
          items: nextFloorItems,
          // Phase 7.A.2 — forward the (possibly mutated) NPC list. The
          // shop handlers stage their writes through `_shopNextNpcs`;
          // every other path forwards the input unchanged.
          npcs: _shopNpcsTouched ? _shopNextNpcs : state.floorState.npcs,
        },
    player: nextPlayer,
    outcome,
    actionLogLength: state.actionLogLength + 1,
    __pendingFloorEntry: pendingFloorEntry,
  };
}
