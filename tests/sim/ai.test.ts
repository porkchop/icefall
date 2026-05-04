import { describe, expect, it } from "vitest";
import {
  bfsDistanceMapFromPlayer,
  decideMonsterAction,
  dirOrdinalForStep,
  AI_UNREACHABLE_SENTINEL,
} from "../../src/sim/ai";
import {
  DIR_DELTAS,
  DIR_E,
  DIR_N,
  DIR_NE,
  DIR_NW,
  DIR_S,
  DIR_SE,
  DIR_SW,
  DIR_W,
  MAX_LOS_RADIUS,
} from "../../src/sim/params";
import { TILE_FLOOR, TILE_WALL } from "../../src/mapgen/tiles";
import type { Floor } from "../../src/mapgen/types";
import type { Monster } from "../../src/sim/types";

function makeOpenFloor(width: number, height: number): Floor {
  const tiles = new Uint8Array(width * height);
  tiles.fill(TILE_FLOOR);
  return {
    floor: 1,
    width,
    height,
    tiles,
    rooms: [],
    doors: [],
    encounters: [],
    entrance: { x: 0, y: 0 },
    exit: { x: width - 1, y: height - 1 },
    bossArena: null,
  };
}

function placeWall(f: Floor, y: number, x: number): void {
  // Mutating Uint8Array is fine; Floor is `readonly` at the field level
  // but the underlying buffer is a typed array reference.
  f.tiles[y * f.width + x] = TILE_WALL;
}

describe("DIR_DELTAS — frozen direction ordinals (addendum N4)", () => {
  it("has 8 entries in N, E, S, W, NE, SE, SW, NW order", () => {
    expect(DIR_DELTAS).toHaveLength(8);
    expect(DIR_DELTAS[DIR_N]).toEqual({ dy: -1, dx: 0 });
    expect(DIR_DELTAS[DIR_E]).toEqual({ dy: 0, dx: 1 });
    expect(DIR_DELTAS[DIR_S]).toEqual({ dy: 1, dx: 0 });
    expect(DIR_DELTAS[DIR_W]).toEqual({ dy: 0, dx: -1 });
    expect(DIR_DELTAS[DIR_NE]).toEqual({ dy: -1, dx: 1 });
    expect(DIR_DELTAS[DIR_SE]).toEqual({ dy: 1, dx: 1 });
    expect(DIR_DELTAS[DIR_SW]).toEqual({ dy: 1, dx: -1 });
    expect(DIR_DELTAS[DIR_NW]).toEqual({ dy: -1, dx: -1 });
  });

  it("y-axis increases southward (frozen-contract assertion)", () => {
    expect(DIR_DELTAS[DIR_S]!.dy).toBeGreaterThan(0);
    expect(DIR_DELTAS[DIR_N]!.dy).toBeLessThan(0);
  });
});

describe("AI_UNREACHABLE_SENTINEL — integer sentinel (addendum N5)", () => {
  it("is exactly MAX_LOS_RADIUS + 1 (integer-only)", () => {
    expect(AI_UNREACHABLE_SENTINEL).toBe(MAX_LOS_RADIUS + 1);
    expect(Number.isInteger(AI_UNREACHABLE_SENTINEL)).toBe(true);
  });

  it("MAX_LOS_RADIUS is pinned to 8", () => {
    expect(MAX_LOS_RADIUS).toBe(8);
  });
});

describe("bfsDistanceMapFromPlayer", () => {
  it("returns 0 at the player's position", () => {
    const f = makeOpenFloor(10, 10);
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, []);
    expect(map[5 * 10 + 5]).toBe(0);
  });

  it("computes 8-connected step counts (diagonal = 1 step)", () => {
    const f = makeOpenFloor(10, 10);
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, []);
    expect(map[4 * 10 + 5]).toBe(1); // N
    expect(map[5 * 10 + 6]).toBe(1); // E
    expect(map[4 * 10 + 6]).toBe(1); // NE (diagonal = 1)
    expect(map[3 * 10 + 6]).toBe(2); // 2 NE steps
  });

  it("caps at MAX_LOS_RADIUS — cells beyond return UNREACHABLE", () => {
    const f = makeOpenFloor(20, 20);
    const map = bfsDistanceMapFromPlayer(f, { y: 0, x: 0 }, []);
    // Manhattan distance 20 = ~10 chebyshev steps, which is > MAX_LOS_RADIUS = 8
    expect(map[19 * 20 + 19]).toBe(AI_UNREACHABLE_SENTINEL);
  });

  it("treats walls as non-walkable", () => {
    const f = makeOpenFloor(10, 10);
    // Wall the player off in a corner
    placeWall(f, 0, 1);
    placeWall(f, 1, 0);
    placeWall(f, 1, 1);
    const map = bfsDistanceMapFromPlayer(f, { y: 0, x: 0 }, []);
    expect(map[5 * 10 + 5]).toBe(AI_UNREACHABLE_SENTINEL);
  });

  it("does NOT block on monster cells — monster collision is enforced at move time, not BFS time", () => {
    // Phase 3 design choice: BFS produces a player-distance map for
    // every cell (including monster-occupied ones). This lets each
    // monster read its own distance without being blocked by itself
    // or its peers. The actual no-overlap-on-move constraint is
    // enforced by the turn loop's destination-occupancy check.
    const f = makeOpenFloor(5, 5);
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 1, x: 1 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 0, x: 0 }, [m]);
    expect(map[1 * 5 + 1]).toBe(1); // diagonal NE from player; reachable.
  });
});

