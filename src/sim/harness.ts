/**
 * Phase 3 headless playthrough harness — `runScripted({ inputs,
 * actions })`. The orchestration layer that holds together
 * `tick(state, action)` (pure), `generateFloor` (Phase 2), and
 * `spawnFloorEntities` (run.ts).
 *
 * This is the **only** file in `src/sim/**` permitted to import
 * `generateFloor` from `src/mapgen/**` — a single-file ESLint
 * exception is recorded in `eslint.config.js`. The architectural
 * intent (per Phase 3 decision memo addendum B5) is that Phase 5+
 * relocates this orchestration to a dedicated `src/run/` layer
 * once the input-driven loop replaces `runScripted`. Until then,
 * the exception is the smallest viable surface.
 *
 * Frozen-contract item 9: `tick` itself does not consume any stream;
 * only the floor-entry block does, via `streams.simFloor(floorN)`.
 *
 * Returned shape (memo decision 9 + addendum N8):
 *
 *   { finalState, perStepHashes, logLength, outcome }
 *
 * `logLength` is the count of actions actually resolved (the
 * killing-blow / win action counts; trailing-after-terminal actions do
 * not — see N2/N8).
 */

import type { Action } from "../core/encode";
import type { FingerprintInputs } from "../core/fingerprint";
import { streamsForRun, type RunStreams } from "../core/streams";
import { seedToBytes } from "../core/seed";
import { sha256Hex } from "../core/hash";
// `src/sim/harness.ts` is the single file in `src/sim/**` permitted
// to import `generateFloor` from the mapgen public surface — recorded
// as a one-file ESLint `ignores` exception in `eslint.config.js` per
// Phase 3 decision memo addendum B5.
import { generateFloor } from "../mapgen/index";
import {
  applyFloorEntry,
  makeInitialRunState,
  spawnFloorEntities,
} from "./run";
import { tick } from "./turn";
import type { RunOutcome, RunState } from "./types";

export type RunScriptedArgs = {
  readonly inputs: FingerprintInputs;
  readonly actions: readonly Action[];
};

export type RunScriptedResult = {
  readonly finalState: RunState;
  readonly perStepHashes: readonly string[];
  readonly logLength: number;
  readonly outcome: RunOutcome;
};

/**
 * Construct the initial `RunState` for a run, performing the floor-1
 * entry block (`generateFloor(1) + spawnFloorEntities(1)`).
 *
 * Exposed separately so the diagnostic page can build a state without
 * driving an action loop, and so unit tests can assert the entry
 * block's `__consumed` delta in isolation.
 */
export function buildInitialRunState(
  inputs: FingerprintInputs,
  streams: RunStreams,
): RunState {
  const floor1 = generateFloor(1, streams);
  const floor1State = spawnFloorEntities(1, floor1, streams);
  return makeInitialRunState(inputs, floor1, floor1State);
}

/**
 * Run a scripted action log. Pure function over `inputs` and `actions`.
 * The stream-isolation invariants are asserted at call boundaries via
 * the `__consumed` set on the freshly-allocated `RunStreams`.
 */
export function runScripted(args: RunScriptedArgs): RunScriptedResult {
  const rootSeed = seedToBytes(args.inputs.seed);
  const streams = streamsForRun(rootSeed);

  let state = buildInitialRunState(args.inputs, streams);
  const perStepHashes: string[] = [];

  let logLength = 0;
  for (let i = 0; i < args.actions.length; i++) {
    if (state.outcome !== "running") break;

    if (state.__pendingFloorEntry) {
      // The previous tick set the pending flag on a successful descend.
      // Run the floor-entry block before processing the next action.
      const newFloor = generateFloor(state.floorN, streams);
      const newFloorState = spawnFloorEntities(
        state.floorN,
        newFloor,
        streams,
      );
      state = applyFloorEntry(state, newFloorState);
    }

    const action = args.actions[i]!;
    state = tick(state, action);
    perStepHashes.push(sha256Hex(state.stateHash));
    logLength++;
  }

  // If the very last tick set __pendingFloorEntry but no further actions
  // remain, leave the flag set — it has no observable effect on the
  // returned hash.

  return {
    finalState: state,
    perStepHashes,
    logLength,
    outcome: state.outcome,
  };
}
