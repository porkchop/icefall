/**
 * Phase 6.A.2 inventory + equipment helpers. Pure functions over the
 * `InventoryEntry[]` and `Equipment` shapes from `src/sim/types.ts`.
 *
 * Phase 6 frozen contract (`docs/ARCHITECTURE.md` "Phase 6 frozen
 * contracts" — "Inventory data shape — deterministic ordering"):
 *
 *   Iteration order is sorted by `kind` ascending (UTF-16 code-unit
 *   order on the `ItemKindId` string), tie-break by `count` descending.
 *   Same discipline as Phase 3's `monsters` (sorted by `id`) and
 *   `items` (sorted by `(y, x, kind)`).
 *
 * `count === 0` slots are removed (the array does not retain
 * zero-count entries). Capacity is unbounded in Phase 6.
 *
 * Every helper here is pure — input arrays are not mutated; outputs are
 * fresh arrays. Mirrors the discipline in `src/sim/run.ts` for
 * `floorState.items` (sorted insertion at construction time, read-only
 * thereafter).
 */

import type { ItemKindId } from "../registries/items";
import type { InventoryEntry } from "./types";

/**
 * UTF-16 code-unit comparison on `ItemKindId`. Mirrors `String.prototype.localeCompare`
 * with a "code-unit" sensitivity, but avoids the locale dependency: the
 * raw `<`/`>` operators on JS strings already use UTF-16 code-unit
 * ordering, which is what the frozen contract pins.
 */
function compareKindAsc(a: ItemKindId, b: ItemKindId): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare two inventory entries by the contract order: kind ASC,
 * tie-break by count DESC. The tie-break only fires for two entries
 * with the same kind, which is normally not possible (the
 * `inventoryAdd` helper merges duplicate kinds), but is asserted here
 * for defense in depth.
 */
function compareEntries(a: InventoryEntry, b: InventoryEntry): number {
  const c = compareKindAsc(a.kind, b.kind);
  if (c !== 0) return c;
  // Tie on kind: count DESC.
  if (a.count > b.count) return -1;
  if (a.count < b.count) return 1;
  return 0;
}

/**
 * Insert one unit of `kind` into the inventory. If a matching entry
 * exists, increment its count; otherwise insert a fresh `{ kind,
 * count: 1 }` entry preserving sort order.
 *
 * Pure — returns a new array.
 */
export function inventoryAdd(
  inventory: readonly InventoryEntry[],
  kind: ItemKindId,
  count: number = 1,
): readonly InventoryEntry[] {
  if (count <= 0 || !Number.isInteger(count)) {
    throw new Error(
      `inventoryAdd: count must be a positive integer (got ${count})`,
    );
  }
  // Search for an existing matching kind.
  let found = -1;
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i]!.kind === kind) {
      found = i;
      break;
    }
  }
  let next: InventoryEntry[];
  if (found >= 0) {
    const existing = inventory[found]!;
    next = inventory.slice();
    next[found] = { kind: existing.kind, count: existing.count + count };
  } else {
    next = inventory.slice();
    next.push({ kind, count });
  }
  next.sort(compareEntries);
  return Object.freeze(next);
}

/**
 * Remove one unit of `kind` from the inventory. If no matching entry
 * exists or its count is zero, returns the input array unchanged
 * (no-op). If decrement brings count to zero, the entry is removed.
 *
 * Pure — returns a new array (or the input on a no-op).
 */
export function inventoryRemove(
  inventory: readonly InventoryEntry[],
  kind: ItemKindId,
  count: number = 1,
): readonly InventoryEntry[] {
  if (count <= 0 || !Number.isInteger(count)) {
    throw new Error(
      `inventoryRemove: count must be a positive integer (got ${count})`,
    );
  }
  let found = -1;
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i]!.kind === kind) {
      found = i;
      break;
    }
  }
  if (found < 0) return inventory;
  const existing = inventory[found]!;
  if (existing.count < count) return inventory;
  const next: InventoryEntry[] = inventory.slice();
  const remaining = existing.count - count;
  if (remaining === 0) {
    next.splice(found, 1);
  } else {
    next[found] = { kind: existing.kind, count: remaining };
  }
  next.sort(compareEntries);
  return Object.freeze(next);
}

/**
 * Returns the count for a given kind, or 0 if not present.
 */
export function inventoryCount(
  inventory: readonly InventoryEntry[],
  kind: ItemKindId,
): number {
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i]!.kind === kind) return inventory[i]!.count;
  }
  return 0;
}
