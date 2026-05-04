/**
 * Phase 5.A.2 HUD tests.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The HUD is a read-only sink on `RunState`.
 *   - It displays `state.player.hp`, `state.player.hpMax`, `state.floorN`,
 *     `state.outcome`, and the short fingerprint.
 *   - The fingerprint widget is recomputed on each frame from the
 *     deterministic inputs; it does not cache.
 *
 * The HUD writes only to the supplied DOM host element; it never
 * mutates `RunState`.
 *
 * Vitest does not ship with `jsdom` / `happy-dom` by default in this
 * repo (no DOM dependency is in package.json). Rather than add one,
 * these tests use a minimal DOM-shape mock that supports the surface
 * the HUD touches: `createElement`, `appendChild`, `classList.add`,
 * `dataset`, `textContent`, `innerHTML`, `querySelector`. The mock is
 * deliberately tiny — adding a real DOM env is a separate dependency
 * decision out of Phase 5.A.2 scope.
 */
import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { renderHud } from "../../src/ui/hud";
import { runScripted } from "../../src/sim/harness";
import { SELF_TEST_INPUTS } from "../../src/sim/self-test-log";
import type { RunState } from "../../src/sim/types";
import { fingerprint } from "../../src/core/fingerprint";
import { installFakeDocument, restoreDocument } from "./fake-dom";

let initialState: RunState;
beforeAll(() => {
  installFakeDocument();
});
afterAll(() => {
  restoreDocument();
});
beforeEach(() => {
  initialState = runScripted({ inputs: SELF_TEST_INPUTS, actions: [] }).finalState;
});

describe("renderHud — visible fields", () => {
  it("renders HP / HP max / floor / outcome / fingerprint", () => {
    const host = document.createElement("div");
    renderHud(host, initialState);
    const text = host.textContent ?? "";
    expect(text).toContain(String(initialState.player.hp));
    expect(text).toContain(String(initialState.player.hpMax));
    expect(text).toContain(String(initialState.floorN));
    expect(text).toContain(initialState.outcome);
    const fp = fingerprint(initialState.fingerprintInputs);
    expect(text).toContain(fp);
  });

  it("creates labelled elements for HP / floor / outcome / fingerprint", () => {
    const host = document.createElement("div");
    renderHud(host, initialState);
    expect(host.querySelector("[data-hud-field='hp']")).not.toBeNull();
    expect(host.querySelector("[data-hud-field='floor']")).not.toBeNull();
    expect(host.querySelector("[data-hud-field='outcome']")).not.toBeNull();
    expect(host.querySelector("[data-hud-field='fingerprint']")).not.toBeNull();
  });
});

describe("renderHud — idempotence", () => {
  it("re-rendering with the same state keeps the same number of children", () => {
    const host = document.createElement("div");
    renderHud(host, initialState);
    const childCount = host.children.length;
    renderHud(host, initialState);
    renderHud(host, initialState);
    renderHud(host, initialState);
    expect(host.children.length).toBe(childCount);
  });

  it("re-rendering updates field text without recreating wrappers", () => {
    const host = document.createElement("div");
    renderHud(host, initialState);
    const firstHpEl = host.querySelector("[data-hud-field='hp']");
    renderHud(host, initialState);
    const secondHpEl = host.querySelector("[data-hud-field='hp']");
    expect(secondHpEl).toBe(firstHpEl);
  });
});

describe("renderHud — read-only on RunState", () => {
  it("does not mutate the supplied state", () => {
    const host = document.createElement("div");
    const before = JSON.stringify({
      hp: initialState.player.hp,
      hpMax: initialState.player.hpMax,
      floorN: initialState.floorN,
      outcome: initialState.outcome,
    });
    renderHud(host, initialState);
    const after = JSON.stringify({
      hp: initialState.player.hp,
      hpMax: initialState.player.hpMax,
      floorN: initialState.floorN,
      outcome: initialState.outcome,
    });
    expect(after).toBe(before);
  });
});

describe("renderHud — outcome reflects state changes", () => {
  it("updates the outcome field when state.outcome changes", () => {
    const host = document.createElement("div");
    renderHud(host, initialState);
    const dead: RunState = { ...initialState, outcome: "dead" };
    renderHud(host, dead);
    const text = host.textContent ?? "";
    expect(text).toContain("dead");
  });
});
