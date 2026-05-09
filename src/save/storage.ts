import type { FingerprintInputs } from "../core/fingerprint";

/**
 * Phase 8 localStorage save layer. Per
 * `artifacts/decision-memo-phase-8.md` decision 8 + addendum B6.
 *
 * **Two-layer design:** the API below is pure(-ish) — it operates on
 * a `StorageLike` interface (a subset of `Storage`) so the layer can
 * be tested in Node without a real `localStorage`. The browser-runtime
 * call site (`src/main.ts`) passes `window.localStorage` at the
 * boundary.
 *
 * **Schema v1** (memo decision 8):
 *
 * ```ts
 * type SaveSlot = {
 *   schemaVersion: 1;
 *   fingerprintShort: string;     // 22-char form (the slot key suffix)
 *   fingerprintFull: string;      // 43-char form (verifier convenience)
 *   inputs: FingerprintInputs;
 *   actionLog: string;            // base64url wire form
 *   logLength: number;
 *   outcome: "running" | "dead" | "won";
 *   floorN: number;
 *   hpRemaining: number;
 *   stateHashHex: string;
 *   savedAt: string;              // ISO-8601 UTC at save time
 * };
 * ```
 *
 * **Resume algorithm** (memo addendum B6):
 *   1. Compute fingerprintShort under CURRENT BUILD.
 *   2. Lookup `localStorage[SAVE_KEY_PREFIX + fingerprintShort]`.
 *   3. If present + integrity-passes → silent resume.
 *   4. If absent → enumerate ALL slots, surface stale-release slots
 *      (same seed, different commitHash) for the "Open in pinned
 *      release?" UI link. The integrity-check-fails path NEVER
 *      deletes a build-mismatched slot.
 */

export const SAVE_KEY_PREFIX = "icefall:save:v1:";
export const SAVE_INTERVAL_ACTIONS = 10;
export const SAVE_SCHEMA_VERSION = 1;

export type SaveSlotOutcome = "running" | "dead" | "won";

export type SaveSlot = {
  readonly schemaVersion: 1;
  readonly fingerprintShort: string;
  readonly fingerprintFull: string;
  readonly inputs: FingerprintInputs;
  readonly actionLog: string;
  readonly logLength: number;
  readonly outcome: SaveSlotOutcome;
  readonly floorN: number;
  readonly hpRemaining: number;
  readonly stateHashHex: string;
  readonly savedAt: string;
};

/**
 * Subset of the `Storage` interface used by this layer. The browser
 * side passes `window.localStorage`; tests pass a mock.
 */
export type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export class QuotaExceededError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "QuotaExceededError";
    this.retryable = retryable;
  }
}

/**
 * Build the storage key for a given fingerprint short.
 */
export function saveKey(fingerprintShort: string): string {
  return SAVE_KEY_PREFIX + fingerprintShort;
}

/**
 * Read a save slot by fingerprint short. Returns `null` if the slot
 * does not exist OR if the JSON parse fails (a corrupted slot is
 * treated as absent — Phase 9 polish may add a recovery UX).
 */
export function readSlot(
  storage: StorageLike,
  fingerprintShort: string,
): SaveSlot | null {
  const raw = storage.getItem(saveKey(fingerprintShort));
  if (raw === null) return null;
  return parseSlotJson(raw);
}

function parseSlotJson(raw: string): SaveSlot | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (
      typeof obj !== "object" ||
      obj === null ||
      Array.isArray(obj) ||
      (obj as { schemaVersion?: unknown }).schemaVersion !== SAVE_SCHEMA_VERSION
    ) {
      return null;
    }
    // Trust shape minimally — JSON.parse already validated structure;
    // a corrupt field surfaces as a runtime error in the consumer.
    return obj as SaveSlot;
  } catch {
    return null;
  }
}

/**
 * Enumerate every save slot in storage. Returns slots in insertion
 * order (which is implementation-defined for `localStorage`, but
 * deterministic per browser session).
 *
 * Used by the multi-slot UI (memo decision 15 + addendum B6) and by
 * the stale-release-slot detection path.
 */
export function listSlots(storage: StorageLike): readonly SaveSlot[] {
  const slots: SaveSlot[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k === null) continue;
    if (!k.startsWith(SAVE_KEY_PREFIX)) continue;
    const raw = storage.getItem(k);
    if (raw === null) continue;
    const slot = parseSlotJson(raw);
    if (slot !== null) slots.push(slot);
  }
  return slots;
}

/**
 * Find slots whose `inputs.seed` matches `parsedSeed` AND whose
 * `inputs.commitHash` does NOT match the current build. These are
 * stale-release slots (memo addendum B6) — surface them in the
 * "Open in pinned release?" UI without deleting them.
 */
export function findStaleReleaseSlots(
  storage: StorageLike,
  parsedSeed: string,
  currentBuildCommitHash: string,
): readonly SaveSlot[] {
  return listSlots(storage).filter(
    (slot) =>
      slot.inputs.seed === parsedSeed &&
      slot.inputs.commitHash !== currentBuildCommitHash,
  );
}

/**
 * Write a save slot. Throws `QuotaExceededError` (retryable=true)
 * on first quota-exceeded; the caller may evict-oldest then retry.
 * Subsequent retries with `retryable=false` indicate a hard failure
 * the UI should surface.
 */
export function writeSlot(
  storage: StorageLike,
  slot: SaveSlot,
): void {
  const json = JSON.stringify(slot);
  try {
    storage.setItem(saveKey(slot.fingerprintShort), json);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (
      err?.name === "QuotaExceededError" ||
      err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err?.message?.toLowerCase().includes("quota")
    ) {
      throw new QuotaExceededError(
        `save: localStorage quota exceeded writing slot ${slot.fingerprintShort}`,
        true,
      );
    }
    throw new Error(
      `save: localStorage write failed: ${err?.message ?? String(e)}`,
    );
  }
}

/**
 * Evict the N oldest save slots (by `savedAt` ascending). Returns
 * the count of slots actually removed (may be less than N if
 * fewer slots exist).
 *
 * Used by the quota-exceeded retry path (memo decision 8). NEVER
 * evicts build-mismatched slots that match the current seed —
 * those are preserved indefinitely per addendum B6 (the user can
 * always recover via `releases/<savedCommit>/`).
 */
export function evictOldestSlots(
  storage: StorageLike,
  count: number,
  protectSeedForCurrentBuild: { seed: string; currentBuildCommitHash: string } | null,
): number {
  const slots = listSlots(storage);
  const sorted = [...slots].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  let evicted = 0;
  for (const slot of sorted) {
    if (evicted >= count) break;
    if (
      protectSeedForCurrentBuild !== null &&
      slot.inputs.seed === protectSeedForCurrentBuild.seed &&
      slot.inputs.commitHash !== protectSeedForCurrentBuild.currentBuildCommitHash
    ) {
      // Stale-release slot for the current seed — preserve.
      continue;
    }
    storage.removeItem(saveKey(slot.fingerprintShort));
    evicted++;
  }
  return evicted;
}
