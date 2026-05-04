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

/** Player entity. `id` is pinned to 0 (frozen-contract item 5). */
export type Player = {
  readonly id: 0;
  readonly kind: "player";
  readonly pos: Point;
  readonly hp: number;
  readonly hpMax: number;
  readonly atk: number;
  readonly def: number;
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
