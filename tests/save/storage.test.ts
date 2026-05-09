import { describe, expect, it } from "vitest";
import {
  evictOldestSlots,
  findStaleReleaseSlots,
  listSlots,
  QuotaExceededError,
  readSlot,
  SAVE_KEY_PREFIX,
  type SaveSlot,
  type StorageLike,
  saveKey,
  writeSlot,
} from "../../src/save/storage";
import type { FingerprintInputs } from "../../src/core/fingerprint";

/**
 * Phase 8.A.2b tests for the localStorage save layer
 * (`src/save/storage.ts`). Per memo decision 8 + addendum B6.
 */

class MemoryStorage implements StorageLike {
  private map: Map<string, string> = new Map();
  // Track insertion order for deterministic key() iteration.
  private order: string[] = [];
  // Optional throw-on-set for quota tests.
  public throwOnSet: { name: string; message: string } | null = null;

  get length(): number {
    return this.order.length;
  }
  key(index: number): string | null {
    return this.order[index] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet !== null) {
      const err = new Error(this.throwOnSet.message);
      err.name = this.throwOnSet.name;
      throw err;
    }
    if (!this.map.has(k)) this.order.push(k);
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
    const idx = this.order.indexOf(k);
    if (idx !== -1) this.order.splice(idx, 1);
  }
}

const BUILD_A_COMMIT = "deadbeef0000";
const BUILD_B_COMMIT = "feedbeef1234";

function makeSlot(
  fingerprintShort: string,
  inputs: FingerprintInputs,
  savedAt: string,
): SaveSlot {
  return {
    schemaVersion: 1,
    fingerprintShort,
    fingerprintFull: fingerprintShort.padEnd(43, "Z"),
    inputs,
    actionLog: "",
    logLength: 0,
    outcome: "running",
    floorN: 1,
    hpRemaining: 10,
    stateHashHex: "0".repeat(64),
    savedAt,
  };
}

describe("saveKey + read/write round-trip", () => {
  it("composes the canonical save-key from the fingerprint short", () => {
    expect(saveKey("ABCDEFGHIJKLMNOPQRSTUV")).toBe(
      SAVE_KEY_PREFIX + "ABCDEFGHIJKLMNOPQRSTUV",
    );
  });

  it("round-trips a write + read for a freshly written slot", () => {
    const storage = new MemoryStorage();
    const slot = makeSlot(
      "fp-1",
      { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
      "2026-05-09T12:00:00Z",
    );
    writeSlot(storage, slot);
    expect(readSlot(storage, "fp-1")).toEqual(slot);
  });

  it("returns null for an absent slot", () => {
    expect(readSlot(new MemoryStorage(), "fp-missing")).toBeNull();
  });

  it("returns null for a corrupted JSON payload (treats as absent)", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY_PREFIX + "fp-bad", "not-json");
    expect(readSlot(storage, "fp-bad")).toBeNull();
  });

  it("returns null for a slot with mismatched schemaVersion", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY_PREFIX + "fp-2",
      JSON.stringify({ schemaVersion: 99, fingerprintShort: "fp-2" }),
    );
    expect(readSlot(storage, "fp-2")).toBeNull();
  });
});

describe("listSlots — enumerate by SAVE_KEY_PREFIX", () => {
  it("lists only slots under the SAVE_KEY_PREFIX (ignoring unrelated keys)", () => {
    const storage = new MemoryStorage();
    const slot1 = makeSlot(
      "fp-1",
      { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s1", modIds: [] },
      "2026-05-09T12:00:00Z",
    );
    const slot2 = makeSlot(
      "fp-2",
      { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s2", modIds: [] },
      "2026-05-10T12:00:00Z",
    );
    writeSlot(storage, slot1);
    writeSlot(storage, slot2);
    storage.setItem("unrelated-key", "garbage");
    const slots = listSlots(storage);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.fingerprintShort).sort()).toEqual([
      "fp-1",
      "fp-2",
    ]);
  });

  it("skips corrupted slots silently", () => {
    const storage = new MemoryStorage();
    writeSlot(
      storage,
      makeSlot(
        "fp-good",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
        "2026-05-09T12:00:00Z",
      ),
    );
    storage.setItem(SAVE_KEY_PREFIX + "fp-bad", "not-json");
    expect(listSlots(storage)).toHaveLength(1);
  });
});

