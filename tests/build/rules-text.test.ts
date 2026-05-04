import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RULES_FILES } from "../../src/build-info";

/**
 * Phase 4.A.1 build-time guard: every entry of `RULES_FILES` must be
 * pure LF-terminated (no CR / no UTF-8 BOM) on disk. CRLF endings or a
 * leading BOM would silently shift `rulesetTextHash` between a
 * Linux/macOS clone and a Windows clone whose `.gitattributes` was
 * missed (defense-in-depth above the LF rule pinned in `.gitattributes`).
 *
 * Per addendum B3 the error-message format is **pinned**:
 *   - `rulesText: file <path> has CRLF; convert to LF and recommit`
 *   - `rulesText: file <path> has UTF-8 BOM at offset 0; remove the BOM and recommit`
 *
 * Per follow-up red-team N18 (option (a)): three of the canonical 12
 * `RULES_FILES` entries land in Phase 4.A.2 (the `src/atlas/**` and
 * `src/registries/atlas-recipes.ts` paths). Their `existsInPhase`
 * field is `"4.A.2"`; this test skips the read on those entries until
 * they exist on disk. A second assertion guards against the
 * silent-skip failure mode: every entry whose `existsInPhase` is
 * `"4.A.1"` MUST exist on disk and be scanned.
 */

const repoRoot = resolve(import.meta.dirname, "..", "..");

function readRulesFile(path: string): Uint8Array {
  return readFileSync(resolve(repoRoot, path));
}

describe("RULES_FILES — canonical alphabetical order", () => {
  it("is sorted alphabetically by path (the sort is the contract — addendum B2)", () => {
    const paths = RULES_FILES.map((f) => f.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("uses lowercase ASCII paths matching /^[a-z][a-z0-9/_.-]*\\.ts$/", () => {
    for (const entry of RULES_FILES) {
      expect(entry.path).toBe(entry.path.toLowerCase());
      expect(entry.path).toMatch(/^[a-z][a-z0-9/_.-]*\.ts$/);
    }
  });

  it("matches the byte-exact canonical 12-entry list pinned in addendum B2", () => {
    expect(RULES_FILES.map((f) => f.path)).toEqual([
      "src/atlas/palette.ts",
      "src/atlas/params.ts",
      "src/registries/atlas-recipes.ts",
      "src/registries/encounters.ts",
      "src/registries/items.ts",
      "src/registries/monsters.ts",
      "src/registries/rooms.ts",
      "src/sim/ai.ts",
      "src/sim/combat.ts",
      "src/sim/params.ts",
      "src/sim/run.ts",
      "src/sim/turn.ts",
    ]);
  });
});

describe("RULES_FILES — LF endings and no UTF-8 BOM", () => {
  for (const entry of RULES_FILES) {
    if (entry.existsInPhase === "4.A.2") {
      // Addendum B3 + follow-up N18: skip until the file lands in 4.A.2.
      // The companion `existsInPhase === "4.A.1"` test below will fail
      // loudly if a "4.A.1" entry is silently absent.
      it.skip(`${entry.path} (deferred to 4.A.2)`, () => {
        // intentionally empty
      });
      continue;
    }
    it(`${entry.path}: no CRLF, no UTF-8 BOM`, () => {
      const bytes = readRulesFile(entry.path);
      // BOM check first (offset-0 only). Pinned error format.
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        throw new Error(
          `rulesText: file ${entry.path} has UTF-8 BOM at offset 0; remove the BOM and recommit`,
        );
      }
      // CR check (any 0x0D byte). Pinned error format.
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0d) {
          throw new Error(
            `rulesText: file ${entry.path} has CRLF; convert to LF and recommit`,
          );
        }
      }
    });
  }

  it("every 4.A.1-marked entry exists on disk (no silent skips)", () => {
    for (const entry of RULES_FILES) {
      if (entry.existsInPhase !== "4.A.1") continue;
      expect(existsSync(resolve(repoRoot, entry.path))).toBe(true);
    }
  });
});

describe(".gitattributes pin (addendum B3)", () => {
  it("exists at repo root", () => {
    expect(existsSync(resolve(repoRoot, ".gitattributes"))).toBe(true);
  });

  it("contains the 'assets/atlas.png binary' load-bearing pin", () => {
    const content = readFileSync(resolve(repoRoot, ".gitattributes"), "utf8");
    expect(content).toContain("assets/atlas.png binary");
    // The global default is also load-bearing — without it text=auto's
    // default behavior would CRLF-corrupt unknown files on Windows.
    expect(content).toContain("* text=auto eol=lf");
  });
});
