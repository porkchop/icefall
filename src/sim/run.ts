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
import { uniformIndex } from "../core/prng";
import {
  eligibleMonstersForFloor,
  getMonsterKind,
  type MonsterKind,
} from "../registries/monsters";
import type { ItemKindId } from "../registries/items";
import {
  NPC_KINDS,
  type NpcKind,
} from "../registries/npcs";
import { TILE_FLOOR } from "../mapgen/tiles";
import type {
  FloorItem,
  FloorNpc,
  FloorState,
  InventoryEntry,
  Monster,
  Player,
  RunState,
} from "./types";

const PLAYER_INITIAL_HP_MAX = 30;
const PLAYER_INITIAL_ATK = 5;
const PLAYER_INITIAL_DEF = 2;

/**
 * Build the initial `Player` at the floor entrance.
 *
 * Phase 6 frozen contract: the player starts with an empty inventory
 * and no equipment in any slot. Inventory is fully reconstructible
 * from the action log (no inventory state is persisted separately).
 */
export function makeInitialPlayer(floor: Floor): Player {
  return {
    id: 0,
    kind: "player",
    pos: { y: floor.entrance.y, x: floor.entrance.x },
    hp: PLAYER_INITIAL_HP_MAX,
    hpMax: PLAYER_INITIAL_HP_MAX,
    atk: PLAYER_INITIAL_ATK,
    def: PLAYER_INITIAL_DEF,
    inventory: Object.freeze([]),
    equipment: Object.freeze({ weapon: null, cyberware: null }),
  };
}

/**
 * Spawn entities for floor entry. Iterates the floor's `encounters`
 * (already sorted by `(kind, y, x)` — Phase 2 frozen) and for each
 * combat slot whose `allowedFloors` includes `floorN`, draws a
 * monster kind from the eligible pool with rejection-sampled uniform
 * indexing. Boss-arena slots on floor 10 spawn the boss with
 * `aiState = "boss-phase-1"` (Phase 7 frozen contract); loot slots
 * record an `item.cred-chip` placeholder.
 *
 * Phase 7.A.2 additions:
 *   - One NPC per floor 1..9 (none on floor 10 — boss arena only).
 *     The NPC kind is chosen by `uniformIndex(npcStockPrng,
 *     NPC_KINDS.length)` against the per-floor `npcStock` stream
 *     (so SIM_DIGEST stays preserved). Position is the entrance cell
 *     plus a small fixed offset clamped to a walkable tile.
 *   - NPC stock is rolled at spawn time, NOT per-action. For each item
 *     in the kind's `stockTable`, include it iff `npcPrng() & 1`
 *     evaluates to 1; included items are added with `count: 1`. The
 *     stream is the `streams.npcStock(floorN)` cursor (Phase 7.A.2
 *     domain anchor `shop:stock`); using the cursor directly keeps
 *     shop generation hash-driven without per-action cursor
 *     consumption (tick's __consumed-empty invariant intact).
 *
 * Consumes exactly two stream keys: `"sim:" + floorN` AND
 * `"npc-stock:" + floorN`. The Phase 3 `__consumed`-delta self-test is
 * extended in Phase 7.A.2 to assert both.
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
      // Spawn the boss inside the boss arena (centre). Phase 7.A.2:
      // initial aiState is `"boss-phase-1"` (frozen contract — boss
      // FSM transitions are deterministic, advancing only when the
      // player attack drops boss HP below the integer thresholds).
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
          aiState: "boss-phase-1",
        });
      }
    } else if (slot.kind === "encounter.loot.basic") {
      const kind: ItemKindId = "item.cred-chip";
      items.push({ y: slot.y, x: slot.x, kind });
    }
  }

  // Phase 7.A.2 NPC spawn — one NPC on floors 1..9 (none on floor 10,
  // which is boss-only). The NPC kind ordinal is rolled against the
  // separate `streams.npcStock(floorN)` cursor so the existing
  // `streams.simFloor(floorN)` consumption (monster spawn) is byte-
  // identical to Phase 3 — keeps SIM_DIGEST preserved.
  const npcs: FloorNpc[] = [];
  if (floorN >= 1 && floorN <= 9) {
    const npcPrng = streams.npcStock(floorN);
    const ordinal = uniformIndex(npcPrng, NPC_KINDS.length);
    const kind: NpcKind = NPC_KINDS[ordinal]!;
    // Place the NPC at a deterministic walkable cell — the entrance
    // cell plus a small fixed offset (`(0, +2)` when walkable, else
    // the entrance itself). Avoids overlapping the player on initial
    // spawn (the player is at `entrance`).
    const npcPos = pickNpcPos(floor);
    // Roll stock: each item in the kind's stockTable is included iff
    // `npcPrng() & 1` evaluates to 1. Always include at least one
    // item via a guarantee: if the random pass produces an empty
    // stock, force-include the first item in the table.
    const stockEntries: InventoryEntry[] = [];
    for (let i = 0; i < kind.stockTable.length; i++) {
      const include = (npcPrng() & 1) === 1;
      if (include) {
        stockEntries.push({ kind: kind.stockTable[i]!, count: 1 });
      }
    }
    if (stockEntries.length === 0 && kind.stockTable.length > 0) {
      stockEntries.push({ kind: kind.stockTable[0]!, count: 1 });
    }
    // Sort the stock by the Phase 6 inventory comparator (kind ASC,
    // count DESC) so the NPC's inventory matches the player's
    // sorting discipline.
    stockEntries.sort((a, b) => {
      if (a.kind < b.kind) return -1;
      if (a.kind > b.kind) return 1;
      if (a.count > b.count) return -1;
      if (a.count < b.count) return 1;
      return 0;
    });
    npcs.push({
      kind: kind.id,
      pos: npcPos,
      inventory: Object.freeze(stockEntries),
    });
  }

  monsters.sort((a, b) => a.id - b.id);
  items.sort(
    (a, b) =>
      a.y - b.y || a.x - b.x || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  // NPCs sort by `kind` ASC, tie-break by `(y, x)` (Phase 7 frozen
  // contract). Single-NPC-per-floor in Phase 7.A.2 makes this trivially
  // sorted; the comparator is in place for the Phase 8+ multi-NPC case.
  npcs.sort((a, b) => {
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return a.pos.x - b.pos.x;
  });

  return {
    floor,
    monsters,
    items,
    npcs,
  };
}

/**
 * Pick an NPC position on the floor: the entrance cell offset by `(0,
 * +2)` if walkable, else the entrance itself. Pure function. The
 * fixed-offset strategy is deterministic (no PRNG consumption — the
 * entrance is already pinned by mapgen and the same input produces the
 * same output).
 */
