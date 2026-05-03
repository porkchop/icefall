/**
 * Phase 2.A CLI: print an ASCII rendering of a deterministic floor to stdout.
 *
 *   npm run gen-floor -- --seed <seedString> --floor <N>
 *
 * Build-time-only Node code. Lives under `tools/` per the layer table in
 * `docs/ARCHITECTURE.md`. Imports only `src/core` and `src/mapgen`; no
 * browser-only paths.
 */

import { generateFloor, renderAscii } from "../src/mapgen/index";
import { streamsForRun } from "../src/core/streams";
import { seedToBytes } from "../src/core/seed";

type Args = { seed: string; floor: number };

function parseArgs(argv: readonly string[]): Args {
  let seed = "";
  let floorRaw = "";
  let floorSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") {
      seed = String(argv[++i] ?? "");
    } else if (a === "--floor") {
      floorRaw = String(argv[++i] ?? "");
      floorSeen = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`gen-floor: unrecognized argument "${a}"`);
    }
  }
  if (seed === "") throw new Error("gen-floor: --seed <string> is required");
  if (!floorSeen) {
    throw new Error("gen-floor: --floor must be an integer in 1..10");
  }
  // Reject non-integer-string input (e.g. "1.5") — parseInt would silently
  // truncate it. The frozen contract requires an integer floorN.
  if (!/^-?\d+$/.test(floorRaw)) {
    throw new Error("gen-floor: --floor must be an integer in 1..10");
  }
  const floor = Number.parseInt(floorRaw, 10);
  if (!Number.isInteger(floor) || floor < 1 || floor > 10) {
    throw new Error("gen-floor: --floor must be an integer in 1..10");
  }
  return { seed, floor };
}

function printHelp(): void {
  console.log("Usage: npm run gen-floor -- --seed <seedString> --floor <1..10>");
  console.log("Prints an ASCII rendering of a deterministic floor to stdout.");
}

export function main(argv: readonly string[]): void {
  const { seed, floor } = parseArgs(argv);
  const streams = streamsForRun(seedToBytes(seed));
  const f = generateFloor(floor, streams);
  process.stdout.write(renderAscii(f));
}

// Run when invoked as the entry script via `vite-node`. Skip when
// running under vitest (which sets VITEST in env) so the test imports
// `main` directly without triggering CLI side effects.
function runIfEntry(): void {
  if (typeof process === "undefined") return;
  if (process.env["VITEST"] !== undefined) return;
  try {
    main(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exit(1);
  }
}
runIfEntry();
