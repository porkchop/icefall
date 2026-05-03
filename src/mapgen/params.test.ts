import { describe, expect, it } from "vitest";
import {
  BSP_MIN_LEAF_WIDTH,
  BSP_MIN_LEAF_HEIGHT,
  BSP_MAX_DEPTH,
  ROOM_PADDING,
  STANDARD_FLOOR_WIDTH,
  STANDARD_FLOOR_HEIGHT,
  BOSS_FLOOR_WIDTH,
  BOSS_FLOOR_HEIGHT,
  BOSS_ARENA_MIN_SIZE,
} from "./params";

describe("mapgen params (frozen contract 5; rulesetVersion bumps on change)", () => {
  it("pins the standard floor dimensions to 60x24", () => {
    expect(STANDARD_FLOOR_WIDTH).toBe(60);
    expect(STANDARD_FLOOR_HEIGHT).toBe(24);
  });

  it("pins the boss floor dimensions to 40x28", () => {
    expect(BOSS_FLOOR_WIDTH).toBe(40);
    expect(BOSS_FLOOR_HEIGHT).toBe(28);
  });

  it("pins the BSP min-leaf-size to a positive integer larger than room padding", () => {
    expect(Number.isInteger(BSP_MIN_LEAF_WIDTH)).toBe(true);
    expect(Number.isInteger(BSP_MIN_LEAF_HEIGHT)).toBe(true);
    expect(BSP_MIN_LEAF_WIDTH).toBeGreaterThan(ROOM_PADDING * 2);
    expect(BSP_MIN_LEAF_HEIGHT).toBeGreaterThan(ROOM_PADDING * 2);
  });

  it("pins the BSP depth cap to a small positive integer", () => {
    expect(Number.isInteger(BSP_MAX_DEPTH)).toBe(true);
    expect(BSP_MAX_DEPTH).toBeGreaterThanOrEqual(2);
    expect(BSP_MAX_DEPTH).toBeLessThanOrEqual(8);
  });

  it("pins the room padding to a small positive integer", () => {
    expect(Number.isInteger(ROOM_PADDING)).toBe(true);
    expect(ROOM_PADDING).toBeGreaterThanOrEqual(1);
    expect(ROOM_PADDING).toBeLessThanOrEqual(3);
  });

  it("BOSS_ARENA_MIN_SIZE >= 16 (decision 4 acceptance criterion)", () => {
    expect(BOSS_ARENA_MIN_SIZE).toBeGreaterThanOrEqual(16);
  });
});
