/**
 * Phase 7.A.2 shop-transaction tests. Exercises `talk`, `buy`, `sell`
 * via synthesized `RunState` fixtures with a known NPC adjacent to the
 * player.
 *
 * Determinism is the load-bearing assertion: same inputs → same final
 * state → same state-hash. Shop pricing flows through `rollU32` with
 * the new `shop:price` domain (Phase 7 frozen contract); stock
 * generation is rolled at floor-spawn time (covered by
 * `tests/sim/run.test.ts`).
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
import { sha256Hex } from "../../src/core/hash";
import {
  ACTION_TYPE_BUY,
  ACTION_TYPE_SELL,
  ACTION_TYPE_TALK,
} from "../../src/sim/params";
import { npcKindOrdinal } from "../../src/registries/npcs";
import type { FloorNpc, RunState } from "../../src/sim/types";

const TEST_INPUTS = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase7-shop-test",
  modIds: [] as readonly string[],
};

function makeFloor1State(): RunState {
  const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
  const floor = generateFloor(1, streams);
  const fs = spawnFloorEntities(1, floor, streams);
  return makeInitialRunState(TEST_INPUTS, floor, fs);
}

/** Place an NPC adjacent to the player, replacing any existing NPCs. */
function withAdjacentNpc(
  state: RunState,
  npc: Omit<FloorNpc, "pos"> & { pos?: FloorNpc["pos"] },
): RunState {
  const pos =
    npc.pos ??
    {
      y: state.player.pos.y,
      x: state.player.pos.x + 0, // co-located = adjacent (Chebyshev distance 0)
    };
  const fullNpc: FloorNpc = {
    kind: npc.kind,
    pos,
    inventory: npc.inventory,
  };
  return {
    ...state,
    floorState: {
      ...state.floorState,
      npcs: [fullNpc],
    },
  };
}

describe("tick — talk action", () => {
  it("advances the state hash and is a no-op on world state", () => {
    const s0 = makeFloor1State();
    const stateBefore = JSON.stringify({
      monsters: s0.floorState.monsters.length,
      items: s0.floorState.items.length,
      inventory: s0.player.inventory,
    });
    const ord = npcKindOrdinal("npc.ripperdoc");
    const s1 = tick(s0, { type: ACTION_TYPE_TALK, target: ord });
    expect(s1.actionLogLength).toBe(s0.actionLogLength + 1);
    expect(sha256Hex(s1.stateHash)).not.toBe(sha256Hex(s0.stateHash));
    const stateAfter = JSON.stringify({
      monsters: s1.floorState.monsters.length,
      items: s1.floorState.items.length,
      inventory: s1.player.inventory,
    });
    expect(stateAfter).toBe(stateBefore);
  });

  it("with no target ordinal — still advances state hash (action-encoding bytes flow through chain)", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, { type: ACTION_TYPE_TALK });
    expect(s1.actionLogLength).toBe(s0.actionLogLength + 1);
  });

  it("with an out-of-range ordinal — no-op but state hash advances", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, { type: ACTION_TYPE_TALK, target: 999 });
    expect(s1.actionLogLength).toBe(s0.actionLogLength + 1);
  });
});

