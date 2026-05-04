import { defineConfig } from "vitest/config";
import { atlasBinaryHashPlugin } from "./scripts/vite-plugin-atlas-binary-hash.mjs";

const PLACEHOLDER_RULESET = "phase1-placeholder-do-not-share";

export default defineConfig({
  // Phase 4.A.1: `__RULESET_VERSION__` continues to inject the Phase 1
  // placeholder per addendum B1. The atlas-binary-hash plugin (B5)
  // injects `__ATLAS_BINARY_HASH__ = EMPTY_SHA256` and
  // `__ATLAS_MISSING__ = true` while `assets/atlas.png` is absent.
  plugins: [atlasBinaryHashPlugin()],
  define: {
    __COMMIT_HASH__: JSON.stringify("dev0000"),
    __RULESET_VERSION__: JSON.stringify(PLACEHOLDER_RULESET),
  },
  test: {
    globals: false,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "eslint-rules/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/atlas/**",
        "src/core/**",
        "src/mapgen/**",
        "src/registries/**",
        "src/sim/**",
      ],
      exclude: [
        "src/atlas/**/*.test.ts",
        "src/core/**/*.test.ts",
        "src/mapgen/**/*.test.ts",
        "src/registries/**/*.test.ts",
        "src/sim/**/*.test.ts",
        // Pure-type declaration files: no executable code, so v8
        // reports as 0/0 which fails the 100% threshold.
        "src/mapgen/types.ts",
        "src/sim/types.ts",
      ],
      thresholds: {
        "src/atlas/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/core/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        "src/mapgen/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 85,
        },
        "src/registries/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 85,
        },
        // Phase 3.A.2 sim coverage: lines/statements/functions at 95
        // (not 100) covers the remaining defensive race-condition
        // paths — monster-boxed-in (ai.ts:165-166), move-target-
        // raced-blocked (turn.ts:249-257), and the rejection-sample
        // re-draw branch (run.ts:55, ~1.4e-9 probability per draw).
        // These are correctness-important fallbacks that resist
        // direct unit-test exercise; the property-style stress on
        // SIM_DIGEST plus the 100-action self-test log are the
        // load-bearing assertions. Branch threshold matches the
        // Phase 2 mapgen/registries precedent.
        "src/sim/**": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 85,
        },
      },
    },
  },
});
