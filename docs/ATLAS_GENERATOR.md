# Atlas Generator — Design Notes

> **Status: drafted in the Phase 4 planning gate** alongside
> `artifacts/decision-memo-phase-4.md`, then **amended after the
> architecture-red-team review** (see the addendum at the bottom of
> the memo, "resolutions for B1–B8 and disposition of N1–N17").
> The byte-level contracts on this page are the steady-state shape
> the procedural-atlas pipeline targets. Changing any of them is a
> `rulesetVersion` bump. The decision memo (including its addendum)
> is the canonical reference; this doc summarizes the result and
> points back to the memo for rationale.

## What the atlas pipeline does

A standalone Node tool (`tools/gen-atlas.ts`) consumes an **atlas seed**
plus a **recipe registry** and emits two deterministic build-time
artifacts:

- `assets/atlas.png` — single indexed-PNG tile sheet, byte-identical
  across Linux / macOS / Windows.
- `assets/atlas.json` — canonical-JSON manifest mapping logical sprite
  IDs (`tile.floor.cyberfloor_01`, `monster.ice.daemon`, …) to atlas
  tile-grid coordinates.

The atlas binary's SHA-256 (`atlasBinaryHash`) is folded into
`rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)` (memo
decision 7), so visuals share a single version axis with rules.

## Build-time data flow

```
atlas seed                      assets/atlas.png         vite.config.ts
  │                                  ▲                          │
  ▼                                  │                          │
seedToBytes (Phase 2)        write file                         │
  │                                  ▲                          │
  ▼                                  │                          │
streamsForRun (Phase 1)       packAtlas (decision 3a)           │
  │                                  ▲                          │
  ▼                                  │                          │
streams.atlas(recipeId)       Uint8Array per recipe             │
  │                                  ▲                          │
  ▼                                  │                          ▼
recipe(prng, palette, ctx)  ────────┘                  read assets/atlas.png
  │                                                              │
  └─ primitives/                                                 ▼
     (paletteIndex, paletteSwap, paletteGradient,         atlasBinaryHash
      bayerThreshold, valueNoise2D, rectMask,                    │
      circleMask, lineMask, columnShift,                         ▼
      scanlineResidue)                                  rulesetVersion =
                                                          sha256(rulesText ‖
                                                                  atlasBinaryHash)
                                                                  │
                                                                  ▼
                                                          inject as
                                                          __RULESET_VERSION__
```

## Layer placement

`src/atlas/**` is a **build-time-only** peer of `src/sim/**` and
`src/mapgen/**`. It imports `src/core/**`, the recipe and palette
constants under itself, and `fdeflate` (the new pinned devDependency
for DEFLATE compression). It is forbidden from importing `src/sim/**`,
`src/mapgen/**`, `src/render/**`, `src/input/**`, `src/main.ts`, or any
browser-only path — same discipline as `src/core/**`. The
`src/render/**` layer (Phase 5+) reads `assets/atlas.png` +
`assets/atlas.json` at runtime via the manifest parser
(`src/atlas/manifest.ts`), but does **not** import recipe or encoder
code — that is build-time-only.

ESLint scope additions (memo decision 11) enforce these boundaries.
`docs/ARCHITECTURE.md` carries the layer table; this doc paraphrases
for readability.

## Frozen contracts (summary)

