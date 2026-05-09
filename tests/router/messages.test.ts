import { describe, expect, it } from "vitest";
import {
  ROUTE_ERR_FP_BAD_CHAR,
  ROUTE_ERR_FP_INVALID,
  ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED,
  ROUTE_ERR_FP_TAMPERED,
  ROUTE_ERR_LOG_DECODE,
  ROUTE_ERR_MODS_INVALID,
  ROUTE_ERR_NO_MATCHING_RELEASE,
  ROUTE_ERR_RELEASE_INDEX_FETCH,
  ROUTE_ERR_SEED_INVALID,
  ROUTE_ERR_SEED_MISSING,
  escapeForDisplay,
  fillTemplate,
} from "../../src/router/messages";

/**
 * Phase 8.A.2b — pinned-string assertions for the 10 ROUTE_ERR_*
 * constants (memo decision 5 + addendum B3 + B9). Every byte is
 * load-bearing: changes to em-dashes (U+2014), quote characters,
 * placeholder names, or whitespace are user-facing and may appear
 * in shared screenshots / issue threads. Any change to these
 * constants is a `rulesetVersion` bump candidate.
 */

describe("ROUTE_ERR_* pinned strings", () => {
  it("ROUTE_ERR_FP_INVALID matches the byte-exact pin", () => {
    expect(ROUTE_ERR_FP_INVALID).toBe(
      "url: ?run= must be 22 base64url characters (got <N>: <repr>)",
    );
  });

  it("ROUTE_ERR_FP_BAD_CHAR matches the byte-exact pin", () => {
    expect(ROUTE_ERR_FP_BAD_CHAR).toBe(
      "url: ?run= contains non-base64url character at position <i>",
    );
  });

  it("ROUTE_ERR_SEED_MISSING matches the byte-exact pin (em-dash U+2014)", () => {
    expect(ROUTE_ERR_SEED_MISSING).toBe(
      "url: ?run= present but ?seed= missing — cannot reconstruct run",
    );
  });

  it("ROUTE_ERR_SEED_INVALID matches the byte-exact pin (em-dash U+2014)", () => {
    expect(ROUTE_ERR_SEED_INVALID).toBe(
      "url: ?seed= invalid — must be a non-empty UTF-8 string with no NUL byte",
    );
  });

  it("ROUTE_ERR_MODS_INVALID matches the byte-exact pin", () => {
    expect(ROUTE_ERR_MODS_INVALID).toBe(
      "url: ?mods= entry <i> contains forbidden character (NUL or comma)",
    );
  });

  it("ROUTE_ERR_LOG_DECODE matches the byte-exact pin (em-dash U+2014)", () => {
    expect(ROUTE_ERR_LOG_DECODE).toBe(
      "url: #log= failed to decode — <inner-error>",
    );
  });

  it("ROUTE_ERR_NO_MATCHING_RELEASE matches the byte-exact pin (addendum B9 bootstrap message)", () => {
    expect(ROUTE_ERR_NO_MATCHING_RELEASE).toBe(
      "router: this run was created with a build that is not present in releases/index.json. The release may not yet be published (try refreshing in a minute) or may have been pruned. If this URL was shared before per-release pinning was live (Phase 8.A.3), the run can be re-created with seed '<seed>' on 'latest/'.",
    );
  });

  it("ROUTE_ERR_FP_TAMPERED matches the byte-exact pin (em-dash + apostrophe)", () => {
    expect(ROUTE_ERR_FP_TAMPERED).toBe(
      "router: this run's fingerprint doesn't match its seed or mods — the URL may have been edited or corrupted; open the original sharer's URL or click 'New Run'",
    );
  });

  it("ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED matches the byte-exact pin (addendum B3 phase-2 retry message)", () => {
    expect(ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED).toBe(
      "router: this run's fingerprint matches no release at the supplied seed '<seed-repr>'. Either the seed was edited after sharing, the URL was double-encoded by an email or link-shortener, or the build that produced the fingerprint was never published. Try opening the original sharer's URL or use 'New Run' with this seed.",
    );
  });

  it("ROUTE_ERR_RELEASE_INDEX_FETCH matches the byte-exact pin (em-dash U+2014)", () => {
    expect(ROUTE_ERR_RELEASE_INDEX_FETCH).toBe(
      "router: failed to fetch releases/index.json — cannot route mismatched-build URLs (network error or release index missing)",
    );
  });
});

describe("escapeForDisplay (advisory A5 substitution rule)", () => {
  it("passes through printable ASCII unchanged", () => {
    expect(escapeForDisplay("abcXYZ-_.~ 0123")).toBe("abcXYZ-_.~ 0123");
  });

  it("escapes a NUL byte as \\x00", () => {
    expect(escapeForDisplay("a\x00b")).toBe("a\\x00b");
  });

  it("escapes control bytes as uppercase \\xHH", () => {
    expect(escapeForDisplay("\x01\x07\x1f")).toBe("\\x01\\x07\\x1F");
  });

  it("escapes high bytes (above U+007E) as uppercase \\xHH", () => {
    expect(escapeForDisplay("\x7f\x80")).toBe("\\x7F\\x80");
  });

  it("doubles a printable backslash to avoid colliding with \\xHH syntax", () => {
    expect(escapeForDisplay("a\\b")).toBe("a\\\\b");
  });
});

describe("fillTemplate", () => {
  it("substitutes a single placeholder", () => {
    expect(fillTemplate("hello <name>!", { "<name>": "world" })).toBe(
      "hello world!",
    );
  });

  it("substitutes multiple placeholders", () => {
    expect(
      fillTemplate("<a> + <b> = <c>", {
        "<a>": "1",
        "<b>": "2",
        "<c>": "3",
      }),
    ).toBe("1 + 2 = 3");
  });

  it("leaves unspecified placeholders intact for diagnostic visibility", () => {
    expect(fillTemplate("<a> and <b>", { "<a>": "X" })).toBe("X and <b>");
  });

  it("substitutes the same placeholder repeatedly", () => {
    expect(fillTemplate("<x> <x> <x>", { "<x>": "Y" })).toBe("Y Y Y");
  });
});
