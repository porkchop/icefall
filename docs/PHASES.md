# PHASES — ICEFALL

This document defines the phase plan. Each phase ends with a working artifact, a code review, a QA pass, and a `phase-approval-N.json` committed to `artifacts/`. Phases do not begin until the prior phase's commit has landed on master.

For each phase the doc lists: **Goal**, **Lead agent**, **Reviewers**, **Deliverables**, **Acceptance criteria**, **Risks**.

**Planning gates** (require a `decision-memo.md` plus an `architecture-red-team` review before code begins): phases 1.A, 2, 3, 4, and 8.

**Public-from-day-one.** Every phase's merged deliverable is automatically deployed to GitHub Pages (set up in Phase 1). This means each phase ends with something a stranger can click and play, the deploy pipeline is battle-tested gradually, and Phase 8 only needs to add the content-addressed layer on top of an already-proven pipeline.

---

## Phase 1 — Deterministic Core + Public Deployment

> **Phase 1 split.** Per `artifacts/decision-memo-phase-1.md` (red-team
> blocking issue B3), Phase 1 is split into **Phase 1.A** (everything
> producible inside the sandbox) and **Phase 1.B** (live GitHub Pages
> verification, which requires an external push). Phase 2 cannot begin
> until **both** are approved. The original Phase 1 acceptance criteria
> are partitioned between 1.A and 1.B below.

**Goal.** Build the substrate that everything else stands on: seeded PRNG, sync hashing, RNG streams, state-hash chain, run fingerprint. Plus a working public deploy pipeline so every subsequent phase ships live to GitHub Pages on merge.

**Lead agent.** `engine-builder` (core), `release-hardening` (deploy)
**Reviewers.** `architecture-red-team`, `code-reviewer`

**Deliverables.**

*Core engine:*
- `src/core/prng.ts` — `mulberry32` or `sfc32`, fully unit-tested
- `src/core/hash.ts` — sync SHA-256 wrapper (browser SubtleCrypto + tiny pure-JS fallback for hot paths)
- `src/core/streams.ts` — RNG stream split off a root seed (`mapgen`, `sim`, `ui`)
- `src/core/fingerprint.ts` — `sha256(commitHash ‖ rulesetVersion ‖ seed ‖ sortedModIds)` and the URL-safe encoding
- `src/core/state-chain.ts` — running state hash advanced by deterministic action descriptors
- Build-time injection of `commitHash` and `rulesetVersion` into the bundle (placeholder `rulesetVersion` until Phase 4 wires in the atlas hash)

*Project scaffolding:*
- TypeScript, Vite, Vitest, ESLint with custom determinism rules
- Vite `base` path configured for GitHub Pages subpath deployment (`/icefall/`)
- Minimal `index.html` and entry point — for Phase 1 it just renders a "core engine ready" diagnostic page that runs the determinism self-tests in the browser and shows the build's `commitHash`

*Deployment pipeline:*
- `.github/workflows/deploy.yml` — GitHub Actions workflow that builds and deploys to GitHub Pages on every push to `main`
- Workflow uses official `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`
- Workflow permissions: `pages: write`, `id-token: write`, `contents: read`
- Concurrency group set so overlapping pushes don't race
- For now the pipeline deploys only `latest` — the content-addressed `releases/<commit>/` layout is added in Phase 8

*README:*
- `README.md` with a prominent "▶ Play live" link to `https://porkchop.github.io/icefall/` at the top
- Workflow status badge for the deploy job
- One-paragraph project description, link to `docs/SPEC.md` for details

**Acceptance criteria — Phase 1.A (in-sandbox).**
- Node-side determinism test: a 1,000-step random-walk produces an identical hardcoded golden digest on every Node run (asserted by `src/core/self-test.test.ts`).
- Fingerprint round-trips: same `(commit, ruleset, seed, mods)` always produces the same fingerprint string; sorting of mod IDs is stable; placeholder ruleset emits a `DEV-` sentinel prefix that Phase 4 will refuse to load.
- 100% line coverage on `src/core/*` (Vitest v8 coverage threshold enforced; build fails below threshold).
- Custom lint rules in place and enforced: no `Math.random`, no `Date.now()`/`performance.now()`/`new Date()` in `core/` or `sim/`, no floating-point arithmetic in `sim/` (per the rule contract in the decision memo), no iteration over un-ordered collections in `sim/`. Each rule has fixture tests.
- `.github/workflows/deploy.yml` exists with pinned action versions, the required permissions block (`pages: write`, `id-token: write`, `contents: read`), the concurrency group, and runs `npm ci && npm run lint && npm run test && npm run build` before deploying.
- `playwright.config.ts` and `tests/e2e/diagnostic.spec.ts` exist and are wired into the CI workflow's `npm run test:e2e` job (executed once browsers are reachable in CI, not in the sandbox).
- README contains the workflow status badge, a "▶ Play live" link, a one-paragraph project description, and a link to `docs/SPEC.md`.

**Acceptance criteria — Phase 1.B (external verification, post-push).**
- Push to `main` triggers the deploy workflow; the workflow completes green within five minutes.
- The GitHub Pages URL serves the current build of `main` and shows the diagnostic page with a green "self-test passed" indicator.
- README's "Play live" link resolves to a working page.
- The CI Playwright job runs `tests/e2e/diagnostic.spec.ts` against `chromium`, `firefox`, `webkit` and reports green on all three; it asserts the same `RANDOM_WALK_DIGEST` constant the Node suite asserts, proving cross-runtime determinism end-to-end.

