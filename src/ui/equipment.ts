/**
 * Phase 6.A.2 equipment UI — `renderEquipment(host, state)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - Read-only sink on `RunState` — no mutation, no PRNG consumption.
 *   - Idempotent: subsequent calls update field text without
 *     re-creating DOM nodes.
 *
 * Displayed: one row per `EquipmentSlot` from `EQUIPMENT_SLOTS` with
 * the equipped `ItemKindId` or "(empty)" when the slot is null. The
 * iteration order is the alphabetical order pinned by
 * `EQUIPMENT_SLOTS`.
 */

import type { RunState } from "../sim/types";
import { EQUIPMENT_SLOTS } from "../sim/types";
import { getString } from "./theme/strings";

/**
 * Idempotently render the equipment section into `host`. Each slot is
 * a `<div class="equipment-slot">` row keyed by `data-equipment-slot`.
 */
export function renderEquipment(host: HTMLElement, state: RunState): void {
  // Static skeleton — built once.
  const initialized =
    host.querySelector(
      `[data-equipment-slot='${EQUIPMENT_SLOTS[0]}']`,
    ) !== null;
  if (!initialized) {
    host.innerHTML = "";
    host.classList.add("equipment");
    const heading = document.createElement("h3");
    heading.className = "equipment-title";
    heading.textContent = getString("equipment.heading");
    host.appendChild(heading);
    for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) {
      const slot = EQUIPMENT_SLOTS[i]!;
      const row = document.createElement("div");
      row.className = "equipment-slot";
      row.dataset["equipmentSlot"] = slot;
      const label = document.createElement("span");
      label.className = "equipment-slot-label";
      label.textContent = slot;
      const value = document.createElement("span");
      value.className = "equipment-slot-value";
      value.dataset["equipmentValueFor"] = slot;
      row.appendChild(label);
      row.appendChild(value);
      host.appendChild(row);
    }
  }

  for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) {
    const slot = EQUIPMENT_SLOTS[i]!;
    const valueEl = host.querySelector<HTMLSpanElement>(
      `[data-equipment-value-for='${slot}']`,
    );
    if (valueEl !== null) {
      const equipped = state.player.equipment[slot];
      valueEl.textContent =
        equipped === null ? getString("equipment.emptySlot") : equipped;
    }
  }
}
