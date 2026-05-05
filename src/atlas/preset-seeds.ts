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
      "8ca99389737be61536458fd39dbf067af6959d207151566ddf9233fced390c3a",
  }),
  Object.freeze({
    id: "variant-A",
    seed: "icefall-atlas-variant-A",
    expectedHash:
      "9454e7223403ca23cea42185d70862a8cfab57a45b93dd16c333ef4feaee5bc5",
  }),
  Object.freeze({
    id: "variant-B",
    seed: "icefall-atlas-variant-B",
    expectedHash:
      "511f5ce57af4bd59d8caf668da18ef767cf4b74c21ebc6fc64ed4f168d08b3ad",
  }),
  Object.freeze({
    id: "variant-C",
    seed: "icefall-atlas-variant-C",
    expectedHash:
      "4bdf8392186cf7c1b6885c6e9f8839c165b755271cea46293ea5b59f74bb8c36",
  }),
]);
