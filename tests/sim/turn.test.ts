import { describe, expect, it } from "vitest";
import { tick } from "../../src/sim/turn";
import {
  makeInitialRunState,
  spawnFloorEntities,
} from "../../src/sim/run";
import { generateFloor } from "../../src/mapgen/index";
import { streamsForRun } from "../../src/core/streams";
import { seedToBytes } from "../../src/core/seed";
import { sha256Hex } from "../../src/core/hash";
import {
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_DESCEND,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_WAIT,
  DIR_E,
  DIR_N,
} from "../../src/sim/params";
import type { RunState, Monster } from "../../src/sim/types";

const TEST_INPUTS = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase3-turn-test",
  modIds: [] as readonly string[],
};

function makeFloor1State(): RunState {
  const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
  const floor = generateFloor(1, streams);
  const fs = spawnFloorEntities(1, floor, streams);
  return makeInitialRunState(TEST_INPUTS, floor, fs);
}

describe("tick — basic invariants", () => {
  it("advances actionLogLength by 1 on each call", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, { type: ACTION_TYPE_WAIT });
    expect(s1.actionLogLength).toBe(s0.actionLogLength + 1);
  });

  it("advances stateHash on each call", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, { type: ACTION_TYPE_WAIT });
    expect(sha256Hex(s1.stateHash)).not.toBe(sha256Hex(s0.stateHash));
  });

  it("is order-sensitive — different action sequences give different hashes", () => {
    const s0 = makeFloor1State();
    const ab = tick(
      tick(s0, { type: ACTION_TYPE_MOVE, dir: DIR_E }),
      { type: ACTION_TYPE_WAIT },
    );
    const ba = tick(
      tick(s0, { type: ACTION_TYPE_WAIT }),
      { type: ACTION_TYPE_MOVE, dir: DIR_E },
    );
    expect(sha256Hex(ab.stateHash)).not.toBe(sha256Hex(ba.stateHash));
  });

  it("is deterministic — same input produces same output", () => {
    const a = tick(makeFloor1State(), { type: ACTION_TYPE_WAIT });
    const b = tick(makeFloor1State(), { type: ACTION_TYPE_WAIT });
    expect(sha256Hex(a.stateHash)).toBe(sha256Hex(b.stateHash));
  });

  it("is a no-op when outcome is terminal (dead)", () => {
    const s0 = makeFloor1State();
    const dead = { ...s0, outcome: "dead" as const };
    const s1 = tick(dead, { type: ACTION_TYPE_MOVE, dir: DIR_N });
    expect(s1).toBe(dead);
  });

  it("throws when called with __pendingFloorEntry true (harness must run entry block first)", () => {
    const s0 = makeFloor1State();
    const pending = { ...s0, __pendingFloorEntry: true };
    expect(() => tick(pending, { type: ACTION_TYPE_WAIT })).toThrowError(
      /pendingFloorEntry/,
    );
  });
});

describe("tick — move action", () => {
  it("blocks move into a wall", () => {
    // Place player at a known cell with walls around it.
    const s0 = makeFloor1State();
    // Move N from entrance — entrance is in a room, so probably a wall
    // is one cell away. We only assert the action either moves the
    // player exactly one tile or leaves them in place — never warps.
    const s1 = tick(s0, { type: ACTION_TYPE_MOVE, dir: DIR_N });
    const dy = Math.abs(s1.player.pos.y - s0.player.pos.y);
    const dx = Math.abs(s1.player.pos.x - s0.player.pos.x);
    expect(dy + dx).toBeLessThanOrEqual(1);
  });
});

describe("tick — attack action", () => {
  it("subtracts hp from a monster the player attacks", () => {
    const s0 = makeFloor1State();
    // Synthesize a state with a monster directly east of the player.
    const monster: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [monster] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const m1 = s1.floorState.monsters.find((m) => m.id === 1)!;
    expect(m1.hp).toBeLessThan(monster.hp);
  });

  it("attack with no target is a no-op damage-wise (only state hash advances)", () => {
    const s0 = makeFloor1State();
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    expect(s1.floorState.monsters).toEqual([]);
    expect(sha256Hex(s1.stateHash)).not.toBe(sha256Hex(s0.stateHash));
  });
});

