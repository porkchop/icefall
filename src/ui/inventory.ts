/**
 * Phase 6.A.2 inventory UI — `renderInventory(host, state)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The UI layer is a **read-only sink** on `RunState`. Same
 *     discipline as the HUD: no mutation, no PRNG consumption, no
 *     `tick()` calls.
 *   - Idempotent rendering: the host element is rebuilt structurally
 *     on the first call and field values are updated in-place on
 *     subsequent calls so DOM nodes are not leaked across frames.
 *
 * The displayed surface in Phase 6.A.2 is intentionally minimal — a
 * row count header and one row per `InventoryEntry`. Phase 9 polish
 * may add icons (the atlas slot id matches the entry kind so the
 * renderer can blit the same sprite as on-floor items).
 */

import type { RunState } from "../sim/types";
import { getString } from "./theme/strings";

const INVENTORY_LIST = "inventory-list";
const INVENTORY_COUNT = "inventory-count";

/**
 * Idempotently render the inventory section into `host`. The first call
 * builds a `<div class="inventory-count">` header + a `<ul
 * class="inventory-list">` body; subsequent calls clear the list and
 * repopulate it with the current `state.player.inventory` entries.
 */
export function renderInventory(host: HTMLElement, state: RunState): void {
  let countEl = host.querySelector<HTMLDivElement>(
    `[data-ui-field='${INVENTORY_COUNT}']`,
  );
  let listEl = host.querySelector<HTMLUListElement>(
    `[data-ui-field='${INVENTORY_LIST}']`,
  );
  if (countEl === null || listEl === null) {
    host.innerHTML = "";
    host.classList.add("inventory");
    const heading = document.createElement("h3");
    heading.className = "inventory-title";
    heading.textContent = getString("inventory.heading");
    host.appendChild(heading);
    countEl = document.createElement("div");
    countEl.className = "inventory-count";
    countEl.dataset["uiField"] = INVENTORY_COUNT;
    host.appendChild(countEl);
    listEl = document.createElement("ul");
    listEl.className = "inventory-list";
    listEl.dataset["uiField"] = INVENTORY_LIST;
    host.appendChild(listEl);
  }

  const inv = state.player.inventory;
  // Sum of stacks for the header readout (each InventoryEntry has a
  // positive integer count; total items = sum of counts).
  let totalCount = 0;
  for (let i = 0; i < inv.length; i++) totalCount += inv[i]!.count;
  const stackNoun =
    inv.length === 1
      ? getString("inventory.stackNounSingular")
      : getString("inventory.stackNounPlural");
  const itemNoun =
    totalCount === 1
      ? getString("inventory.itemNounSingular")
      : getString("inventory.itemNounPlural");
  countEl.textContent = getString("inventory.countTemplate", {
    stackCount: inv.length,
    stackNoun,
    itemCount: totalCount,
    itemNoun,
  });

  // Repopulate the list. Setting innerHTML to "" is safe because every
  // child is owned by this module.
  listEl.innerHTML = "";
  for (let i = 0; i < inv.length; i++) {
    const entry = inv[i]!;
    const li = document.createElement("li");
    li.className = "inventory-row";
    li.dataset["inventoryKind"] = entry.kind;
    const kindSpan = document.createElement("span");
    kindSpan.className = "inventory-kind";
    kindSpan.textContent = entry.kind;
    const countSpan = document.createElement("span");
    countSpan.className = "inventory-row-count";
    countSpan.textContent = `×${entry.count}`;
    li.appendChild(kindSpan);
    li.appendChild(countSpan);
    listEl.appendChild(li);
  }
}
