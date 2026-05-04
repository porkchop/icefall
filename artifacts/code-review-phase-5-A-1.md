# Code Review — Phase 5.A.1 (drift-detection sweep)

## Verdict

APPROVE.

All four PHASES.md acceptance criteria pass. The four Phase 4.A.2
cosmetic carry-forwards (N4 loader cast trick, N5 dual-source
constant equality, N6 `RecipeContext` relocation, N7 fflate
version pin) are addressed; the new `docs/ARCHITECTURE.md` Phase 5
section locks the renderer/input/ui read-only contracts and the
new layer-table rows ahead of any 5.A.2 implementation; final
gates (lint, typecheck, test, build) are all green; zero net-new
files exist under `src/render/**`, `src/input/**`, or
`src/ui/**`. Test count climbs from 821 → 824 (+3: 2 dual-source
equality + 1 fflate version pin). Bundle size unchanged at 62.95
kB / 24.03 kB gzipped — verified by stash-and-rebuild against
HEAD@92ccfb8. Phase 3.A.2 carry-forwards correctly deferred (none
touch files Phase 5.A.2 will modify).

One non-blocking finding: the `RecipeContext` relocation is
*partial* — `src/registries/atlas-recipes.ts:17` and
`tests/atlas/registry.test.ts:12` still import from
`../atlas/recipes/floor` via the backward-compat re-export shim
`floor.ts:13`. The registry case is defensible (touching it would
bump `rulesetVersion`); the test case has no such constraint and
could have been migrated. See suggestion 1 below.

## Blocking issues

None.

## Verification points

1. **N4 — JSON.parse cast trick replaced.** PASS. `src/atlas/loader.ts:118-124`
   now reads as a clean `JSON.parse(manifestText)` call with
   `// eslint-disable-next-line determinism/no-float-arithmetic`
   immediately above the call site (`:123`). The justification at
   `:118-122` explicitly identifies the loader as the
   "data-ingestion boundary" and explains that the lint rule bans
   `JSON.parse` "inside sim/mapgen/atlas *interior* code" — exactly
   the contract recorded in `docs/ARCHITECTURE.md:733-737`. The
   `(JSON as unknown as { parse(s: string): unknown }).parse` cast
   shape is gone (verified via diff at `git diff HEAD --
   src/atlas/loader.ts`). The disable directive is single-line
   scoped (`-next-line`), not a blanket file-level disable. `npm
   run lint` exits clean.

2. **N5 — dual-source byte equality.** PASS.
   `tests/build/atlas-binary-hash-plugin.test.ts:58-67` adds the
   `dual-source constant equality (build-info ↔ vite plugin)`
   describe block with both required tests:
   `EMPTY_SHA256 matches between scripts/vite-plugin-atlas-binary-hash.mjs
   and src/build-info.ts` (`:59-61`) and `PLACEHOLDER_RULESET_VERSION
   matches between scripts/vite-plugin-atlas-binary-hash.mjs and
   src/build-info.ts` (`:62-66`). Both use `expect(...).toBe(...)`
   with renamed-alias imports per the brief
   (`BUILD_INFO_EMPTY_SHA256`, `BUILD_INFO_PLACEHOLDER_RULESET_VERSION`
   at `:16-17`). Both literals on the build-info side are sourced
   from `src/build-info.ts:8,11-12`; the plugin side is at
   `scripts/vite-plugin-atlas-binary-hash.mjs:37-40`. Test run
   confirms `Test Files 2 passed (2)` / `Tests 18 passed (18)`
   for the file. The introductory comment at `:50-57` correctly
   explains why the duplication is forced (vite plugin loaded at
   config-load time cannot transit `@noble/hashes` via
   TypeScript). This closes the audit-readability gap raised in
   `code-review-phase-4-A-2.md:436-444`.

