import { describe, expect, it } from "vitest";
import { generateFloor } from "./generate";
import { streamPrng, streamsForRun } from "../core/streams";
import { seedToBytes } from "../core/seed";
import { bfsReachable } from "./reachability";

/**
 * 200-seed property reachability sweep (memo addendum N4).
 *
 * The 200 seed strings are drawn deterministically from a fixed root
 * seed via `streamPrng(rootSeed, "test:reach")` so the test itself is
 * itself reproducible. For each seed, we generate floors 1..10 and
 * assert reachability holds. Total: 2,000 floors per test run.
 *
 * Budget: <= 5 seconds in `npm run test`.
 */

const ROOT_PROPERTY = new Uint8Array([
  // 32-byte fixed root for the property sweep. Distinct from any
  // production seed so the sweep cannot collide with a fixture's
  // golden output.
  0x70, 0x72, 0x6f, 0x70, 0x65, 0x72, 0x74, 0x79,
  0x73, 0x77, 0x65, 0x65, 0x70, 0x72, 0x6f, 0x6f,
  0x74, 0x32, 0x30, 0x32, 0x36, 0x70, 0x68, 0x32,
  0x61, 0x73, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x21,
]);

const SEED_COUNT = 200;
const FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

describe("200-seed property reachability sweep (memo addendum N4)", () => {
  it("every (seed, floor) pair yields a fully-reachable floor", () => {
    const seedDraw = streamPrng(ROOT_PROPERTY, "test:reach");
    const seedStrings: string[] = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      // Each seed string is a 12-hex-char render of three u32 draws.
      const a = seedDraw();
      const b = seedDraw();
      const c = seedDraw();
      seedStrings.push(
        a.toString(16).padStart(8, "0") +
          b.toString(16).padStart(8, "0") +
          c.toString(16).padStart(8, "0"),
      );
    }

    let checked = 0;
    for (const seed of seedStrings) {
      const rootBytes = seedToBytes(seed);
      for (const floorN of FLOORS) {
        const streams = streamsForRun(rootBytes);
        const f = generateFloor(floorN, streams);
        const ok = bfsReachable(f.tiles, f.width, f.height, f.entrance);
        if (!ok) {
          throw new Error(
            `property sweep failed: seed="${seed}" floor=${floorN}`,
          );
        }
        checked++;
      }
    }
    expect(checked).toBe(SEED_COUNT * FLOORS.length);
  });
});
