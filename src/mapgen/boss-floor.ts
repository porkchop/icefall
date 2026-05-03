/**
 * Floor-10 generator override. Frozen contract 13 from
 * `artifacts/decision-memo-phase-2.md`.
 *
 * Layout:
 *   - 40 wide x 28 tall floor.
 *   - A central ~20x20 boss arena, padded against the floor edges.
 *   - An antechamber near the top edge with the entrance.
 *   - A single corridor connecting the antechamber to the arena's
 *     north door.
 *   - One `encounter.boss-arena.entry` slot just outside the arena
 *     door; no exit; no other encounter slots.
 *
 * Deterministic from the PRNG. No floats. No `Math.*`. No time inputs.
 */

import type { PRNG } from "../core/prng";
import {
  BOSS_FLOOR_WIDTH,
  BOSS_FLOOR_HEIGHT,
  BOSS_ARENA_MIN_SIZE,
} from "./params";
import { TILE_FLOOR, TILE_DOOR } from "./tiles";
import type { Door, Encounter, Floor, Room } from "./types";
import { carveRoom, carveLCorridor, placeDoor } from "./corridors";
import { uniformU32 } from "./bsp";
import { idiv } from "./math";

/**
 * Build the floor-10 boss floor from a PRNG. The PRNG is consulted to
 * jitter the entrance position within the antechamber's interior; the
 * arena geometry is otherwise fully determined by `params.ts`.
 */
export function generateBossFloor(prng: PRNG): Floor {
  const width = BOSS_FLOOR_WIDTH;
  const height = BOSS_FLOOR_HEIGHT;
  const tiles = new Uint8Array(width * height);

  // Arena: centered horizontally, sits in the lower portion of the
  // floor. Its size is BOSS_ARENA_MIN_SIZE x BOSS_ARENA_MIN_SIZE,
  // padded by 2 cells from the bottom edge.
  const arenaW = BOSS_ARENA_MIN_SIZE;
  const arenaH = BOSS_ARENA_MIN_SIZE;
  const arenaX = idiv(width - arenaW, 2);
  const arenaY = height - arenaH - 2;

  // Antechamber: 8 wide, 4 tall, centered horizontally near the top.
  const anteW = 8;
  const anteH = 4;
  const anteX = idiv(width - anteW, 2);
  const anteY = 1;

  carveRoom(tiles, width, height, {
    x: arenaX,
    y: arenaY,
    w: arenaW,
    h: arenaH,
  });
  carveRoom(tiles, width, height, {
    x: anteX,
    y: anteY,
    w: anteW,
    h: anteH,
  });

  // Connect antechamber bottom-center to arena top-center via a
  // straight vertical corridor, with a small horizontal nudge if their
  // x-centers do not align.
  const anteBottomX = anteX + idiv(anteW, 2);
  const anteBottomY = anteY + anteH - 1;
  const arenaTopX = arenaX + idiv(arenaW, 2);
  const arenaTopY = arenaY;
  carveLCorridor(
    tiles,
    width,
    height,
    { x: anteBottomX, y: anteBottomY },
    { x: arenaTopX, y: arenaTopY },
    /* horizontalFirst */ false,
  );

  // Place doors where the corridor meets each room's wall.
  const doors: Door[] = [];
  doors.push(placeDoor(tiles, width, height, { x: anteBottomX, y: anteBottomY }));
  doors.push(placeDoor(tiles, width, height, { x: arenaTopX, y: arenaTopY }));

  // Encounter slot just outside the arena's north door (one cell up).
  const encounterY = arenaTopY - 1;
  // Corridor cell at this position should already be floor.
  /* v8 ignore start */
  if (tiles[encounterY * width + arenaTopX] !== TILE_FLOOR) {
    // Make sure the corridor cell is floor — should be true by
    // carveLCorridor, but assert for safety.
    throw new Error(
      "generateBossFloor: corridor cell outside arena door is not floor",
    );
  }
  /* v8 ignore stop */
  const encounters: Encounter[] = [
    {
      kind: "encounter.boss-arena.entry",
      x: arenaTopX,
      y: encounterY,
    },
  ];

  // Entrance: pick a floor cell strictly inside the antechamber. We
  // sample from the interior with one PRNG draw per axis so the
  // entrance jitters across runs while the layout stays deterministic.
  const innerW = anteW - 2;
  const innerH = anteH - 2;
  const ex = anteX + 1 + uniformU32(prng, innerW);
  const ey = anteY + 1 + uniformU32(prng, innerH);
  const entrance = { x: ex, y: ey };

  const rooms: Room[] = [
    {
      id: 0,
      kind: "room.boss-antechamber",
      x: anteX,
      y: anteY,
      w: anteW,
      h: anteH,
    },
    {
      id: 1,
      kind: "room.boss-arena",
      x: arenaX,
      y: arenaY,
      w: arenaW,
      h: arenaH,
    },
  ];

  // The TILE_DOOR cells emitted above are still TILE_DOOR; ensure
  // entrance does not coincide with a door. By construction, the
  // entrance is a strict-interior antechamber cell that the corridor
  // never visits, so this is structurally impossible — assert.
  /* v8 ignore next 5 */
  if (tiles[entrance.y * width + entrance.x] !== TILE_FLOOR) {
    throw new Error(
      `generateBossFloor: entrance at (${entrance.x},${entrance.y}) is not on TILE_FLOOR`,
    );
  }
  // Also assert the door tiles really are doors.
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i]!;
    /* v8 ignore next 3 */
    if (tiles[d.y * width + d.x] !== TILE_DOOR) {
      throw new Error(`generateBossFloor: door at (${d.x},${d.y}) misplaced`);
    }
  }

  return {
    floor: 10,
    width,
    height,
    tiles,
    rooms,
    doors,
    encounters,
    entrance,
    exit: null,
    bossArena: { x: arenaX, y: arenaY, w: arenaW, h: arenaH },
  };
}
