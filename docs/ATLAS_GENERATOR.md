# Atlas Generator — Design Notes

> **Status: placeholder.** This document is drafted in the Phase 4 planning gate by `strategy-planner` and reviewed by `architecture-red-team` before any atlas-generator code is written. See `docs/PHASES.md` Phase 4 for context.

## What this document will cover

When written, this document will resolve the following decisions:

- **Recipe primitive set.** The exact list of pure functions exposed to recipes (palette ops, ordered and error-diffusion dither, value/Perlin noise, shape masks, glitch ops). This becomes the modding surface for atlas-recipe mods later, so the set must be small and orthogonal.
- **Recipe registration contract.** Stable IDs, versioning, the `(seededRng, palette) → PNG bytes` signature, and how recipes declare their target sprite slot.
- **Atlas layout strategy.** Fixed grid versus packing, padding rules, target tile size, atlas binary size budget (target: under 256 KB).
- **Deterministic PNG encoding.** The specific encoder, compression level, and any platform-specific quirks that need pinning to make the atlas binary byte-identical across Linux, macOS, and Windows CI runners.
- **`rulesetVersion` integration.** Exactly when `atlasBinaryHash` is computed in the build, where it is injected, and how the build fails if the checked-in `assets/atlas.png` is stale.
- **Dev-mode preview UI.** Atlas-seed slider, side-by-side comparison view, and the workflow for choosing the v1 atlas seed during Phase 9 tuning.

## Out of scope

- Specific recipe implementations (those land in `src/atlas/recipes/` during Phase 4 and are extended in Phases 6 and 7).
- Theme-swapping (deferred past v1; this doc commits to interface seams that make it possible later).
- Audio generation (procedural in spirit, but a separate future document).

## Cross-references

- `docs/SPEC.md` — "Sprite Atlas — Procedural Generation" section
- `docs/PHASES.md` — Phase 4 (planning gate, deliverables, acceptance criteria, risks)
- `docs/ARCHITECTURE.md` — overall system architecture (drafted in the Phase 1 planning gate)