**Risks.**
- Floating-point drift in hot paths — mitigated by the lint rule banning floats in `sim/` plus a CI test that asserts a hardcoded golden state-hash digest across all four runtimes.
- SubtleCrypto is async, which complicates hot-path use — mitigated by using a sync SHA-256 implementation everywhere (`@noble/hashes/sha256`); SubtleCrypto deferred to a possible later optimization path with no contract impact.
- Vite asset pathing under a GitHub Pages subpath is a common foot-gun — pinned by the `base` config and verified by a Playwright smoke that mirrors the subpath under `vite preview` in 1.A; the live verification in 1.B is the final check.

---

## Phase 2 — Map Generation

> **Phase 2 split.** Per `artifacts/decision-memo-phase-2.md` and the
> attached `architecture-red-team` review (see `artifacts/red-team-phase-2.md`),
> Phase 2 is split into **Phase 2.0** (planning gate — decision memo + red-team
> review + addendum + Phase 1 carry-forward follow-ups), **Phase 2.A**
> (sandbox-verifiable implementation), and **Phase 2.B** (live GitHub Pages
> verification, which requires an external push). Phase 3 cannot begin until
> all three are approved. The original Phase 2 acceptance criteria are
> partitioned between 2.A and 2.B below; Phase 2.0 introduces no new
> acceptance criteria of its own beyond planning-gate compliance.

**Goal.** Generate dungeon floors deterministically from `(seed, floorN)`. Floors are 2D grids of tiles with rooms, corridors, doors, and pre-slotted encounter markers. Output is plain data — no rendering yet.

**Lead agent.** `engine-builder`
**Reviewers.** `architecture-red-team`, `code-reviewer`

**Deliverables.**
- `src/mapgen/` — room placement, corridor carving, door placement, encounter slotting
- `src/registries/rooms.ts`, `src/registries/encounters.ts` — stable-ID registries
- JSON serialization of generated floors for golden-output tests
- CLI tool: `npm run gen-floor -- --seed <X> --floor <N>` prints an ASCII rendering of a floor to stdout for human inspection
- A "fixture pack": 20 fixed `(seed, floor)` pairs with their golden ASCII output committed to the repo
- The deployed diagnostic page is extended to include an in-browser ASCII floor preview, so anyone visiting the live URL can see mapgen working
- A property-style reachability sweep over 200 deterministic seeds × floors 1–10 (per red-team review N4)
- CI workflow uploads `vite build --report` (rollup-plugin-visualizer treemap) as the `bundle-report` artifact (per red-team review N5)

**Acceptance criteria — Phase 2.0 (planning gate).**
- `artifacts/decision-memo-phase-2.md` exists and was reviewed by `architecture-red-team` before any Phase 2 implementation code is written.
- The red-team review at `artifacts/red-team-phase-2.md` exists; any blocking issues it raised are addressed via an in-memo addendum that supersedes the original prose.
- The two Phase 1 carry-forward follow-ups land before Phase 2.A code begins:
  - `code-review #2` — bump `eslint-rules/no-float-arithmetic` invalid-fixture count beyond 20 (target ≥ 25).
  - `code-review #8` — add a unit test asserting `encodeAction` emits optional fields in strictly increasing tag order across all 2^k field-presence combinations.

**Acceptance criteria — Phase 2.A (in-sandbox).**
- Same `(seed, floor)` always produces the same floor (golden test on the 20-pair fixture pack).
- Every floor has exactly one entrance and exactly one exit, except floor 10 which has an entrance and a boss room.
- All rooms reachable from the entrance (graph connectivity test, asserted both as a runtime invariant inside `generateFloor` and as a 200-seed property sweep).
- Floor 10 is structurally distinguished: a single large boss arena reachable from the entrance.
- Mapgen consumes only the `streams.mapgen(floorN)` stream, never the sim or ui streams — verified by the runtime guard contract pinned in the decision memo's addendum (per-call delta on `RunStreams.__consumed` equals exactly `{"mapgen:"+floorN}`), plus a lint rule, plus a self-test that runs in the browser.
- All frozen contracts established by the decision memo (tile codes, JSON shape, registry IDs, ASCII char mapping, base64url alphabet, always-present null-fields, strict parser, `seedToBytes`) are implemented and have at least one regression-failing test.
- Bundle size budget: `dist/`-gzipped ≤ 75 KB; `bundle-report` uploaded as a CI artifact.
- `npm ci && npm run lint && npm run test && npm run build && npm run test:e2e` all green inside the sandbox.

**Acceptance criteria — Phase 2.B (external verification, post-push).**
- The live GitHub Pages URL serves the updated diagnostic page with the in-browser ASCII floor preview working.
- The Phase 2.B Playwright job exercises the preview UI (set seed, set floor, click "Generate floor", assert `window.__FLOOR_PREVIEW__ === "ready"`, assert the rendered ASCII matches the expected golden output for that seed/floor pair) on chromium, firefox, and webkit.

**Risks.**
- Map gen accidentally consuming sim-stream RNG would silently couple level layout to combat outcomes — contained by the stream split, the runtime per-call delta guard, the lint rule, and the in-browser self-test.
- Frozen-contract drift across runtimes — contained by the byte-equality fixture-pack tests and the new `mapgen-cross-runtime-digest` self-test.

---

## Phase 3 — Entity Model, Turn Loop, Combat