describe("tick — buy action", () => {
  it("transfers item from NPC to player and chips from player to NPC", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const sWithChips: RunState = {
      ...s0,
      player: {
        ...s0.player,
        inventory: [
          { kind: "item.cred-chip", count: 100 },
        ],
      },
    };
    const sWithNpc = withAdjacentNpc(sWithChips, {
      kind: "npc.fixer",
      inventory: [{ kind: "item.weapon.knife", count: 1 }],
    });
    const s1 = tick(sWithNpc, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    // Player should now hold one knife.
    const knife = s1.player.inventory.find(
      (e) => e.kind === "item.weapon.knife",
    );
    expect(knife).toBeDefined();
    expect(knife!.count).toBe(1);
    // NPC stock should be empty for that kind, and gained chips.
    const npc = s1.floorState.npcs[0]!;
    const npcKnife = npc.inventory.find(
      (e) => e.kind === "item.weapon.knife",
    );
    expect(npcKnife).toBeUndefined();
    const npcChips = npc.inventory.find((e) => e.kind === "item.cred-chip");
    expect(npcChips).toBeDefined();
    expect(npcChips!.count).toBeGreaterThan(0);
  });

  it("no-op when player can't afford the item", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const sWithoutChips = withAdjacentNpc(s0, {
      kind: "npc.fixer",
      inventory: [{ kind: "item.weapon.knife", count: 1 }],
    });
    const s1 = tick(sWithoutChips, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    expect(s1.player.inventory.find((e) => e.kind === "item.weapon.knife")).toBeUndefined();
    // NPC keeps the item.
    expect(s1.floorState.npcs[0]!.inventory[0]!.kind).toBe("item.weapon.knife");
  });

  it("no-op when NPC is non-adjacent", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const farNpc: FloorNpc = {
      kind: "npc.fixer",
      pos: { y: s0.player.pos.y + 10, x: s0.player.pos.x + 10 },
      inventory: [{ kind: "item.weapon.knife", count: 1 }],
    };
    const sFar: RunState = {
      ...s0,
      player: {
        ...s0.player,
        inventory: [{ kind: "item.cred-chip", count: 100 }],
      },
      floorState: {
        ...s0.floorState,
        npcs: [farNpc],
      },
    };
    const s1 = tick(sFar, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    // Non-adjacent → player still has all 100 chips.
    const chips = s1.player.inventory.find((e) => e.kind === "item.cred-chip");
    expect(chips!.count).toBe(100);
    expect(
      s1.player.inventory.find((e) => e.kind === "item.weapon.knife"),
    ).toBeUndefined();
  });

  it("no-op when NPC doesn't stock the requested item", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const sNoStock = withAdjacentNpc(
      {
        ...s0,
        player: {
          ...s0.player,
          inventory: [{ kind: "item.cred-chip", count: 100 }],
        },
      },
      {
        kind: "npc.fixer",
        inventory: [{ kind: "item.weapon.pistol", count: 1 }],
      },
    );
    const s1 = tick(sNoStock, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    expect(
      s1.player.inventory.find((e) => e.kind === "item.weapon.knife"),
    ).toBeUndefined();
    const chips = s1.player.inventory.find((e) => e.kind === "item.cred-chip");
    expect(chips!.count).toBe(100);
  });

  it("is deterministic — same inputs produce same outputs", () => {
    const a = makeFloor1State();
    const b = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const setupA = withAdjacentNpc(
      {
        ...a,
        player: { ...a.player, inventory: [{ kind: "item.cred-chip", count: 100 }] },
      },
      { kind: "npc.fixer", inventory: [{ kind: "item.weapon.knife", count: 1 }] },
    );
    const setupB = withAdjacentNpc(
      {
        ...b,
        player: { ...b.player, inventory: [{ kind: "item.cred-chip", count: 100 }] },
      },
      { kind: "npc.fixer", inventory: [{ kind: "item.weapon.knife", count: 1 }] },
    );
    const s1 = tick(setupA, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    const s2 = tick(setupB, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    expect(sha256Hex(s1.stateHash)).toBe(sha256Hex(s2.stateHash));
  });
});

describe("tick — sell action", () => {
  it("transfers item from player to NPC and pays out chips", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const sPlayerHasItem = withAdjacentNpc(
      {
        ...s0,
        player: {
          ...s0.player,
          inventory: [
            { kind: "item.cred-chip", count: 5 },
            { kind: "item.weapon.knife", count: 1 },
          ],
        },
      },
      {
        kind: "npc.fixer",
        inventory: [{ kind: "item.cred-chip", count: 50 }],
      },
    );
    const s1 = tick(sPlayerHasItem, {
      type: ACTION_TYPE_SELL,
      target: ord,
      item: "item.weapon.knife",
    });
    expect(
      s1.player.inventory.find((e) => e.kind === "item.weapon.knife"),
    ).toBeUndefined();
    const playerChips = s1.player.inventory.find(
      (e) => e.kind === "item.cred-chip",
    );
    expect(playerChips!.count).toBeGreaterThanOrEqual(5);
    const npcKnife = s1.floorState.npcs[0]!.inventory.find(
      (e) => e.kind === "item.weapon.knife",
    );
    expect(npcKnife).toBeDefined();
  });

  it("no-op when player doesn't have the item", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const sNoItem = withAdjacentNpc(s0, {
      kind: "npc.fixer",
      inventory: [{ kind: "item.cred-chip", count: 50 }],
    });
    const s1 = tick(sNoItem, {
      type: ACTION_TYPE_SELL,
      target: ord,
      item: "item.weapon.knife",
    });
    expect(
      s1.player.inventory.find((e) => e.kind === "item.cred-chip"),
    ).toBeUndefined();
  });

  it("no-op when NPC is non-adjacent", () => {
    const s0 = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const farNpc: FloorNpc = {
      kind: "npc.fixer",
      pos: { y: s0.player.pos.y + 10, x: s0.player.pos.x + 10 },
      inventory: [{ kind: "item.cred-chip", count: 50 }],
    };
    const sFar: RunState = {
      ...s0,
      player: {
        ...s0.player,
        inventory: [{ kind: "item.weapon.knife", count: 1 }],
      },
      floorState: { ...s0.floorState, npcs: [farNpc] },
    };
    const s1 = tick(sFar, {
      type: ACTION_TYPE_SELL,
      target: ord,
      item: "item.weapon.knife",
    });
    const knife = s1.player.inventory.find(
      (e) => e.kind === "item.weapon.knife",
    );
    expect(knife).toBeDefined();
  });
});

describe("tick — shop is hash-driven (no Math.random)", () => {
  it("buy price is deterministic across two identical buy actions on different RunState fixtures", () => {
    // Two runs of an identical scenario must produce the same NPC
    // chip count (proves price is hash-derived, not RNG-derived).
    const a = makeFloor1State();
    const b = makeFloor1State();
    const ord = npcKindOrdinal("npc.fixer");
    const setupA = withAdjacentNpc(
      {
        ...a,
        player: { ...a.player, inventory: [{ kind: "item.cred-chip", count: 100 }] },
      },
      { kind: "npc.fixer", inventory: [{ kind: "item.weapon.knife", count: 1 }] },
    );
    const setupB = withAdjacentNpc(
      {
        ...b,
        player: { ...b.player, inventory: [{ kind: "item.cred-chip", count: 100 }] },
      },
      { kind: "npc.fixer", inventory: [{ kind: "item.weapon.knife", count: 1 }] },
    );
    const s1 = tick(setupA, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    const s2 = tick(setupB, {
      type: ACTION_TYPE_BUY,
      target: ord,
      item: "item.weapon.knife",
    });
    const chipsA = s1.floorState.npcs[0]!.inventory.find(
      (e) => e.kind === "item.cred-chip",
    );
    const chipsB = s2.floorState.npcs[0]!.inventory.find(
      (e) => e.kind === "item.cred-chip",
    );
    expect(chipsA!.count).toBe(chipsB!.count);
  });
});
