/**
 * Phase 7.A.2 win-log builder. Programmatically synthesizes a scripted
 * action sequence that:
 *   1. Walks from floor-1 entrance toward the exit, picking up any
 *      items on the path and engaging adjacent NPCs to buy a weapon
 *      (the floor-1 NPC is reachable from the entrance corridor).
 *   2. Uses heal consumables when HP drops below 50%, equips the best
 *      weapon held to maximise per-attack damage, and attacks any
 *      monster blocking the path.
 *   3. Descends to floor 2, repeats steps 1-2 through floor 9.
 *   4. On floor 10, walks to the boss arena and attacks the boss until
 *      it dies (or the player dies trying — we pick a seed where the
 *      buff stack lets the player win on a fixed adjacency cell).
 *
 * The output is a `(inputs, actions)` pair. Pinned by `WIN_DIGEST` in
 * `src/core/self-test.ts` — any silent change to the boss FSM,
 * shop-action handlers, scripted-walk algorithm, item-effect domains,
 * or the NPC-spawn position surfaces here as a digest mismatch.
 *
 * Implementation note: this builder runs the sim AHEAD of itself in a
 * shadow simulation to know which cells are walkable / which monsters
 * block the path. It does NOT consume any non-deterministic state —
 * the same inputs always produce the same actions.
 */

import type { Action } from "../src/core/encode";
import type { FingerprintInputs } from "../src/core/fingerprint";
import { streamsForRun } from "../src/core/streams";
import { seedToBytes } from "../src/core/seed";
import { idiv } from "../src/core/intmath";
import { generateFloor } from "../src/mapgen/index";
import {
  applyFloorEntry,
  makeInitialRunState,
  spawnFloorEntities,
} from "../src/sim/run";
import { tick } from "../src/sim/turn";
import {
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_BUY,
  ACTION_TYPE_DESCEND,
  ACTION_TYPE_EQUIP,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_PICKUP,
  ACTION_TYPE_USE,
  ACTION_TYPE_WAIT,
  DIR_DELTAS,
  type Direction,
} from "../src/sim/params";
import { TILE_FLOOR, TILE_DOOR } from "../src/mapgen/tiles";
import { getItemKind, type ItemKindId } from "../src/registries/items";
import { NPC_KINDS, npcKindOrdinal } from "../src/registries/npcs";

// Lookup table from NpcKindId → NpcKind (basePrice / priceVariance) so
// the walker can decide affordability without re-iterating NPC_KINDS
// per call. Built once at module load (NPC_KINDS is frozen).
const NPC_KINDS_BY_ID: Readonly<
  Record<string, { basePrice: number; priceVariance: number }>
> = (() => {
  const out: Record<string, { basePrice: number; priceVariance: number }> = {};
  for (let i = 0; i < NPC_KINDS.length; i++) {
    const k = NPC_KINDS[i]!;
    out[k.id] = { basePrice: k.basePrice, priceVariance: k.priceVariance };
  }
  return out;
})();
import type { FloorNpc, RunState, Monster } from "../src/sim/types";
import type { Floor, Point } from "../src/mapgen/types";

export const SELF_TEST_WIN_INPUTS: FingerprintInputs = Object.freeze({
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase7-win-icefall-1",
  modIds: Object.freeze([]) as readonly string[],
});

/**
 * Find the cardinal-direction step from `from` to `to`, or `null` if
 * `to` is not a unit-step from `from`. Cardinal-only — the walker uses
 * 4-connected pathing (matches the diagonal-aware AI but doesn't need
 * NE/NW/SE/SW for a one-shot scripted walk).
 */
function dirFromStep(from: Point, to: Point): Direction | null {
  const dy = to.y - from.y;
  const dx = to.x - from.x;
  for (let i = 0; i < DIR_DELTAS.length; i++) {
    const d = DIR_DELTAS[i]!;
    if (d.dy === dy && d.dx === dx) return i as Direction;
  }
  return null;
}