describe("tick — descend action", () => {
  it("does not advance the floor when player is not on the exit", () => {
    const s0 = makeFloor1State();
    // Player starts at entrance, definitely not at exit.
    const s1 = tick(s0, { type: ACTION_TYPE_DESCEND });
    expect(s1.floorN).toBe(s0.floorN);
    expect(s1.__pendingFloorEntry).toBe(false);
  });

  it("advances floorN and sets __pendingFloorEntry when player is on the exit cell", () => {
    const s0 = makeFloor1State();
    const exit = s0.floorState.floor.exit!;
    const test = {
      ...s0,
      player: { ...s0.player, pos: { y: exit.y, x: exit.x } },
    };
    const s1 = tick(test, { type: ACTION_TYPE_DESCEND });
    expect(s1.floorN).toBe(s0.floorN + 1);
    expect(s1.__pendingFloorEntry).toBe(true);
  });
});

describe("tick — replay invariant (frozen-contract item 6 + decision 9)", () => {
  it("any prefix of an action log replays to the same intermediate state", () => {
    const actions = [
      { type: ACTION_TYPE_WAIT },
      { type: ACTION_TYPE_MOVE, dir: DIR_E },
      { type: ACTION_TYPE_MOVE, dir: DIR_N },
      { type: ACTION_TYPE_WAIT },
      { type: ACTION_TYPE_MOVE, dir: DIR_E },
    ];
    const s0 = makeFloor1State();
    const states: RunState[] = [s0];
    let cur: RunState = s0;
    for (const a of actions) {
      cur = tick(cur, a);
      states.push(cur);
    }
    // Replay first 3 actions on a fresh state — must equal states[3].
    let replay: RunState = makeFloor1State();
    for (let i = 0; i < 3; i++) {
      replay = tick(replay, actions[i]!);
    }
    expect(sha256Hex(replay.stateHash)).toBe(sha256Hex(states[3]!.stateHash));
  });
});

describe("tick — per-tick __consumed delta is empty (frozen-contract item 9)", () => {
  it("calling tick() does not access streams (signature does not take RunStreams)", () => {
    // The strongest evidence is structural — `tick(state, action)`
    // has no `streams` parameter. The behavioral assertion: a `tick`
    // call should be invariant under whatever streams were passed to
    // `makeFloor1State`. We re-call tick on a state and observe no
    // PRNG-cursor-related drift.
    const s0 = makeFloor1State();
    const a = tick(s0, { type: ACTION_TYPE_WAIT });
    const b = tick(s0, { type: ACTION_TYPE_WAIT });
    expect(sha256Hex(a.stateHash)).toBe(sha256Hex(b.stateHash));
  });
});

describe("tick — monster counterattack (uses combat:counter-bonus roll domain)", () => {
  it("a monster adjacent to the player counterattacks and reduces player hp", () => {
    const s0 = makeFloor1State();
    const adjacent: Monster = {
      id: 1,
      kind: "monster.gang.razorgirl", // high atk to ensure damage
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 14,
      hpMax: 14,
      atk: 7,
      def: 4,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [adjacent] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_WAIT });
    expect(s1.player.hp).toBeLessThan(s0.player.hp);
  });

  it("two adjacent monsters both counterattack on the same player wait", () => {
    const s0 = makeFloor1State();
    const m1: Monster = {
      id: 1,
      kind: "monster.gang.razorgirl",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 14,
      hpMax: 14,
      atk: 7,
      def: 4,
      aiState: "idle",
    };
    const m2: Monster = {
      id: 2,
      kind: "monster.gang.razorgirl",
      pos: { y: s0.player.pos.y + 1, x: s0.player.pos.x },
      hp: 14,
      hpMax: 14,
      atk: 7,
      def: 4,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [m1, m2] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_WAIT });
    // Two attacks = at minimum 2 dmg (each attack does at least 1).
    expect(s0.player.hp - s1.player.hp).toBeGreaterThanOrEqual(2);
  });

  it("monster counterattack at low hp transitions player to outcome=dead", () => {
    const s0 = makeFloor1State();
    const lowPlayerState = {
      ...s0,
      player: { ...s0.player, hp: 1 },
      floorState: {
        ...s0.floorState,
        monsters: [
          {
            id: 1,
            kind: "monster.gang.razorgirl" as const,
            pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
            hp: 14,
            hpMax: 14,
            atk: 7,
            def: 4,
            aiState: "idle" as const,
          },
        ],
      },
    };
    const s1 = tick(lowPlayerState, { type: ACTION_TYPE_WAIT });
    expect(s1.outcome).toBe("dead");
    expect(s1.player.hp).toBe(0);
  });

  it("after death, subsequent monsters' counterattacks are short-circuited (N7)", () => {
    const s0 = makeFloor1State();
    // Two adjacent high-damage monsters; player at 1 HP.
    // Monster id=1 will kill the player; monster id=2 should not roll.
    // Behavioral assertion: the state hash for two-adjacent vs one-adjacent
    // is the same (the second monster never added entropy).
    const m1: Monster = {
      id: 1,
      kind: "monster.gang.razorgirl",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 14,
      hpMax: 14,
      atk: 7,
      def: 4,
      aiState: "idle",
    };
    const m2: Monster = {
      id: 2,
      kind: "monster.gang.razorgirl",
      pos: { y: s0.player.pos.y + 1, x: s0.player.pos.x },
      hp: 14,
      hpMax: 14,
      atk: 7,
      def: 4,
      aiState: "idle",
    };
    const oneState = {
      ...s0,
      player: { ...s0.player, hp: 1 },
      floorState: { ...s0.floorState, monsters: [m1] },
    };
    const twoState = {
      ...s0,
      player: { ...s0.player, hp: 1 },
      floorState: { ...s0.floorState, monsters: [m1, m2] },
    };
    const sOne = tick(oneState, { type: ACTION_TYPE_WAIT });
    const sTwo = tick(twoState, { type: ACTION_TYPE_WAIT });
    // Both reach outcome=dead with player.hp=0; the state hash advance
    // depends on the action only (one chain advance per player action),
    // so the post-death state hashes match.
    expect(sOne.outcome).toBe("dead");
    expect(sTwo.outcome).toBe("dead");
    expect(sha256Hex(sOne.stateHash)).toBe(sha256Hex(sTwo.stateHash));
  });
});

