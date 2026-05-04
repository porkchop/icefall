/**
 * Phase 6.A.2 inventory-from-log reconstruction invariant test.
 *
 * Per `docs/PHASES.md:428` (Phase 6.A.2 acceptance criterion 2):
 *
 *   "Inventory state is fully reconstructible from the action log
 *    alone — no inventory state is persisted separately. Asserted by
 *    a new test that runs a scripted action log, captures the final
 *    inventory, replays the same log from genesis, and asserts
 *    byte-identical inventory."
 *
 * Pinned by the Phase 6 frozen contract (`docs/ARCHITECTURE.md`
 * "Phase 6 frozen contracts" → "Inventory-from-log reconstruction
 * invariant"): SPEC.md principle 2 says "action log is the save."
 * Phase 8 will exercise this further when fingerprint-based replay
 * lands; this test pins the property at the Phase 6 boundary.
 */

import { describe, expect, it } from "vitest";
import { runScripted } from "../../src/sim/harness";
import {
  SELF_TEST_INVENTORY_INPUTS,
  SELF_TEST_INVENTORY_LOG,
} from "../../src/sim/self-test-inventory-log";
import {
  ACTION_TYPE_EQUIP,
  ACTION_TYPE_PICKUP,
  ACTION_TYPE_UNEQUIP,
  ACTION_TYPE_USE,
  ACTION_TYPE_WAIT,
} from "../../src/sim/params";
import { sha256Hex } from "../../src/core/hash";
import type { Action } from "../../src/core/encode";

describe("inventory-from-log reconstruction (Phase 6.A.2 acceptance criterion 2)", () => {
  it("replaying the same log twice yields byte-identical inventory + equipment", () => {
    const a = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG,
    });
    const b = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG,
    });

    // Inventory must be a JSON-equivalent structure (the runtime
    // freezes the array so reference identity is not asserted —
    // structural identity is the contract).
    expect(JSON.stringify(a.finalState.player.inventory)).toBe(
      JSON.stringify(b.finalState.player.inventory),
    );
    expect(JSON.stringify(a.finalState.player.equipment)).toBe(
      JSON.stringify(b.finalState.player.equipment),
    );
  });

  it("the final state-hash matches between two independent replays", () => {
    const a = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG,
    });
    const b = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG,
    });
    expect(sha256Hex(a.finalState.stateHash)).toBe(
      sha256Hex(b.finalState.stateHash),
    );
  });

  it("any prefix of the log replays to the same inventory state at that step", () => {
    const full = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG,
    });
    const prefix = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions: SELF_TEST_INVENTORY_LOG.slice(0, 8),
    });
    expect(prefix.perStepHashes[7]).toBe(full.perStepHashes[7]);
  });

  it("a log that performs pickup→equip→use builds the expected final inventory + equipment", () => {
    // Synthesize a log with placeholder items that does NOT depend on
    // floor-1 having an item at the entrance — instead we assert
    // structural properties that rely on the action log being the
    // single source of truth. The replay invariant is the load-bearing
    // assertion; this test is a sanity-check on the operational
    // semantics.
    const actions: readonly Action[] = [
      // Pickup with no item present: no-op, but tick advances.
      { type: ACTION_TYPE_PICKUP },
      // Equip a weapon that isn't in inventory: no-op.
      { type: ACTION_TYPE_EQUIP, item: "item.weapon.knife" },
      // Unequip same: no-op.
      { type: ACTION_TYPE_UNEQUIP, item: "item.weapon.knife" },
      // Use a consumable that isn't in inventory: no-op.
      { type: ACTION_TYPE_USE, item: "item.consumable.syringe" },
      // A few waits to advance the chain.
      { type: ACTION_TYPE_WAIT },
      { type: ACTION_TYPE_WAIT },
    ];
    const r = runScripted({
      inputs: SELF_TEST_INVENTORY_INPUTS,
      actions,
    });
    // Inventory should still be empty (all the inventory-touching
    // actions were no-ops).
    expect(r.finalState.player.inventory.length).toBe(0);
    expect(r.finalState.player.equipment.weapon).toBeNull();
    expect(r.finalState.player.equipment.cyberware).toBeNull();
  });
});