/**
 * 4-connected BFS path from `start` to `goal` over the floor's
 * walkable tiles. Returns the path as an array of points (inclusive of
 * both endpoints), or `null` if no path exists.
 *
 * `avoid` (optional) lists cells the search must NOT enter — used by
 * the walker to route around live monsters when a clear path exists,
 * minimising counter-attack damage. The start cell is always allowed
 * (avoidance is checked on neighbours, not on start). When no path
 * avoiding the obstacles exists, the caller falls back to a non-
 * avoidance BFS so the player can still engage blockers head-on.
 */
function bfsPath(
  floor: Floor,
  start: Point,
  goal: Point,
  avoid?: ReadonlySet<number>,
): readonly Point[] | null {
  const w = floor.width;
  const h = floor.height;
  const visited = new Uint8Array(w * h);
  const parent = new Int32Array(w * h);
  parent.fill(-1);
  const xs = new Int32Array(w * h);
  const ys = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  xs[tail] = start.x;
  ys[tail] = start.y;
  tail++;
  visited[start.y * w + start.x] = 1;
  // Cardinal-4 deltas (N E S W).
  const cardDeltas: { readonly dy: number; readonly dx: number }[] = [
    { dy: -1, dx: 0 },
    { dy: 0, dx: 1 },
    { dy: 1, dx: 0 },
    { dy: 0, dx: -1 },
  ];
  let found = false;
  while (head < tail) {
    const cx = xs[head]!;
    const cy = ys[head]!;
    head++;
    if (cx === goal.x && cy === goal.y) {
      found = true;
      break;
    }
    for (let i = 0; i < cardDeltas.length; i++) {
      const d = cardDeltas[i]!;
      const ny = cy + d.dy;
      const nx = cx + d.dx;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni] === 1) continue;
      // Skip the goal cell from the avoid set so the search can
      // terminate on it (we may want to walk to a cell occupied by
      // an NPC, for instance — an NPC isn't a blocker but a target).
      if (avoid !== undefined && avoid.has(ni) && !(nx === goal.x && ny === goal.y)) continue;
      const t = floor.tiles[ni]!;
      if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
      visited[ni] = 1;
      parent[ni] = cy * w + cx;
      xs[tail] = nx;
      ys[tail] = ny;
      tail++;
    }
  }
  if (!found) return null;
  // Reconstruct the path. We avoid `cur / w` (would be float division
  // banned by the no-float-arithmetic lint rule) by re-tracking the
  // (x, y) tuple through `parent` indices using `idiv`.
  const out: Point[] = [];
  let cur = goal.y * w + goal.x;
  while (cur !== -1) {
    const y = idiv(cur, w);
    const x = cur - y * w;
    out.unshift({ x, y });
    if (cur === start.y * w + start.x) break;
    cur = parent[cur]!;
  }
  return out;
}

/**
 * Find the nearest monster on the player's BFS path. Returns the
 * monster on the path (one cell away) or `null` if no monster is
 * blocking the immediate next step.
 */
function monsterAtPoint(
  monsters: readonly Monster[],
  p: Point,
): Monster | null {
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i]!;
    if (m.hp > 0 && m.pos.x === p.x && m.pos.y === p.y) return m;
  }
  return null;
}

/**
 * Total atk-bonus a held weapon would provide if equipped (registry
 * `effect.base` only — variance is rolled at attack time so we use the
 * registry baseline as a deterministic ranking key). Returns 0 for
 * non-atk-bonus items. Pure.
 */
function weaponBaseBonus(itemId: ItemKindId): number {
  const k = getItemKind(itemId);
  if (k.effect.kind === "atk-bonus") return k.effect.base;
  return 0;
}

/**
 * Pick the strongest weapon (highest `effect.base` from `atk-bonus`
 * effect) currently in the player's inventory, or `null` if none.
 * Pure — read-only over `state`.
 */
function bestWeaponInInventory(state: RunState): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const entry of state.player.inventory) {
    if (!entry.kind.startsWith("item.weapon.")) continue;
    const base = weaponBaseBonus(entry.kind);
    if (base > bestBase) {
      bestBase = base;
      bestId = entry.kind;
    }
  }
  return bestId;
}

