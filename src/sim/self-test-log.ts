/**
 * Phase 3 self-test inputs and 100-action scripted log. Pinned by the
 * `SIM_DIGEST` golden constant in `src/core/self-test.ts` — any change
 * here is a `rulesetVersion` bump.
 *
 * The action log is intentionally long enough (100 actions) to exercise
 * monster encounters, BFS pathing, and counter-attack rolls. It does
 * not script a descent — Phase 3.A.2's primary digest pin is the
 * *floor-1* state hash. A separate descent test exercises the
 * floor-entry __consumed delta.
 */

import type { Action } from "../core/encode";
import type { FingerprintInputs } from "../core/fingerprint";
import {
  ACTION_TYPE_ATTACK,
  ACTION_TYPE_MOVE,
  ACTION_TYPE_WAIT,
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
} from "./params";

export const SELF_TEST_INPUTS: FingerprintInputs = Object.freeze({
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed: "phase3-self-test",
  modIds: Object.freeze([]) as readonly string[],
});

const dirs = [DIR_N, DIR_E, DIR_S, DIR_W] as const;

function makeLog(): readonly Action[] {
  const out: Action[] = [];
  for (let i = 0; i < 100; i++) {
    const k = i % 7;
    if (k === 0) {
      out.push({ type: ACTION_TYPE_WAIT });
    } else if (k === 6) {
      out.push({ type: ACTION_TYPE_ATTACK, dir: dirs[i % 4]! });
    } else {
      out.push({ type: ACTION_TYPE_MOVE, dir: dirs[i % 4]! });
    }
  }
  return Object.freeze(out);
}

export const SELF_TEST_LOG_100: readonly Action[] = makeLog();
