import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateFloor,
  renderAscii,
  serializeFloor,
} from "../../../src/mapgen/index";
import { parseFloor } from "../../../src/mapgen/serialize";
import { streamsForRun } from "../../../src/core/streams";
import { seedToBytes } from "../../../src/core/seed";
import { TILE_FLOOR, TILE_DOOR } from "../../../src/mapgen/tiles";
import { bfsReachable } from "../../../src/mapgen/reachability";
import { BOSS_ARENA_MIN_SIZE } from "../../../src/mapgen/params";

type ManifestEntry = { seed: string; floor: number };
type Manifest = { pairs: ManifestEntry[] };

const FIXTURE_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return here;
})();
const MANIFEST: Manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8"),
) as Manifest;

function jsonPath(e: ManifestEntry): string {
  return join(FIXTURE_DIR, `${e.seed}__floor${e.floor}.json`);
}
function asciiPath(e: ManifestEntry): string {
  return join(FIXTURE_DIR, `${e.seed}__floor${e.floor}.ascii`);
}

describe("fixture pack — byte-equality (decision 11, 20 pairs)", () => {
  it("manifest contains 20 (seed, floor) pairs", () => {
    expect(MANIFEST.pairs).toHaveLength(20);
  });

  for (const entry of MANIFEST.pairs) {
    const label = `${entry.seed} floor=${entry.floor}`;
    it(`${label}: regenerated JSON matches the committed golden`, () => {
      const streams = streamsForRun(seedToBytes(entry.seed));
      const f = generateFloor(entry.floor, streams);
      const jsonNow = serializeFloor(f);
      const jsonGolden = readFileSync(jsonPath(entry), "utf8");
      expect(jsonNow).toBe(jsonGolden);
    });

    it(`${label}: regenerated ASCII matches the committed golden`, () => {
      const streams = streamsForRun(seedToBytes(entry.seed));
      const f = generateFloor(entry.floor, streams);
      const asciiNow = renderAscii(f);
      const asciiGolden = readFileSync(asciiPath(entry), "utf8");
      expect(asciiNow).toBe(asciiGolden);
    });

    it(`${label}: golden JSON parses cleanly via parseFloor`, () => {
      const golden = readFileSync(jsonPath(entry), "utf8");
      const obj = JSON.parse(golden) as unknown;
      const back = parseFloor(obj);
      expect(back.floor).toBe(entry.floor);
    });

    it(`${label}: invariants hold (entrance/exit, reachability, floor 10 boss arena)`, () => {
      const streams = streamsForRun(seedToBytes(entry.seed));
      const f = generateFloor(entry.floor, streams);
      // Entrance always present.
      expect(f.entrance).toBeDefined();
      if (entry.floor === 10) {
        expect(f.exit).toBeNull();
        expect(f.bossArena).not.toBeNull();
        expect(f.bossArena!.w).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
        expect(f.bossArena!.h).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
      } else {
        expect(f.bossArena).toBeNull();
        expect(f.exit).not.toBeNull();
      }
      // Reachability over walkable tiles (TILE_FLOOR | TILE_DOOR).
      expect(bfsReachable(f.tiles, f.width, f.height, f.entrance)).toBe(true);
      // Entrance is on a floor cell.
      expect(f.tiles[f.entrance.y * f.width + f.entrance.x]).toBe(TILE_FLOOR);
      // Doors are TILE_DOOR.
      for (const d of f.doors) {
        expect(f.tiles[d.y * f.width + d.x]).toBe(TILE_DOOR);
      }
    });
  }
});
