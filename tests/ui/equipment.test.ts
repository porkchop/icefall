/**
 * Phase 6.A.2 equipment UI tests.
 *
 * Per the Phase 5 frozen contract — UI is a read-only sink on
 * `RunState`. The equipment UI shows one row per `EquipmentSlot`.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { renderEquipment } from "../../src/ui/equipment";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS } from "../../src/sim/self-test-log";
import type { RunState } from "../../src/sim/types";
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

describe("renderEquipment — initial empty slots", () => {
  it("renders a row for each EquipmentSlot showing '(empty)'", () => {
    const host = document.createElement("div");
    renderEquipment(host, initialState);
    const text = host.textContent ?? "";
    expect(text).toContain("weapon");
    expect(text).toContain("cyberware");
    // Both empty
    const emptyMatches = text.match(/\(empty\)/g);
    expect(emptyMatches).not.toBeNull();
    expect(emptyMatches!.length).toBe(2);
  });

  it("creates labelled value spans for each slot", () => {
    const host = document.createElement("div");
    renderEquipment(host, initialState);
    expect(
      host.querySelector("[data-equipment-value-for='weapon']"),
    ).not.toBeNull();
    expect(
      host.querySelector("[data-equipment-value-for='cyberware']"),
    ).not.toBeNull();
  });
});

describe("renderEquipment — populated slots", () => {
  it("shows the equipped item ids", () => {
    const state: RunState = {
      ...initialState,
      player: {
        ...initialState.player,
        equipment: {
          weapon: "item.weapon.cyberblade",
          cyberware: "item.cyber.armor",
        },
      },
    };
    const host = document.createElement("div");
    renderEquipment(host, state);
    const text = host.textContent ?? "";
    expect(text).toContain("item.weapon.cyberblade");
    expect(text).toContain("item.cyber.armor");
  });
});

describe("renderEquipment — idempotence", () => {
  it("re-rendering with the same state preserves child count", () => {
    const host = document.createElement("div");
    renderEquipment(host, initialState);
    const after1 = host.children.length;
    renderEquipment(host, initialState);
    renderEquipment(host, initialState);
    expect(host.children.length).toBe(after1);
  });

  it("re-rendering after a state change updates the slot value text", () => {
    const host = document.createElement("div");
    renderEquipment(host, initialState);
    const updatedState: RunState = {
      ...initialState,
      player: {
        ...initialState.player,
        equipment: { weapon: "item.weapon.knife", cyberware: null },
      },
    };
    renderEquipment(host, updatedState);
    const text = host.textContent ?? "";
    expect(text).toContain("item.weapon.knife");
  });
});

describe("renderEquipment — read-only on RunState", () => {
  it("does not mutate the supplied state's equipment", () => {
    const state: RunState = {
      ...initialState,
      player: {
        ...initialState.player,
        equipment: Object.freeze({
          weapon: "item.weapon.knife",
          cyberware: null,
        }),
      },
    };
    const before = JSON.stringify(state.player.equipment);
    const host = document.createElement("div");
    renderEquipment(host, state);
    const after = JSON.stringify(state.player.equipment);
    expect(after).toBe(before);
  });
});
