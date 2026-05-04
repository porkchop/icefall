import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 5.A.1 drift-sweep fflate version pin (Phase 4.A.2 code-review
 * nit N7). The atlas-encoder-cross-runtime self-test asserts a
 * pinned single-color-tile golden hash; an fflate version bump that
 * subtly changes IDAT bytes would surface there. This test is the
 * complementary explicit trip-wire: it asserts the pinned version
 * literal in `package.json` so a `package-lock.json` integrity bump
 * (or a careless `^` / `~` introduction) fails loudly without
 * waiting for the encoder golden to mismatch.
 *
 * Per the addendum-2 substitution (`fdeflate` → `fflate`) and per
 * addendum-1 N1 the fflate version is exact-pinned with no caret/tilde.
 * Bumping the pin is a `rulesetVersion` bump (encoder bytes change →
 * atlasBinaryHash bumps) and requires architecture-red-team review
 * + the cross-OS matrix to re-verify byte-equality on the new version.
 */

const FFLATE_PINNED_VERSION = "0.8.2";

describe("fflate version pin (addendum N1 + N7)", () => {
  it(`package.json pins fflate to exactly ${FFLATE_PINNED_VERSION} (no caret, no tilde)`, () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { devDependencies?: Record<string, string> };
    const pinned = pkg.devDependencies?.["fflate"];
    expect(pinned).toBe(FFLATE_PINNED_VERSION);
  });
});
