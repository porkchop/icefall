import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { atlasBinaryHashPlugin } from "./scripts/vite-plugin-atlas-binary-hash.mjs";

const PLACEHOLDER_RULESET = "phase1-placeholder-do-not-share";

function readCommitHash(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev0000";
  }
}

export default defineConfig({
  base: "/icefall/",
  // Phase 4.A.1: `__RULESET_VERSION__` continues to inject the Phase 1
  // placeholder per addendum B1. The `deriveRulesetVersion` helper
  // (src/build-info.ts) is **defined but not yet called**; 4.A.2 lands
  // `assets/atlas.png` and flips this call site to the derived value
  // in the same commit. The atlas-binary-hash plugin (addendum B5)
  // injects `__ATLAS_BINARY_HASH__` and `__ATLAS_MISSING__` so the
  // helper has its second input wired ahead of the flip.
  plugins: [atlasBinaryHashPlugin()],
  define: {
    __COMMIT_HASH__: JSON.stringify(readCommitHash()),
    __RULESET_VERSION__: JSON.stringify(PLACEHOLDER_RULESET),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
