import { defineConfig } from "vite";
import { execSync } from "node:child_process";

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
  define: {
    __COMMIT_HASH__: JSON.stringify(readCommitHash()),
    __RULESET_VERSION__: JSON.stringify(PLACEHOLDER_RULESET),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