The 13 frozen contracts established in
`artifacts/decision-memo-phase-4.md` (full text in the "Frozen
contracts" section of the memo):

1. **Recipe primitive set** — exactly ten functions: `paletteIndex`,
   `paletteSwap`, `paletteGradient`, `bayerThreshold`, `valueNoise2D`,
   `rectMask`, `circleMask`, `lineMask`, `columnShift`,
   `scanlineResidue`. Floyd–Steinberg, Perlin, polygon-fill, and
   paint-bucket are deferred per memo decision 1.
2. **Recipe signature** — `(prng, palette, ctx) => Uint8Array` of
   length `tileSize * tileSize`, row-major palette indices.
3. **Recipe ID format** —
   `^atlas-recipe\.(cyberpunk)\.(tile|monster|item|npc|ui|boss)\.[a-z][a-z0-9_-]{0,31}$`,
   total ≤ 64 UTF-8 bytes, 7-bit ASCII.
4. **`streams.atlas(recipeId)` accessor** — added to `RunStreams`,
   records `"atlas:" + recipeId` into `__consumed`. Salt encoding
   `(name="atlas", salts=[recipeId])`. Distinct from
   `streams.sim()`, `streams.simFloor(N)`, `streams.mapgen(N)`,
   `streams.ui()` by construction (memo decision 1a). Per-call
   invariant: `streams.atlas(recipeId)` advances `__consumed.size`
   by **exactly 1** (memo addendum B8). Root seed for the atlas
   pipeline is derived via `atlasSeedToBytes(...)`, **not**
   `seedToBytes(...)` (memo addendum B7); the two are byte-distinct
   domains anchored by the literal `"icefall:atlas-seed:v1:"`
   prefix.
5. **Atlas layout constants** — `TILE_SIZE = 16`, `TILE_PADDING = 1`
   (transparent right + bottom), `ATLAS_TILES_WIDE = 16`,
   `ATLAS_TILES_HIGH = 8`. Atlas pixel dimensions are
   `272 × 136` for v1; well under the 256 KB binary budget.
   Bumping either tile-grid dimension is **coordinate-stable but
   binary-unstable** (the IHDR dimensions change → `atlasBinaryHash`
   bumps → `rulesetVersion` bumps); allowed only at a
   `rulesetVersion` boundary with `architecture-red-team` review
   (memo addendum B6). Cell budget at v1 is `8 × 16 = 128`, well
   above the Phase 7 ceiling of ~34 effective cells; no bump
   anticipated through v1.
6. **Atlas-grid placement** — registry-declaration order, row-major,
   multi-tile rectangles never split, no backfill, no compaction.
   Inserting a recipe at the *end* never moves earlier sprites'
   `(atlasX, atlasY)` — load-bearing for additive Phase 6/7 growth.
7. **PNG encoder format** — indexed PNG (color type 3), bit depth 8,
   `PLTE` + `tRNS` chunks, **no ancillary chunks** (no `gAMA`, `sRGB`,
   `cHRM`, `pHYs`, `tEXt`, `tIME`), filter type 0 ("None") for every
   scanline, `fdeflate` level 1 for DEFLATE, chunk order
   `IHDR, PLTE, tRNS, IDAT, IEND`. `tRNS` chunk length is exactly
   16 bytes for `paletteCount = 16` (memo addendum N6). Encoder
   uses `Uint8Array` only (no `Buffer`) and `@noble/hashes/sha256`
   only (no `crypto.subtle` / `node:crypto`); enforced by ESLint
   scope (memo addendum B4). Encoder asserts `pixels[i] <
   palette.colors.length` per pixel before emitting IDAT (memo
   addendum N5).
8. **Color palette** — 16 entries, `cyberpunk-neon-v1`. Entry 0 is
   transparent; entries 1–15 are fully opaque (no partial alpha).
9. **Atlas JSON manifest schema** — top-level keys
   alphabetical-sorted (`atlasBinaryHash, atlasSeed, generator,
   palette, schemaVersion, sprites`); per-sprite keys
   alphabetical-sorted (`atlasX, atlasY, recipeId, tilesHigh,
   tilesWide`); `sprites` map keys alphabetical-sorted; strict-parse
   (unknown / missing keys throw); coordinates in tile-grid units.
10. **`rulesetVersion` derivation** — `rulesetTextHash` pre-image is
    the alphabetically-sorted concatenation of `(utf8_path, NUL,
    sha256(normalizeForHash(content)), NUL)` tuples for each of the
    12 entries of `RULES_FILES`, where `normalizeForHash` strips a
    leading UTF-8 BOM and replaces all CRLF with LF (memo addendum
    B2 — supersedes the original 44-byte separator scheme);
    `rulesetVersion = sha256(utf8(rulesetTextHash) ‖ utf8("|") ‖
    utf8(atlasBinaryHash))`. `atlasBinaryHash` is computed by the
    `vite-plugin-atlas-binary-hash` plugin's `configResolved` hook
    (memo addendum B5), with deterministic
    `EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
    fallback when `assets/atlas.png` is missing. CRLF + BOM
    discipline is enforced at the file-system layer by
    `.gitattributes` (memo addendum B3) and at the test layer by
    `tests/build/rules-text.test.ts`.
11. **Atlas-loader DEV- refusal** — runtime loader throws when
    `rulesetVersion === PLACEHOLDER_RULESET_VERSION`.
12. **`ATLAS_DIGEST` golden** — pinned in `src/core/self-test.ts`
    next to `RANDOM_WALK_DIGEST`, `MAPGEN_DIGEST`, `SIM_DIGEST`.
13. **Atlas-loader hash check** — runtime loader hashes fetched
    `assets/atlas.png` and asserts equality with build-time
    `__ATLAS_BINARY_HASH__`.

## Phase 4 sprite coverage

Seven recipes ship in Phase 4.A.2:
- `tile.floor.cyberfloor_01`
- `tile.wall.cyberfloor_01`
- `tile.door.cyberdoor`
- `monster.ice.daemon`
- `item.cred-chip`
- `npc.ripperdoc`
- `player`

Phase 6 adds the remaining ~19 items; Phase 7 adds the remaining ~14
monsters, the boss, and the remaining 2 NPCs. All are additive to
the registry, so Phase 4 sprite coordinates remain stable
(decision 6 invariant).

## Atlas-seed lifecycle

- **Phase 4–8.** `ATLAS_SEED_DEFAULT =
  "icefall-phase4-placeholder-atlas-seed"`. Bumping is allowed
  without `architecture-red-team` review; each bump changes
  `assets/atlas.png` → `atlasBinaryHash` → `rulesetVersion` (this is
  expected during dev).
- **Phase 9.** Final v1 release atlas seed selected via the dev-mode
  preview UI (memo decision 9). Bumping post-Phase-9 requires
  `architecture-red-team` review and a new `releases/<commit>/`
  directory under Phase 8's content-addressed release layout.

## Build script

```
npm run gen-atlas    # vite-node tools/gen-atlas.ts
                     # → reads ATLAS_SEED_DEFAULT
                     # → runs every recipe deterministically
                     # → writes assets/atlas.png + assets/atlas.json
```

CI runs `npm run gen-atlas` followed by `git diff --exit-code
assets/`; non-empty diff fails the build with a
"run 'npm run gen-atlas' and commit" error. The CI step ordering
(memo addendum B5) is: (1) `npm run gen-atlas`, (2) `git diff
--exit-code assets/`, (3) `npm run build`, (4) `npm run test:e2e`
against `vite preview`. The cross-OS byte-equality job (Phase 4.B)
runs the same script on `ubuntu-latest`, `macos-latest`, and
`windows-latest` with `fail-fast: false` and `node-version: 20.x`
(memo addendum N14), and asserts SHA-256 equality of all three
generated `assets/atlas.png` files. Any change to `fdeflate`'s
version line in `package-lock.json` (including its `integrity`
hash) auto-flags an `architecture-red-team` review event (memo
addendum N1).

## Dev-mode preview UI

The deployed page (Phase 4+) hosts an `<section id="atlas-preview">`
with:
- Free-form atlas-seed text input (`#atlas-seed-input`); validated
  against the `seedToBytes` precondition (well-formed UTF-16,
  length 1..255) before being passed to `atlasSeedToBytes(...)`.
- Four preset-seed buttons (`placeholder`, `variant-A`, `variant-B`,
  `variant-C`); each has its own pinned `expectedHash` golden in
  `src/atlas/preset-seeds.ts` (memo addendum N12), and the Phase
  4.B Playwright job exercises all four.
- Side-by-side `<canvas>` showing the build-time atlas vs the
  user-typed seed's freshly-regenerated atlas.
- `<div id="atlas-preview-error">` element for invalid-seed and
  `__ATLAS_MISSING__` error display (memo addendum B4, B5).
- `window.__ATLAS_PREVIEW__`, `__ATLAS_PREVIEW_BUILD_HASH__`,
  `__ATLAS_PREVIEW_LIVE_HASH__`, `__ATLAS_PREVIEW_SEED__` flags for
  cross-runtime Playwright assertions.

The preview survives Phase 5+ (per `docs/PHASES.md:208`); Phase 9 may
collapse it into a dev-only dropdown.

## Test surfaces

Per memo decision 12:

- **Per-primitive unit tests** (`tests/atlas/primitives/`) — fixed
  inputs → hardcoded golden bytes.
- **Per-recipe golden hashes** (`tests/atlas/recipes/`) — each
  recipe's output buffer SHA-256 against a hardcoded hex.
- **Whole-atlas `ATLAS_DIGEST`** in `src/core/self-test.ts` — the
  load-bearing cross-runtime determinism assertion (Node + 3
  browsers).
- **Cross-OS PNG byte equality** — Phase 4.B GitHub Actions matrix
  on ubuntu-latest / macos-latest / windows-latest.
- **`parseAtlasJson` round-trip self-test** — mirrors Phase 2's
  `parseFloor` precedent.
- **`atlas-stream-isolation` self-test** — `streams.atlas(recipeId)`
  records exactly one `"atlas:..."` key, never sim/mapgen/ui keys.

## Out of scope (deferred)

- Floyd–Steinberg dither, Perlin noise, polygon-fill / paint-bucket
  primitives — memo decision 1.
- Boss recipe, full ~14-monster / ~19-item / 2-NPC content — Phases
  6 and 7.
- CRT shader (the `scanlineResidue` primitive bakes recipe-time
  scanlines; the runtime shader is Phase 9).
- Theme switching (interface designed; alternate themes deferred
  past v1).
- Atlas-recipe mods (data shape designed; mod loader deferred past
  v1).
- Animated sprites; atlas LOD; audio.

## Cross-references

- `artifacts/decision-memo-phase-4.md` — canonical decision memo
  (this doc summarizes; the memo justifies).
- `docs/SPEC.md` — "Sprite Atlas — Procedural Generation" section.
- `docs/PHASES.md` — Phase 4 deliverables, acceptance criteria,
  risks, phase split.
- `docs/ARCHITECTURE.md` — layer table, frozen contracts (updated
  in Phase 4.A.1's drift-detection sweep to reference Phase 4
  contracts).
