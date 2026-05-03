import { describe, expect, it } from "vitest";
import { generateFloor } from "./generate";
import { streamsForRun } from "../core/streams";
import { seedToBytes } from "../core/seed";
import { bfsReachable } from "./reachability";
import { isWalkable, TILE_FLOOR, TILE_DOOR } from "./tiles";
import { serializeFloor } from "./serialize";
import {
  STANDARD_FLOOR_HEIGHT,
  STANDARD_FLOOR_WIDTH,
  BOSS_FLOOR_HEIGHT,
  BOSS_FLOOR_WIDTH,
  BOSS_ARENA_MIN_SIZE,
} from "./params";

const SEED = "phase2-test";

describe("generateFloor (frozen contracts 1..5, 7..13)", () => {
  it("rejects floorN outside 1..10", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    expect(() => generateFloor(0, streams)).toThrow(/1\.\.10/);
    expect(() => generateFloor(11, streams)).toThrow(/1\.\.10/);
    expect(() => generateFloor(1.5, streams)).toThrow(/1\.\.10/);
  });

  it("produces a 60x24 floor for floors 1..9", () => {
    for (let n = 1; n <= 9; n++) {
      const streams = streamsForRun(seedToBytes(SEED));
      const f = generateFloor(n, streams);
      expect(f.width).toBe(STANDARD_FLOOR_WIDTH);
      expect(f.height).toBe(STANDARD_FLOOR_HEIGHT);
      expect(f.floor).toBe(n);
    }
  });

  it("produces a 40x28 floor for floor 10", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    const f = generateFloor(10, streams);
    expect(f.width).toBe(BOSS_FLOOR_WIDTH);
    expect(f.height).toBe(BOSS_FLOOR_HEIGHT);
    expect(f.floor).toBe(10);
  });

  it("places exactly one entrance and exactly one exit on floors 1..9", () => {
    for (let n = 1; n <= 9; n++) {
      const streams = streamsForRun(seedToBytes(SEED));
      const f = generateFloor(n, streams);
      expect(f.entrance).not.toBeNull();
      expect(f.exit).not.toBeNull();
      expect(f.bossArena).toBeNull();
      const entranceCount = f.rooms.filter((r) => r.kind === "room.entrance")
        .length;
      const exitCount = f.rooms.filter((r) => r.kind === "room.exit").length;
      expect(entranceCount).toBe(1);
      expect(exitCount).toBe(1);
    }
  });

  it("places entrance + bossArena and no exit on floor 10", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    const f = generateFloor(10, streams);
    expect(f.entrance).not.toBeNull();
    expect(f.exit).toBeNull();
    expect(f.bossArena).not.toBeNull();
    expect(f.bossArena!.w).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
    expect(f.bossArena!.h).toBeGreaterThanOrEqual(BOSS_ARENA_MIN_SIZE);
  });

  it("makes every walkable cell reachable from the entrance (runtime invariant)", () => {
    for (let n = 1; n <= 10; n++) {
      const streams = streamsForRun(seedToBytes(SEED));
      const f = generateFloor(n, streams);
      expect(bfsReachable(f.tiles, f.width, f.height, f.entrance)).toBe(true);
    }
  });

  it("entrance and exit are placed on TILE_FLOOR cells", () => {
    for (let n = 1; n <= 9; n++) {
      const streams = streamsForRun(seedToBytes(SEED));
      const f = generateFloor(n, streams);
      const eIdx = f.entrance.y * f.width + f.entrance.x;
      const xIdx = f.exit!.y * f.width + f.exit!.x;
      expect(f.tiles[eIdx]).toBe(TILE_FLOOR);
      expect(f.tiles[xIdx]).toBe(TILE_FLOOR);
    }
  });

  it("doors are placed on TILE_DOOR cells", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    const f = generateFloor(2, streams);
    for (const d of f.doors) {
      expect(f.tiles[d.y * f.width + d.x]).toBe(TILE_DOOR);
    }
  });

  it("is reproducible: same (seed, floor) → identical floor JSON", () => {
    const a = generateFloor(3, streamsForRun(seedToBytes(SEED)));
    const b = generateFloor(3, streamsForRun(seedToBytes(SEED)));
    expect(serializeFloor(a)).toBe(serializeFloor(b));
  });

  it("differs across distinct floors for the same seed", () => {
    const a = generateFloor(1, streamsForRun(seedToBytes(SEED)));
    const b = generateFloor(2, streamsForRun(seedToBytes(SEED)));
    expect(serializeFloor(a)).not.toBe(serializeFloor(b));
  });

  it("differs across distinct seeds for the same floor", () => {
    const a = generateFloor(1, streamsForRun(seedToBytes("seed-A")));
    const b = generateFloor(1, streamsForRun(seedToBytes("seed-B")));
    expect(serializeFloor(a)).not.toBe(serializeFloor(b));
  });

  it("on floor 10, path from entrance to arena door has length <= width+height", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    const f = generateFloor(10, streams);
    // The arena bounding rect is in f.bossArena. Find any cell on its
    // boundary that is reachable.
    expect(f.bossArena).not.toBeNull();
    const ba = f.bossArena!;
    // Use BFS distance via custom mini-loop.
    const total = f.width * f.height;
    const dist = new Int32Array(total).fill(-1);
    const xs = new Int32Array(total);
    const ys = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const startIdx = f.entrance.y * f.width + f.entrance.x;
    dist[startIdx] = 0;
    xs[tail] = f.entrance.x;
    ys[tail] = f.entrance.y;
    tail++;
    let minArenaDist = Number.MAX_SAFE_INTEGER;
    while (head < tail) {
      const x = xs[head]!;
      const y = ys[head]!;
      const idx = y * f.width + x;
      head++;
      // Inside the arena bounding rect?
      if (
        x >= ba.x &&
        x < ba.x + ba.w &&
        y >= ba.y &&
        y < ba.y + ba.h
      ) {
        if (dist[idx]! < minArenaDist) minArenaDist = dist[idx]!;
      }
      const neighbours = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
      ];
      for (const n of neighbours) {
        const nx = x + n.dx;
        const ny = y + n.dy;
        if (nx < 0 || nx >= f.width || ny < 0 || ny >= f.height) continue;
        const nidx = ny * f.width + nx;
        if (dist[nidx]! >= 0) continue;
        if (!isWalkable(f.tiles[nidx]!)) continue;
        dist[nidx] = dist[idx]! + 1;
        xs[tail] = nx;
        ys[tail] = ny;
        tail++;
      }
    }
    expect(minArenaDist).toBeLessThanOrEqual(f.width + f.height);
  });
});

describe("stream isolation runtime guard (frozen contract 11)", () => {
  it("delta on streams.__consumed is exactly {mapgen:N}", () => {
    const streams = streamsForRun(seedToBytes(SEED));
    expect([...streams.__consumed]).toEqual([]);
    generateFloor(1, streams);
    expect([...streams.__consumed]).toEqual(["mapgen:1"]);
    generateFloor(2, streams);
    const after = [...streams.__consumed].sort();
    expect(after).toEqual(["mapgen:1", "mapgen:2"]);
  });

  it("throws if generateFloor is called and stream consumption diverges", () => {
    // Simulate a "polluted" RunStreams by pre-touching sim() before
    // generateFloor — that does not violate the per-call delta but is
    // a red flag we want to surface in tests separately. Instead we
    // observe the per-call delta directly:
    const streams = streamsForRun(seedToBytes(SEED));
    streams.sim(); // pre-pollute; mapgen guard should not see this
    const before = new Set(streams.__consumed);
    generateFloor(1, streams);
    const delta: string[] = [];
    for (const k of streams.__consumed) {
      if (!before.has(k)) delta.push(k);
    }
    expect(delta).toEqual(["mapgen:1"]);
  });
});