> **Phase 3 split.** Per `artifacts/decision-memo-phase-3.md` decision 14
> and the attached `architecture-red-team` review (see
> `artifacts/red-team-phase-3.md`), Phase 3 is split into **Phase 3.0**
> (planning gate — decision memo + red-team review + addendum
> resolving B1–B6), **Phase 3.A.1** (drift-detection sweep — Phase 2.A
> code-review carry-forwards N7 decoder relocation + N3 gen-fixtures
> unit test + ARCHITECTURE.md update referencing Phase 3 frozen
> contracts), **Phase 3.A.2** (sandbox-verifiable sim implementation),
> and **Phase 3.B** (live GitHub Pages verification, which requires an
> external push). Phase 4 cannot begin until all four are approved.
> Phase 3.0 introduces no new acceptance criteria of its own beyond
> planning-gate compliance; Phase 3.A.1 is the no-net-new-sim drift
> sweep that the addendum requires before sim implementation begins;
> Phase 3.A.2 implements the sim per the decision memo's frozen
> contracts; Phase 3.B re-verifies the diagnostic-page extension on
> the live deployed URL.

**Goal.** Headless simulation. The player and monsters move on the grid, take turns, and resolve combat against the state hash. No rendering; controlled by a synthetic input feeder for testing.

**Lead agent.** `engine-builder`
**Reviewers.** `architecture-red-team`, `code-reviewer`

**Deliverables.**
- `src/sim/entity.ts`, `src/sim/turn.ts`, `src/sim/combat.ts`
- `src/registries/monsters.ts`, `src/registries/items.ts` (items present as data, no inventory mechanics yet)
- Action descriptor schema: `{ type, target?, item? }` — small, stable, hashable
- `src/sim/run.ts` — top-level run state machine; takes `(fingerprintInputs, actionLog)` → `RunState`
- A "headless playthrough" test harness: scripted action log → final state hash
- Diagnostic page extended with a "run a scripted playthrough" button that exercises the harness in the live deployment

**Acceptance criteria — Phase 3.0 (planning gate).**
- `artifacts/decision-memo-phase-3.md` exists and was reviewed by `architecture-red-team` before any Phase 3 implementation code is written.
- The red-team review at `artifacts/red-team-phase-3.md` exists; all six blocking issues (B1–B6) are addressed via an in-memo addendum that supersedes the original prose.
- A follow-up `architecture-red-team` review of the addendum confirms blocker resolution (verdict APPROVE or APPROVE WITH NITS).

**Acceptance criteria — Phase 3.A.1 (drift-detection sweep).**
- Phase 2.A code-review carry-forward N7 — `decodeBase64Url` and `B64URL_REVERSE` relocated from `src/mapgen/serialize.ts` to `src/core/hash.ts` alongside the existing `base64url` encoder; `src/mapgen/serialize.ts` imports from `src/core/hash`; error-message prefix renamed to `decodeBase64Url:`; focused unit tests cover all `r mod 4 ∈ {0, 2, 3}` branches plus the `r === 1` reject path plus invalid-character path plus high-codepoint path plus empty round-trip plus 50-seed property round-trip; 100% line / branch / function coverage on `src/core/hash.ts` without relying on transitive coverage from `src/mapgen/**`.
- Phase 2.A code-review carry-forward N3 — `tools/gen-fixtures.ts` has a focused unit test under `tests/tools/gen-fixtures.test.ts` covering `slug` rejection on non-alphanumeric input (via `fixturePathFor`), `generatePair` happy path including determinism + JSON round-trip + ASCII trailing-newline contract, and `readManifest` shape validation.
- `docs/ARCHITECTURE.md` is updated to reference Phase 3's frozen contracts (action vocabulary, roll-derivation function, roll-domain registry, combat damage formula, player-id pin, turn order, AI zero-PRNG / zero-roll claim, `streams.simFloor(floorN)` accessor, per-tick `__consumed`-empty invariant, `RunState.outcome` set, `MAX_LOS_RADIUS = 8`, `SIM_DIGEST` golden constant, damage-clamp + short-circuit, plus deferred contracts: one-way descent, verifier trailing-after-terminal).
- `npm ci && npm run lint && npm run test && npm run build` all green inside the sandbox, with no net-new `src/sim/**` code.

**Acceptance criteria — Phase 3.A.2 (sandbox-verifiable sim implementation).**
- A 100-action scripted run on a fixed `FingerprintInputs` produces the same final state hash on every machine and across both Node and browser builds (asserted by the new `sim-cross-runtime-digest` self-test against a hardcoded `SIM_DIGEST`).
- Combat outcomes are computed solely from `H(stateHashPre ‖ encodeAction(action) ‖ "icefall:roll:v1:" ‖ lp(domain) ‖ u32_le(index))` — no other entropy enters the per-action sim path (asserted by the `sim-stream-isolation` self-test which verifies per-tick `__consumed` delta is empty).
- Death and boss-kill state transitions are reachable via the test harness.
- Replay invariant: any prefix of an action log replays to the same intermediate state.
- All Phase 3 frozen contracts (decision memo addendum items 1–13) are implemented and have at least one regression-failing test.
- `npm ci && npm run lint && npm run test && npm run build && npm run test:e2e` all green inside the sandbox.

**Acceptance criteria — Phase 3.B (external verification, post-push).**
- The live GitHub Pages URL serves the updated diagnostic page with the in-browser scripted-playthrough button working.
- The Phase 3.B Playwright job exercises the scripted-playthrough button (click → assert `window.__SIM_FINAL_STATE_HASH__` equals the expected hex digest, assert `window.__SIM_OUTCOME__` is one of `running | dead | won`) on chromium, firefox, and webkit.

