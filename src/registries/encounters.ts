/**
 * Encounter slot kind registry — frozen contract 10 from
 * `artifacts/decision-memo-phase-2.md`.
 *
 * Phase 2 ships only the *slots*: empty containers placed by the map
 * generator. Phase 6 / 7 wire in the actual content (which monster spawns
 * at `encounter.combat.basic` on floor 4, etc.). Stable string IDs from
 * day one let the Phase 6 PR add content without touching this file.
 */

export type EncounterKindId =
  | "encounter.combat.basic"
  | "encounter.combat.elite"
  | "encounter.loot.basic"
  | "encounter.boss-arena.entry";

export type EncounterPlacement = "in-room" | "corridor" | "door-adjacent";

/**
 * Metadata for one encounter slot kind.
 *
 * - `weight`: relative sampling weight when mapgen picks one of several
 *   eligible kinds for a given slot. Phase 2 mapgen does not yet use the
 *   weights for non-trivial sampling (slot kinds are picked structurally),
 *   but the field is part of the frozen registry surface.
 * - `allowedFloors`: which floor numbers may host this kind.
 * - `placement`: hint to mapgen about where to physically locate the
 *   slot. `in-room` = inside a room interior, `corridor` = along a
 *   corridor tile, `door-adjacent` = floor cell next to a door.
 */
export type EncounterKind = {
  readonly id: EncounterKindId;
  readonly weight: number;
  readonly allowedFloors: readonly number[];
  readonly placement: EncounterPlacement;
};

const FLOORS_1_TO_9: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9,
]);
const FLOORS_4_TO_9: readonly number[] = Object.freeze([4, 5, 6, 7, 8, 9]);
const FLOOR_10: readonly number[] = Object.freeze([10]);

function freezeKind(k: EncounterKind): EncounterKind {
  return Object.freeze({ ...k, allowedFloors: k.allowedFloors });
}

export const ENCOUNTER_KINDS: readonly EncounterKind[] = Object.freeze([
  freezeKind({
    id: "encounter.boss-arena.entry",
    weight: 1,
    allowedFloors: FLOOR_10,
    placement: "door-adjacent",
  }),
  freezeKind({
    id: "encounter.combat.basic",
    weight: 6,
    allowedFloors: FLOORS_1_TO_9,
    placement: "in-room",
  }),
  freezeKind({
    id: "encounter.combat.elite",
    weight: 2,
    allowedFloors: FLOORS_4_TO_9,
    placement: "in-room",
  }),
  freezeKind({
    id: "encounter.loot.basic",
    weight: 3,
    allowedFloors: FLOORS_1_TO_9,
    placement: "in-room",
  }),
]);

export const ENCOUNTER_KIND_IDS: readonly EncounterKindId[] = Object.freeze(
  ENCOUNTER_KINDS.map((k) => k.id),
);

/**
 * Resolve an encounter-kind id to its metadata entry. Throws on unknown
 * id.
 */
export function getEncounterKind(id: string): EncounterKind {
  for (let i = 0; i < ENCOUNTER_KINDS.length; i++) {
    const k = ENCOUNTER_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getEncounterKind: unknown encounter kind id "${id}"`);
}
