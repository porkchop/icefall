/**
 * Phase 7.A.2 win-screen UI tests. The win-screen is a read-only sink
 * on `RunState` that activates when `state.outcome === "won"`.
 *
 * Read-only discipline mirrors the Phase 6 inventory + equipment tests.
 * Idempotency is asserted: a second `renderWinScreen` call on the same
 * host updates field text in place without re-creating DOM nodes.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { renderWinScreen } from "../../src/ui/win-screen";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS } from "../../src/sim/self-test-log";
import type { RunState } from "../../src/sim/types";
import { installFakeDocument, restoreDocument } from "./fake-dom";

let baseState: RunState;
beforeAll(() => {
  installFakeDocument();
});
afterAll(() => {
  restoreDocument();
});
beforeEach(() => {
  baseState = runScripted({
    inputs: SELF_TEST_INPUTS,
    actions: [],
  }).finalState;
});

describe("renderWinScreen — pre-victory state", () => {
  it("renders the skeleton without crashing when outcome is 'running'", () => {
    const host = document.createElement("div");
    renderWinScreen(host, baseState);
    const text = host.textContent ?? "";
    expect(text).toContain("Run Complete");
    expect(text).toContain("Run not yet complete.");
  });

  it("renders the player's fingerprint regardless of outcome (read-only sink)", () => {
    const host = document.createElement("div");
    renderWinScreen(host, baseState);
    const fp = host.querySelector("[data-ui-field='win-fingerprint']");
    expect(fp).not.toBeNull();
    expect((fp!.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("renders the final floor + final HP", () => {
    const host = document.createElement("div");
    renderWinScreen(host, baseState);
    const floor = host.querySelector("[data-ui-field='win-floor']");
    const hp = host.querySelector("[data-ui-field='win-hp']");
    expect(floor).not.toBeNull();
    expect(hp).not.toBeNull();
    expect(floor!.textContent).toBe(String(baseState.floorN));
    expect(hp!.textContent).toBe(`${baseState.player.hp}/${baseState.player.hpMax}`);
  });
});

describe("renderWinScreen — won state", () => {
  it("shows the victory message when state.outcome === 'won'", () => {
    const host = document.createElement("div");
    const wonState: RunState = { ...baseState, outcome: "won" };
    renderWinScreen(host, wonState);
    const message = host.querySelector("[data-ui-field='win-message']");
    expect(message).not.toBeNull();
    expect(message!.textContent).toContain("defeated the floor-10 boss");
  });
});

describe("renderWinScreen — idempotency", () => {
  it("re-rendering on the same host does not duplicate DOM nodes", () => {
    const host = document.createElement("div");
    renderWinScreen(host, baseState);
    const childrenAfterFirst = host.children.length;
    renderWinScreen(host, baseState);
    expect(host.children.length).toBe(childrenAfterFirst);
  });

  it("re-rendering with a 'won' state updates the message in place", () => {
    const host = document.createElement("div");
    renderWinScreen(host, baseState);
    const messageEl = host.querySelector("[data-ui-field='win-message']");
    expect(messageEl).not.toBeNull();
    const beforeText = messageEl!.textContent;
    const wonState: RunState = { ...baseState, outcome: "won" };
    renderWinScreen(host, wonState);
    expect(messageEl!.textContent).not.toBe(beforeText);
    expect(messageEl!.textContent).toContain("defeated");
  });
});