/**
 * Total def-bonus a held cyberware would provide if equipped (registry
 * `effect.base` only). Returns 0 for non-def-bonus items. Pure.
 */
function cyberwareBaseBonus(itemId: ItemKindId): number {
  const k = getItemKind(itemId);
  if (k.effect.kind === "def-bonus") return k.effect.base;
  if (k.effect.kind === "atk-bonus") return k.effect.base;
  return 0;
}

/**
 * Pick the strongest cyberware (highest `effect.base` from `def-bonus`
 * effect) currently in the player's inventory, or `null` if none.
 * Pure.
 */
function bestCyberwareInInventory(state: RunState): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const entry of state.player.inventory) {
    if (!entry.kind.startsWith("item.cyber.")) continue;
    const base = cyberwareBaseBonus(entry.kind);
    if (base > bestBase) {
      bestBase = base;
      bestId = entry.kind;
    }
  }
  return bestId;
}

/**
 * Pick the largest `heal`-effect consumable held, or `null` if none.
 * `minBase` excludes heals whose `effect.base` is below the minimum
 * (set this to ~4 during the boss fight to avoid triggering a
 * net-negative-HP swap on a weak heal — the boss counters every tick,
 * so a syringe heal of 3 against a 5+ counter is HP-negative). Pure.
 */
function bestHealInInventory(
  state: RunState,
  minBase: number = 0,
): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const entry of state.player.inventory) {
    const k = getItemKind(entry.kind);
    if (k.effect.kind !== "heal") continue;
    if (k.effect.base < minBase) continue;
    if (k.effect.base > bestBase) {
      bestBase = k.effect.base;
      bestId = entry.kind;
    }
  }
  return bestId;
}

/**
 * Sum of cred-chip count in the player's inventory.
 */
function playerChips(state: RunState): number {
  for (const e of state.player.inventory) {
    if (e.kind === "item.cred-chip") return e.count;
  }
  return 0;
}

/**
 * Find an NPC's stocked weapon kind (highest base atk-bonus), or
 * `null` if the NPC has no weapons in stock.
 */
function npcBestWeapon(npc: FloorNpc): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const e of npc.inventory) {
    if (!e.kind.startsWith("item.weapon.")) continue;
    const base = weaponBaseBonus(e.kind);
    if (base > bestBase) {
      bestBase = base;
      bestId = e.kind;
    }
  }
  return bestId;
}

/**
 * Find an NPC's stocked cyberware kind (highest base def-bonus), or
 * `null`. Used to buy passive defence buffs (the load-bearing
 * survivability bump for the boss fight).
 */
function npcBestCyberware(npc: FloorNpc): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const e of npc.inventory) {
    if (!e.kind.startsWith("item.cyber.")) continue;
    const base = cyberwareBaseBonus(e.kind);
    if (base > bestBase) {
      bestBase = base;
      bestId = e.kind;
    }
  }
  return bestId;
}

/**
 * Find an NPC's stocked heal consumable (highest base), or `null`.
 */
function npcBestHeal(npc: FloorNpc): ItemKindId | null {
  let bestId: ItemKindId | null = null;
  let bestBase = -1;
  for (const e of npc.inventory) {
    const k = getItemKind(e.kind);
    if (k.effect.kind === "heal" && k.effect.base > bestBase) {
      bestBase = k.effect.base;
      bestId = e.kind;
    }
  }
  return bestId;
}

/**
 * Attempt to top off HP if it's below `threshold` of hpMax. Each
 * use-action consumes one heal item and pushes one action. Stops as
 * soon as HP is back above threshold or no qualifying heals remain.
 *
 * `minBase` filters out heal items whose `effect.base` is below the
 * minimum — used during the boss fight where weak heals are net-
 * negative HP (the boss counters every tick).
 */
