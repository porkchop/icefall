/**
 * Phase 6.A.2 inventory-helper unit tests. Verifies the deterministic
 * sort discipline (kind ASC, tie-break count DESC) and pure-function
 * contract (input arrays not mutated; outputs are fresh frozen arrays).
 */

import { describe, expect, it } from "vitest";
import {
  inventoryAdd,
  inventoryRemove,
  inventoryCount,
} from "../../src/sim/inventory";
import type { InventoryEntry } from "../../src/sim/types";

describe("inventoryAdd", () => {
  it("inserts a new kind into an empty inventory", () => {
    const out = inventoryAdd([], "item.cred-chip");
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe("item.cred-chip");
    expect(out[0]!.count).toBe(1);
  });

  it("increments count when the kind already exists", () => {
    const initial: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 2 },
    ];
    const out = inventoryAdd(initial, "item.cred-chip");
    expect(out.length).toBe(1);
    expect(out[0]!.count).toBe(3);
  });

  it("supports adding a count > 1 in a single call", () => {
    const out = inventoryAdd([], "item.eddies", 5);
    expect(out[0]!.count).toBe(5);
  });

  it("maintains sort by kind ASC after insertion", () => {
    let inv: readonly InventoryEntry[] = [];
    inv = inventoryAdd(inv, "item.weapon.knife");
    inv = inventoryAdd(inv, "item.cred-chip");
    inv = inventoryAdd(inv, "item.stim-patch");
    const ids = inv.map((e) => e.kind);
    expect(ids).toEqual(ids.slice().sort());
  });

  it("does not mutate the input array", () => {
    const initial: readonly InventoryEntry[] = Object.freeze([
      Object.freeze({ kind: "item.cred-chip" as const, count: 1 }),
    ]);
    const before = JSON.stringify(initial);
    inventoryAdd(initial, "item.eddies");
    expect(JSON.stringify(initial)).toBe(before);
  });

  it("rejects non-positive integer counts", () => {
    expect(() => inventoryAdd([], "item.cred-chip", 0)).toThrowError(
      /positive integer/,
    );
    expect(() => inventoryAdd([], "item.cred-chip", -1)).toThrowError(
      /positive integer/,
    );
    expect(() => inventoryAdd([], "item.cred-chip", 1.5)).toThrowError(
      /positive integer/,
    );
  });
});

describe("inventoryRemove", () => {
  it("decrements count when more than 1 is held", () => {
    const initial: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 3 },
    ];
    const out = inventoryRemove(initial, "item.cred-chip");
    expect(out.length).toBe(1);
    expect(out[0]!.count).toBe(2);
  });

  it("removes the entry entirely when count goes to zero (no zero-count slots)", () => {
    const initial: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 1 },
    ];
    const out = inventoryRemove(initial, "item.cred-chip");
    expect(out.length).toBe(0);
  });

  it("returns the input unchanged when the kind is not present", () => {
    const initial: readonly InventoryEntry[] = Object.freeze([
      Object.freeze({ kind: "item.cred-chip" as const, count: 1 }),
    ]);
    const out = inventoryRemove(initial, "item.eddies");
    expect(out).toBe(initial);
  });

  it("returns the input unchanged when removing more than is held", () => {
    const initial: readonly InventoryEntry[] = Object.freeze([
      Object.freeze({ kind: "item.cred-chip" as const, count: 1 }),
    ]);
    const out = inventoryRemove(initial, "item.cred-chip", 5);
    expect(out).toBe(initial);
  });

  it("preserves sort after removal", () => {
    let inv: readonly InventoryEntry[] = [];
    inv = inventoryAdd(inv, "item.weapon.knife");
    inv = inventoryAdd(inv, "item.cred-chip");
    inv = inventoryAdd(inv, "item.stim-patch");
    inv = inventoryRemove(inv, "item.cred-chip");
    const ids = inv.map((e) => e.kind);
    expect(ids).toEqual(ids.slice().sort());
  });
});

describe("inventoryCount", () => {
  it("returns 0 for missing kinds", () => {
    expect(inventoryCount([], "item.cred-chip")).toBe(0);
  });

  it("returns the actual count for present kinds", () => {
    const inv: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 3 },
      { kind: "item.eddies", count: 5 },
    ];
    expect(inventoryCount(inv, "item.cred-chip")).toBe(3);
    expect(inventoryCount(inv, "item.eddies")).toBe(5);
  });
});
