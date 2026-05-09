/**
 * Phase 5.A.2 HUD — `renderHud(host, state)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The HUD is a **read-only sink** on `RunState`. Same discipline as
 *     the renderer: no mutation, no PRNG consumption, no `tick()`
 *     calls.
 *   - Displayed fields: `state.player.hp`, `state.player.hpMax`,
 *     `state.floorN`, `state.outcome`, and the
 *     `fingerprint(state.fingerprintInputs)` short string.
 *   - The fingerprint widget is recomputed on each frame from the
 *     deterministic inputs; it does not cache.
 *
 * The HUD writes only to the supplied DOM host element; the host's
 * structure is rebuilt idempotently via `data-hud-field` attributes so
 * repeated renders neither leak DOM nodes nor accumulate listeners.
 */

import type { RunState } from "../sim/types";
import { fingerprint } from "../core/fingerprint";
import { getString } from "./theme/strings";

const HP_FIELD = "hp";
const FLOOR_FIELD = "floor";
const OUTCOME_FIELD = "outcome";
const FINGERPRINT_FIELD = "fingerprint";

/**
 * Idempotently render the HUD into `host`. Subsequent calls update the
 * existing field elements rather than re-creating the entire subtree —
 * keeps the DOM stable for screen readers / CSS animations and avoids
 * leaking nodes when the game loop calls `renderHud` once per turn.
 *
 * `cssClass` styling lives in the consumer (`style.css` ships the
 * matching `.hud` rules) — this module produces semantic markup with
 * stable `data-hud-field` selectors.
 */
export function renderHud(host: HTMLElement, state: RunState): void {
  // Build the static skeleton once; on subsequent renders just update
  // the value spans.
  let hpEl = host.querySelector<HTMLSpanElement>(
    `[data-hud-field='${HP_FIELD}']`,
  );
  if (hpEl === null) {
    host.innerHTML = "";
    host.classList.add("hud");
    hpEl = appendField(host, HP_FIELD, getString("hud.hpLabel"));
    appendField(host, FLOOR_FIELD, getString("hud.floorLabel"));
    appendField(host, OUTCOME_FIELD, getString("hud.outcomeLabel"));
    appendField(host, FINGERPRINT_FIELD, getString("hud.fingerprintLabel"));
  }

  const hp = `${state.player.hp}/${state.player.hpMax}`;
  setFieldValue(host, HP_FIELD, hp);
  setFieldValue(host, FLOOR_FIELD, String(state.floorN));
  setFieldValue(host, OUTCOME_FIELD, state.outcome);
  setFieldValue(host, FINGERPRINT_FIELD, fingerprint(state.fingerprintInputs));
}

function appendField(
  host: HTMLElement,
  field: string,
  label: string,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "hud-field";
  const labelEl = document.createElement("span");
  labelEl.className = "hud-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "hud-value";
  valueEl.dataset["hudField"] = field;
  wrap.appendChild(labelEl);
  wrap.appendChild(valueEl);
  host.appendChild(wrap);
  return valueEl;
}

function setFieldValue(host: HTMLElement, field: string, value: string): void {
  const el = host.querySelector<HTMLSpanElement>(
    `[data-hud-field='${field}']`,
  );
  if (el !== null) {
    el.textContent = value;
  }
}
