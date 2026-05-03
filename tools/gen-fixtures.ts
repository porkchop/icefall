/**
 * Phase 2.A fixture-pack regenerator. Reads `tests/fixtures/floors/manifest.json`
 * and writes one `<seedSlug>__floor<N>.json` and one `<seedSlug>__floor<N>.ascii`
 * per (seed, floor) pair. CI fails if `git diff tests/fixtures/floors/` is
 * non-empty after regeneration.
 *
 *   npm run gen-fixtures
 *
 * Build-time-only Node code. Lives under `tools/` per the layer table.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateFloor,
  renderAscii,
  serializeFloor,
} from "../src/mapgen/index";
import { streamsForRun } from "../src/core/streams";
import { seedToBytes } from "../src/core/seed";

type ManifestEntry = { seed: string; floor: number };
type Manifest = { pairs: ManifestEntry[] };

const FIXTURE_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "tests", "fixtures", "floors");
})();
const MANIFEST_PATH = join(FIXTURE_DIR, "manifest.json");

function slug(seed: string): string {
  // Restrict to ASCII alnum + hyphen for safe filenames; reject anything
  // that would produce a different on-disk name across OSes.
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      c === 0x2d;
    if (!ok) {
      throw new Error(
        `gen-fixtures: seed "${seed}" contains a non-[A-Za-z0-9-] character at index ${i}`,
      );
    }
  }
  return seed;
}

export function fixturePathFor(
  entry: ManifestEntry,
  ext: "json" | "ascii",
): string {
  return join(FIXTURE_DIR, `${slug(entry.seed)}__floor${entry.floor}.${ext}`);
}

export function generatePair(entry: ManifestEntry): {
  json: string;
  ascii: string;
} {
  const streams = streamsForRun(seedToBytes(entry.seed));
  const f = generateFloor(entry.floor, streams);
  return { json: serializeFloor(f), ascii: renderAscii(f) };
}

export function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as Manifest;
  if (!Array.isArray(parsed.pairs)) {
    throw new Error("gen-fixtures: manifest.json missing 'pairs' array");
  }
  return parsed;
}

export function main(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const manifest = readManifest();
  let written = 0;
  for (const entry of manifest.pairs) {
    const pair = generatePair(entry);
    writeFileSync(fixturePathFor(entry, "json"), pair.json);
    writeFileSync(fixturePathFor(entry, "ascii"), pair.ascii);
    written += 2;
  }
  console.log(
    `gen-fixtures: wrote ${written} files for ${manifest.pairs.length} (seed, floor) pairs`,
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