**Risks.**
- Object iteration order leaking nondeterminism — covered by a project-wide rule of using sorted arrays for any iterated collection in sim code.
- Action descriptor schema changes mid-project would invalidate existing fingerprints — once adopted, schema changes require a `rulesetVersion` bump.

---

## Phase 4 — Procedural Atlas Generator (Planning Gate)

> **Phase 4 split.** Per `artifacts/decision-memo-phase-4.md` decision 13
> as amended by the addendum (resolutions B1–B8) and the attached
> `architecture-red-team` review (see `artifacts/red-team-phase-4.md`),
> Phase 4 is split into **Phase 4.0** (planning gate — decision memo +
> red-team review + addendum resolving B1–B8), **Phase 4.A.1**
> (drift-detection sweep — Phase 3.A.2 code-review carry-forwards +
> `uniformIndex` relocation to `src/core/prng.ts` + `fflate`
> devDependency exact-pinned + `.gitattributes` with `assets/atlas.png
> binary` + LF normalization + `tests/build/rules-text.test.ts`
> CRLF/BOM scan + `vite-plugin-atlas-binary-hash` scaffolding with
> `EMPTY_SHA256` fallback + `deriveRulesetVersion` helper
> defined-but-unused + `docs/ARCHITECTURE.md` update referencing Phase
> 4 frozen contracts and the new `atlasSeedToBytes` domain anchor),
> **Phase 4.A.2** (sandbox-verifiable atlas implementation:
> primitives, recipes, registry, encoder, manifest, generator,
> preview UI, ATLAS_DIGEST self-test, the call-site flip from
> `PLACEHOLDER_RULESET_VERSION` to the real derivation, and
> `assets/atlas.png` + `assets/atlas.json` — all in the same commit
> per addendum B1), and **Phase 4.B** (live-deploy verification +
> cross-OS PNG byte-equality matrix on the GitHub Actions
> ubuntu-latest / macos-latest / windows-latest runners with
> `fail-fast: false` and `node-version: 20.x` per addendum N14).
> Phase 5 cannot begin until all four are approved. Phase 4.0
> introduces no new acceptance criteria of its own beyond
> planning-gate compliance; Phase 4.A.1 is the no-net-new-atlas
> drift sweep (no placeholder retirement, no `__RULESET_VERSION__`
> call-site flip — the helper is defined but unused, so master
> between 4.A.1 and 4.A.2 continues to inject the Phase 1
> placeholder); Phase 4.A.2 implements the atlas pipeline and
> retires the placeholder in the same commit; Phase 4.B re-verifies
> the diagnostic-page atlas-preview section on the live deployed
> URL and asserts cross-OS PNG byte equality.

**Goal.** Build the deterministic art pipeline. A standalone tool generates `assets/atlas.png` and `assets/atlas.json` from an atlas seed plus a recipe registry. The atlas binary hash is folded into `rulesetVersion`.

**Lead agent.** `engine-builder` (generator), `frontend-builder` (preview UI)
**Reviewers.** `architecture-red-team`, `code-reviewer`

**Why this is a planning gate.** The atlas generator's output shape, recipe API, and sub-generator vocabulary are load-bearing for the project's identity. They affect modding, theme-swapping, and the rulesetVersion contract. A `decision-memo.md` covers: recipe primitive set (palette ops, dither, noise, masks, glitch ops), how recipes are registered with stable IDs, atlas layout strategy (fixed grid vs packing), how `rulesetVersion` incorporates `atlasBinaryHash`, and the dev-mode preview UI. See `docs/ATLAS_GENERATOR.md`.

**Deliverables.**
- `tools/gen-atlas.ts` — Node-runnable, deterministic atlas generator
- `src/atlas/primitives/` — pure functions: palette ops, ordered dither, value/perlin noise (seeded), shape masks, glitch ops
- `src/atlas/recipes/` — per-slot recipes producing PNG byte data given a seeded RNG and palette
- `src/registries/atlas-recipes.ts` — stable-ID registry mapping logical sprite IDs to recipes
- `assets/atlas.png` and `assets/atlas.json` checked in (regeneratable from source)
- `npm run gen-atlas` script: regenerates atlas, fails CI if `git diff assets/` is non-empty
- Build wiring: `rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)` with `atlasBinaryHash` computed at build time
- Dev-mode preview page: render the current atlas and offer a slider for atlas-seed variants — deployed live so atlas tuning can happen against the deployed environment
- Initial recipe coverage for floor tile, wall tile, door, one monster, one item, one NPC, player sprite — enough to validate the pipeline before Phase 5 needs the full content set

**Acceptance criteria — Phase 4.0 (planning gate).**
- `artifacts/decision-memo-phase-4.md` exists and was reviewed by `architecture-red-team` before any Phase 4 implementation code is written.
- The red-team review at `artifacts/red-team-phase-4.md` exists; any blocking issues it raised are addressed via an in-memo addendum that supersedes the original prose.

