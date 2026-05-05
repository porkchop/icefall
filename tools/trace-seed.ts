/**
 * Phase 7.A.2b probe: trace what the walker does on floor 10 for a
 * specific seed. Prints intermediate state to understand failure mode.
 */

import type { FingerprintInputs } from "../src/core/fingerprint";
import { buildWinLog } from "./build-win-log";
import { runScripted } from "../src/sim/harness";

const seed = process.env.SEED ?? "alpha-807";
const inputs: FingerprintInputs = {
  commitHash: "dev0000",
  rulesetVersion: "phase1-placeholder-do-not-share",
  seed,
  modIds: [],
};

const { actions } = buildWinLog(inputs);
console.log(`seed=${seed} actions=${actions.length}`);

// Replay and snapshot at key milestones.
const result = runScripted({ inputs, actions });
const final = result.finalState;
console.log(`outcome=${result.outcome} floor=${final.floorN} hp=${final.player.hp}/${final.player.hpMax}`);
console.log(`player.pos=(${final.player.pos.x},${final.player.pos.y})`);
console.log(`bossArena=${JSON.stringify(final.floorState.floor.bossArena)}`);
const boss = final.floorState.monsters.find((m) => m.kind === "monster.boss.black-ice-v0");
if (boss) {
  console.log(`boss.pos=(${boss.pos.x},${boss.pos.y}) hp=${boss.hp}/${boss.hpMax} aiState=${boss.aiState}`);
}
console.log(`equipped weapon=${final.player.equipment.weapon} cyberware=${final.player.equipment.cyberware}`);
const inv = final.player.inventory.map((e) => `${e.kind}x${e.count}`).join(",");
console.log(`inventory=${inv}`);

// Count action types in the log.
const counts: Record<string, number> = {};
for (const a of actions) {
  counts[a.type] = (counts[a.type] ?? 0) + 1;
}
console.log(`action counts: ${JSON.stringify(counts)}`);

// Last 50 actions
console.log("--- last 30 actions ---");
for (let i = Math.max(0, actions.length - 30); i < actions.length; i++) {
  const a = actions[i]!;
  console.log(`  ${i}: ${JSON.stringify(a)}`);
}
