/**
 * Phase 7.A.2 seed probe. Tries many candidate seeds and reports
 * winners under the current `buildWinLog` strategy.
 */

import type { FingerprintInputs } from "../src/core/fingerprint";
import { buildWinLog } from "./build-win-log";
import { runScripted } from "../src/sim/harness";

// Generate a wide variety of seed strings.
const seeds: string[] = [];
const prefix = process.env.SEED_PREFIX ?? "win";
const startIdx = parseInt(process.env.SEED_START ?? "0", 10);
const count = parseInt(process.env.SEED_COUNT ?? "5000", 10);
for (let i = startIdx; i < startIdx + count; i++) {
  seeds.push(`${prefix}-${i}`);
}

const winners: { seed: string; actions: number; hp: number }[] = [];
let total = 0;
let floor10 = 0;
let bestFloor = 0;
let bestSeed = '';
for (const seed of seeds) {
  total++;
  const inputs: FingerprintInputs = {
    commitHash: "dev0000",
    rulesetVersion: "phase1-placeholder-do-not-share",
    seed,
    modIds: [],
  };
  try {
    const { actions } = buildWinLog(inputs);
    const result = runScripted({ inputs, actions });
    if (result.outcome === "won") {
      winners.push({
        seed,
        actions: actions.length,
        hp: result.finalState.player.hp,
      });
      console.log(
        `${seed}: WIN floor=${result.finalState.floorN} hp=${result.finalState.player.hp}/${result.finalState.player.hpMax} actions=${actions.length}`,
      );
    } else if (result.finalState.floorN === 10) {
      floor10++;
      const boss = result.finalState.floorState.monsters.find(
        (m) => m.kind === "monster.boss.black-ice-v0",
      );
      console.log(
        `${seed}: F10 outcome=${result.outcome} hp=${result.finalState.player.hp} bossHP=${boss?.hp ?? "?"} actions=${actions.length}`,
      );
    }
    if (result.finalState.floorN > bestFloor || (result.finalState.floorN === bestFloor && result.finalState.player.hp > 0 && result.outcome === 'won')) {
      bestFloor = result.finalState.floorN;
      bestSeed = seed;
    }
  } catch (e) {
    console.log(`${seed}: error ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log("---");
console.log(`WIN: ${winners.length}, F10 deaths: ${floor10}, total: ${total}`);
console.log(`best seed: ${bestSeed} (floor ${bestFloor})`);
if (winners.length > 0) {
  winners.sort((a, b) => (a.seed < b.seed ? -1 : a.seed > b.seed ? 1 : 0));
  console.log(`pick: ${winners[0]!.seed}`);
}
