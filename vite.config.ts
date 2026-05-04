import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { atlasBinaryHashPlugin } from "./scripts/vite-plugin-atlas-binary-hash.mjs";

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
  // Phase 4.A.2 (atomic flip per addendum B1). The atlas-binary-hash
  // plugin owns `__ATLAS_BINARY_HASH__`, `__ATLAS_MISSING__`, and
  // `__RULESET_VERSION__` injection — its `config()` hook returns the
  // three keys with the values computed from the on-disk
  // `assets/atlas.png` plus `RULES_FILES`. The user-supplied `define`
  // here adds only `__COMMIT_HASH__` (git-derived).
  plugins: [atlasBinaryHashPlugin()],
  define: {
    __COMMIT_HASH__: JSON.stringify(readCommitHash()),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
