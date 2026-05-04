/**
 * Phase 6.A.2 inventory UI tests.
 *
 * Per the Phase 5 frozen contract — UI is a read-only sink on
 * `RunState`. The inventory UI shows a stack count header + one row
 * per `InventoryEntry`.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { renderInventory } from "../../src/ui/inventory";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS } from "../../src/sim/self-test-log";
import type { RunState, InventoryEntry } from "../../src/sim/types";
import { installFakeDocument, restoreDocument } from "./fake-dom";

let initialState: RunState;
beforeAll(() => {
  installFakeDocument();
});
afterAll(() => {
  restoreDocument();
});
beforeEach(() => {
  initialState = runScripted({
    inputs: SELF_TEST_INPUTS,
    actions: [],
  }).finalState;
});

describe("renderInventory — initial empty state", () => {
  it("renders a count header showing zero stacks", () => {
    const host = document.createElement("div");
    renderInventory(host, initialState);
    const text = host.textContent ?? "";
    expect(text).toContain("0 stacks");
  });

  it("creates the count and list field elements", () => {
    const host = document.createElement("div");
    renderInventory(host, initialState);
    expect(
      host.querySelector("[data-ui-field='inventory-count']"),
    ).not.toBeNull();
    expect(
      host.querySelector("[data-ui-field='inventory-list']"),
    ).not.toBeNull();
  });
});

describe("renderInventory — populated state", () => {
  it("shows one row per entry with kind and count", () => {
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 3 },
      { kind: "item.weapon.knife", count: 1 },
    ];
    const state: RunState = {
      ...initialState,
      player: { ...initialState.player, inventory },
    };
    const host = document.createElement("div");
    renderInventory(host, state);
    const text = host.textContent ?? "";
    expect(text).toContain("item.cred-chip");
    expect(text).toContain("×3");
    expect(text).toContain("item.weapon.knife");
    expect(text).toContain("×1");
    // 2 stacks header
    expect(text).toContain("2 stacks");
    // Total items = 4
    expect(text).toContain("4 items");
  });

  it("uses singular nouns when only one stack/item is present", () => {
    const inventory: InventoryEntry[] = [
      { kind: "item.eddies", count: 1 },
    ];
    const state: RunState = {
      ...initialState,
      player: { ...initialState.player, inventory },
    };
    const host = document.createElement("div");
    renderInventory(host, state);
    const text = host.textContent ?? "";
    expect(text).toContain("1 stack ");
    expect(text).toContain("1 item");
  });
});

describe("renderInventory — idempotence", () => {
  it("re-rendering with the same state keeps the host structure stable", () => {
    const inventory: InventoryEntry[] = [
      { kind: "item.cred-chip", count: 2 },
    ];
    const state: RunState = {
      ...initialState,
      player: { ...initialState.player, inventory },
    };
    const host = document.createElement("div");
    renderInventory(host, state);
    const childCountAfter = host.children.length;
    renderInventory(host, state);
    renderInventory(host, state);
    expect(host.children.length).toBe(childCountAfter);
  });
});

describe("renderInventory — read-only on RunState", () => {
  it("does not mutate the supplied state's inventory", () => {
    const inventory: readonly InventoryEntry[] = Object.freeze([
      Object.freeze({ kind: "item.cred-chip" as const, count: 5 }),
    ]);
    const state: RunState = {
      ...initialState,
      player: { ...initialState.player, inventory },
    };
    const before = JSON.stringify(state.player.inventory);
    const host = document.createElement("div");
    renderInventory(host, state);
    const after = JSON.stringify(state.player.inventory);
    expect(after).toBe(before);
  });
});