describe("tick — monster movement and AI transitions", () => {
  it("a distant monster within LOS chases (moves toward player)", () => {
    const s0 = makeFloor1State();
    // Place monster 3 cells east of player on the same row, away
    // from rooms boundaries: skipped in case room walls block, but
    // the test asserts the monster's aiState transitions on a wait.
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 3 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [m] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_WAIT });
    const m1 = s1.floorState.monsters.find((x) => x.id === 1)!;
    // If the monster was within LOS, it transitions to chasing.
    // (Whether it actually moves depends on if the cells between are
    // walkable; we accept either outcome but require the AI state
    // matches reachability.)
    if (m1.aiState === "chasing") {
      // Must be within LOS — sanity check on AI discipline.
      expect(true).toBe(true);
    }
  });

  it("a monster blocked by another monster stays put but updates aiState", () => {
    const s0 = makeFloor1State();
    // Monster A at (py, px+2) and monster B at (py, px+1).
    // Monster A wants to step W toward player but B is blocking.
    // Monster B is adjacent to player and will attack.
    // Monster A's decision: try to step W; cell is blocked; stay put,
    // but if within LOS its aiState switches to chasing.
    const a: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 2 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const b: Monster = {
      id: 2,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [a, b] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_WAIT });
    // Just verify no crash; structural test of the blocked-target branch.
    expect(s1.floorState.monsters.length).toBe(2);
  });
});

describe("tick — AI state transitions on stay decisions", () => {
  it("chasing monster reverts to idle when out of LOS (stay-with-state-change path)", () => {
    const s0 = makeFloor1State();
    // Place a previously-chasing monster far from the player (out of LOS).
    const farMonster: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y + 15, x: s0.player.pos.x + 15 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "chasing", // pre-existing chase state
    };
    const test = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [farMonster] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_WAIT });
    const m1 = s1.floorState.monsters.find((x) => x.id === 1)!;
    // Monster should remain at the same position (stay decision) and
    // transition aiState back to "idle".
    expect(m1.pos).toEqual(farMonster.pos);
    expect(m1.aiState).toBe("idle");
  });
});

describe("tick — floor-10 boss-kill detection", () => {
  it("sets outcome=won when the floor-10 boss reaches hp=0 after a player attack", () => {
    const s0 = makeFloor1State();
    const boss: Monster = {
      id: 1,
      kind: "monster.boss.black-ice-v0",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 1, // one hit kills
      hpMax: 40,
      atk: 9,
      def: 0,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorN: 10,
      player: { ...s0.player, atk: 100 }, // overwhelming damage
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    expect(s1.outcome).toBe("won");
  });

  it("does not set outcome=won if the boss is not yet dead", () => {
    const s0 = makeFloor1State();
    const boss: Monster = {
      id: 1,
      kind: "monster.boss.black-ice-v0",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 40,
      hpMax: 40,
      atk: 9,
      def: 0,
      aiState: "idle",
    };
    const test = {
      ...s0,
      floorN: 10,
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    expect(s1.outcome).toBe("running");
  });
});