function maybeHeal(
  state: RunState,
  actions: Action[],
  threshold: number,
  minBase: number = 0,
): RunState {
  let cur = state;
  while (cur.outcome === "running") {
    if (cur.player.hp * 100 >= cur.player.hpMax * threshold) break;
    const healId = bestHealInInventory(cur, minBase);
    if (healId === null) break;
    const useAction: Action = { type: ACTION_TYPE_USE, item: healId };
    actions.push(useAction);
    cur = tick(cur, useAction);
  }
  return cur;
}

/**
 * Equip the best weapon in inventory if a stronger one than the
 * currently-equipped weapon is held. Pushes one EQUIP action when a
 * change is needed.
 */
function maybeEquipBestWeapon(state: RunState, actions: Action[]): RunState {
  const best = bestWeaponInInventory(state);
  if (best === null) return state;
  const cur = state.player.equipment.weapon;
  const curBase = cur === null ? 0 : weaponBaseBonus(cur);
  const bestBase = weaponBaseBonus(best);
  if (bestBase <= curBase) return state;
  const equipAction: Action = { type: ACTION_TYPE_EQUIP, item: best };
  actions.push(equipAction);
  return tick(state, equipAction);
}

/**
 * Equip the best cyberware (def-bonus) in inventory. Mirror of
 * `maybeEquipBestWeapon`.
 */
function maybeEquipBestCyberware(state: RunState, actions: Action[]): RunState {
  const best = bestCyberwareInInventory(state);
  if (best === null) return state;
  const cur = state.player.equipment.cyberware;
  const curBase = cur === null ? 0 : cyberwareBaseBonus(cur);
  const bestBase = cyberwareBaseBonus(best);
  if (bestBase <= curBase) return state;
  const equipAction: Action = { type: ACTION_TYPE_EQUIP, item: best };
  actions.push(equipAction);
  return tick(state, equipAction);
}

/**
 * Drive a scripted walk from the player's current position to a goal
 * point. If a monster blocks the next step, attack it first. If the
 * cell the player just entered has a floor item, pick it up. If the
 * cell has an adjacent NPC with a weapon stronger than what the player
 * holds and chips to afford it, buy the upgrade.
 *
 * Caps the action count at `maxStepsPerFloor` to avoid runaway loops
 * (e.g., an unreachable goal). Returns even on cap-hit so callers can
 * detect failure.
 */
function walkToward(
  state: RunState,
  goal: Point,
  actions: Action[],
  maxSteps: number,
  healThreshold: number = 0,
  healMinBase: number = 0,
): { state: RunState; reached: boolean } {
  let cur = state;
  let steps = 0;
  while (steps < maxSteps) {
    if (cur.outcome !== "running") return { state: cur, reached: false };
    if (cur.player.pos.x === goal.x && cur.player.pos.y === goal.y) {
      return { state: cur, reached: true };
    }
    // Heal if HP fell below the requested threshold (default 0 means
    // emergency-only — heal at hp <= 5). Caller-supplied thresholds
    // (e.g. 70 on floor 10's boss approach) keep HP topped up while
    // walking through monster-aggro range. `healMinBase` filters out
    // weak heals when the caller cares about HP-positive trades.
    if (healThreshold > 0) {
      cur = maybeHeal(cur, actions, healThreshold, healMinBase);
      if (cur.outcome !== "running") return { state: cur, reached: false };
    } else if (cur.player.hp <= 5) {
      cur = maybeHeal(cur, actions, 30);
      if (cur.outcome !== "running") return { state: cur, reached: false };
    }
    // Equip best gear if we just picked up an upgrade.
    cur = maybeEquipBestWeapon(cur, actions);
    if (cur.outcome !== "running") return { state: cur, reached: false };
    cur = maybeEquipBestCyberware(cur, actions);
    if (cur.outcome !== "running") return { state: cur, reached: false };
    // Engage any adjacent NPC for a buy-upgrade if profitable.
    cur = maybeBuyFromAdjacentNpc(cur, actions);
    if (cur.outcome !== "running") return { state: cur, reached: false };

    // Try a path that avoids live monsters first. If that fails, fall
    // back to a standard BFS (which may put a monster in the next
    // step's cell — handled below by the attack branch).
    const w = cur.floorState.floor.width;
    const avoid = new Set<number>();
    for (let i = 0; i < cur.floorState.monsters.length; i++) {
      const m = cur.floorState.monsters[i]!;
      if (m.hp > 0) avoid.add(m.pos.y * w + m.pos.x);
    }
    let path = bfsPath(cur.floorState.floor, cur.player.pos, goal, avoid);
    if (path === null || path.length < 2) {
      path = bfsPath(cur.floorState.floor, cur.player.pos, goal);
    }
    if (path === null || path.length < 2) {
      // Can't reach.
      return { state: cur, reached: false };
    }
    const next = path[1]!;
    const dir = dirFromStep(cur.player.pos, next);
    if (dir === null) return { state: cur, reached: false };
    const blocking = monsterAtPoint(cur.floorState.monsters, next);
    if (blocking !== null) {
      const attack: Action = { type: ACTION_TYPE_ATTACK, dir };
      actions.push(attack);
      cur = tick(cur, attack);
    } else {
      const move: Action = { type: ACTION_TYPE_MOVE, dir };
      actions.push(move);
      cur = tick(cur, move);
      // After moving, attempt a pickup if the new cell has a floor item.
      cur = maybePickupHere(cur, actions);
    }
    steps++;
  }
  return { state: cur, reached: false };
}

