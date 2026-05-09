import { describe, expect, it } from "vitest";
import {
  decideRouting,
  buildReleasesIndexUrl,
  type BuildContext,
} from "../../src/router/redirect";
import { fingerprint, fingerprintFull } from "../../src/core/fingerprint";
import type { FingerprintInputs } from "../../src/core/fingerprint";
import { encodeActionLog } from "../../src/share/encode";
import {
  ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED,
  ROUTE_ERR_FP_TAMPERED,
  ROUTE_ERR_NO_MATCHING_RELEASE,
  ROUTE_ERR_RELEASE_INDEX_FETCH,
} from "../../src/router/messages";

const ORIGIN = "https://porkchop.github.io";
const BASE_PATH = "/icefall/";
const BASE_URL = `${ORIGIN}${BASE_PATH}`;

const CURRENT_BUILD: BuildContext = {
  commitHash: "deadbeef0000",
  rulesetVersion: "current".padEnd(64, "0"),
  basePath: BASE_PATH,
};

function fpFor(inputs: FingerprintInputs): string {
  return fingerprint(inputs).slice(0, 22);
}

function fpFullFor(inputs: FingerprintInputs): string {
  return fingerprintFull(inputs);
}

describe("buildReleasesIndexUrl", () => {
  it("composes the canonical absolute URL (memo addendum B5)", () => {
    expect(buildReleasesIndexUrl(ORIGIN, BASE_PATH)).toBe(
      "https://porkchop.github.io/icefall/releases/index.json",
    );
  });

  it("normalizes a basePath without trailing slash", () => {
    expect(buildReleasesIndexUrl(ORIGIN, "/icefall")).toBe(
      "https://porkchop.github.io/icefall/releases/index.json",
    );
  });
});

describe("decideRouting — `?run=` absent", () => {
  it("returns boot-fresh on the bare URL", () => {
    expect(decideRouting(BASE_URL, CURRENT_BUILD, null)).toEqual({
      kind: "boot-fresh",
      seed: null,
    });
  });

  it("returns boot-fresh with a standalone ?seed= (decision 11 daily-seed)", () => {
    expect(decideRouting(`${BASE_URL}?seed=alpha-1`, CURRENT_BUILD, null)).toEqual({
      kind: "boot-fresh",
      seed: "alpha-1",
    });
  });

  it("surfaces URL-parse errors as kind:'error'", () => {
    const r = decideRouting(`${BASE_URL}?run=tooShort&seed=s`, CURRENT_BUILD, null);
    expect(r.kind).toBe("error");
  });
});

describe("decideRouting — fingerprint matches current build (boot-replay)", () => {
  const inputs: FingerprintInputs = {
    commitHash: CURRENT_BUILD.commitHash,
    rulesetVersion: CURRENT_BUILD.rulesetVersion,
    seed: "alpha-1",
    modIds: [],
  };

  it("returns boot-replay when the URL's fingerprint matches the current build", () => {
    const fp = fpFor(inputs);
    const r = decideRouting(`${BASE_URL}?run=${fp}&seed=alpha-1`, CURRENT_BUILD, null);
    expect(r.kind).toBe("boot-replay");
    if (r.kind === "boot-replay") {
      expect(r.claimedFingerprint).toBe(fp);
      expect(r.inputs.seed).toBe("alpha-1");
    }
  });

  it("returns boot-replay with a #log= when supplied", () => {
    const fp = fpFor(inputs);
    const wire = encodeActionLog([{ type: "wait" }]);
    const r = decideRouting(
      `${BASE_URL}?run=${fp}&seed=alpha-1#log=${wire}`,
      CURRENT_BUILD,
      null,
    );
    expect(r.kind).toBe("boot-replay");
    if (r.kind === "boot-replay") {
      expect(r.logWire).toBe(wire);
    }
  });
});

describe("decideRouting — fingerprint mismatch + index-fetch failure", () => {
  it("surfaces ROUTE_ERR_RELEASE_INDEX_FETCH when index is null", () => {
    // Use a totally bogus 22-char fp.
    const fp = "A".repeat(22);
    const r = decideRouting(`${BASE_URL}?run=${fp}&seed=alpha-1`, CURRENT_BUILD, null);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.code).toBe(ROUTE_ERR_RELEASE_INDEX_FETCH);
    }
  });

  it("surfaces ROUTE_ERR_RELEASE_INDEX_FETCH on malformed index JSON", () => {
    const fp = "A".repeat(22);
    const r = decideRouting(
      `${BASE_URL}?run=${fp}&seed=alpha-1`,
      CURRENT_BUILD,
      "not json",
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/release-index: JSON parse failed/);
    }
  });
});

