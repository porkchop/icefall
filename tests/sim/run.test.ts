import { describe, expect, it } from "vitest";
import {
  uniformIndex,
  spawnFloorEntities,
  makeInitialPlayer,
  makeInitialRunState,
  applyFloorEntry,
} from "../../src/sim/run";
import { streamsForRun, type RunStreams } from "../../src/core/streams";
import { seedToBytes } from "../../src/core/seed";
import { generateFloor } from "../../src/mapgen/index";

const TEST_SEED = "phase3-run-test";
const TEST_INPUTS = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: TEST_SEED,
  modIds: [] as readonly string[],
};

function freshStreams(): RunStreams {
  return streamsForRun(seedToBytes(TEST_SEED));
}

describe("uniformIndex — integer-only rejection sampling", () => {
  it("returns values in [0, n) for various n", () => {
    const streams = freshStreams();
    const prng = streams.simFloor(1);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      const v = uniformIndex(prng, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      counts[v]++;
    }
    // Each bucket should be hit at least 50 times by uniform sampling
    // (expected ~100; this is a loose check for distribution).
    for (const c of counts) expect(c).toBeGreaterThan(50);
  });

  it("returns values in [0, 2) for n=2 (power of 2 — no rejection)", () => {
    const streams = freshStreams();
    const prng = streams.simFloor(1);
    for (let i = 0; i < 100; i++) {
      const v = uniformIndex(prng, 2);
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it("rejects non-positive n", () => {
    const streams = freshStreams();
    const prng = streams.simFloor(1);
    expect(() => uniformIndex(prng, 0)).toThrowError(/positive integer/);
    expect(() => uniformIndex(prng, -5)).toThrowError(/positive integer/);
  });

  it("rejects non-integer n", () => {
    const streams = freshStreams();
    const prng = streams.simFloor(1);
    expect(() => uniformIndex(prng, 1.5)).toThrowError(/positive integer/);
  });

  it("is integer-only (no Math.floor or division)", () => {
    // Indirect check: source file passes the no-float-arithmetic lint
    // rule, which is verified by `npm run lint`. This test asserts
    // behavioral correctness on a stress-case n=7 (not a power of 2,
    // so rejection sampling is exercised).
    const streams = freshStreams();
    const prng = streams.simFloor(1);
    for (let i = 0; i < 500; i++) {
      const v = uniformIndex(prng, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("is deterministic for a given PRNG sequence", () => {
    const a = freshStreams().simFloor(1);
    const b = freshStreams().simFloor(1);
    for (let i = 0; i < 10; i++) {
      expect(uniformIndex(a, 7)).toBe(uniformIndex(b, 7));
    }
  });
});

describe("spawnFloorEntities", () => {
  it("consumes exactly one stream key (sim:<floorN>) per call", () => {
    const streams = freshStreams();
    const before = [...streams.__consumed].sort();
    const floor = generateFloor(3, streams);
    const beforeSpawn = [...streams.__consumed].sort();
    spawnFloorEntities(3, floor, streams);
    const after = [...streams.__consumed].sort();
    // The floor-1-entry test below covers the full delta; here we just
    // check that exactly one new key appeared after spawn.
    expect(after.length).toBe(beforeSpawn.length + 1);
    expect(after.includes("sim:3")).toBe(true);
    expect(before.includes("sim:3")).toBe(false);
  });

  it("populates monsters at each combat slot whose floor is allowed", () => {
    const streams = freshStreams();
    const floor = generateFloor(1, streams);
    const state = spawnFloorEntities(1, floor, streams);
    // Floor 1: the only eligible monster is monster.ice.daemon.
    for (const m of state.monsters) {
      if (m.kind !== "monster.boss.black-ice-v0") {
        expect(m.kind).toBe("monster.ice.daemon");
      }
    }
  });

  it("monsters are sorted by id", () => {
    const streams = freshStreams();
    const floor = generateFloor(5, streams);
    const state = spawnFloorEntities(5, floor, streams);
    for (let i = 1; i < state.monsters.length; i++) {
      expect(state.monsters[i]!.id).toBeGreaterThan(state.monsters[i - 1]!.id);
    }
  });

  it("each spawned monster has full HP and idle aiState", () => {
    const streams = freshStreams();
    const floor = generateFloor(2, streams);
    const state = spawnFloorEntities(2, floor, streams);
    for (const m of state.monsters) {
      expect(m.hp).toBe(m.hpMax);
      expect(m.aiState).toBe("idle");
    }
  });

  it("loot slots produce item.cred-chip placeholders", () => {
    const streams = freshStreams();
    const floor = generateFloor(1, streams);
    const state = spawnFloorEntities(1, floor, streams);
    for (const item of state.items) {
      expect(item.kind).toBe("item.cred-chip");
    }
  });

  it("floor 10 spawns the boss", () => {
    const streams = freshStreams();
    const floor = generateFloor(10, streams);
    const state = spawnFloorEntities(10, floor, streams);
    const boss = state.monsters.find(
      (m) => m.kind === "monster.boss.black-ice-v0",
    );
    expect(boss).toBeDefined();
    expect(boss!.hpMax).toBeGreaterThan(20);
  });

  it("is deterministic — same seed/floor produces same monsters", () => {
    const a = (() => {
      const s = freshStreams();
      const f = generateFloor(2, s);
      return spawnFloorEntities(2, f, s);
    })();
    const b = (() => {
      const s = freshStreams();
      const f = generateFloor(2, s);
      return spawnFloorEntities(2, f, s);
    })();
    expect(a.monsters.length).toBe(b.monsters.length);
    for (let i = 0; i < a.monsters.length; i++) {
      expect(a.monsters[i]!.kind).toBe(b.monsters[i]!.kind);
      expect(a.monsters[i]!.pos).toEqual(b.monsters[i]!.pos);
    }
  });
});

describe("makeInitialPlayer", () => {
  it("places the player at the floor's entrance", () => {
    const streams = freshStreams();
    const floor = generateFloor(1, streams);
    const player = makeInitialPlayer(floor);
    expect(player.pos).toEqual({
      y: floor.entrance.y,
      x: floor.entrance.x,
    });
  });

  it("starts with id=0, hp=hpMax, kind='player'", () => {
    const streams = freshStreams();
    const floor = generateFloor(1, streams);
    const player = makeInitialPlayer(floor);
    expect(player.id).toBe(0);
    expect(player.hp).toBe(player.hpMax);
    expect(player.kind).toBe("player");
  });
});

describe("makeInitialRunState + applyFloorEntry", () => {
  it("makeInitialRunState sets outcome=running, actionLogLength=0, no pending entry", () => {
    const streams = freshStreams();
    const floor = generateFloor(1, streams);
    const fs = spawnFloorEntities(1, floor, streams);
    const state = makeInitialRunState(TEST_INPUTS, floor, fs);
    expect(state.outcome).toBe("running");
    expect(state.actionLogLength).toBe(0);
    expect(state.__pendingFloorEntry).toBe(false);
    expect(state.floorN).toBe(1);
    expect(state.stateHash.length).toBe(32);
  });

  it("applyFloorEntry replaces floorState and clears pending flag", () => {
    const streams = freshStreams();
    const floor1 = generateFloor(1, streams);
    const fs1 = spawnFloorEntities(1, floor1, streams);
    const state0 = {
      ...makeInitialRunState(TEST_INPUTS, floor1, fs1),
      floorN: 2,
      __pendingFloorEntry: true,
    };
    const floor2 = generateFloor(2, streams);
    const fs2 = spawnFloorEntities(2, floor2, streams);
    const state1 = applyFloorEntry(state0, floor2, fs2);
    expect(state1.__pendingFloorEntry).toBe(false);
    expect(state1.floorState.floor).toBe(floor2);
    expect(state1.player.pos).toEqual({
      y: floor2.entrance.y,
      x: floor2.entrance.x,
    });
  });
});