/**
 * Walk to a nearby cred-chip on the floor IF the chip is no further
 * than `maxDetour` BFS steps from the player's current position. The
 * walker uses this to opportunistically grab chips that are close on
 * the path, without zigzagging through monster-aggro range. Returns
 * the state with one or more pickup actions appended.
 */
function maybePickupNearbyLoot(
  state: RunState,
  actions: Action[],
  maxDetour: number,
): RunState {
  let cur = state;
  // One pass — picks up at most one loot per call so the loop in the
  // caller controls re-checking after the position changed.
  const items = cur.floorState.items;
  let bestIdx = -1;
  let bestLen = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const path = bfsPath(
      cur.floorState.floor,
      cur.player.pos,
      { y: it.y, x: it.x },
    );
    if (path === null) continue;
    if (path.length > maxDetour) continue;
    if (bestLen === -1 || path.length < bestLen) {
      bestLen = path.length;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return cur;
  const target = items[bestIdx]!;
  const walked = walkToward(
    cur,
    { y: target.y, x: target.x },
    actions,
    maxDetour * 4,
  );
  cur = walked.state;
  if (walked.reached) cur = maybePickupHere(cur, actions);
  return cur;
}

/**
 * If the player's current cell has a floor item, push an
 * `ACTION_TYPE_PICKUP` action. No-op when no item is at the cell.
 */
function maybePickupHere(state: RunState, actions: Action[]): RunState {
  const items = state.floorState.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.y === state.player.pos.y && it.x === state.player.pos.x) {
      const pickup: Action = { type: ACTION_TYPE_PICKUP };
      actions.push(pickup);
      return tick(state, pickup);
    }
  }
  return state;
}

/**
 * If the player is adjacent to an NPC, attempt to buy:
 *   - the NPC's strongest cyberware (when stronger than equipped) — the
 *     load-bearing survivability bump for the boss fight;
 *   - the NPC's strongest weapon (when stronger than what we carry); and
 *   - one heal consumable per visit (when the NPC stocks one and we can
 *     spare chips).
 * Each successful purchase emits one BUY action.
 */
