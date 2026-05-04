/**
 * Phase 3 turn loop — `tick(state, action): RunState`.
 *
 * Frozen-contract item 9: per-`tick` `__consumed` delta is empty by
 * construction. This function takes `RunState` and `Action` only — no
 * `RunStreams` parameter — so it is structurally incapable of consuming
 * any PRNG cursor. Floor-entry spawn (`generateFloor` +
 * `spawnFloorEntities`) happens in the run loop (`runScripted` and
 * Phase 5+'s input-driven equivalent) outside `tick`.
 *
 * On a successful `descend`, `tick` sets
 * `RunState.__pendingFloorEntry = true` and advances `floorN`. The
 * harness sees the flag and runs the floor-entry block on the next
 * loop iteration before resolving the next player action.
 *
 * State-hash advance is one per *player action* (frozen-contract item
 * 6) — monster tick decisions do not appear on the chain.
 */

import { advance } from "../core/state-chain";
import type { Action } from "../core/encode";
import { TILE_FLOOR, TILE_DOOR } from "../mapgen/tiles";
import {
  ACTION_TYPE_WAIT,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_DESCEND,
  DIR_DELTAS,
} from "./params";
import {
  damageBonus,
  damageAmount,
  clampHp,
  ROLL_DOMAIN_ATK_BONUS,
  ROLL_DOMAIN_COUNTER_BONUS,
} from "./combat";
import {
  bfsDistanceMapFromPlayer,
  decideMonsterAction,
} from "./ai";
import type { Floor } from "../mapgen/types";
import type {
  Monster,
  MonsterAIState,
  Player,
  Point,
  RunOutcome,
  RunState,
} from "./types";

function isPlayerOn(player: Player, x: number, y: number): boolean {
  return player.pos.x === x && player.pos.y === y;
}

function isPassable(floor: Floor, y: number, x: number): boolean {
  if (x < 0 || x >= floor.width || y < 0 || y >= floor.height) return false;
  const t = floor.tiles[y * floor.width + x]!;
  return t === TILE_FLOOR || t === TILE_DOOR;
}

function findMonsterAt(
  monsters: readonly Monster[],
  y: number,
  x: number,
): Monster | undefined {
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i]!;
    if (m.hp > 0 && m.pos.y === y && m.pos.x === x) return m;
  }
  return undefined;
}

function isMonsterAt(
  monsters: readonly Monster[],
  y: number,
  x: number,
): boolean {
  return findMonsterAt(monsters, y, x) !== undefined;
}

/**
 * The single action resolver. Returns the new `RunState`.
 *
 * - Asserts the state hash is advanced exactly once per call (frozen
 *   contract — caller observes via `state.actionLogLength` increment).
 * - Does NOT mutate any input.
 * - Uses only Phase 1's `advance(state, action)` and the per-roll
 *   subhash from `combat.ts`.
 */