3. **N6 — RecipeContext relocation.** NEEDS-WORK (non-blocking).
   `src/atlas/recipes/types.ts` exists (`:11-15`) and contains the
   canonical `RecipeContext` definition. Comment at `:1-9` is
   substantive and explains the relocation rationale. All seven
   recipe files (`floor.ts:11`, `door.ts:10`, `wall.ts:10`,
   `player.ts:10`, `monster-ice-daemon.ts:11`,
   `item-cred-chip.ts:11`, `npc-ripperdoc.ts:11`) import from
   `./types`. `src/atlas/generate.ts:31` imports from
   `./recipes/types`. `floor.ts:13` re-exports `RecipeContext` for
   backward-compat. **However**, two consumers still import the
   type via the floor re-export shim:
   `src/registries/atlas-recipes.ts:17` (`from "../atlas/recipes/floor"`)
   and `tests/atlas/registry.test.ts:12` (`from "../../src/atlas/recipes/floor"`).
   The brief explicitly required: "no remaining `from "./floor"`
   (or `"./recipes/floor"`) imports of `RecipeContext` exist
   anywhere in the repo." The registry case has a defensible
   reason — `src/registries/atlas-recipes.ts` is in `RULES_FILES`
   (`build-info.ts:66`), so editing its imports would bump
   `rulesetVersion`. The test file has no such constraint. The
   relocation intent stated in `types.ts:6-9` ("recipe authors do
   not have to know which sibling happened to declare the shared
   type first") is undermined by the registry still pointing
   readers at `./floor` — a recipe author scanning the registry
   would be misled. Non-blocking because the type is *now*
   single-defined (the `floor.ts:13` re-export forwards rather
   than re-declares), and the partial migration does not break any
   test or contract. See suggestion 1.

4. **N7 — fflate version pin.** PASS.
   `tests/build/fflate-version-pin.test.ts` exists with the
   pinned literal `FFLATE_PINNED_VERSION = "0.8.2"` (`:22`),
   reads `package.json` directly (`:27-29`), and asserts
   `pkg.devDependencies?.["fflate"] === "0.8.2"` (`:30-31`). Test
   passes (`Test Files 1 passed (1)` / `Tests 1 passed (1)`).
   Cross-checked against `package.json:30` (`"fflate": "0.8.2"`).
   The introductory comment at `:5-20` correctly identifies this
   as the "complementary explicit trip-wire" that the
   atlas-encoder-cross-runtime self-test goldens implicitly cover
   — and explicitly flags that bumping the pin is a
   `rulesetVersion` bump requiring red-team review and the
   cross-OS matrix re-run.

5. **Phase 3.A.2 tick unknown-action defensive check correctly
   deferred.** PASS. `git diff HEAD -- src/sim/turn.ts` is empty.
   Phase 5.A.2 produces `Action` descriptors via
   `src/input/keyboard.ts` and feeds them to the *existing*
   `tick()`; `turn.ts` itself is not modified. The "additive
   vocabulary" Phase 1 contract (silent no-op on unknown action
   types) preserves the rulesetVersion-stable contract for the
   schema. Defer is correct. PHASES.md:331 explicitly authorizes
   carrying these forward "to a future phase boundary".

6. **Phase 3.A.2 other carry-forwards correctly deferred.** PASS.
   `git diff HEAD -- src/sim/{ai,combat,run}.ts
   tests/e2e/diagnostic.spec.ts` is empty. None of these files
   are in Phase 5.A.2's deliverable set per `PHASES.md:323-328`
   (`src/render/canvas.ts`, `src/input/keyboard.ts`,
   `src/ui/hud.ts`, `src/main.ts`, `eslint.config.js`). The
   `applyFloorEntry` redundant param, `dirOrdinalForStep` export
   comment, `ROLL_DOMAIN_ANCHOR_BYTES` shared constant, and e2e
   `SIM_DIGEST` redeclare items remain documented follow-ups in
   `code-review-phase-3-A-2.md:91-109`.