function maybeBuyFromAdjacentNpc(
  state: RunState,
  actions: Action[],
): RunState {
  let cur = state;
  const npcs = cur.floorState.npcs;
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i]!;
    const dy = Math.abs(npc.pos.y - cur.player.pos.y);
    const dx = Math.abs(npc.pos.x - cur.player.pos.x);
    if (dy > 1 || dx > 1) continue;

    // Affordability: NPCs charge `basePrice + (0..priceVariance-1)`
    // chips. The minimum-affordability check is `chips >= basePrice`;
    // below that the buy can never succeed. The maximum-affordability
    // check is `chips >= basePrice + priceVariance` for guaranteed
    // success on any roll; we use the minimum so the walker tries even
    // when chips are tight (a failed buy is a state-hash-advancing no-op,
    // bloating the log slightly but preserving determinism).
    const npcKindData = NPC_KINDS_BY_ID[npc.kind];
    if (npcKindData === undefined) continue;
    const minPrice = npcKindData.basePrice;
    const maxPrice = npcKindData.basePrice + npcKindData.priceVariance;

    // Priority order:
    //   1. Heals (info-broker is the only NPC kind that stocks
    //      heal-effect items, and it appears at most once or twice in
    //      a 9-floor run — buying when we can is critical).
    //   2. Cyberware (def-bonus is the load-bearing survivability
    //      bump for the boss fight).
    //   3. Weapons (atk-bonus speeds up the boss kill but isn't
    //      load-bearing — the player's base atk=5 + boss def=5 + bonus
    //      0..3 already deals 1..3 dmg/tick).

    // 1. Heals — buy as many as we can afford, capped at 5.
    let refreshedNpc: FloorNpc | undefined = npc;
    while (cur.outcome === "running") {
      const r = cur.floorState.npcs.find((n) => n.kind === npc.kind);
      if (r === undefined) break;
      refreshedNpc = r;
      const heal = npcBestHeal(refreshedNpc);
      if (heal === null) break;
      if (playerChips(cur) < minPrice) break;
      const ord = npcKindOrdinal(refreshedNpc.kind);
      const buy: Action = {
        type: ACTION_TYPE_BUY,
        target: ord,
        item: heal,
      };
      const beforeHeal = cur;
      actions.push(buy);
      cur = tick(cur, buy);
      if (cur === beforeHeal) break;
      // Cap aggregate heal count to avoid drowning the log; 10 stim/
      // injectors is plenty for any boss fight.
      let totalHeals = 0;
      for (const e of cur.player.inventory) {
        const k = getItemKind(e.kind);
        if (k.effect.kind === "heal") totalHeals += e.count;
      }
      if (totalHeals >= 10) break;
      // Stop if the price actually drained more than we had — defensive
      // against runaway in odd `priceVariance` configurations.
      if (playerChips(cur) === playerChips(beforeHeal)) break;
    }

    // 2. Cyberware — strict upgrade only.
    refreshedNpc = cur.floorState.npcs.find((n) => n.kind === npc.kind);
    if (refreshedNpc === undefined) continue;
    const npcCyber = npcBestCyberware(refreshedNpc);
    if (npcCyber !== null && playerChips(cur) >= minPrice) {
      const heldCyber = bestCyberwareInInventory(cur);
      const curBase = heldCyber === null ? 0 : cyberwareBaseBonus(heldCyber);
      const equippedBase =
        cur.player.equipment.cyberware === null
          ? 0
          : cyberwareBaseBonus(cur.player.equipment.cyberware);
      const refBase = Math.max(curBase, equippedBase);
      const npcBase = cyberwareBaseBonus(npcCyber);
      if (npcBase > refBase) {
        const ord = npcKindOrdinal(refreshedNpc.kind);
        const buy: Action = {
          type: ACTION_TYPE_BUY,
          target: ord,
          item: npcCyber,
        };
        actions.push(buy);
        cur = tick(cur, buy);
      }
    }

    // 3. Weapons — strict upgrade only, AND only if we have at least
    // `maxPrice * 2` chips on hand (so we don't drain ourselves to 0
    // when we may need heals next floor).
    refreshedNpc = cur.floorState.npcs.find((n) => n.kind === npc.kind);
    if (refreshedNpc === undefined) continue;
    const npcWeapon = npcBestWeapon(refreshedNpc);
    if (npcWeapon !== null && playerChips(cur) >= maxPrice * 2) {
      const cur2 = bestWeaponInInventory(cur);
      const curBase = cur2 === null ? 0 : weaponBaseBonus(cur2);
      const equippedBase =
        cur.player.equipment.weapon === null
          ? 0
          : weaponBaseBonus(cur.player.equipment.weapon);
      const refBase = Math.max(curBase, equippedBase);
      const npcBase = weaponBaseBonus(npcWeapon);
      if (npcBase > refBase) {
        const ord = npcKindOrdinal(refreshedNpc.kind);
        const buy: Action = {
          type: ACTION_TYPE_BUY,
          target: ord,
          item: npcWeapon,
        };
        actions.push(buy);
        cur = tick(cur, buy);
      }
    }
  }
  return cur;
}

