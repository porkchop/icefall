import { describe, expect, it } from "vitest";
import { parseReleaseIndex } from "../../src/router/release-index-parse";

const VALID_ENTRY = {
  commitShort: "abcdef012345",
  commitHash: "abcdef012345",
  rulesetVersion: "a".repeat(64),
  atlasBinaryHash: "b".repeat(64),
  publishedAt: "2026-05-09T12:34:56Z",
};

const VALID_INDEX = JSON.stringify({
  schemaVersion: 1,
  releases: [VALID_ENTRY],
});

describe("parseReleaseIndex — happy path", () => {
  it("parses a minimal valid index", () => {
    const r = parseReleaseIndex(VALID_INDEX);
    expect(r.schemaVersion).toBe(1);
    expect(r.releases).toHaveLength(1);
    expect(r.releases[0]).toEqual(VALID_ENTRY);
  });

  it("parses an empty releases array (bootstrap state)", () => {
    const r = parseReleaseIndex(
      JSON.stringify({ schemaVersion: 1, releases: [] }),
    );
    expect(r.releases).toEqual([]);
  });

  it("parses multiple entries preserving order", () => {
    const r = parseReleaseIndex(
      JSON.stringify({
        schemaVersion: 1,
        releases: [
          VALID_ENTRY,
          { ...VALID_ENTRY, commitShort: "111111111111", commitHash: "111111111111" },
        ],
      }),
    );
    expect(r.releases).toHaveLength(2);
    expect(r.releases[0]!.commitShort).toBe("abcdef012345");
    expect(r.releases[1]!.commitShort).toBe("111111111111");
  });
});

describe("parseReleaseIndex — schema-shape rejections", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseReleaseIndex("not json")).toThrowError(
      /release-index: JSON parse failed/,
    );
  });

  it("rejects a non-object top-level", () => {
    expect(() => parseReleaseIndex("[]")).toThrowError(
      /release-index: top-level value must be an object/,
    );
  });

  it("rejects schemaVersion !== 1", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({ schemaVersion: 2, releases: [] }),
      ),
    ).toThrowError(/unsupported schemaVersion 2/);
  });

  it("rejects a missing `releases` array", () => {
    expect(() =>
      parseReleaseIndex(JSON.stringify({ schemaVersion: 1 })),
    ).toThrowError(/field 'releases' must be an array/);
  });

  it("rejects a non-object entry", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({ schemaVersion: 1, releases: ["not-an-object"] }),
      ),
    ).toThrowError(/releases\[0\] must be an object/);
  });

  it("rejects a missing string field", () => {
    const { commitShort: _, ...rest } = VALID_ENTRY;
    void _;
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({ schemaVersion: 1, releases: [rest] }),
      ),
    ).toThrowError(/field 'commitShort' must be a string/);
  });
});

describe("parseReleaseIndex — regex validation", () => {
  it("rejects commitShort that's not 12 hex chars", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, commitShort: "abc" }],
        }),
      ),
    ).toThrowError(/commitShort must match \/\^\[0-9a-f\]\{12\}\$\//);
  });

  it("rejects commitShort with uppercase hex", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, commitShort: "ABCDEF012345" }],
        }),
      ),
    ).toThrowError(/commitShort must match/);
  });

  it("rejects rulesetVersion that's not 64 hex chars", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, rulesetVersion: "a".repeat(63) }],
        }),
      ),
    ).toThrowError(/rulesetVersion must match \/\^\[0-9a-f\]\{64\}\$\//);
  });

  it("rejects atlasBinaryHash that's not 64 hex chars", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, atlasBinaryHash: "deadbeef" }],
        }),
      ),
    ).toThrowError(/atlasBinaryHash must match/);
  });

  it("rejects publishedAt with wrong syntax", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, publishedAt: "tomorrow" }],
        }),
      ),
    ).toThrowError(/publishedAt must match/);
  });

  it("rejects publishedAt that's syntactically valid but semantically invalid (advisory A1 round-trip)", () => {
    expect(() =>
      parseReleaseIndex(
        JSON.stringify({
          schemaVersion: 1,
          releases: [{ ...VALID_ENTRY, publishedAt: "2026-13-32T25:99:99Z" }],
        }),
      ),
    ).toThrowError(/publishedAt is not a valid ISO-8601 UTC timestamp/);
  });
});
