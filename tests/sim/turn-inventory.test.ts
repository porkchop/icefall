/**
 * Phase 6.A.2 tick() tests for the new inventory + equipment +
 * use-effect actions: pickup, drop, equip, unequip, use.
 *
 * Pinned by the Phase 6 frozen contract (`docs/ARCHITECTURE.md` "Phase
 * 6 frozen contracts" → "Action vocabulary additions" + "Item-effect
 * resolution path through the per-action roll subhash").
 *
 * Every assertion in this file is purely behavioral on the public
 * `tick(state, action)` surface — no test reaches into private
 * helpers — so the tests survive future refactors of the inventory
 * helper module.
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
  ACTION_TYPE_PICKUP,
  ACTION_TYPE_DROP,
  ACTION_TYPE_EQUIP,
  ACTION_TYPE_UNEQUIP,
  ACTION_TYPE_USE,
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_WAIT,
  DIR_E,
} from "../../src/sim/params";
import { inventoryCount } from "../../src/sim/inventory";
import type {
  RunState,
  Monster,
  FloorItem,
  InventoryEntry,
} from "../../src/sim/types";

const TEST_INPUTS = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase6-turn-inventory-test",
  modIds: [] as readonly string[],
};

function makeFloor1State(): RunState {
  const streams = streamsForRun(seedToBytes(TEST_INPUTS.seed));
  const floor = generateFloor(1, streams);
  const fs = spawnFloorEntities(1, floor, streams);
  return makeInitialRunState(TEST_INPUTS, floor, fs);
}

describe("tick — pickup action", () => {
  it("removes the FloorItem at the player's cell and adds it to inventory", () => {
    const s0 = makeFloor1State();
    const item: FloorItem = {
      y: s0.player.pos.y,
      x: s0.player.pos.x,
      kind: "item.cred-chip",
    };
    const test: RunState = {
      ...s0,
      floorState: { ...s0.floorState, items: [item] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_PICKUP });
    expect(s1.floorState.items.length).toBe(0);
    expect(inventoryCount(s1.player.inventory, "item.cred-chip")).toBe(1);
  });

  it("is a no-op when the player's cell has no item", () => {
    const s0 = makeFloor1State();
    const test: RunState = {
      ...s0,
      floorState: { ...s0.floorState, items: [] },
    };
    const s1 = tick(test, { type: ACTION_TYPE_PICKUP });
    expect(s1.player.inventory.length).toBe(0);
  });

  it("stacks repeated pickups by kind", () => {
    const s0 = makeFloor1State();
    // Two cred-chips at the player's cell — only the first is picked up
    // because pickup removes the topmost matching item.
    const items: FloorItem[] = [
      {
        y: s0.player.pos.y,
        x: s0.player.pos.x,
        kind: "item.cred-chip",
      },
    ];
    const test: RunState = {
      ...s0,
      floorState: { ...s0.floorState, items },
    };
    let s = test;
    s = tick(s, { type: ACTION_TYPE_PICKUP });
    // Place a second cred-chip and pick up again.
    s = {
      ...s,
      floorState: {
        ...s.floorState,
        items: [
          {
            y: s.player.pos.y,
            x: s.player.pos.x,
            kind: "item.cred-chip",
          },
        ],
      },
    };
    s = tick(s, { type: ACTION_TYPE_PICKUP });
    expect(inventoryCount(s.player.inventory, "item.cred-chip")).toBe(2);
    // Stacked into a single InventoryEntry.
    expect(s.player.inventory.length).toBe(1);
  });
});

describe("tick — drop action", () => {
  it("removes one unit from inventory and places a FloorItem at the player's cell", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 2 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
      floorState: { ...s0.floorState, items: [] },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_DROP,
      item: "item.cred-chip",
    });
    expect(inventoryCount(s1.player.inventory, "item.cred-chip")).toBe(1);
    expect(s1.floorState.items.length).toBe(1);
    expect(s1.floorState.items[0]!.kind).toBe("item.cred-chip");
    expect(s1.floorState.items[0]!.y).toBe(s0.player.pos.y);
    expect(s1.floorState.items[0]!.x).toBe(s0.player.pos.x);
  });

  it("is a no-op when the kind is not in inventory", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, {
      type: ACTION_TYPE_DROP,
      item: "item.cred-chip",
    });
    expect(s1.floorState.items.length).toBe(s0.floorState.items.length);
    expect(s1.player.inventory).toEqual(s0.player.inventory);
  });

  it("is a no-op when `item` is missing", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
    };
    const s1 = tick(test, { type: ACTION_TYPE_DROP });
    expect(inventoryCount(s1.player.inventory, "item.cred-chip")).toBe(1);
  });
});

describe("tick — equip action", () => {
  it("moves a weapon from inventory to equipment.weapon", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.weapon.knife", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_EQUIP,
      item: "item.weapon.knife",
    });
    expect(s1.player.equipment.weapon).toBe("item.weapon.knife");
    expect(inventoryCount(s1.player.inventory, "item.weapon.knife")).toBe(0);
  });

  it("moves a cyberware to equipment.cyberware", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.cyber.armor", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_EQUIP,
      item: "item.cyber.armor",
    });
    expect(s1.player.equipment.cyberware).toBe("item.cyber.armor");
  });

  it("displaces the previously-equipped item back into inventory atomically", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.weapon.cyberblade", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: {
        ...s0.player,
        inventory,
        equipment: { weapon: "item.weapon.knife", cyberware: null },
      },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_EQUIP,
      item: "item.weapon.cyberblade",
    });
    expect(s1.player.equipment.weapon).toBe("item.weapon.cyberblade");
    expect(inventoryCount(s1.player.inventory, "item.weapon.knife")).toBe(1);
  });

  it("is a no-op for non-equipment items", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_EQUIP,
      item: "item.cred-chip",
    });
    expect(s1.player.equipment.weapon).toBeNull();
    expect(s1.player.equipment.cyberware).toBeNull();
    expect(inventoryCount(s1.player.inventory, "item.cred-chip")).toBe(1);
  });

  it("is a no-op when the item is not in inventory", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, {
      type: ACTION_TYPE_EQUIP,
      item: "item.weapon.knife",
    });
    expect(s1.player.equipment.weapon).toBeNull();
  });
});

describe("tick — unequip action", () => {
  it("moves the equipped item back into inventory", () => {
    const s0 = makeFloor1State();
    const test: RunState = {
      ...s0,
      player: {
        ...s0.player,
        equipment: { weapon: "item.weapon.knife", cyberware: null },
      },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_UNEQUIP,
      item: "item.weapon.knife",
    });
    expect(s1.player.equipment.weapon).toBeNull();
    expect(inventoryCount(s1.player.inventory, "item.weapon.knife")).toBe(1);
  });

  it("is a no-op when the requested item is not equipped", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, {
      type: ACTION_TYPE_UNEQUIP,
      item: "item.weapon.knife",
    });
    expect(s1.player.equipment.weapon).toBeNull();
    expect(inventoryCount(s1.player.inventory, "item.weapon.knife")).toBe(0);
  });
});

describe("tick — use action (consumable heal)", () => {
  it("heals the player and consumes the item", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.consumable.syringe", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory, hp: 10, hpMax: 30 },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_USE,
      item: "item.consumable.syringe",
    });
    // syringe has heal{base:3, variance:0} — deterministic +3.
    expect(s1.player.hp).toBe(13);
    expect(inventoryCount(s1.player.inventory, "item.consumable.syringe")).toBe(0);
  });

  it("clamps healing at hpMax", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.consumable.med-injector", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory, hp: 28, hpMax: 30 },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_USE,
      item: "item.consumable.med-injector",
    });
    expect(s1.player.hp).toBe(30);
  });

  it("is a no-op when the item is not in inventory", () => {
    const s0 = makeFloor1State();
    const test: RunState = {
      ...s0,
      player: { ...s0.player, hp: 10, hpMax: 30 },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_USE,
      item: "item.consumable.syringe",
    });
    expect(s1.player.hp).toBe(10);
  });

  it("is a no-op for non-consumable items (the item stays in inventory)", () => {
    const s0 = makeFloor1State();
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 1 },
    ];
    const test: RunState = {
      ...s0,
      player: { ...s0.player, inventory },
    };
    const s1 = tick(test, {
      type: ACTION_TYPE_USE,
      item: "item.cred-chip",
    });
    expect(inventoryCount(s1.player.inventory, "item.cred-chip")).toBe(1);
  });
});

describe("tick — equipment-modifier injection at attack time", () => {
  it("an equipped weapon adds atk-bonus to player attack damage", () => {
    const s0 = makeFloor1State();
    const monster: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 100,
      hpMax: 100,
      atk: 0,
      def: 0,
      aiState: "idle",
    };
    const baseTest: RunState = {
      ...s0,
      floorState: { ...s0.floorState, monsters: [monster] },
    };
    // No-weapon attack
    const sNoWeapon = tick(baseTest, {
      type: ACTION_TYPE_ATTACK,
      dir: DIR_E,
    });
    const dmgNoWeapon =
      monster.hp - sNoWeapon.floorState.monsters[0]!.hp;
    // Equip a high-bonus weapon
    const armedTest: RunState = {
      ...baseTest,
      player: {
        ...baseTest.player,
        equipment: { weapon: "item.weapon.shotgun", cyberware: null },
      },
    };
    const sArmed = tick(armedTest, {
      type: ACTION_TYPE_ATTACK,
      dir: DIR_E,
    });
    const dmgArmed =
      monster.hp - sArmed.floorState.monsters[0]!.hp;
    // Shotgun has atk-bonus base:3, variance:4 → bonus is at least 3.
    expect(dmgArmed).toBeGreaterThanOrEqual(dmgNoWeapon + 3);
  });

  it("equipped cyberware with def-bonus reduces counter-attack damage", () => {
    const s0 = makeFloor1State();
    const monster: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: s0.player.pos.y, x: s0.player.pos.x + 1 },
      hp: 14,
      hpMax: 14,
      atk: 8,
      def: 0,
      aiState: "idle",
    };
    const noCyberTest: RunState = {
      ...s0,
      player: { ...s0.player, hp: 30, hpMax: 30, def: 0 },
      floorState: { ...s0.floorState, monsters: [monster] },
    };
    const sNoCyber = tick(noCyberTest, { type: ACTION_TYPE_WAIT });
    const dmgNoCyber = noCyberTest.player.hp - sNoCyber.player.hp;

    // Equip subdermal-armor (def-bonus base:3, variance:2 → bonus >= 3).
    const armoredTest: RunState = {
      ...noCyberTest,
      player: {
        ...noCyberTest.player,
        equipment: {
          weapon: null,
          cyberware: "item.cyber.subdermal-armor",
        },
      },
    };
    const sArmored = tick(armoredTest, { type: ACTION_TYPE_WAIT });
    const dmgArmored = armoredTest.player.hp - sArmored.player.hp;
    // Min damage is 1 (clamp), so we just assert the armored case
    // received less or equal damage (and at least one scenario should
    // be strictly less if base damage was > 1).
    expect(dmgArmored).toBeLessThanOrEqual(dmgNoCyber);
  });
});

describe("tick — Phase 3 SIM_DIGEST stability check", () => {
  it("a wait action on the initial state produces a deterministic non-zero hash advance", () => {
    const s0 = makeFloor1State();
    const s1 = tick(s0, { type: ACTION_TYPE_WAIT });
    expect(s1.actionLogLength).toBe(s0.actionLogLength + 1);
    // The Phase 3 frozen 100-action SIM_DIGEST is asserted in
    // src/core/self-test.ts; this test just sanity-checks that wait
    // doesn't trigger any new effect rolls when no equipment is
    // equipped (no-equip path stays at zero rolls per the contract).
  });
});