**Acceptance criteria — Phase 4.A.1 (drift-detection sweep).**
- Phase 3.A.2 code-review carry-forwards (if any) landed.
- `uniformIndex` relocated from `src/sim/run.ts` to `src/core/prng.ts`; focused unit tests cover termination, unbiased distribution, and `n=1` boundary; 100% line / branch / function coverage on `src/core/prng.ts` preserved.
- `fflate` devDependency added to `package.json` (exact-pinned; no caret, no tilde); `package-lock.json` `integrity` hash recall flagged in the `architecture-red-team` checklist (addendum N1). Note: the addendum text named this dependency `fdeflate`, which does not exist on the npm registry — `fflate` is the actual canonical pure-JS sync deterministic deflate library and is the equivalent the addendum's encoder discipline (level pinning, deterministic IDAT output, no native code) was specifying. See decision-memo-phase-4.md addendum-2 (Phase 4.A.1 implementation discovery) for the substitution rationale.
- `.gitattributes` created at the repo root with the byte-exact content pinned in addendum B3 (includes `assets/atlas.png binary` and `* text=auto eol=lf`).
- `tests/build/rules-text.test.ts` added; asserts every entry of `RULES_FILES` (addendum B2) has LF endings and no UTF-8 BOM, with the pinned error-message format.
- `vite-plugin-atlas-binary-hash` scaffolding added in `scripts/vite-plugin-atlas-binary-hash.mjs`; the plugin is wired into both `vite.config.ts` and `vitest.config.ts`; with `assets/atlas.png` absent, the plugin injects `__ATLAS_BINARY_HASH__ = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"` (the SHA-256 of the empty byte string) and `__ATLAS_MISSING__ = true` via `JSON.stringify` (addendum B5, N17).
- `deriveRulesetVersion(rulesText, atlasBinaryHash)` helper exported from `src/build-info.ts`; the helper is **defined but not yet called** at the `define`-block site (addendum B1). `vite.config.ts` and `vitest.config.ts` continue to inject `PLACEHOLDER_RULESET_VERSION` for `__RULESET_VERSION__` until Phase 4.A.2 lands the atlas binary.
- `docs/ARCHITECTURE.md` updated to reference Phase 4 frozen contracts (recipe primitive set, recipe signature, recipe ID format, `streams.atlas(recipeId)` accessor with per-call `__consumed.size` += 1 invariant, atlas layout constants with the tile-grid resize rule from addendum B6, atlas-grid placement function, PNG encoder format with the all-16-byte `tRNS` chunk and per-pixel palette-bounds check from addendum N5/N6, color palette, atlas JSON manifest schema, `rulesetVersion` derivation per addendum B2, atlas-loader DEV- refusal + hash check with pinned error strings per addendum N7, `ATLAS_DIGEST` golden constant), the new `src/atlas/**` layer-table entry including `src/atlas/seed.ts` and `atlasSeedToBytes` per addendum B7, the new ESLint scope additions including `node:buffer` / `crypto` / `node:crypto` / `crypto.subtle` / `Buffer` per addendum B4 and bare-`fs`/`path` per addendum N10, and the deferred contracts.
- `npm ci && npm run lint && npm run test && npm run build` all green inside the sandbox, with no net-new `src/atlas/**` recipe code.

**Acceptance criteria — Phase 4.A.2 (sandbox-verifiable atlas implementation).**
- `npm run gen-atlas` produces a byte-identical PNG on the sandbox host OS (cross-OS verification deferred to 4.B).
- `assets/atlas.json` schema validates and references only IDs registered in `atlas-recipes.ts`; the manifest's `atlasBinaryHash` matches the actual `assets/atlas.png` SHA-256.
- The `vite.config.ts` and `vitest.config.ts` `define`-block call sites are flipped from `PLACEHOLDER_RULESET_VERSION` to `deriveRulesetVersion(rulesText, atlasBinaryHash)` (per addendum B1, in the same commit that lands `assets/atlas.png`); the `__RULESET_VERSION__` injection uses `JSON.stringify` (per addendum N17). The atlas loader refuses any build whose `rulesetVersion === PLACEHOLDER_RULESET_VERSION` with the exact error string pinned in addendum N7.
- The seven initial recipes render at the target tile size with no transparency or palette bleed bugs; encoder uses `Uint8Array` only (no `Buffer`) and `@noble/hashes/sha256` only (no `crypto.subtle` / `node:crypto`) per addendum B4; encoder asserts `pixels[i] < palette.colors.length` per pixel per addendum N5.
- Atlas binary size budget: under 256 KB (Phase 4 actual: under 16 KB); JS bundle-report shows total `dist/`-gzipped under 75 KB (addendum N8).
- `ATLAS_DIGEST` cross-runtime self-test passes in Node and in `vite preview`-served browsers; `atlas-stream-isolation` (rewritten per addendum B8 to use `__consumed.size === 1`), `atlas-manifest-parse`, and `atlas-encoder-cross-runtime` (added per addendum B4) self-tests pass.
- All Phase 4 frozen contracts (final form per addendum) implemented and have at least one regression-failing test, including: the wrap-with-skip atlas-grid edge case (addendum N9), the non-canonical-input manifest round-trip (addendum N15), and the four preset-seed `expectedHash` golden assertions (addendum N12).
- Layer-import lint rules added to `eslint.config.js`; fixture tests confirm the no-restricted-imports surface for `src/atlas/**` covers `node:buffer`, `crypto`, `node:crypto`, `crypto.subtle`, `Buffer`, and the bare-`fs`/`path` ban for `tools/**`.
- `npm ci && npm run lint && npm run test && npm run build && npm run test:e2e` all green inside the sandbox.