describe("decideMonsterAction", () => {
  it("returns 'attack' when monster is adjacent (cardinal) to player", () => {
    const f = makeOpenFloor(10, 10);
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 5, x: 6 }, // 1 step east of player at (5,5)
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, [m]);
    const decision = decideMonsterAction(m, { y: 5, x: 5 }, map, f);
    expect(decision.kind).toBe("attack");
  });

  it("returns 'attack' when monster is adjacent (diagonal) to player", () => {
    const f = makeOpenFloor(10, 10);
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 6, x: 6 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, [m]);
    expect(decideMonsterAction(m, { y: 5, x: 5 }, map, f).kind).toBe("attack");
  });

  it("returns 'stay' (idle) when monster is out of LOS", () => {
    const f = makeOpenFloor(20, 20);
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 19, x: 19 }, // far from player at (0,0)
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 0, x: 0 }, [m]);
    const decision = decideMonsterAction(m, { y: 0, x: 0 }, map, f);
    expect(decision.kind).toBe("stay");
    expect(decision.newAiState).toBe("idle");
  });

  it("returns 'move' toward the player when within LOS but not adjacent", () => {
    const f = makeOpenFloor(10, 10);
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 5, x: 8 }, // 3 steps E of player
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, [m]);
    const decision = decideMonsterAction(m, { y: 5, x: 5 }, map, f);
    expect(decision.kind).toBe("move");
    expect(decision.newAiState).toBe("chasing");
    if (decision.kind === "move") {
      // Should step toward player (x decreasing).
      expect(decision.to.x).toBe(7);
      expect(decision.to.y).toBe(5);
    }
  });

  it("breaks BFS ties by direction order N, E, S, W, NE, SE, SW, NW", () => {
    const f = makeOpenFloor(10, 10);
    // Monster diagonally NE of player at distance 2.
    // Equidistant moves toward player are: SW (decreases both y and x).
    // But before SW, the monster should consider N, E, S, W first.
    // Two cells with distance 1 lead toward player from monster:
    //   - from (3, 5): going SE (to 4,6) — distance from player at (5,5) = 1
    //   - from (3, 5): going S (to 4, 5) — distance from player at (5,5) = 1
    //   - from (3, 5): going E (to 3, 6) — distance from player at (5,5) = 2 (no, this *increases* distance)
    // Actually monster at (3,5) with player at (5,5):
    //   monster's BFS distance from player = 2
    //   to step toward player, look for adjacent cells with distance 1
    //   - N(2,5): dist 3 — no
    //   - E(3,6): dist 2 — no
    //   - S(4,5): dist 1 — yes (S is direction 2)
    //   - W(3,4): dist 3 — no
    //   - SE(4,6): dist 1 — yes (SE is direction 5)
    //   - SW(4,4): dist 1 — yes (SW is direction 6)
    // So tiebreak picks S first.
    const m: Monster = {
      id: 1,
      kind: "monster.ice.daemon",
      pos: { y: 3, x: 5 },
      hp: 4,
      hpMax: 4,
      atk: 2,
      def: 0,
      aiState: "idle",
    };
    const map = bfsDistanceMapFromPlayer(f, { y: 5, x: 5 }, [m]);
    const decision = decideMonsterAction(m, { y: 5, x: 5 }, map, f);
    expect(decision.kind).toBe("move");
    if (decision.kind === "move") {
      expect(decision.to).toEqual({ y: 4, x: 5 }); // S step
    }
  });
});

describe("dirOrdinalForStep", () => {
  it("returns the direction ordinal for unit deltas", () => {
    expect(dirOrdinalForStep(-1, 0)).toBe(DIR_N);
    expect(dirOrdinalForStep(0, 1)).toBe(DIR_E);
    expect(dirOrdinalForStep(1, 0)).toBe(DIR_S);
    expect(dirOrdinalForStep(0, -1)).toBe(DIR_W);
    expect(dirOrdinalForStep(-1, 1)).toBe(DIR_NE);
    expect(dirOrdinalForStep(1, 1)).toBe(DIR_SE);
    expect(dirOrdinalForStep(1, -1)).toBe(DIR_SW);
    expect(dirOrdinalForStep(-1, -1)).toBe(DIR_NW);
  });

  it("returns -1 for non-unit deltas", () => {
    expect(dirOrdinalForStep(2, 0)).toBe(-1);
    expect(dirOrdinalForStep(0, 0)).toBe(-1);
    expect(dirOrdinalForStep(-2, -1)).toBe(-1);
  });
});
