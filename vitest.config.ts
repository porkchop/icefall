import { defineConfig } from "vitest/config";
import { atlasBinaryHashPlugin } from "./scripts/vite-plugin-atlas-binary-hash.mjs";

// Phase 4.A.2 (atomic flip per addendum B1). The atlas-binary-hash
// plugin owns `__ATLAS_BINARY_HASH__`, `__ATLAS_MISSING__`, and
// `__RULESET_VERSION__` injection — its `config()` hook returns the
// three keys with the values computed from the on-disk
// `assets/atlas.png` plus `RULES_FILES`.

export default defineConfig({
  plugins: [atlasBinaryHashPlugin()],
  define: {
    __COMMIT_HASH__: JSON.stringify("dev000000000"),
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
        "src/input/**",
        "src/mapgen/**",
        "src/registries/**",
        "src/render/**",
        "src/sim/**",
        "src/ui/**",
      ],
      exclude: [
        "src/atlas/**/*.test.ts",
        "src/core/**/*.test.ts",
        "src/input/**/*.test.ts",
        "src/mapgen/**/*.test.ts",
        "src/registries/**/*.test.ts",
        "src/render/**/*.test.ts",
        "src/sim/**/*.test.ts",
        "src/ui/**/*.test.ts",
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
        // Phase 5.A.2 render/input/ui coverage. The renderer's
        // defensive paths (canvas-context-unavailable, manifest
        // missing slot) and the keyboard's no-window fallback are
        // exercised; Phase 5 frozen contract permits ≥ 95% as
        // documented in the operating-rules section of the phase
        // prompt (the documented Phase 5 deviation: "defensive paths
        // can be uncovered").
        "src/render/**": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 85,
        },
        "src/input/**": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 85,
        },
        "src/ui/**": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 85,
        },
      },
    },
  },
});
