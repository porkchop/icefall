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
      "a3f7e3caa857b5edbd1728a874b858484e58150658277a54dc9506f0489edb08",
  }),
  Object.freeze({
    id: "variant-A",
    seed: "icefall-atlas-variant-A",
    expectedHash:
      "5fea9dee7b220a5689eefaeecff0d44b302e1f2fa5554d499fce57a9e979dcd8",
  }),
  Object.freeze({
    id: "variant-B",
    seed: "icefall-atlas-variant-B",
    expectedHash:
      "61f8b72f24c98bb1e65b340e5c5b5dd7a3f0cd6f7801644a15fa701d1c5d2056",
  }),
  Object.freeze({
    id: "variant-C",
    seed: "icefall-atlas-variant-C",
    expectedHash:
      "51ac6293c0953047c3eb27aece3275cd6c17537fa68a74f75d480821c772893f",
  }),
]);
