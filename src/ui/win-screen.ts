/**
 * Phase 7.A.2 win-screen UI — `renderWinScreen(host, state)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - Read-only sink on `RunState` — no mutation, no PRNG consumption.
 *   - Idempotent rendering: subsequent calls reuse the existing DOM
 *     skeleton; field text is updated in place.
 *
 * Activation rule (Phase 7 frozen contract): the host element renders
 * a celebratory message + the run's shareable fingerprint when
 * `state.outcome === "won"`. The caller (`src/main.ts`) is responsible
 * for showing/hiding the host element based on the same condition.
 */

import type { RunState } from "../sim/types";
import { fingerprint } from "../core/fingerprint";
import { getString } from "./theme/strings";

const WIN_MESSAGE_FIELD = "win-message";
const WIN_FINGERPRINT_FIELD = "win-fingerprint";
const WIN_FLOOR_FIELD = "win-floor";
const WIN_HP_FIELD = "win-hp";

/**
 * Idempotently render the win-screen section into `host`. Builds the
 * skeleton on first call; updates field text in place on subsequent
 * calls. Always renders something — the caller hides the host
 * element when `state.outcome !== "won"`.
 */
export function renderWinScreen(host: HTMLElement, state: RunState): void {
  let messageEl = host.querySelector<HTMLDivElement>(
    `[data-ui-field='${WIN_MESSAGE_FIELD}']`,
  );
  let fingerprintEl = host.querySelector<HTMLDivElement>(
    `[data-ui-field='${WIN_FINGERPRINT_FIELD}']`,
  );
  let floorEl = host.querySelector<HTMLDivElement>(
    `[data-ui-field='${WIN_FLOOR_FIELD}']`,
  );
  let hpEl = host.querySelector<HTMLDivElement>(
    `[data-ui-field='${WIN_HP_FIELD}']`,
  );
  if (
    messageEl === null ||
    fingerprintEl === null ||
    floorEl === null ||
    hpEl === null
  ) {
    host.innerHTML = "";
    host.classList.add("win-screen");
    const heading = document.createElement("h2");
    heading.className = "win-screen-title";
    heading.textContent = getString("winScreen.heading");
    host.appendChild(heading);

    messageEl = document.createElement("div");
    messageEl.className = "win-screen-message";
    messageEl.dataset["uiField"] = WIN_MESSAGE_FIELD;
    host.appendChild(messageEl);

    const fingerprintRow = document.createElement("div");
    fingerprintRow.className = "win-screen-row";
    const fingerprintLabel = document.createElement("span");
    fingerprintLabel.className = "win-screen-label";
    fingerprintLabel.textContent = getString("winScreen.fingerprintLabel");
    fingerprintEl = document.createElement("div");
    fingerprintEl.className = "win-screen-value win-screen-fingerprint";
    fingerprintEl.dataset["uiField"] = WIN_FINGERPRINT_FIELD;
    fingerprintRow.appendChild(fingerprintLabel);
    fingerprintRow.appendChild(fingerprintEl);
    host.appendChild(fingerprintRow);

    const floorRow = document.createElement("div");
    floorRow.className = "win-screen-row";
    const floorLabel = document.createElement("span");
    floorLabel.className = "win-screen-label";
    floorLabel.textContent = getString("winScreen.floorLabel");
    floorEl = document.createElement("div");
    floorEl.className = "win-screen-value";
    floorEl.dataset["uiField"] = WIN_FLOOR_FIELD;
    floorRow.appendChild(floorLabel);
    floorRow.appendChild(floorEl);
    host.appendChild(floorRow);

    const hpRow = document.createElement("div");
    hpRow.className = "win-screen-row";
    const hpLabel = document.createElement("span");
    hpLabel.className = "win-screen-label";
    hpLabel.textContent = getString("winScreen.hpLabel");
    hpEl = document.createElement("div");
    hpEl.className = "win-screen-value";
    hpEl.dataset["uiField"] = WIN_HP_FIELD;
    hpRow.appendChild(hpLabel);
    hpRow.appendChild(hpEl);
    host.appendChild(hpRow);
  }

  if (state.outcome === "won") {
    messageEl.textContent = getString("winScreen.wonMessage");
  } else {
    // The host element is hidden by `src/main.ts` when outcome is not
    // "won"; we still update the message so the DOM reflects the
    // current state on a subsequent render.
    messageEl.textContent = getString("winScreen.notWonMessage");
  }
  fingerprintEl.textContent = fingerprint(state.fingerprintInputs);
  floorEl.textContent = String(state.floorN);
  hpEl.textContent = `${state.player.hp}/${state.player.hpMax}`;
}
