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
import type { ItemKindId } from "../registries/items";
import type { FingerprintInputs } from "../core/fingerprint";

/** A 2D integer point. Distinct from mapgen's `Point` to keep the sim
 *  layer's type surface independent (mutations stay in-module).
 */
export type Point = { readonly x: number; readonly y: number };

/** Monster AI FSM (Phase 3 decision 7). */
export type MonsterAIState = "idle" | "chasing";

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

/** State of the current floor — entities + items. Sorted by id / by
 *  `(y, x, kind)` for deterministic iteration.
 */
export type FloorState = {
  readonly floor: Floor;
  readonly monsters: readonly Monster[];
  readonly items: readonly FloorItem[];
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
