import { describe, expect, it } from "vitest";
import {
  mergeReleaseIndex,
  tryParsePriorIndex,
  parseArgs,
} from "../../scripts/publish-dual.mjs";

/**
 * Phase 8.A.3 unit tests for `scripts/publish-dual.mjs`'s pure
 * functions. The fetch + filesystem I/O paths are exercised on the
 * live deploy (Phase 8.B); this test surface pins the merge logic
 * + the input-validation regex set + the bootstrap-from-empty path.
 */

const VALID_ENTRY = Object.freeze({
  commitShort: "deadbeef0000",
  commitHash: "deadbeef0000",
  rulesetVersion: "a".repeat(64),
  atlasBinaryHash: "b".repeat(64),
  publishedAt: "2026-05-09T12:00:00Z",
});

describe("mergeReleaseIndex — happy path", () => {
  it("seeds an index from null prior (bootstrap case)", () => {
    const merged = mergeReleaseIndex(null, VALID_ENTRY);
    expect(merged.schemaVersion).toBe(1);
    expect(merged.releases).toHaveLength(1);
    expect(merged.releases[0]).toEqual(VALID_ENTRY);
  });

  it("seeds an index from undefined prior (defensive bootstrap)", () => {
    const merged = mergeReleaseIndex(undefined, VALID_ENTRY);
    expect(merged.releases).toHaveLength(1);
  });

  it("prepends the new entry (newest-first per addendum B5)", () => {
    const prior = {
      schemaVersion: 1 as const,
      releases: [
        {
          ...VALID_ENTRY,
          commitShort: "111111111111",
          commitHash: "111111111111",
          publishedAt: "2026-04-01T12:00:00Z",
        },
        {
          ...VALID_ENTRY,
          commitShort: "222222222222",
          commitHash: "222222222222",
          publishedAt: "2026-03-01T12:00:00Z",
        },
      ],
    };
    const newEntry = {
      ...VALID_ENTRY,
      commitShort: "999999999999",
      commitHash: "999999999999",
      publishedAt: "2026-05-09T12:00:00Z",
    };
    const merged = mergeReleaseIndex(prior, newEntry);
    expect(merged.releases).toHaveLength(3);
    expect(merged.releases[0]!.commitShort).toBe("999999999999");
    expect(merged.releases[1]!.commitShort).toBe("111111111111");
    expect(merged.releases[2]!.commitShort).toBe("222222222222");
  });

  it("replaces an existing entry with the same commitShort (re-deploy case)", () => {
    const prior = {
      schemaVersion: 1 as const,
      releases: [
        {
          ...VALID_ENTRY,
          commitShort: "deadbeef0000",
          commitHash: "deadbeef0000",
          publishedAt: "2026-04-01T12:00:00Z",
        },
        {
          ...VALID_ENTRY,
          commitShort: "111111111111",
          commitHash: "111111111111",
          publishedAt: "2026-03-01T12:00:00Z",
        },
      ],
    };
    const reDeploy = {
      ...VALID_ENTRY,
      commitShort: "deadbeef0000",
      commitHash: "deadbeef0000",
      publishedAt: "2026-05-09T12:00:00Z", // newer timestamp
    };
    const merged = mergeReleaseIndex(prior, reDeploy);
    expect(merged.releases).toHaveLength(2);
    expect(merged.releases[0]!.commitShort).toBe("deadbeef0000");
    expect(merged.releases[0]!.publishedAt).toBe("2026-05-09T12:00:00Z");
    expect(merged.releases[1]!.commitShort).toBe("111111111111");
  });
});