describe("decideRouting — phase-1 enumeration (mismatched build, match found)", () => {
  it("redirects to the matching commitShort under releases/", () => {
    const oldBuildCommit = "feedbeef1234";
    const oldBuildRuleset = "0d".repeat(32); // 64 hex chars
    const oldInputs: FingerprintInputs = {
      commitHash: oldBuildCommit,
      rulesetVersion: oldBuildRuleset,
      seed: "alpha-1",
      modIds: [],
    };
    const fp = fpFor(oldInputs);
    const indexJson = JSON.stringify({
      schemaVersion: 1,
      releases: [
        {
          commitShort: oldBuildCommit,
          commitHash: oldBuildCommit,
          rulesetVersion: oldBuildRuleset,
          atlasBinaryHash: "c".repeat(64),
          publishedAt: "2026-04-01T12:00:00Z",
        },
      ],
    });
    const r = decideRouting(
      `${BASE_URL}?run=${fp}&seed=alpha-1`,
      CURRENT_BUILD,
      indexJson,
    );
    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") {
      expect(r.target).toBe(
        `${BASE_URL}releases/${oldBuildCommit}/?run=${fp}&seed=alpha-1`,
      );
    }
  });

  it("preserves the #log= fragment through the redirect", () => {
    const oldBuildCommit = "feedbeef1234";
    const oldBuildRuleset = "0d".repeat(32); // 64 hex chars
    const oldInputs: FingerprintInputs = {
      commitHash: oldBuildCommit,
      rulesetVersion: oldBuildRuleset,
      seed: "alpha-1",
      modIds: [],
    };
    const fp = fpFor(oldInputs);
    const wire = encodeActionLog([{ type: "wait" }]);
    const indexJson = JSON.stringify({
      schemaVersion: 1,
      releases: [
        {
          commitShort: oldBuildCommit,
          commitHash: oldBuildCommit,
          rulesetVersion: oldBuildRuleset,
          atlasBinaryHash: "c".repeat(64),
          publishedAt: "2026-04-01T12:00:00Z",
        },
      ],
    });
    const r = decideRouting(
      `${BASE_URL}?run=${fp}&seed=alpha-1#log=${wire}`,
      CURRENT_BUILD,
      indexJson,
    );
    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") {
      expect(r.target).toContain(`#log=${wire}`);
      expect(r.target).toContain(`?run=${fp}&seed=alpha-1`);
    }
  });
});

describe("decideRouting — phase-2 enumeration (addendum B3 disambiguation)", () => {
  it("surfaces ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED when fp matches a release with empty mods but the URL has mods", () => {
    const oldBuildCommit = "feedbeef1234";
    const oldBuildRuleset = "0d".repeat(32); // 64 hex chars
    // Fingerprint computed under modIds: [] (the original)
    const fpUnderEmptyMods = fpFor({
      commitHash: oldBuildCommit,
      rulesetVersion: oldBuildRuleset,
      seed: "alpha-1",
      modIds: [],
    });
    const indexJson = JSON.stringify({
      schemaVersion: 1,
      releases: [
        {
          commitShort: oldBuildCommit,
          commitHash: oldBuildCommit,
          rulesetVersion: oldBuildRuleset,
          atlasBinaryHash: "c".repeat(64),
          publishedAt: "2026-04-01T12:00:00Z",
        },
      ],
    });
    // The URL has `&mods=tampered` — phase 1 won't find a match;
    // phase 2 (without mods) will, surfacing the seed-tampered error.
    const r = decideRouting(
      `${BASE_URL}?run=${fpUnderEmptyMods}&seed=alpha-1&mods=tampered`,
      CURRENT_BUILD,
      indexJson,
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.code).toBe(ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED);
      expect(r.message).toContain("'alpha-1'");
    }
  });
});

describe("decideRouting — sub-case 5c (FP_TAMPERED at the right releases/<commit>/ subtree)", () => {
  it("surfaces ROUTE_ERR_FP_TAMPERED when the URL is at releases/<commit>/ but fp doesn't match anything", () => {
    const oldBuildCommit = "feedbeef1234";
    const oldBuildRuleset = "0d".repeat(32); // 64 hex chars
    const indexJson = JSON.stringify({
      schemaVersion: 1,
      releases: [
        {
          commitShort: oldBuildCommit,
          commitHash: oldBuildCommit,
          rulesetVersion: oldBuildRuleset,
          atlasBinaryHash: "c".repeat(64),
          publishedAt: "2026-04-01T12:00:00Z",
        },
      ],
    });
    // URL is at releases/<oldCommit>/ but the fp is bogus.
    const fp = "Z".repeat(22);
    const r = decideRouting(
      `${ORIGIN}/icefall/releases/${oldBuildCommit}/?run=${fp}&seed=alpha-1`,
      CURRENT_BUILD,
      indexJson,
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.code).toBe(ROUTE_ERR_FP_TAMPERED);
    }
  });
});

describe("decideRouting — final-fall-through (NO_MATCHING_RELEASE)", () => {
  it("surfaces ROUTE_ERR_NO_MATCHING_RELEASE with seed substitution (addendum B9)", () => {
    const indexJson = JSON.stringify({ schemaVersion: 1, releases: [] });
    const fp = "A".repeat(22);
    const r = decideRouting(
      `${BASE_URL}?run=${fp}&seed=tomorrow's-seed`,
      CURRENT_BUILD,
      indexJson,
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.code).toBe(ROUTE_ERR_NO_MATCHING_RELEASE);
      expect(r.message).toContain("seed 'tomorrow");
    }
  });
});

// silence unused-import warning for fpFullFor (kept for future tests)
void fpFullFor;