function pickNpcPos(floor: Floor): { y: number; x: number } {
  const ex = floor.entrance.x;
  const ey = floor.entrance.y;
  const tryX = ex + 2;
  if (
    tryX >= 0 &&
    tryX < floor.width &&
    ey >= 0 &&
    ey < floor.height &&
    floor.tiles[ey * floor.width + tryX] === TILE_FLOOR
  ) {
    return { y: ey, x: tryX };
  }
  // Fallback: entrance itself (player is there too on first arrival,
  // but the renderer sorts by entity type — Phase 7.A.2 ships only one
  // NPC per floor so collisions are tolerable). The Phase 3 BFS
  // contract is unchanged: NPCs do not appear in `monsters` and are
  // ignored by the AI distance map.
  return { y: ey, x: ex };
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
 * sets `__pendingFloorEntry = true` on a successful descend. The new
 * floor is read from `newFloorState.floor` (the FloorState invariant
 * pins `floorState.floor` as the floor those entities live on), so a
 * second `newFloor` parameter would be redundant and a misalignment
 * surface (Phase 3.A.2 code-review carry-forward; landed in Phase
 * 6.A.1's drift sweep ahead of Phase 6.A.2's inventory-state
 * initialization in this same module).
 */
export function applyFloorEntry(
  state: RunState,
  newFloorState: FloorState,
): RunState {
  return {
    ...state,
    floorState: newFloorState,
    player: {
      ...state.player,
      pos: {
        y: newFloorState.floor.entrance.y,
        x: newFloorState.floor.entrance.x,
      },
    },
    __pendingFloorEntry: false,
  };
}