describe("mergeReleaseIndex — validation rejections", () => {
  it("rejects an entry missing commitShort", () => {
    // Construct an entry without commitShort by spreading a subset.
    const { commitShort: _omit, ...rest } = VALID_ENTRY;
    void _omit;
    expect(() =>
      mergeReleaseIndex(null, rest as unknown as typeof VALID_ENTRY),
    ).toThrowError(/entry\.commitShort must match/);
  });

  it("rejects an entry with non-12-hex commitShort", () => {
    expect(() =>
      mergeReleaseIndex(null, { ...VALID_ENTRY, commitShort: "abc" }),
    ).toThrowError(/entry\.commitShort must match/);
  });

  it("rejects an entry with non-64-hex rulesetVersion", () => {
    expect(() =>
      mergeReleaseIndex(null, { ...VALID_ENTRY, rulesetVersion: "deadbeef" }),
    ).toThrowError(/entry\.rulesetVersion must match/);
  });

  it("rejects an entry with non-64-hex atlasBinaryHash", () => {
    expect(() =>
      mergeReleaseIndex(null, { ...VALID_ENTRY, atlasBinaryHash: "x".repeat(64) }),
    ).toThrowError(/entry\.atlasBinaryHash must match/);
  });

  it("rejects an entry with malformed publishedAt", () => {
    expect(() =>
      mergeReleaseIndex(null, { ...VALID_ENTRY, publishedAt: "tomorrow" }),
    ).toThrowError(/entry\.publishedAt must match/);
  });

  it("rejects a prior index with unsupported schemaVersion", () => {
    // Force the wrong schemaVersion via a cast — TypeScript would
    // reject `2` against the literal-type field; the runtime check
    // is what we're exercising.
    expect(() =>
      mergeReleaseIndex(
        { schemaVersion: 2, releases: [] } as unknown as Parameters<
          typeof mergeReleaseIndex
        >[0],
        VALID_ENTRY,
      ),
    ).toThrowError(/prior schemaVersion 2 unsupported/);
  });
});

describe("tryParsePriorIndex — bootstrap-friendly fallback (advisory A7)", () => {
  it("returns null on malformed JSON (logged as bootstrap)", () => {
    expect(tryParsePriorIndex("not json")).toBeNull();
  });

  it("returns null on a non-object top-level", () => {
    expect(tryParsePriorIndex("[]")).toBeNull();
  });

  it("returns null on schemaVersion mismatch", () => {
    expect(
      tryParsePriorIndex(
        JSON.stringify({ schemaVersion: 99, releases: [] }),
      ),
    ).toBeNull();
  });

  it("returns null when any per-entry shape fails (defensive against partial writes)", () => {
    expect(
      tryParsePriorIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ commitShort: "abc" /* too short */ }],
        }),
      ),
    ).toBeNull();
  });

  it("parses a valid prior index", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      releases: [VALID_ENTRY],
    });
    const parsed = tryParsePriorIndex(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.releases).toHaveLength(1);
  });

  it("parses an empty releases array", () => {
    const text = JSON.stringify({ schemaVersion: 1, releases: [] });
    const parsed = tryParsePriorIndex(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.releases).toEqual([]);
  });
});

describe("parseArgs — required-arg + format checks", () => {
  it("requires --commit-short", () => {
    expect(() =>
      parseArgs([
        "node",
        "publish-dual.mjs",
        "--published-at=2026-05-09T12:00:00Z",
        "--dist-final=dist-final",
      ]),
    ).toThrowError(/missing required arg --commit-short/);
  });

  it("requires --published-at", () => {
    expect(() =>
      parseArgs([
        "node",
        "publish-dual.mjs",
        "--commit-short=deadbeef0000",
        "--dist-final=dist-final",
      ]),
    ).toThrowError(/missing required arg --published-at/);
  });

  it("requires --dist-final", () => {
    expect(() =>
      parseArgs([
        "node",
        "publish-dual.mjs",
        "--commit-short=deadbeef0000",
        "--published-at=2026-05-09T12:00:00Z",
      ]),
    ).toThrowError(/missing required arg --dist-final/);
  });

  it("accepts the optional --prior-index-url", () => {
    const args = parseArgs([
      "node",
      "publish-dual.mjs",
      "--commit-short=deadbeef0000",
      "--published-at=2026-05-09T12:00:00Z",
      "--dist-final=dist-final",
      "--prior-index-url=https://example.com/releases/index.json",
    ]);
    expect(args["prior-index-url"]).toBe(
      "https://example.com/releases/index.json",
    );
  });

  it("rejects malformed arguments (e.g. positional non-flag)", () => {
    expect(() =>
      parseArgs([
        "node",
        "publish-dual.mjs",
        "--commit-short=deadbeef0000",
        "positional-non-flag",
      ]),
    ).toThrowError(/unrecognized argument/);
  });
});
