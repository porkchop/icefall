import { describe, expect, it } from "vitest";
import * as mod from "./index";

describe("src/mapgen/index public surface", () => {
  it("exports generateFloor, serializeFloor, renderAscii", () => {
    expect(typeof mod.generateFloor).toBe("function");
    expect(typeof mod.serializeFloor).toBe("function");
    expect(typeof mod.renderAscii).toBe("function");
    expect(typeof mod.generateBossFloor).toBe("function");
    expect(typeof mod.isWalkable).toBe("function");
  });

  it("does NOT export parseFloor — addendum N6 keeps it internal", () => {
    expect("parseFloor" in mod).toBe(false);
  });

  it("re-exports the four frozen tile codes", () => {
    expect(mod.TILE_VOID).toBe(0);
    expect(mod.TILE_FLOOR).toBe(1);
    expect(mod.TILE_WALL).toBe(2);
    expect(mod.TILE_DOOR).toBe(3);
  });

  it("re-exports floor-dimension constants", () => {
    expect(mod.STANDARD_FLOOR_WIDTH).toBe(60);
    expect(mod.STANDARD_FLOOR_HEIGHT).toBe(24);
    expect(mod.BOSS_FLOOR_WIDTH).toBe(40);
    expect(mod.BOSS_FLOOR_HEIGHT).toBe(28);
  });

  it("FLOOR_SCHEMA_VERSION is 1 (frozen)", () => {
    expect(mod.FLOOR_SCHEMA_VERSION).toBe(1);
  });
});