**Acceptance criteria — Phase 4.B (live-deploy + cross-OS verification).**
- `npm run gen-atlas` produces a byte-identical PNG on `ubuntu-latest`, `macos-latest`, and `windows-latest` CI runners — asserted by a new `cross-os-atlas-equality` GitHub Actions job (matrix `fail-fast: false`, `node-version: 20.x` per addendum N14) whose aggregator step asserts pairwise SHA-256 equality of the generated `assets/atlas.png`.
- The live GitHub Pages URL serves the updated diagnostic page with the in-browser atlas-preview section working.
- The Phase 4.B Playwright job exercises the atlas-preview section on chromium / firefox / webkit: asserts `window.__ATLAS_PREVIEW__ === "ready"`, asserts `window.__ATLAS_PREVIEW_BUILD_HASH__ === window.__ATLAS_PREVIEW_LIVE_HASH__` on `ATLAS_SEED_DEFAULT`, and asserts each of the four preset seeds (`placeholder`, `variant-A`, `variant-B`, `variant-C`) regenerates to its pinned `expectedHash` per addendum N12.
- The four preset-seed `expectedHash` values are computed during 4.A.2 on the `ubuntu-latest` shard of the cross-OS matrix and pasted into `src/atlas/preset-seeds.ts` literally before live deploy is approved (addendum N12).
- The atlas preview page is live at the deployed URL.

**Risks.**
- PNG encoder nondeterminism (e.g. zlib compression-level differences across platforms) would break atlas-hash reproducibility — mitigated by pinning a single deterministic encoder and asserting byte-equality in CI.
- Recipe API shape locked once mods care about it — addressed by the planning gate.
- Programmer-art recipes might look bad enough to demoralize — Phase 9 explicitly tunes the generator; intermediate "ugly but reproducible" output is acceptable through Phase 8.

---

## Phase 5 — Renderer + Input

> **Phase 5 split.** Per `artifacts/phase-update-phase-5.json` (the
> phase-update artifact recording the split decision after Phase 4.B's
> cross-OS matrix verified Phase 4 end-to-end), Phase 5 is split into
> **Phase 5.A.1** (drift-detection sweep — Phase 3.A.2 cosmetic
> carry-forwards now load-bearing because Phase 5 will exercise sim
> code; Phase 4.A.2 carry-forwards N4–N7 from
> `artifacts/code-review-phase-4-A-2.md`; ARCHITECTURE.md updated to
> reference Phase 5 frozen contracts including the renderer/input/ui
> layer-table entries; and the existing `src/atlas/loader.ts` API
> reviewed for renderer-side suitability and reused in place — the
> Phase 4.A.2 review noted that loader is naturally atlas-pipeline-internal
> and `docs/PHASES.md`'s reference to `src/render/atlas-loader.ts` was
> a doc artifact; the renderer imports `loadAtlas()` from
> `src/atlas/loader.ts` rather than relocating it), **Phase 5.A.2**
> (sandbox-verifiable implementation: `src/render/canvas.ts` tile
> renderer + frame loop, `src/input/keyboard.ts` keypress→action
> descriptor, `src/ui/hud.ts` HP/eddies/floor/fingerprint widget,
> sim→render→input integration in `src/main.ts` replacing the
> diagnostic page with the playable game while preserving the
> diagnostic self-test surface for cross-runtime determinism, and
> the Phase 5 layer-import lint rules), and **Phase 5.B** (live
> GitHub Pages verification — cross-runtime Playwright on
> chromium/firefox/webkit asserting that five movement keys advance
> sim state and the HUD reflects it; the cross-OS matrix from Phase
> 4.B continues to assert atlas determinism). Phase 6 cannot begin
> until all three are approved. Phase 5 is **not** a planning-gate
> phase per the policy at the top of this document, so no
> `decision-memo-phase-5.md` is required; the X.A.1/X.A.2/X.B
> decomposition is the established pattern from Phases 3 and 4 and
> is recorded in the phase-update artifact rather than a planning
> memo.

**Goal.** Make the simulation visible and playable using the generated atlas. Canvas-based tile renderer, keyboard input, simple HUD.

**Lead agent.** `frontend-builder`
**Reviewers.** `code-reviewer`, `qa-playwright`

**Deliverables.**
- `src/render/canvas.ts` — tile renderer reading `assets/atlas.png` + `assets/atlas.json`
- Atlas-loader integration — the renderer's `init()` calls `loadAtlas()` from `src/atlas/loader.ts` (Phase 4.A.2's existing loader; the Phase 4.A.2 code review approved this naming over the original `src/render/atlas-loader.ts` reference because the loader is atlas-pipeline-internal — same module, just imported by the renderer at startup)
- `src/input/keyboard.ts` — keypress → action descriptor
- `src/ui/hud.ts` — HP, eddies, floor indicator, fingerprint widget
- The deployed page transitions from "diagnostic" to "playable game" — the live URL is now a real (sparse) game; the diagnostic self-test banner + the cross-runtime determinism digests + the floor-preview + scripted-playthrough + atlas-preview sections continue to ship as a collapsible "diagnostics" section so cross-runtime CI assertions remain green

