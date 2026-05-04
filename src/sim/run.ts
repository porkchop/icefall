/**
 * Phase 3 run state machine — `RunState` construction, `outcome`
 * transitions, floor-entry spawn block.
 *
 * `spawnFloorEntities(floorN, floor, streams)` is the only function in
 * `src/sim/**` that consumes a PRNG cursor, and it does so via
 * `streams.simFloor(floorN)` only. The harness (`runScripted`) is the
 * caller; the floor itself is produced by Phase 2's `generateFloor`,
 * which the harness imports across the layer boundary (the only
 * sim→mapgen edge in the project, per addendum B5 + lint exception).
 *
 * `tick(state, action)` is in `turn.ts`. This module produces the
 * `RunState` skeletons that `tick` reads from and writes to.
 */

import { genesis } from "../core/state-chain";
import type { Floor } from "../mapgen/types";
import type { FingerprintInputs } from "../core/fingerprint";
import type { RunStreams } from "../core/streams";
import type { PRNG } from "../core/prng";
import {
  eligibleMonstersForFloor,
  getMonsterKind,
  type MonsterKind,
} from "../registries/monsters";
import type { ItemKindId } from "../registries/items";
import type {
  FloorItem,
  FloorState,
  Monster,
  Player,
  RunState,
} from "./types";

const PLAYER_INITIAL_HP_MAX = 30;
const PLAYER_INITIAL_ATK = 5;
const PLAYER_INITIAL_DEF = 2;

/**
 * Rejection-sampled uniform integer in `[0, n)`. Integer-only — no
 * `Math.floor`, no `/`. The largest u32 with `(m + 1)` divisible by
 * `n` is `m = 0xFFFFFFFF - tail` where
 * `tail = ((0xFFFFFFFF % n) + 1) % n`.
 *
 * For `n` ≤ ~10 the rejection probability is < 1e-8 per draw; for
 * non-power-of-two `n` it's bounded by `n / 2^32`.
 */
export function uniformIndex(prng: PRNG, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`uniformIndex: n must be positive integer (got ${n})`);
  }
  const tail = ((0xffffffff % n) + 1) % n;
  const m = (0xffffffff - tail) >>> 0;
  let r = prng() >>> 0;
  while (r > m) r = prng() >>> 0;
  return r % n;
}

/** Build the initial `Player` at the floor entrance. */
export function makeInitialPlayer(floor: Floor): Player {
  return {
    id: 0,
    kind: "player",
    pos: { y: floor.entrance.y, x: floor.entrance.x },
    hp: PLAYER_INITIAL_HP_MAX,
    hpMax: PLAYER_INITIAL_HP_MAX,
    atk: PLAYER_INITIAL_ATK,
    def: PLAYER_INITIAL_DEF,
  };
}

/**
 * Spawn entities for floor entry. Iterates the floor's `encounters`
 * (already sorted by `(kind, y, x)` — Phase 2 frozen) and for each
 * combat slot whose `allowedFloors` includes `floorN`, draws a
 * monster kind from the eligible pool with rejection-sampled uniform
 * indexing. Boss-arena slots on floor 10 spawn the boss; loot slots
 * record an `item.cred-chip` placeholder.
 *
 * Consumes exactly one stream key: `"sim:" + floorN`.
 */
export function spawnFloorEntities(
  floorN: number,
  floor: Floor,
  streams: RunStreams,
): FloorState {
  const prng = streams.simFloor(floorN);
  const monsters: Monster[] = [];
  const items: FloorItem[] = [];
  let nextMonsterId = 1;

  const eligible = eligibleMonstersForFloor(floorN);

  for (let i = 0; i < floor.encounters.length; i++) {
    const slot = floor.encounters[i]!;
    if (
      slot.kind === "encounter.combat.basic" ||
      slot.kind === "encounter.combat.elite"
    ) {
      if (eligible.length > 0) {
        const idx = uniformIndex(prng, eligible.length);
        const kind: MonsterKind = eligible[idx]!;
        monsters.push({
          id: nextMonsterId++,
          kind: kind.id,
          pos: { y: slot.y, x: slot.x },
          hp: kind.hpMax,
          hpMax: kind.hpMax,
          atk: kind.atk,
          def: kind.def,
          aiState: "idle",
        });
      }
    } else if (slot.kind === "encounter.boss-arena.entry") {
      // Spawn the boss inside the boss arena (centre).
      if (floorN === 10 && floor.bossArena !== null) {
        const arena = floor.bossArena;
        const cy = arena.y + (arena.h >>> 1);
        const cx = arena.x + (arena.w >>> 1);
        const boss = getMonsterKind("monster.boss.black-ice-v0");
        monsters.push({
          id: nextMonsterId++,
          kind: boss.id,
          pos: { y: cy, x: cx },
          hp: boss.hpMax,
          hpMax: boss.hpMax,
          atk: boss.atk,
          def: boss.def,
          aiState: "idle",
        });
      }
    } else if (slot.kind === "encounter.loot.basic") {
      const kind: ItemKindId = "item.cred-chip";
      items.push({ y: slot.y, x: slot.x, kind });
    }
  }

  monsters.sort((a, b) => a.id - b.id);
  items.sort(
    (a, b) =>
      a.y - b.y || a.x - b.x || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );

  return {
    floor,
    monsters,
    items,
  };
}

/**
 * Build the initial `RunState`. The caller (harness) is responsible for
 * having generated `floor` via `mapgen.generateFloor` and for having
 * called `spawnFloorEntities(1, floor, streams)` already.
 */
export function makeInitialRunState(
  fingerprintInputs: FingerprintInputs,
  floor: Floor,
  initialFloorState: FloorState,
): RunState {
  return {
    fingerprintInputs,
    stateHash: genesis(),
    floorN: floor.floor,
    floorState: initialFloorState,
    player: makeInitialPlayer(floor),
    outcome: "running",
    actionLogLength: 0,
    __pendingFloorEntry: false,
  };
}

/**
 * Apply a floor-entry transition — called by the harness after `tick`
 * sets `__pendingFloorEntry = true` on a successful descend.
 * Generates a new floor (caller's responsibility), spawns entities,
 * places the player at the new floor's entrance, clears the pending
 * flag.
 */
export function applyFloorEntry(
  state: RunState,
  newFloor: Floor,
  newFloorState: FloorState,
): RunState {
  return {
    ...state,
    floorState: newFloorState,
    player: {
      ...state.player,
      pos: { y: newFloor.entrance.y, x: newFloor.entrance.x },
    },
    __pendingFloorEntry: false,
  };
}
