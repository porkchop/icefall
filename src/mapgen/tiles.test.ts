import { describe, expect, it } from "vitest";
import {
  TILE_VOID,
  TILE_FLOOR,
  TILE_WALL,
  TILE_DOOR,
  isWalkable,
  TILE_CODE_MIN,
  TILE_CODE_MAX,
} from "./tiles";

describe("tile codes (frozen contract 1)", () => {
  it("pins the four tile codes to their frozen integer values", () => {
    expect(TILE_VOID).toBe(0);
    expect(TILE_FLOOR).toBe(1);
    expect(TILE_WALL).toBe(2);
    expect(TILE_DOOR).toBe(3);
  });

  it("reserves codes 4..255 for additive expansion", () => {
    expect(TILE_CODE_MIN).toBe(0);
    expect(TILE_CODE_MAX).toBe(255);
  });

  it("isWalkable treats floor and door as walkable, wall and void as blocking", () => {
    expect(isWalkable(TILE_FLOOR)).toBe(true);
    expect(isWalkable(TILE_DOOR)).toBe(true);
    expect(isWalkable(TILE_WALL)).toBe(false);
    expect(isWalkable(TILE_VOID)).toBe(false);
  });

  it("isWalkable rejects unknown tile codes (additive future codes default to blocking)", () => {
    expect(isWalkable(4)).toBe(false);
    expect(isWalkable(255)).toBe(false);
  });
});
