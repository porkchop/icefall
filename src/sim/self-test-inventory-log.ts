/**
 * Phase 6.A.2 self-test inputs and scripted inventory-action log.
 * Pinned by the `INVENTORY_DIGEST` golden constant in
 * `src/core/self-test.ts` — any change here is a `rulesetVersion`
 * bump.
 *
 * This log exercises the new Phase 6 action vocabulary
 * (`pickup/drop/equip/unequip/use`) so the per-tick item-effect roll
 * domains are walked. The test assertion is a state-hash digest after
 * the log completes.
 *
 * The fixed seed `phase6-self-test-inventory` is chosen so floor 1's
 * entrance has at least one floor-loot tile reachable in a few moves
 * for this seed; the log uses synthesized state for branches that
 * depend on encountering specific items. The harness/tick paths still
 * resolve from genesis byte-for-byte deterministically.
 */

import type { Action } from "../core/encode";
import type { FingerprintInputs } from "../core/fingerprint";
import {
  ACTION_TYPE_DROP,
  ACTION_TYPE_EQUIP,
  ACTION_TYPE_PICKUP,
  ACTION_TYPE_UNEQUIP,
  ACTION_TYPE_USE,
  ACTION_TYPE_WAIT,
} from "./params";

export const SELF_TEST_INVENTORY_INPUTS: FingerprintInputs = Object.freeze({
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase6-self-test-inventory",
  modIds: Object.freeze([]) as readonly string[],
});

/**
 * A 16-action scripted log that walks every new Phase 6 action type
 * at least once. Most actions resolve as no-ops on the genesis state
 * (no item to pick up, nothing to drop / equip / unequip / use), but
 * each `tick` call still advances the state-hash chain — so the
 * digest pin captures the action-encoding bytes in the chain even
 * when the world-state side effects are no-ops.
 *
 * The test in `tests/sim/inventory-replay.test.ts` does the
 * heavy-lifting validation that inventory state is fully
 * reconstructible from the action log alone.
 */
export const SELF_TEST_INVENTORY_LOG: readonly Action[] = Object.freeze([
  { type: ACTION_TYPE_PICKUP },
  { type: ACTION_TYPE_WAIT },
  { type: ACTION_TYPE_DROP, item: "item.cred-chip" },
  { type: ACTION_TYPE_PICKUP },
  { type: ACTION_TYPE_EQUIP, item: "item.weapon.knife" },
  { type: ACTION_TYPE_UNEQUIP, item: "item.weapon.knife" },
  { type: ACTION_TYPE_USE, item: "item.consumable.syringe" },
  { type: ACTION_TYPE_WAIT },
  { type: ACTION_TYPE_PICKUP },
  { type: ACTION_TYPE_EQUIP, item: "item.cyber.armor" },
  { type: ACTION_TYPE_UNEQUIP, item: "item.cyber.armor" },
  { type: ACTION_TYPE_DROP, item: "item.weapon.shotgun" },
  { type: ACTION_TYPE_USE, item: "item.consumable.med-injector" },
  { type: ACTION_TYPE_PICKUP },
  { type: ACTION_TYPE_WAIT },
  { type: ACTION_TYPE_USE, item: "item.consumable.nano-repair" },
]);
