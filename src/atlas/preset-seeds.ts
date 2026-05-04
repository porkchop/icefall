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
      "35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47",
  }),
  Object.freeze({
    id: "variant-A",
    seed: "icefall-atlas-variant-A",
    expectedHash:
      "c3dc8c8b50592e2c7383d2cafd02d2932afd27a1f898bea9aadc82a5299c7396",
  }),
  Object.freeze({
    id: "variant-B",
    seed: "icefall-atlas-variant-B",
    expectedHash:
      "405713dfbbbc9b57e2ee3e08b47abe6436d3199ceb2613b602829532bbeef0f8",
  }),
  Object.freeze({
    id: "variant-C",
    seed: "icefall-atlas-variant-C",
    expectedHash:
      "f77e1a28d6cfe0452ab790503996e787f46a240b2818d8adc1dedfadadbef01c",
  }),
]);
