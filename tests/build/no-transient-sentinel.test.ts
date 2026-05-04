import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLACEHOLDER_RULESET_VERSION } from "../../src/build-info";

/**
 * Phase 4 atomic flip guard (memo addendum B1). On master, the
 * `__RULESET_VERSION__` injection holds exactly one of two states:
 *   (a) `PLACEHOLDER_RULESET_VERSION` (pre-4.A.2 commit, no atlas), or
 *   (b) a 64-char lowercase-hex string (4.A.2 onward).
 * No third "transient sentinel" form is allowed — specifically, the
 * `"4.A.1-pre-atlas-"` sentinel mentioned in early Phase 4 planning
 * MUST NOT appear in any built bundle (addendum B1).
 *
 * This test scans `dist/` (if present) for the forbidden substring
 * and asserts it does not appear. Skip gracefully if `dist/` hasn't
 * been built yet.
 */

const repoRoot = resolve(import.meta.dirname, "..", "..");
const distDir = resolve(repoRoot, "dist");
const distAssetsDir = resolve(distDir, "assets");

describe("no transient ruleset sentinel in built bundle (addendum B1)", () => {
  it("dist/assets/*.js does not contain '4.A.1-pre-atlas-' sentinel", () => {
    if (!existsSync(distAssetsDir)) {
      // Not yet built; skip silently — the CI build step will hit
      // this assertion. (Local `npm test` before `npm run build` is
      // the typical case.)
      return;
    }
    const jsFiles = readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));
    for (const f of jsFiles) {
      const text = readFileSync(resolve(distAssetsDir, f), "utf8");
      expect(text).not.toContain("4.A.1-pre-atlas-");
    }
  });
});

describe("placeholder constant export", () => {
  it("PLACEHOLDER_RULESET_VERSION still exists as the canonical sentinel", () => {
    // The placeholder export is preserved post-4.A.2 for backward
    // compatibility with the Phase 1 self-test that asserts the
    // `DEV-` prefix fingerprint behavior. Removing it would break
    // that fixture.
    expect(PLACEHOLDER_RULESET_VERSION).toBe("phase1-placeholder-do-not-share");
  });
});
