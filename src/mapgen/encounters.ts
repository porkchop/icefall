/**
 * Encounter slot placement. Mapgen does NOT pick content (which monster
 * is in the slot) — only the slot's geometry and kind. Phases 6/7 fill
 * in content later.
 *
 * Frozen contract 10: only the four registered encounter kinds may be
 * emitted. Mapgen Phase 2 places at most one slot per regular room, on a
 * `TILE_FLOOR` cell strictly inside the room (i.e. not on the room's
 * outer wall ring).
 *
 * Pure function of the input grid + PRNG. Deterministic, integer-only,
 * lint-rule clean.
 */

import type { PRNG } from "../core/prng";
import type { Encounter, Room } from "./types";
import { TILE_FLOOR } from "./tiles";
import {
  ENCOUNTER_KINDS,
  type EncounterKindId,
} from "../registries/encounters";
import { uniformU32 } from "./bsp";

/**
 * Place at most one encounter slot inside a regular room on a given
 * floor. Returns an empty array for entrance / exit / boss rooms.
 */
export function placeEncountersForRoom(
  tiles: Uint8Array,
  width: number,
  height: number,
  room: Room,
  prng: PRNG,
  floorN: number,
): Encounter[] {
  if (room.kind !== "room.regular") return [];
  // Build the candidate kind list (eligible by floor).
  const candidates: EncounterKindId[] = [];
  for (let i = 0; i < ENCOUNTER_KINDS.length; i++) {
    const k = ENCOUNTER_KINDS[i]!;
    if (k.placement !== "in-room") continue;
    let allowed = false;
    for (let j = 0; j < k.allowedFloors.length; j++) {
      if (k.allowedFloors[j] === floorN) {
        allowed = true;
        break;
      }
    }
    if (allowed) candidates.push(k.id);
  }
  if (candidates.length === 0) return [];

  // Decide whether to actually place a slot. About half the time we
  // skip — keeping the floor's encounter count modest.
  const placeBit = prng() & 1;
  if (placeBit === 0) return [];

  // Pick the kind uniformly from the candidate list. Candidate list
  // order is the (id-sorted) registry order, which is deterministic.
  const kindIdx = uniformU32(prng, candidates.length);
  const kind = candidates[kindIdx]!;

  // Pick a floor tile strictly inside the room (not on the wall ring).
  const innerW = room.w - 2;
  const innerH = room.h - 2;
  if (innerW <= 0 || innerH <= 0) return [];
  // Search up to a bounded number of tries; if none of the picked
  // cells is floor, skip.
  for (let attempt = 0; attempt < 8; attempt++) {
    const xOff = uniformU32(prng, innerW);
    const yOff = uniformU32(prng, innerH);
    const x = room.x + 1 + xOff;
    const y = room.y + 1 + yOff;
    if (tiles[y * width + x] === TILE_FLOOR) {
      void height;
      return [{ kind, x, y }];
    }
  }
  return [];
}
