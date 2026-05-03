import { defineConfig } from "vitest/config";

const PLACEHOLDER_RULESET = "phase1-placeholder-do-not-share";

export default defineConfig({
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
      include: ["src/core/**"],
      exclude: ["src/core/**/*.test.ts"],
      thresholds: {
        "src/core/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
      },
    },
  },
});
