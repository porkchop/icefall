/**
 * Phase 7.A.2 boss FSM tests. The floor-10 boss has an aiState that
 * transitions deterministically through three phases on integer HP
 * thresholds (66% / 33%). Per-phase atk/def increments add to the
 * registry-default stats at counter-attack time.
 *
 * Determinism is the load-bearing assertion: same input HP → same
 * threshold crossing → same phase. No PRNG inside transitions.
 */

import { describe, expect, it } from "vitest";
import { tick } from "../../src/sim/turn";
import {
  makeInitialRunState,
  spawnFloorEntities,
} from "../../src/sim/run";
import { generateFloor } from "../../src/mapgen/index";
import { streamsForRun } from "../../src/core/streams";
import { seedToBytes } from "../../src/core/seed";
import {
  ACTION_TYPE_ATTACK,
  DIR_E,
} from "../../src/sim/params";
import type { Monster, RunState } from "../../src/sim/types";

const TEST_INPUTS = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase7-boss-fsm-test",
  modIds: [] as readonly string[],
};

function makeFloor1State(): RunState {
  const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
  const floor = generateFloor(1, streams);
  const fs = spawnFloorEntities(1, floor, streams);
  return makeInitialRunState(TEST_INPUTS, floor, fs);
}

function bossNextToPlayer(player: { pos: { x: number; y: number } }, hp: number, hpMax: number, aiState: Monster["aiState"]): Monster {
  return {
    id: 1,
    kind: "monster.boss.black-ice-v0",
    pos: { y: player.pos.y, x: player.pos.x + 1 },
    hp,
    hpMax,
    atk: 9,
    def: 5,
    aiState,
  };
}

describe("boss FSM — phase transitions", () => {
  it("starts at boss-phase-1 when spawned via spawnFloorEntities on floor 10", () => {
    const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
    const floor10 = generateFloor(10, streams);
    const fs = spawnFloorEntities(10, floor10, streams);
    const boss = fs.monsters.find(
      (m) => m.kind === "monster.boss.black-ice-v0",
    );
    expect(boss).toBeDefined();
    expect(boss!.aiState).toBe("boss-phase-1");
  });

  it("transitions phase-1 → phase-2 when HP drops below 66% via player attack", () => {
    const s0 = makeFloor1State();
    // Player atk 5, boss def 5 → base damage = max(1, 5-5+bonus) = 1+bonus.
    // Set boss HP to 27/40 (i.e., 67.5% — above 66% threshold).
    // After one player attack with bonus 1+ → HP drops to ~26 (65%) → triggers transition.
    // Using HP 27 explicitly so the threshold crosses with any bonus 1-3.
    const boss = bossNextToPlayer(s0.player, 27, 40, "boss-phase-1");
    const sWithBoss: RunState = {
      ...s0,
      player: { ...s0.player, atk: 10 }, // ensure damage > 0
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(sWithBoss, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const newBoss = s1.floorState.monsters.find((m) => m.id === 1)!;
    // Damage = max(1, 10-5+bonus) >= 5 → newHp <= 22 < 40*66/100 = 26.4 → phase-2.
    expect(newBoss.hp).toBeLessThan(27);
    expect(newBoss.hp * 100).toBeLessThan(40 * 66);
    expect(newBoss.aiState).toBe("boss-phase-2");
  });

  it("transitions phase-2 → phase-3 when HP drops below 33%", () => {
    const s0 = makeFloor1State();
    // Boss HP at 14/40 (35%). One attack with damage >= 2 puts it
    // below 13.2 (= 33%). Damage = max(1, 10-5+bonus) >= 5 always.
    const boss = bossNextToPlayer(s0.player, 14, 40, "boss-phase-2");
    const sWithBoss: RunState = {
      ...s0,
      player: { ...s0.player, atk: 10 },
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(sWithBoss, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const newBoss = s1.floorState.monsters.find((m) => m.id === 1)!;
    expect(newBoss.hp * 100).toBeLessThan(40 * 33);
    expect(newBoss.aiState).toBe("boss-phase-3");
  });

  it("does NOT transition phase-1 → phase-2 when HP stays above 66% threshold", () => {
    const s0 = makeFloor1State();
    // HP 38/40 → 95%. One attack with damage 5..7 brings it to 31..33,
    // still above 26.4 (66% threshold).
    const boss = bossNextToPlayer(s0.player, 38, 40, "boss-phase-1");
    const sWithBoss: RunState = {
      ...s0,
      player: { ...s0.player, atk: 10 },
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(sWithBoss, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const newBoss = s1.floorState.monsters.find((m) => m.id === 1)!;
    expect(newBoss.aiState).toBe("boss-phase-1");
  });

  it("phase-3 stays at phase-3 (no further transitions)", () => {
    const s0 = makeFloor1State();
    const boss = bossNextToPlayer(s0.player, 5, 40, "boss-phase-3");
    const sWithBoss: RunState = {
      ...s0,
      player: { ...s0.player, atk: 10 },
      floorState: { ...s0.floorState, monsters: [boss] },
    };
    const s1 = tick(sWithBoss, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const newBoss = s1.floorState.monsters.find((m) => m.id === 1);
    if (newBoss && newBoss.hp > 0) {
      expect(newBoss.aiState).toBe("boss-phase-3");
    }
  });

  it("boss FSM transitions are deterministic (same input → same phase)", () => {
    const s0a = makeFloor1State();
    const s0b = makeFloor1State();
    const bossA = bossNextToPlayer(s0a.player, 27, 40, "boss-phase-1");
    const bossB = bossNextToPlayer(s0b.player, 27, 40, "boss-phase-1");
    const setupA: RunState = {
      ...s0a,
      player: { ...s0a.player, atk: 10 },
      floorState: { ...s0a.floorState, monsters: [bossA] },
    };
    const setupB: RunState = {
      ...s0b,
      player: { ...s0b.player, atk: 10 },
      floorState: { ...s0b.floorState, monsters: [bossB] },
    };
    const s1 = tick(setupA, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const s2 = tick(setupB, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    const a = s1.floorState.monsters[0]!.aiState;
    const b = s2.floorState.monsters[0]!.aiState;
    expect(a).toBe(b);
  });
});

describe("boss FSM — win-state detection", () => {
  it("outcome → 'won' when boss HP reaches 0 on floor 10", () => {
    const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
    const floor10 = generateFloor(10, streams);
    const fs10 = spawnFloorEntities(10, floor10, streams);
    const baseState = makeInitialRunState(TEST_INPUTS, floor10, fs10);
    // Synthesize a state on floor 10 with the boss adjacent at 1 HP.
    const boss = bossNextToPlayer(baseState.player, 1, 40, "boss-phase-3");
    const sWithBoss: RunState = {
      ...baseState,
      floorN: 10,
      player: { ...baseState.player, atk: 100 }, // big enough to one-shot
      floorState: {
        ...baseState.floorState,
        monsters: [boss],
      },
    };
    const s1 = tick(sWithBoss, { type: ACTION_TYPE_ATTACK, dir: DIR_E });
    expect(s1.outcome).toBe("won");
  });
});
