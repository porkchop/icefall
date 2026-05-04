/**
 * Phase 4 preset atlas seeds (memo decision 9 + addendum N12). Four
 * stable comparison seeds used by the diagnostic-page atlas-preview UI
 * + Phase 4.B Playwright assertions.
 *
 * Each entry has a pinned `expectedHash` (SHA-256 of `generateAtlas(seed).png`).
 * The hashes were computed during Phase 4.A.2 on the sandbox host (an
 * ubuntu-equivalent runner) and pasted literally here. Phase 4.B
 * re-verifies them on the cross-OS matrix (`ubuntu-latest` is the
 * primary source of truth).
 *
 * Bumping any `expectedHash` requires architecture-red-team review per
 * memo addendum N12.
 */

import { ATLAS_SEED_DEFAULT } from "./params";

export type AtlasPresetSeed = {
  readonly id: "placeholder" | "variant-A" | "variant-B" | "variant-C";
  readonly seed: string;
  readonly expectedHash: string;
};

export const ATLAS_PRESET_SEEDS: readonly AtlasPresetSeed[] = Object.freeze([
  Object.freeze({
    id: "placeholder",
    seed: ATLAS_SEED_DEFAULT,
    expectedHash:
      "d1b4a8b73d3e2c1b7cd70c26fe15a08faae5d91351d9e2e9a542ce71727b8d1a",
  }),
  Object.freeze({
    id: "variant-A",
    seed: "icefall-atlas-variant-A",
    expectedHash:
      "de525492c8e57d9a0d3a0cf0705473ea71c980fdb0531e23611b8b943e3fbb1b",
  }),
  Object.freeze({
    id: "variant-B",
    seed: "icefall-atlas-variant-B",
    expectedHash:
      "e06d80723b3a2fe417a53b908aa85a3a087e6c6ac41038bcc2fd809ddbe7dd3a",
  }),
  Object.freeze({
    id: "variant-C",
    seed: "icefall-atlas-variant-C",
    expectedHash:
      "2fd44a69293f6ad7acdff33cb8e30cc34fef4efc73ac6c79bdb3f4c0971d9233",
  }),
]);
