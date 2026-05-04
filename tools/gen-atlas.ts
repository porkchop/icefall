/**
 * Phase 4 atlas generator entry point (memo decision 10). Runs
 * `generateAtlas(ATLAS_SEED_DEFAULT)` and writes:
 *   - `assets/atlas.png`
 *   - `assets/atlas.json`
 * relative to the repository root. CI fails if `git diff --exit-code
 * assets/` is non-empty after running.
 *
 * Usage: `npm run gen-atlas` (mirrors `gen-floor` / `gen-fixtures`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAtlas } from "../src/atlas/generate";
import { serializeAtlasManifest } from "../src/atlas/manifest";
import { ATLAS_SEED_DEFAULT } from "../src/atlas/params";

const ASSETS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "assets");
})();

export function main(): void {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const { png, manifest } = generateAtlas(ATLAS_SEED_DEFAULT);
  const manifestText = serializeAtlasManifest(manifest);
  writeFileSync(join(ASSETS_DIR, "atlas.png"), png);
  writeFileSync(join(ASSETS_DIR, "atlas.json"), manifestText);
  console.log(
    `gen-atlas: wrote ${png.length} byte atlas.png + ${manifestText.length} byte atlas.json under seed ${JSON.stringify(ATLAS_SEED_DEFAULT)}`,
  );
}

function runIfEntry(): void {
  if (typeof process === "undefined") return;
  if (process.env["VITEST"] !== undefined) return;
  try {
    main();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exit(1);
  }
}
runIfEntry();