**Acceptance criteria — Phase 5.A.1 (drift-detection sweep).**
- Phase 3.A.2 cosmetic carry-forwards from `artifacts/code-review-phase-3-A-2.md` (applyFloorEntry redundant param, dirOrdinalForStep export-only-by-tests comment, ROLL_DOMAIN_ANCHOR_BYTES shared constant, tick unknown-action defensive type-check, e2e SIM_DIGEST duplication note) addressed where they touch files Phase 5.A.2 will modify; the rest carried forward to a future phase boundary.
- Phase 4.A.2 cosmetic carry-forwards from `artifacts/code-review-phase-4-A-2.md` (N4 loader JSON.parse cast→eslint-disable comment; N5 EMPTY_SHA256/PLACEHOLDER_RULESET_VERSION dual-source byte-equality assertion test; N6 RecipeContext type colocated in floor.ts→relocate to a shared types module; N7 fflate version explicit assertion in atlas-encoder-cross-runtime self-test) addressed.
- `docs/ARCHITECTURE.md` updated with Phase 5 frozen contracts (the new `src/render/`, `src/input/`, `src/ui/` layer-table entries with their import-allowed and import-forbidden lists; the renderer's read-only contract on sim state; the input descriptor's relationship to the Phase 1 `Action` schema; the HUD's read-only contract on RunState; the atlas-loader call site at run start; the lint rule inventory additions for the new layers).
- `npm ci && npm run lint && npm run test && npm run build` all green inside the sandbox, with no net-new `src/render/**`, `src/input/**`, or `src/ui/**` code.

**Acceptance criteria — Phase 5.A.2 (sandbox-verifiable implementation).**
- A human can play a real run end-to-end on the deployed URL (it'll be punishing without polish, but the loop closes).
- Renderer reads from sim state and never writes to it; sim is unaware the renderer exists (architectural test: `src/render/**` cannot import from `src/sim/**` write paths).
- Renderer module disallowed from importing `src/core/streams.ts` or `src/sim/combat.ts` (lint rule additions in `eslint.config.js`).
- Atlas hash mismatch (loaded atlas does not match build-time hash) produces a clear error and aborts the run — already implemented in `src/atlas/loader.ts` per Phase 4.A.2 addendum N7; Phase 5.A.2 wires the loader into `src/main.ts`'s startup path.
- The diagnostic page's existing sections (self-test, build-info, floor-preview, scripted-playthrough, atlas-preview) continue to render so the cross-runtime Playwright suite from Phases 1.B/2.B/3.B/4.B keeps passing alongside the new playable-game UI.
- `npm ci && npm run lint && npm run test && npm run build && npm run test:e2e` all green inside the sandbox.

**Acceptance criteria — Phase 5.B (live-deploy + cross-runtime verification).**
- The live GitHub Pages URL serves the playable-game UI alongside the diagnostic sections.
- Cross-runtime Playwright on chromium/firefox/webkit: load the page, press five movement keys, assert the HUD updates (HP / floor indicator advance per the scripted action sequence on a fixed seed).
- The Phase 4.B `cross-os-atlas-equality` matrix continues to pass — the renderer changes are JS-only and do not regenerate the atlas, so the ATLAS_DIGEST golden + the four preset-seed expectedHash goldens remain unchanged. Drift is a regression and a Phase 5.B blocker.

**Risks.**
- Renderer accidentally introducing nondeterminism — caught by the import boundary lint rule.
- Adding the playable game without preserving the diagnostic surface would break the cross-runtime determinism assertions established in Phases 1.B/2.B/3.B/4.B; mitigated by the Phase 5.A.2 acceptance criterion above.

---

## Phase 6 — Items, Currency, Equipment

**Goal.** Treasures, eddies, consumables (stim patches, trauma packs), and equippable cyberware/weapons that modify combat outcomes. Atlas recipes are extended to cover the full item set.

**Lead agent.** `engine-builder` (rules), `frontend-builder` (UI)
**Reviewers.** `code-reviewer`, `qa-playwright`

**Deliverables.**
- Inventory and equipment data structures in sim
- Pickup / drop / equip / unequip / use action descriptors
- Inventory and equipment screens in UI
- Item registry populated with ~20 starter items across the relevant categories
- Atlas recipes for all ~20 items; atlas regenerates with new sprites

**Acceptance criteria.**
- Item effects are deterministic and resolved through the same hash-driven combat path; no item bypasses the sim stream.
- Inventory state is fully reconstructible from the action log alone — no inventory state is persisted separately.
- Adding new items to the registry triggers atlas regeneration; CI fails if the checked-in atlas is stale.
- Playwright test on the live URL: pick up an item → equip it → kill a scripted monster on a fixed seed → assert state hash matches a golden value.

---

## Phase 7 — NPCs, Shops, Boss

**Goal.** Fill the dungeon with social and climactic content. Ripperdoc and fixer NPCs that trade eddies for gear or upgrades. A real boss fight on floor 10. Atlas recipes for NPCs and the boss.

**Lead agent.** `engine-builder` (rules), `frontend-builder` (UI)
**Reviewers.** `code-reviewer`, `qa-playwright`

**Deliverables.**
- NPC registry, shop interaction action descriptors, minimal in-game text
- Boss room generator override on floor 10
- Boss entity with a multi-phase deterministic state machine
- Atlas recipes for ~3 NPC types and the boss
- Win screen with shareable fingerprint

**Acceptance criteria.**
- A scripted run on a fixed fingerprint can: buy an upgrade from a ripperdoc, descend to floor 10, and defeat the boss.
- Win-state transition is reachable and replayable.
- All shop transactions are resolved deterministically from the state hash (no `Math.random` for stock generation, etc.).
- The full game is playable end-to-end on the deployed URL (ugly art still acceptable until Phase 9).

---

## Phase 8 — Run Fingerprint, Replay, Saves & Content-Addressed Releases (Planning Gate)

**Goal.** First-class sharing, verification, and version-pinned hosting. URL fingerprints, action-log import/export, replay viewer, mismatched-version handling, localStorage resume, and the content-addressed release layout layered on top of the existing GitHub Pages pipeline from Phase 1.

**Lead agent.** `engine-builder` (verifier), `frontend-builder` (UI), `release-hardening` (deployment)
**Reviewers.** `architecture-red-team`, `code-reviewer`, `qa-playwright`

**Why this is a planning gate.** This is the load-bearing pillar of the project's identity. Fingerprint format, URL routing, and the release-pinning contract are very hard to change once people start sharing runs. A `decision-memo.md` is required before code begins, covering: fingerprint format and length budget, action-log encoding and compression, mismatched-version UX, the verifier API contract, the `releases/<commit>/` layout, and the routing strategy that resolves `?run=<fingerprint>` to the matching pinned release while keeping the bare URL on `latest`.

**Deliverables.**
- `?run=<fingerprint>&seed=<seed>` URL parsing
- Action log export to clipboard (base64 JSON)
- Action log import + replay viewer that steps through a saved log
- Verifier mode: takes `(fingerprint, action log, claimed final state hash)` and returns boolean
- Mod-ID slot in the fingerprint format wired up; registry empty for now (interface, not implementation)
- Action log auto-saved to localStorage every N actions
- Resume on page load: silent replay back to the current floor with state hash matching pre-close
- Multi-slot save UI keyed by fingerprint (one slot per active run)
- Build pipeline extended: every release published to `releases/<commit-short>/` alongside the existing `latest/`, including the pinned atlas
- Routing: bare URL still serves `latest`; `?run=<fingerprint>` resolves to the matching `releases/<commit>/`
- `docs/PROD_REQUIREMENTS.md` finalized (retention policy, repo size budget, etc.)

**Acceptance criteria.**
- A run shared by URL is reproducible by a stranger on a different machine, exactly — including identical visuals.
- Replay viewer reaches the same final state hash as the original run.
- Mismatched commit hash in a fingerprint produces a clear, actionable error directing the player to the correct release URL.
- Verifier correctly accepts valid runs and rejects tampered logs.
- Closing and reopening the tab mid-run drops the player at the same floor with the same state hash.
- An old fingerprint loads its pinned release with its pinned atlas even after master has moved on (verified by a CI test that pins a fingerprint, advances master with breaking rule and atlas changes, and confirms the old run still loads and replays correctly).

**Risks.**
- Fingerprint format churn after release would invalidate everyone's saved runs. Handled by the planning gate.
- Pages artifact size growing with every commit — addressed in `PROD_REQUIREMENTS.md` with a retention policy (probably "keep all forever, they're cheap" until repo size becomes a concern).
- localStorage quota (5–10 MB per origin) — bounded by an action-log size cap.

---

## Phase 9 — Polish & Release Hardening

**Goal.** Tune the procedural generator until the game looks great, add audio and post-processing, and ship a real public-facing release.

**Lead agent.** `frontend-builder` (juice, generator tuning), `release-hardening` (production)
**Reviewers.** `code-reviewer`, `qa-playwright`

**Deliverables.**
- Atlas-recipe tuning pass: extensive playtesting of atlas-seed candidates against the live deployed preview, choice of final atlas seed for v1 release, refinement of recipe primitives if needed
- CRT / scanline post-processing shader (toggleable)
- SFX and a couple of synthwave tracks (CC-0 / CC-BY or commissioned)
- Title screen with seed entry, "random seed," and "paste fingerprint" actions
- Polished `README.md`, `CONTRIBUTING.md`, `LICENSE`, an architecture diagram (`docs/ARCHITECTURE.md` polished)
- Optional: itch.io page, custom domain
- Daily-seed convention documented
- Accessibility pass: keyboard-only navigation, contrast check, prefers-reduced-motion respected

**Acceptance criteria.**
- A first-time visitor can land on the GitHub Pages URL, click "New Run," and play to floor 1 without reading docs.
- Lighthouse score > 90 for performance and best-practices on the live URL.
- All text rendered through the theme registry (so a future theme mod can replace it).
- The chosen v1 atlas seed is the one shipped; bumping it post-release would require a `rulesetVersion` bump and a new `releases/<commit>/`.

---

## Phase Dependency Graph

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
```

Strictly linear. Each phase compounds on the prior; skipping is not safe. Note that Phase 4 (atlas generator) deliberately precedes Phase 5 (renderer) — the renderer is built against the real atlas pipeline from day one, not against placeholder art. Note also that Phase 1 sets up GitHub Pages deployment, so every subsequent phase's merged deliverable is publicly playable.

## Definition of "Phase Complete"

A phase is complete when **all** of the following are true:

1. All deliverables are in place.
2. All acceptance criteria pass.
3. Code review approval lives at `artifacts/code-review-phase-N.md`.
4. QA approval lives at `artifacts/qa-phase-N.md`.
5. `artifacts/phase-approval-N.json` is committed.
6. The commit lands on master via a normal PR review.
7. The deploy workflow runs green and the live URL reflects the new state.
8. For phases 1, 2, 3, 4, 8: the corresponding `artifacts/decision-memo-phase-N.md` exists and was reviewed by `architecture-red-team` before any code in the phase was written.

## What's Not in This Document

- Detailed architecture: see `docs/ARCHITECTURE.md` (drafted in the Phase 1 planning gate; refined throughout).
- Atlas generator design notes: see `docs/ATLAS_GENERATOR.md` (drafted in the Phase 4 planning gate).
- Production / deployment requirements: see `docs/PROD_REQUIREMENTS.md` (finalized in Phase 8; the basic pipeline shape is decided in Phase 1).
- Mod system design: deferred. Will land as a separate document after v1 ships, against an unchanged fingerprint contract. Atlas-recipe mods are an especially interesting later category — the recipe registry is the seam.