describe("findStaleReleaseSlots — addendum B6", () => {
  it("finds slots whose seed matches but commitHash differs from current build", () => {
    const storage = new MemoryStorage();
    writeSlot(
      storage,
      makeSlot(
        "fp-stale",
        { commitHash: BUILD_B_COMMIT, rulesetVersion: "rv", seed: "shared-seed", modIds: [] },
        "2026-04-01T12:00:00Z",
      ),
    );
    writeSlot(
      storage,
      makeSlot(
        "fp-current",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "shared-seed", modIds: [] },
        "2026-05-01T12:00:00Z",
      ),
    );
    writeSlot(
      storage,
      makeSlot(
        "fp-other",
        { commitHash: BUILD_B_COMMIT, rulesetVersion: "rv", seed: "other-seed", modIds: [] },
        "2026-05-02T12:00:00Z",
      ),
    );
    const stale = findStaleReleaseSlots(storage, "shared-seed", BUILD_A_COMMIT);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.fingerprintShort).toBe("fp-stale");
  });

  it("returns empty when no slot's seed matches", () => {
    const storage = new MemoryStorage();
    expect(findStaleReleaseSlots(storage, "missing", BUILD_A_COMMIT)).toEqual(
      [],
    );
  });
});

describe("writeSlot — quota-exceeded", () => {
  it("throws QuotaExceededError when storage.setItem throws QuotaExceededError", () => {
    const storage = new MemoryStorage();
    storage.throwOnSet = {
      name: "QuotaExceededError",
      message: "DOM exception 22",
    };
    expect(() =>
      writeSlot(
        storage,
        makeSlot(
          "fp-1",
          { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
          "2026-05-09T12:00:00Z",
        ),
      ),
    ).toThrow(QuotaExceededError);
  });

  it("throws QuotaExceededError on Firefox's NS_ERROR_DOM_QUOTA_REACHED", () => {
    const storage = new MemoryStorage();
    storage.throwOnSet = {
      name: "NS_ERROR_DOM_QUOTA_REACHED",
      message: "Persistent storage maximum size reached",
    };
    expect(() =>
      writeSlot(
        storage,
        makeSlot(
          "fp-1",
          { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
          "2026-05-09T12:00:00Z",
        ),
      ),
    ).toThrow(QuotaExceededError);
  });

  it("re-throws non-quota errors as plain Error with the save: prefix", () => {
    const storage = new MemoryStorage();
    storage.throwOnSet = {
      name: "TypeError",
      message: "something else broke",
    };
    expect(() =>
      writeSlot(
        storage,
        makeSlot(
          "fp-1",
          { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
          "2026-05-09T12:00:00Z",
        ),
      ),
    ).toThrowError(/save: localStorage write failed: something else broke/);
  });
});

describe("evictOldestSlots — quota-recovery + protection of stale slots", () => {
  it("evicts the N oldest slots by savedAt", () => {
    const storage = new MemoryStorage();
    writeSlot(
      storage,
      makeSlot(
        "fp-old",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s1", modIds: [] },
        "2026-01-01T00:00:00Z",
      ),
    );
    writeSlot(
      storage,
      makeSlot(
        "fp-mid",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s2", modIds: [] },
        "2026-03-01T00:00:00Z",
      ),
    );
    writeSlot(
      storage,
      makeSlot(
        "fp-new",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s3", modIds: [] },
        "2026-05-01T00:00:00Z",
      ),
    );
    const evicted = evictOldestSlots(storage, 2, null);
    expect(evicted).toBe(2);
    expect(listSlots(storage).map((s) => s.fingerprintShort)).toEqual(["fp-new"]);
  });

  it("PRESERVES stale-release slots for the protected seed (addendum B6 'never deleted')", () => {
    const storage = new MemoryStorage();
    writeSlot(
      storage,
      makeSlot(
        "fp-stale-protected",
        { commitHash: BUILD_B_COMMIT, rulesetVersion: "rv", seed: "shared-seed", modIds: [] },
        "2026-01-01T00:00:00Z",
      ),
    );
    writeSlot(
      storage,
      makeSlot(
        "fp-other-old",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "other", modIds: [] },
        "2026-02-01T00:00:00Z",
      ),
    );
    // Try to evict 5 — only fp-other-old is evictable (the other is
    // protected as a stale-release slot for the current seed).
    const evicted = evictOldestSlots(storage, 5, {
      seed: "shared-seed",
      currentBuildCommitHash: BUILD_A_COMMIT,
    });
    expect(evicted).toBe(1);
    const remaining = listSlots(storage).map((s) => s.fingerprintShort).sort();
    expect(remaining).toEqual(["fp-stale-protected"]);
  });

  it("returns the actual count when fewer slots exist than the requested N", () => {
    const storage = new MemoryStorage();
    writeSlot(
      storage,
      makeSlot(
        "fp-one",
        { commitHash: BUILD_A_COMMIT, rulesetVersion: "rv", seed: "s", modIds: [] },
        "2026-01-01T00:00:00Z",
      ),
    );
    expect(evictOldestSlots(storage, 5, null)).toBe(1);
  });
});