/**
 * Build the win-log: a synthesized action log that descends to floor
 * 10 and defeats the boss. Pure function over `inputs` — same inputs
 * always produce the same log. The log is what `WIN_DIGEST` is pinned
 * against.
 *
 * `inputs` defaults to `SELF_TEST_WIN_INPUTS` so the digest constant
 * pins a single canonical seed. Tests and the seed-probe tool pass
 * alternative `FingerprintInputs` to explore the seed space without
 * mutating any module-level state.
 *
 * This builder runs an INTERNAL simulation forward to discover what
 * actions are needed; the resulting `Action[]` is the load-bearing
 * output. Callers re-run via `runScripted({inputs, actions})` and
 * assert `outcome === "won"`.
 */
export function buildWinLog(
  inputs: FingerprintInputs = SELF_TEST_WIN_INPUTS,
): {
  readonly inputs: FingerprintInputs;
  readonly actions: readonly Action[];
} {
  const rootSeed = seedToBytes(inputs.seed);
  const streams = streamsForRun(rootSeed);
  const floor1 = generateFloor(1, streams);
  const fs1 = spawnFloorEntities(1, floor1, streams);
  let state = makeInitialRunState(inputs, floor1, fs1);
  const actions: Action[] = [];

  // Floors 1..9: walk to the exit with item/NPC interactions, descend.
  for (let n = 1; n <= 9; n++) {
    const exit = state.floorState.floor.exit;
    if (exit === null) break;

    // Opportunistic chip pickup: walk to the closest reachable
    // cred-chip on the floor as long as the player has > 70% HP. Stop
    // if HP drops — chase damage from far-flung detours is the
    // dominant attrition source. Cap at 8 chips per floor.
    for (let chipsTaken = 0; chipsTaken < 8; chipsTaken++) {
      if (state.player.hp * 10 < state.player.hpMax * 7) break;
      const before = state;
      state = maybePickupNearbyLoot(state, actions, 60);
      if (state.outcome !== "running") break;
      if (state === before) break;
    }
    if (state.outcome !== "running") break;

    // Phase A: detour to the NPC — buying cyberware/weapons/heals is
    // the load-bearing survival mechanic. The NPC kind rotates per
    // floor's `npcStock` stream; the criterion only requires "buy an
    // upgrade from a ripperdoc", satisfied as soon as the walker visits
    // a ripperdoc-spawned floor.
    if (state.floorState.npcs.length > 0) {
      const npc = state.floorState.npcs[0]!;
      const adj: Point[] = [
        { y: npc.pos.y, x: npc.pos.x }, // co-located is also adjacent
        { y: npc.pos.y - 1, x: npc.pos.x },
        { y: npc.pos.y, x: npc.pos.x + 1 },
        { y: npc.pos.y + 1, x: npc.pos.x },
        { y: npc.pos.y, x: npc.pos.x - 1 },
      ];
      for (const a of adj) {
        const w = state.floorState.floor.width;
        if (a.y < 0 || a.y >= state.floorState.floor.height) continue;
        if (a.x < 0 || a.x >= w) continue;
        const t = state.floorState.floor.tiles[a.y * w + a.x];
        if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
        const walked = walkToward(state, a, actions, 400);
        state = walked.state;
        if (walked.reached) break;
        if (state.outcome !== "running") break;
      }
    }
    if (state.outcome !== "running") break;

    // Walk to the exit. Cap at 1500 steps per floor.
    const walked = walkToward(state, exit, actions, 1500);
    state = walked.state;
    if (state.outcome !== "running") break;
    if (!walked.reached) break;
    // Descend.
    const descend: Action = { type: ACTION_TYPE_DESCEND };
    actions.push(descend);
    state = tick(state, descend);
    // Run the floor-entry block (mirrors `runScripted` orchestration).
    if (state.__pendingFloorEntry) {
      const newFloor = generateFloor(state.floorN, streams);
      const newFloorState = spawnFloorEntities(
        state.floorN,
        newFloor,
        streams,
      );
      state = applyFloorEntry(state, newFloorState);
    }
  }

  // Floor 10: heal up, equip best weapon + cyberware, walk to a tile
  // adjacent to the boss, then attack until the boss is dead or our
  // HP runs out.
  if (state.floorN === 10 && state.outcome === "running") {
    state = maybeHeal(state, actions, 100);
    state = maybeEquipBestWeapon(state, actions);
    state = maybeEquipBestCyberware(state, actions);

    const arena = state.floorState.floor.bossArena;
    if (arena !== null) {
      const boss = state.floorState.monsters.find(
        (m) => m.kind === "monster.boss.black-ice-v0",
      );
      if (boss !== undefined) {
        // Walk to a cardinal-adjacent cell of the boss. Try N first
        // (which is reachable from the boss-arena entry door); fall
        // back to others if blocked.
        const adjacents: Point[] = [
          { y: boss.pos.y - 1, x: boss.pos.x }, // N
          { y: boss.pos.y, x: boss.pos.x + 1 }, // E
          { y: boss.pos.y + 1, x: boss.pos.x }, // S
          { y: boss.pos.y, x: boss.pos.x - 1 }, // W
        ];
        let anyReached = false;
        for (const adj of adjacents) {
          const w = state.floorState.floor.width;
          const t = state.floorState.floor.tiles[adj.y * w + adj.x];
          if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
          // Floor-10 walk uses healThreshold=70 so the walker stays
          // above 70% HP through the boss-arena approach. No minBase
          // filter here — even a weak heal is better than dying mid-
          // walk when we're 8 cells out from the boss arena.
          const walked = walkToward(state, adj, actions, 1500, 70, 0);
          state = walked.state;
          if (walked.reached) {
            anyReached = true;
            break;
          }
        }
        if (anyReached && state.outcome === "running") {
          // Top off HP one more time before the burn-down loop —
          // strong heals only (`minBase=4`). Weak heals (syringe /
          // nano-repair base 3) against a 5+ counter are net-negative
          // HP and waste a turn.
          state = maybeHeal(state, actions, 100, 4);
          // Now attack the boss until it dies. Cap at 500 attacks.
          for (let i = 0; i < 500; i++) {
            if (state.outcome !== "running") break;
            const curBoss = state.floorState.monsters.find(
              (m) => m.kind === "monster.boss.black-ice-v0",
            );
            if (curBoss === undefined || curBoss.hp <= 0) break;
            // Heal aggressively mid-fight when HP drops below 70% —
            // the boss counters every tick (move, use, or attack), so
            // surviving a ~10-tick burn-down requires healing whenever
            // HP drops materially. minBase=4 skips heals that would
            // be net-negative HP against the boss counter (boss avg
            // counter ≥ 4 per tick under typical scaling). Med-
            // injectors (base 8) and adrenaline-spike (base 4) qualify.
            state = maybeHeal(state, actions, 70, 4);
            if (state.outcome !== "running") break;
            const dy = curBoss.pos.y - state.player.pos.y;
            const dx = curBoss.pos.x - state.player.pos.x;
            const dir = dirFromStep(state.player.pos, {
              y: state.player.pos.y + dy,
              x: state.player.pos.x + dx,
            });
            if (dir === null) break;
            const attack: Action = { type: ACTION_TYPE_ATTACK, dir };
            actions.push(attack);
            state = tick(state, attack);
          }
        }
      }
    }
  }

  // Trailing wait — keeps the log non-empty even on edge cases.
  if (actions.length === 0) actions.push({ type: ACTION_TYPE_WAIT });

  return { inputs, actions: Object.freeze(actions) };
}