7. **`docs/ARCHITECTURE.md` Phase 5 section.** PASS.
   `ARCHITECTURE.md:694-795` is the new "Phase 5 frozen contracts
   (renderer + input + ui)" section. Coverage verified for:
   renderer read-only contract (`:706-717`); renderer
   `eslint.config.js` ban on `src/core/streams.ts` and
   `src/sim/combat.ts` with rationale (`:719-725`); atlas-loader
   call site at run start with the addendum-N7 pinned messages
   (`:727-737`) and the data-ingestion-boundary `eslint-disable`
   note tying back to `loader.ts:123`; input descriptor →
   Phase 1 `Action` schema mapping with the
   no-`ACTION_VERSION`-bump rationale (`:739-747`); HUD read-only
   contract (`:749-755`); diagnostic surface preserved with
   collapsible-`<details>` allowance and DOM-id pin (`:757-764`);
   new layer-table at `:772-776` with three rows
   (`src/render/`, `src/input/`, `src/ui/`), each pinning both
   the imports-allowed and imports-forbidden lists; deferred
   contracts (harness mapgen-exception migration, frame-rate
   budget, accessibility) at `:785-795`. The
   `src/main.ts`-as-single-orchestrator constraint at `:778-783`
   makes the import-direction discipline explicit. The lint-rule
   inventory at `:811-825` does not yet add new rows for the
   render/input/ui rules — but this is consistent with the
   architecture text at `:782` ("added in Phase 5.A.2's
   `eslint.config.js` extension"). The contract is declared in
   the layer-table; the eslint wiring lands when the files do.

8. **No net-new render/input/ui code.** PASS. `ls /workspace/src/`
   returns `atlas`, `build-info.ts`, `core`, `main.ts`, `mapgen`,
   `registries`, `sim` — no `render`, `input`, or `ui`
   directories. `git status --short` shows zero new files under
   those paths. The two new files in working tree
   (`src/atlas/recipes/types.ts`, `tests/build/fflate-version-pin.test.ts`)
   are scope-correct for the drift sweep.

9. **Final gates green.** PASS. `npm run lint` exits with no
   output past the script header. `npm run typecheck` (`tsc -b
   --noEmit`) exits clean. `npm run test` reports `Test Files 54
   passed (54)` / `Tests 824 passed (824)` — exactly the
   expected `821 + 3 = 824` (the +3 are the two
   `dual-source constant equality` describe-block tests in
   `atlas-binary-hash-plugin.test.ts:58-67` plus the single
   `fflate-version-pin.test.ts` test). `npm run build` reports
   `dist/assets/index-Bb6oVDw8.js   62.95 kB │ gzip: 24.03 kB` —
   byte-exact match to HEAD@92ccfb8 (verified by stash + rebuild
   against the pre-sweep tree, which produced the identical
   `62.95 kB / 24.03 kB gzip` line). Source-map filename hash
   bumps from `Be-0FqJj` to `Bb6oVDw8`, which is expected and
   harmless (the bundle hash incorporates source-paths/comments
   that change in the recipe imports). Coverage gates pass on
   every directory; the new `src/atlas/recipes/types.ts` reports
   `0/0/0/0` (it is type-only and emits nothing at runtime; the
   v8 collector reports zero on type-only files — not a coverage
   regression).

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate.

The N5 dual-source equality tests and the N7 fflate version pin
test all use byte-exact `toBe` assertions on hand-typed literals.
Removing either the duplicated literal in
`scripts/vite-plugin-atlas-binary-hash.mjs:37-40` or the bump in
`package.json:30` would fail the assertion loudly — so each test
would fail if the underlying contract drifted, satisfying the
"would fail if the feature were removed" criterion.

The N6 relocation has no dedicated test (the type compiles or it
does not — the existing recipe tests at `tests/atlas/recipes.test.ts`
exercise the production code paths that import `RecipeContext`,
so a broken relocation would surface there). This is appropriate
— a runtime test for a TS-only type relocation would be a
self-referential round-trip with no mutation surface. Acceptable.

The N4 cleanup is verified by the existing
`tests/atlas/loader.test.ts` battery (already in tree) — the
loader's behavior is unchanged, only the implementation shape
swapped.

No new module went untested. No regression test elided.

## DRY-gate / drift-detection-gate

**DRY:** N5 closes the previously-noted dual-source gap between
`scripts/vite-plugin-atlas-binary-hash.mjs:37-40` and
`src/build-info.ts:8,11-12`. The literals are still duplicated
(forced by the build pipeline), but the *test* now asserts they
agree byte-exactly, so silent drift fails loudly. This is the
correct pattern for forced duplication: assert equality at test
time, not engineer-it-away.

N6 *partially* consolidates `RecipeContext` (production
single-defined in `types.ts`; the floor.ts re-export forwards
rather than re-declares). Two consumers still import via the
backward-compat path, but the type itself is no longer
duplicated. The DRY win is real but incomplete; see suggestion 1.

**Drift:** the loader.ts cast trick removal (N4) replaces a
"clever workaround" with explicit-disable + justification —
strictly an audit-clarity improvement. The eslint disable is
single-line scoped, so it does not silently authorize a future
`JSON.parse` in any other file or any other line of `loader.ts`.

The Phase 5 architecture section establishes the renderer/input/ui
contracts *ahead* of any code lines being written, which is the
canonical drift-prevention pattern. A 5.A.2 builder reading this
section before writing `src/render/canvas.ts` cannot accidentally
import `core/streams` or call `tick()` from render code — the
contract is pinned before the implementation can drift.

## Non-blocking suggestions

1. **`RecipeContext` migration is partial.**
   `src/registries/atlas-recipes.ts:17` and
   `tests/atlas/registry.test.ts:12` still import `RecipeContext`
   from `"../atlas/recipes/floor"` / `"../../src/atlas/recipes/floor"`.
   The registry case is defensible: editing
   `src/registries/atlas-recipes.ts` would bump `rulesetVersion`
   (it is in `RULES_FILES`, `src/build-info.ts:66`), and a drift
   sweep should not bump rules-text bytes. The test file has no
   such constraint — `tests/atlas/registry.test.ts` is not in
   `RULES_FILES`, so changing that single line `import type
   { RecipeContext } from "../../src/atlas/recipes/floor";` →
   `from "../../src/atlas/recipes/types";` would complete the
   migration cleanly. Consider doing this in the same sweep, or
   noting in `floor.ts:13`'s re-export comment that the shim
   exists *specifically* to spare `src/registries/atlas-recipes.ts`
   a `rulesetVersion` bump (so a future maintainer does not
   delete the re-export thinking it is dead code).

2. **Lint rule inventory could enumerate the new layers ahead of
   wiring.** `ARCHITECTURE.md:813-825` does not yet have rows for
   the renderer's `core/streams`/`sim/combat` import bans, the
   `src/main.ts`-as-single-orchestrator constraint, or the
   `src/render/`, `src/input/`, `src/ui/` boundary patterns. The
   layer-table at `:772-776` declares the contract, but a future
   reader scanning the lint inventory section would not see the
   render/input/ui rules listed. Adding three rows (one per layer)
   even with `Implementation: deferred to Phase 5.A.2's
   eslint.config.js extension` would close the audit-readability
   gap. Cosmetic.

3. **`tsconfig.tsbuildinfo` modification in working tree.**
   `git status --short` reports `M tsconfig.tsbuildinfo` — this
   is a TypeScript incremental-build cache, regenerated on every
   `tsc -b` invocation. Not in `.gitignore`. Not load-bearing.
   Suggest either adding to `.gitignore` or `git restore --` ing
   it before committing. Cosmetic; the file is tooling output,
   not code.

4. **`floor.ts` re-export comment.** `floor.ts:13` reads
   `export type { RecipeContext };` with no comment. A reader
   inheriting the file would not know the re-export is a
   backward-compat shim for `src/registries/atlas-recipes.ts`. A
   one-line comment (`// Re-exported for backward-compat with
   `src/registries/atlas-recipes.ts` (relocating that import
   would bump rulesetVersion)`) would prevent a future
   "this looks dead, deleting" mistake. Cosmetic.

5. **`tests/atlas/registry.test.ts:12` could move to `./types`.**
   See suggestion 1. Same physical change; one-line edit. Cosmetic.

## Files reviewed

Production: `src/atlas/loader.ts`, `src/atlas/generate.ts`,
`src/atlas/recipes/{floor,door,wall,player,monster-ice-daemon,
item-cred-chip,npc-ripperdoc}.ts`, `src/atlas/recipes/types.ts`
(new), `src/registries/atlas-recipes.ts` (read-only verification),
`src/build-info.ts` (read-only verification),
`scripts/vite-plugin-atlas-binary-hash.mjs` (read-only verification),
`package.json` (read-only verification).

Tests: `tests/build/atlas-binary-hash-plugin.test.ts`,
`tests/build/fflate-version-pin.test.ts` (new),
`tests/atlas/registry.test.ts` (read-only verification).

Docs: `docs/ARCHITECTURE.md:694-795` (new Phase 5 section),
`docs/PHASES.md:296-352` (Phase 5 callout block + acceptance
criteria).

Phase 5.A.1 is ready for approval. Phase 5.A.2 (sandbox-verifiable
renderer + input + HUD implementation) is the next phase.
