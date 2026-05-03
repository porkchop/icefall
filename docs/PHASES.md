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

**Acceptance criteria.**
- Same `(seed, floor)` always produces the same floor (golden test).
- Every floor has exactly one entrance and exactly one exit, except floor 10 which has an entrance and a boss room.
- All rooms reachable from the entrance (graph connectivity test).
- Floor 10 is structurally distinguished: a single large boss arena reachable from the entrance.
- Mapgen consumes only the `streams.mapgen` stream, never the sim stream — verified by a runtime guard plus a lint rule.
- The live URL serves the updated diagnostic page with the ASCII preview working.

**Risks.**
- Map gen accidentally consuming sim-stream RNG would silently couple level layout to combat outcomes — contained by the stream split and the runtime guard.

---

## Phase 3 — Entity Model, Turn Loop, Combat

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

**Acceptance criteria.**
- A 100-action scripted run on a fixed fingerprint produces the same final state hash on every machine and across both Node and browser builds.
- Combat outcomes are computed solely from `H(stateHash ‖ action)` — no other entropy enters the sim path (audited).
- Death and boss-kill state transitions are reachable via the test harness.
- Replay invariant: any prefix of an action log replays to the same intermediate state.

**Risks.**
- Object iteration order leaking nondeterminism — covered by a project-wide rule of using sorted arrays for any iterated collection in sim code.
- Action descriptor schema changes mid-project would invalidate existing fingerprints — once adopted, schema changes require a `rulesetVersion` bump.

---

## Phase 4 — Procedural Atlas Generator (Planning Gate)

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

**Acceptance criteria.**
- `npm run gen-atlas` produces a byte-identical PNG on Linux, macOS, and Windows CI runners.
- `assets/atlas.json` schema validates and references only IDs registered in `atlas-recipes.ts`.
- `rulesetVersion` changes when (and only when) either the rules text or the atlas binary changes.
- The seven initial recipes render at the target tile size with no transparency or palette bleed bugs.
- Atlas binary size budget: under 256 KB for the v1 sprite count.
- The atlas preview page is live at the deployed URL.

**Risks.**
- PNG encoder nondeterminism (e.g. zlib compression-level differences across platforms) would break atlas-hash reproducibility — mitigated by pinning a single deterministic encoder and asserting byte-equality in CI.
- Recipe API shape locked once mods care about it — addressed by the planning gate.
- Programmer-art recipes might look bad enough to demoralize — Phase 9 explicitly tunes the generator; intermediate "ugly but reproducible" output is acceptable through Phase 8.

---

## Phase 5 — Renderer + Input

**Goal.** Make the simulation visible and playable using the generated atlas. Canvas-based tile renderer, keyboard input, simple HUD.

**Lead agent.** `frontend-builder`
**Reviewers.** `code-reviewer`, `qa-playwright`

**Deliverables.**
- `src/render/canvas.ts` — tile renderer reading `assets/atlas.png` + `assets/atlas.json`
- `src/render/atlas-loader.ts` — loads the atlas at startup, validates against the in-build atlas hash
- `src/input/keyboard.ts` — keypress → action descriptor
- `src/ui/hud.ts` — HP, eddies, floor indicator, fingerprint widget
- The deployed page transitions from "diagnostic" to "playable game" — the live URL is now a real (sparse) game

**Acceptance criteria.**
- A human can play a real run end-to-end on the deployed URL (it'll be punishing without polish, but the loop closes).
- Renderer reads from sim state and never writes to it; sim is unaware the renderer exists (architectural test: `render/` cannot import from `sim/` write paths).
- Renderer module disallowed from importing `core/streams` or `sim/combat` (lint rule).
- Atlas hash mismatch (loaded atlas does not match build-time hash) produces a clear error and aborts the run.
- Playwright smoke test against the deployed URL: load the page, press five movement keys, assert the HUD updates accordingly.

**Risks.**
- Renderer accidentally introducing nondeterminism — caught by the import boundary lint rule.

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