export function tick(state: RunState, action: Action): RunState {
  if (state.outcome !== "running") {
    // Terminal — trailing actions are no-ops (memo decision 11 + N2).
    return state;
  }
  if (state.__pendingFloorEntry) {
    throw new Error(
      "tick: cannot call tick while __pendingFloorEntry is true; harness must run floor-entry block first",
    );
  }

  const stateHashPre = state.stateHash;
  const stateHashPost = advance(stateHashPre, action);
  const floor = state.floorState.floor;
  const player = state.player;

  let nextPlayer: Player = player;
  let nextMonsters: readonly Monster[] = state.floorState.monsters;
  let nextFloorN = state.floorN;
  let pendingFloorEntry = false;
  let outcome: RunOutcome = state.outcome;

  // Resolve player action.
  if (action.type === ACTION_TYPE_WAIT) {
    // pass
  } else if (action.type === ACTION_TYPE_MOVE) {
    const dir = action.dir;
    if (dir !== undefined) {
      const delta = DIR_DELTAS[dir]!;
      const ny = player.pos.y + delta.dy;
      const nx = player.pos.x + delta.dx;
      if (
        isPassable(floor, ny, nx) &&
        !isMonsterAt(nextMonsters, ny, nx)
      ) {
        nextPlayer = {
          ...player,
          pos: { y: ny, x: nx },
        };
      }
    }
  } else if (action.type === ACTION_TYPE_ATTACK) {
    const dir = action.dir;
    if (dir !== undefined) {
      const delta = DIR_DELTAS[dir]!;
      const ny = player.pos.y + delta.dy;
      const nx = player.pos.x + delta.dx;
      const target = findMonsterAt(nextMonsters, ny, nx);
      if (target !== undefined) {
        const bonus = damageBonus(
          stateHashPre,
          action,
          ROLL_DOMAIN_ATK_BONUS,
          0,
        );
        const dmg = damageAmount(player.atk, target.def, bonus);
        const newHp = clampHp(target.hp, dmg);
        nextMonsters = nextMonsters.map((m) =>
          m.id === target.id ? { ...m, hp: newHp } : m,
        );
      }
    }
  } else if (action.type === ACTION_TYPE_DESCEND) {
    const exit = floor.exit;
    if (
      state.floorN < 10 &&
      exit !== null &&
      isPlayerOn(player, exit.x, exit.y)
    ) {
      nextFloorN = state.floorN + 1;
      pendingFloorEntry = true;
    }
  }
  // Unknown action types are no-ops — Phase 1 binary encoding still
  // accepts the action (verifier may flag), but the sim treats it as
  // a wait. This is consistent with "additive vocabulary" (decision 3).

  // Detect win: floor-10 boss with hp == 0.
  if (state.floorN === 10 && nextFloorN === 10) {
    let bossDead = false;
    let sawBoss = false;
    for (let i = 0; i < nextMonsters.length; i++) {
      const m = nextMonsters[i]!;
      // The boss kind id is the only one whose registered isBoss is true.
      // Detect via the kind id literal — the boss registry entry is
      // named `monster.boss.black-ice-v0` (decision 12).
      if (m.kind === "monster.boss.black-ice-v0") {
        sawBoss = true;
        if (m.hp === 0) bossDead = true;
      }
    }
    if (sawBoss && bossDead) outcome = "won";
  }

  // Resolve monster ticks (zero-PRNG, zero-roll AI). Only proceed if
  // outcome is still running (a descend ended the player turn cleanly,
  // and a win was just set above; in either case skip monster ticks).
  let counterIndex = 0;
  if (outcome === "running" && !pendingFloorEntry) {
    const distMap = bfsDistanceMapFromPlayer(
      floor,
      nextPlayer.pos,
      nextMonsters,
    );
    const aliveMonsters = nextMonsters.filter((m) => m.hp > 0);
    // Iterate monsters in ascending id order. nextMonsters is already
    // sorted by id at construction (frozen contract); preserve order.
    const monstersById = aliveMonsters
      .slice()
      .sort((a, b) => a.id - b.id);

    let workingMonsters = nextMonsters.slice();
    let workingPlayer = nextPlayer;

    for (let i = 0; i < monstersById.length; i++) {
      const m = monstersById[i]!;
      // Find its current state in workingMonsters.
      const cur = workingMonsters.find((x) => x.id === m.id);
      if (cur === undefined || cur.hp <= 0) continue;

      const decision = decideMonsterAction(
        cur,
        workingPlayer.pos,
        distMap,
        floor,
      );

      if (decision.kind === "stay") {
        if (cur.aiState !== decision.newAiState) {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  aiState: decision.newAiState as MonsterAIState,
                }
              : x,
          );
        }
      } else if (decision.kind === "move") {
        // Re-check the target cell isn't occupied by a since-moved monster
        // or the player.
        if (
          !isMonsterAt(workingMonsters, decision.to.y, decision.to.x) &&
          !(
            workingPlayer.pos.y === decision.to.y &&
            workingPlayer.pos.x === decision.to.x
          )
        ) {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  pos: decision.to as Point,
                  aiState: decision.newAiState as MonsterAIState,
                }
              : x,
          );
        } else {
          // Target became blocked — stay put but keep newAiState.
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  aiState: decision.newAiState as MonsterAIState,
                }
              : x,
          );
        }
      } else {
        // attack — counterattack the player.
        const bonus = damageBonus(
          stateHashPre,
          action,
          ROLL_DOMAIN_COUNTER_BONUS,
          counterIndex,
        );
        counterIndex++;
        const dmg = damageAmount(cur.atk, workingPlayer.def, bonus);
        const newHp = clampHp(workingPlayer.hp, dmg);
        workingPlayer = {
          ...workingPlayer,
          hp: newHp,
        };
        if (cur.aiState !== "chasing") {
          workingMonsters = workingMonsters.map((x) =>
            x.id === m.id ? { ...x, aiState: "chasing" } : x,
          );
        }
        if (newHp === 0) {
          outcome = "dead";
          break; // short-circuit per N7.
        }
      }
    }

    nextMonsters = workingMonsters;
    nextPlayer = workingPlayer;
  }

  return {
    fingerprintInputs: state.fingerprintInputs,
    stateHash: stateHashPost,
    floorN: nextFloorN,
    floorState: pendingFloorEntry
      ? state.floorState // unchanged; harness will overwrite on entry
      : {
          floor: state.floorState.floor,
          monsters: nextMonsters,
          items: state.floorState.items,
        },
    player: nextPlayer,
    outcome,
    actionLogLength: state.actionLogLength + 1,
    __pendingFloorEntry: pendingFloorEntry,
  };
}
