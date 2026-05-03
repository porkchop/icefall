/**
 * Room kind registry — frozen contract 9 from
 * `artifacts/decision-memo-phase-2.md`.
 *
 * Stable string IDs survive renumbering and are self-documenting in floor
 * JSON. Adding a new kind is additive; removing or renaming a kind is a
 * `rulesetVersion` bump and requires `architecture-red-team` review. The
 * append-only-by-convention test that asserts prior entries are
 * unchanged across commits is deferred to Phase 6, when the second
 * writer of this file exists (memo addendum B3).
 *
 * The `metadata` fields (min/max dimensions, allowedFloors) are reference
 * values for mapgen and renderer code; they are part of the same frozen
 * contract surface.
 */

export type RoomKindId =
  | "room.entrance"
  | "room.exit"
  | "room.regular"
  | "room.boss-arena"
  | "room.boss-antechamber";

/**
 * Metadata for one room kind. Min/max widths and heights are inclusive
 * tile counts; `allowedFloors` is the (sorted) list of floor numbers on
 * which this kind may appear.
 */
export type RoomKind = {
  readonly id: RoomKindId;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly allowedFloors: readonly number[];
};

const FLOORS_1_TO_9: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9,
]);
const FLOORS_1_TO_10: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
]);
const FLOOR_10: readonly number[] = Object.freeze([10]);

function freezeKind(k: RoomKind): RoomKind {
  return Object.freeze({ ...k, allowedFloors: k.allowedFloors });
}

export const ROOM_KINDS: readonly RoomKind[] = Object.freeze([
  freezeKind({
    id: "room.boss-antechamber",
    minWidth: 5,
    minHeight: 3,
    maxWidth: 12,
    maxHeight: 6,
    allowedFloors: FLOOR_10,
  }),
  freezeKind({
    id: "room.boss-arena",
    minWidth: 16,
    minHeight: 16,
    maxWidth: 24,
    maxHeight: 24,
    allowedFloors: FLOOR_10,
  }),
  freezeKind({
    id: "room.entrance",
    minWidth: 4,
    minHeight: 3,
    maxWidth: 12,
    maxHeight: 8,
    allowedFloors: FLOORS_1_TO_10,
  }),
  freezeKind({
    id: "room.exit",
    minWidth: 4,
    minHeight: 3,
    maxWidth: 12,
    maxHeight: 8,
    allowedFloors: FLOORS_1_TO_9,
  }),
  freezeKind({
    id: "room.regular",
    minWidth: 4,
    minHeight: 3,
    maxWidth: 12,
    maxHeight: 8,
    allowedFloors: FLOORS_1_TO_9,
  }),
]);

/** Ordered list of frozen room-kind IDs. */
export const ROOM_KIND_IDS: readonly RoomKindId[] = Object.freeze(
  ROOM_KINDS.map((k) => k.id),
);

/**
 * Resolve a room-kind id to its metadata entry. Throws on unknown id —
 * unknown ids are programmer errors, not data errors.
 */
export function getRoomKind(id: string): RoomKind {
  for (let i = 0; i < ROOM_KINDS.length; i++) {
    const k = ROOM_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getRoomKind: unknown room kind id "${id}"`);
}
