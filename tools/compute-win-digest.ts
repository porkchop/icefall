/**
 * Phase 7.A.2 — compute the WIN_DIGEST golden constant by running the
 * synthesized win log against a fresh harness. One-shot helper; not
 * part of the regular build pipeline. The resulting hex string is
 * pasted literally into `src/core/self-test.ts:WIN_DIGEST`.
 */

import { buildWinLog } from "./build-win-log";
import { runScripted } from "../src/sim/harness";
import { sha256Hex } from "../src/core/hash";

const { inputs, actions } = buildWinLog();
const result = runScripted({ inputs, actions });
const finalHash = sha256Hex(result.finalState.stateHash);
console.log(`actions: ${actions.length}`);
console.log(`outcome: ${result.outcome}`);
console.log(`floor: ${result.finalState.floorN}`);
console.log(`hp: ${result.finalState.player.hp}/${result.finalState.player.hpMax}`);
console.log(`WIN_DIGEST: ${finalHash}`);
