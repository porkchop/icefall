/**
 * Phase 3 sim domain types. Frozen by Phase 3 decision memo
 * (`artifacts/decision-memo-phase-3.md`) decisions 2, 5, and the
 * addendum's frozen-contract list (items 5, 9, 10, 13).
 *
 * `RunState` is an in-memory contract only; Phase 3 does not serialize
 * it to JSON (Phase 8 will introduce a separate `RunStateSnapshot`
 * schema for the verifier API). Collections are sorted at construction
 * time and read-only thereafter — `monsters` by `id`, `items` by
 * `(y, x, kind)` — so iteration is deterministic.
 */

import type { Floor } from "../mapgen/types";
import type { MonsterKindId } from "../registries/monsters";
import type { NpcKindId } from "../registries/npcs";
import type { ItemKindId } from "../registries/items";
import type { FingerprintInputs } from "../core/fingerprint";

/** A 2D integer point. Distinct from mapgen's `Point` to keep the sim
 *  layer's type surface independent (mutations stay in-module).
 */
export type Point = { readonly x: number; readonly y: number };

/**
 * Monster AI FSM. Phase 3 union extended in Phase 7.A.2 with three boss
 * phase states (`docs/ARCHITECTURE.md` "Phase 7 frozen contracts"). The
 * boss starts at `boss-phase-1`; transitions are PURELY DETERMINISTIC
 * (no random; advance only via player attack actions that drop the
 * boss HP below the integer thresholds 66% / 33%):
 *   - phase-1 → phase-2 when `hp * 100 < hpMax * 66`
 *   - phase-2 → phase-3 when `hp * 100 < hpMax * 33`
 * Per-phase scaling adds to the registry-default atk/def at counter-attack
 * time: phase-1 = +0/+0, phase-2 = +1/+0, phase-3 = +2/+1.
 */
export type MonsterAIState =
  | "idle"
  | "chasing"
  | "boss-phase-1"
  | "boss-phase-2"
  | "boss-phase-3";

/**
 * A single inventory stack — one item kind, positive integer count.
 * Phase 6 frozen contract (`docs/ARCHITECTURE.md` "Phase 6 frozen
 * contracts" — "Inventory data shape"): a stack with `count === 0` is
 * removed (the array does not retain zero-count slots).
 */
export type InventoryEntry = {
  readonly kind: ItemKindId;
  readonly count: number;
};

/**
 * Equipment-slot enumeration. Phase 6 frozen contract: this set is
 * **frozen** in Phase 6; bumping requires architecture-red-team review
 * (Phase 9 polish may add `armor`, `accessory`, etc., as additive
 * `rulesetVersion`-bumping changes).
 */
export type EquipmentSlot = "cyberware" | "weapon";

/**
 * Equipment record — fixed-slot, each holding a single `ItemKindId` or
 * `null` (slot empty). Slot order in the type literal matches the
 * alphabetical iteration order of `EQUIPMENT_SLOTS`.
 */
export type Equipment = {
  readonly cyberware: ItemKindId | null;
  readonly weapon: ItemKindId | null;
};

/**
 * Deterministic iteration order over equipment slots. Alphabetical so
 * any `for (const s of EQUIPMENT_SLOTS)` loop walks slots in the same
 * order across runtimes (frozen-contract item 6 from Phase 3 — the
 * SIM_UNORDERED lint discipline applies to any sim-internal iteration).
 */
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = Object.freeze([
  "cyberware",
  "weapon",
]);

/**
 * Player entity. `id` is pinned to 0 (frozen-contract item 5).
 *
 * Phase 6 frozen contract additions:
 *   - `inventory` — sorted by `kind` ASC (UTF-16 code-unit order),
 *     tie-break by `count` DESC; entries with `count === 0` are removed.
 *     Capacity unbounded in Phase 6.
 *   - `equipment` — fixed-slot record keyed by `EquipmentSlot`.
 */
export type Player = {
  readonly id: 0;
  readonly kind: "player";
  readonly pos: Point;
  readonly hp: number;
  readonly hpMax: number;
  readonly atk: number;
  readonly def: number;
  readonly inventory: readonly InventoryEntry[];
  readonly equipment: Equipment;
};

/** Monster entity. `id` is `1..N`, assigned at floor-entry spawn time. */
export type Monster = {
  readonly id: number;
  readonly kind: MonsterKindId;
  readonly pos: Point;
  readonly hp: number;
  readonly hpMax: number;
  readonly atk: number;
  readonly def: number;
  readonly aiState: MonsterAIState;
};

/** A loot-slot placeholder placed at floor-entry. Phase 6 will give it
 *  inventory mechanics; Phase 3 only records that the slot exists.
 */
export type FloorItem = {
  readonly y: number;
  readonly x: number;
  readonly kind: ItemKindId;
};

/**
 * One non-combatant NPC placed on a floor. Phase 7 frozen contract
 * (`docs/ARCHITECTURE.md` "Phase 7 frozen contracts (NPCs + shops + boss)"):
 * NPCs are interaction targets, NOT combat entities — they have no
 * `hp`/`atk`/`def`. Their `inventory` carries the NPC's shop stock at
 * spawn time, sorted by the same Phase 6 inventory comparator (kind
 * ASC, count DESC). The shop transaction handlers in `tick()` consume
 * from this stock and replenish it with cred-chip currency on `buy`.
 */
export type FloorNpc = {
  readonly kind: NpcKindId;
  readonly pos: Point;
  readonly inventory: readonly InventoryEntry[];
};

/**
 * State of the current floor — entities + items + NPCs. Collections
 * sorted by deterministic comparators:
 *   - `monsters` by `id`
 *   - `items` by `(y, x, kind)`
 *   - `npcs` by `kind` ASC, tie-break by `(y, x)` (Phase 7 frozen contract)
 */
export type FloorState = {
  readonly floor: Floor;
  readonly monsters: readonly Monster[];
  readonly items: readonly FloorItem[];
  readonly npcs: readonly FloorNpc[];
};

/**
 * Top-level run state. Frozen-contract item 9 says `tick(state, action)`
 * is a pure function of `state` and `action`; this type carries every
 * field that function reads from or writes to. `__pendingFloorEntry` is
 * a one-bit flag set by `tick` on a successful descend, signalling the
 * harness to perform the floor-entry block (`generateFloor` +
 * `spawnFloorEntities`) in the next loop iteration.
 */
export type RunOutcome = "running" | "dead" | "won";

export type RunState = {
  readonly fingerprintInputs: FingerprintInputs;
  readonly stateHash: Uint8Array;
  readonly floorN: number;
  readonly floorState: FloorState;
  readonly player: Player;
  readonly outcome: RunOutcome;
  readonly actionLogLength: number;
  readonly __pendingFloorEntry: boolean;
};
