/**
 * Domain types for `src/mapgen/`. These types describe the in-memory and
 * wire-form representation of a generated floor; the wire form is
 * frozen contract 4/9 from `artifacts/decision-memo-phase-2.md`.
 */

import type { RoomKindId } from "../registries/rooms";
import type { EncounterKindId } from "../registries/encounters";

/** Inclusive-origin, exclusive-extent integer rectangle. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** A single placed room. `id` is the index in the floor's `rooms` array. */
export type Room = Rect & {
  readonly id: number;
  readonly kind: RoomKindId;
};

/** A door tile, on the boundary between a room and a corridor. */
export type Door = {
  readonly x: number;
  readonly y: number;
};

/** An encounter slot. Phase 2 only places the slot; Phase 6+ fills it. */
export type Encounter = {
  readonly kind: EncounterKindId;
  readonly x: number;
  readonly y: number;
};

/** Coordinate pair for entrance / exit. */
export type Point = {
  readonly x: number;
  readonly y: number;
};

/**
 * One generated floor. The serialized form (`serializeFloor`) emits the
 * top-level keys in alphabetical order with all collections pre-sorted
 * by their canonical comparator (memo decision 5 + addendum B2).
 */
export type Floor = {
  readonly floor: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  readonly rooms: readonly Room[];
  readonly doors: readonly Door[];
  readonly encounters: readonly Encounter[];
  readonly entrance: Point;
  readonly exit: Point | null;
  readonly bossArena: Rect | null;
};
