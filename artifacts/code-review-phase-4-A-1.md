# Code Review — Phase 4.A.1 (drift-detection sweep)

## Verdict

APPROVE.

All thirteen verification points pass. The phase is exactly the
"no-net-new-atlas-code drift sweep" the addendum committed to: one new
file under `src/atlas/**` (`seed.ts`), one new Vite plugin
(`scripts/vite-plugin-atlas-binary-hash.mjs`), one relocation
(`uniformIndex` to `src/core/prng.ts`), one defined-but-unused helper
(`deriveRulesetVersion`) plus its frozen-contract scaffolding
(`RULES_FILES`, `stripBom`, `normalizeForHash`, `rulesetTextHash`),
and the byte-pinned discipline files (`.gitattributes`, lint-scope
additions, ARCHITECTURE.md frozen-contract section). The
`fdeflate → fflate` substitution is sound and well-documented in
addendum-2 with all three doc artifacts kept in sync. Final gates green:
lint clean, 639 passed | 3 skipped, build 38.91 KB raw / 15.06 KB
gzipped (zero growth from Phase 3.B). No Phase 3.A.2 carry-forwards
were silently landed.

## Blocking issues

None.

## Verification points

1. **No Phase 3.A.2 carry-forwards landed.** PASS. `git diff HEAD --
   src/sim/{ai,combat,turn}.ts` is empty. `src/sim/run.ts` diff is
   purely the `uniformIndex` import-path change (`type { PRNG }` →
   `{ uniformIndex }`) and removal of the relocated function body
   (lines 36–58 of pre-diff) — no cosmetic edits to `applyFloorEntry`,
   `dirOrdinalForStep`, or `tick`'s unknown-action handling. The four
   non-blocking suggestions from `code-review-phase-3-A-2.md:91-109`
   remain documented follow-ups, as instructed.

2. **`uniformIndex` relocation.** PASS. The function lives at
   `src/core/prng.ts:67-76` with byte-identical algorithm
   (`tail = ((0xffffffff % n) + 1) % n; m = (0xffffffff - tail) >>> 0;
   while (r > m) r = prng() >>> 0; return r % n;`) and the same error
   message (`uniformIndex: n must be positive integer (got ${n})`).
   Removed from `src/sim/run.ts` (the diff shows the body deleted at
   pre-diff lines 39–58). Re-imported correctly by
   `tests/sim/run.test.ts:1-7`. `tests/core/prng-uniform-index.test.ts`
   covers: termination on `n=1`, on power-of-two `n`, on
   non-power-of-two `n=7`, and a fixture-PRNG forced rejection path
   (`prng-uniform-index.test.ts:17-63`); chi-square distribution over
   60_000 draws of `n=10` (threshold 28, df=9 critical at p≈0.001) and
   70_000 draws of `n=7` (threshold 23, df=6); `n=1` boundary
   (`:115-119`); error paths for `n=0`, negative, non-integer, NaN,
   Infinity (`:122-155`). Coverage report: `core/prng.ts`
   100/100/100/100. The vitest.config.ts `src/core/**` branch
   threshold remains 90 (Phase 1 baseline); the per-file v8 report
   still shows 100% on `prng.ts`, so the relocation does not regress
   the file.

3. **`fflate` devDependency.** PASS. `package.json:29` reads
   `"fflate": "0.8.2"` — exact-pinned, no caret/tilde.
   `package-lock.json` entry for `node_modules/fflate` carries the
   integrity hash
   `sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A==`.
   The substitution preserves every discipline addendum-1 B5/N1/N2
   specified: `fflate` exposes `deflateSync(data, opts)` from
   `node_modules/fflate/lib/index.cjs` (sync, level-pinnable via
   `{ level: 1 }`); pure JS (a single `index.cjs` plus tree-shakeable
   `.d.ts` — no native code, no `node-gyp`); shipped as ESM + CJS
   (`browser.cjs` is a re-export wrapper, not a runtime branch);
   ~30 KB minified per the addendum-2 estimate. The `npm view
   fdeflate` 404 is genuine — the addendum-2 substitution is
   necessary, not optional.

4. **`.gitattributes`.** PASS. File exists at `/workspace/.gitattributes`
   with byte-exact addendum B3 content (verified against
   `decision-memo-phase-4.md:2197-2219`): the `# Phase 4 cross-OS …`
   header comment, `* text=auto eol=lf`, the per-extension `text
   eol=lf` block (`*.ts`/`*.tsx`/`*.js`/`*.mjs`/`*.cjs`/`*.json`/`*.md`/
   `*.yml`/`*.yaml`/`*.html`/`*.css`), the `*.png|*.jpg|*.jpeg|*.webp|
   *.ico binary` block, the load-bearing `assets/atlas.png binary`
   pin (`.gitattributes:20`), and `assets/atlas.json text eol=lf` are
   all present in the pinned order. Companion test
   `tests/build/rules-text.test.ts:102-114` asserts the file exists
   and contains both load-bearing lines.

5. **`tests/build/rules-text.test.ts`.** PASS. `RULES_FILES` matches
   the addendum B2 alphabetical 12-entry list byte-exactly
   (`build-info.ts:38-51`; asserted by `rules-text.test.ts:46-61`).
   The CRLF + BOM scan uses the pinned error-message format
   (`rules-text.test.ts:78-89`): `rulesText: file <path> has UTF-8
   BOM at offset 0; remove the BOM and recommit` and `rulesText: file
   <path> has CRLF; convert to LF and recommit`. The N18 disposition
   is sound — `RulesFileEntry` carries an `existsInPhase: "4.A.1" |
   "4.A.2"` discriminator (`build-info.ts:33-36`); `rules-text.test.ts:
   66-74` calls `it.skip` for `"4.A.2"` entries with a
   `(deferred to 4.A.2)` suffix; the silent-skip guard at
   `:94-99` asserts every `"4.A.1"` entry exists on disk via
   `existsSync(repoRoot/path)`. Vitest output confirms `tests/build/
   rules-text.test.ts (18 tests | 3 skipped)` — the three skipped
   match the three `"4.A.2"` entries (`src/atlas/palette.ts`,
   `src/atlas/params.ts`, `src/registries/atlas-recipes.ts`).

6. **`vite-plugin-atlas-binary-hash`.** PASS. Plugin at
   `scripts/vite-plugin-atlas-binary-hash.mjs:85-115` is wired into
   `vite.config.ts:26` and `vitest.config.ts:11`. The empty-atlas
   fallback (`:38-39`) defines `EMPTY_SHA256 =
   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
   as a literal pin (not computed); `computeAtlasBinaryHash` returns
   `{ hash: EMPTY_SHA256, missing: true }` when `assets/atlas.png` is
   absent (`:71-78`). The `config()` hook injects both values via
   `JSON.stringify` per N17 (`:103-104`); the test at
   `atlas-binary-hash-plugin.test.ts:69-77` verifies the literal output
   `cfg.define.__ATLAS_BINARY_HASH__ === '"e3b0…b855"'` and
   `cfg.define.__ATLAS_MISSING__ === 'true'`. The plugin imports
   `sha256` from `@noble/hashes/sha256` (`:30`) — no `crypto.subtle`,
   no `node:crypto`. Bytes flow through `new Uint8Array(bytes)`
   (`:74`) — no `Buffer`. `EMPTY_SHA256 === sha256Hex(new Uint8Array(0))`
   is asserted at `atlas-binary-hash-plugin.test.ts:36-38`.
   `handleHotUpdate` (`vite-plugin-atlas-binary-hash.mjs:108-113`) is
   exercised by three tests at `atlas-binary-hash-plugin.test.ts:97-138`
   covering full-reload trigger, no-op for unrelated files, and cache
   refresh.

7. **`deriveRulesetVersion`.** PASS. Helper at
   `src/build-info.ts:136-144` is exported and **not called** at the
   `define`-block site — `vite.config.ts:29` and `vitest.config.ts:14`
   continue to inject `JSON.stringify(PLACEHOLDER_RULESET)` for
   `__RULESET_VERSION__`, with explanatory comments
   (`vite.config.ts:19-25`, `vitest.config.ts:7-10`) calling out that
   the flip to `deriveRulesetVersion(rulesText, atlasBinaryHash)`
   lands in 4.A.2 with `assets/atlas.png`. The pre-image matches
   addendum B2: `rulesetTextHash` (`build-info.ts:97-113`) iterates
   `RULES_FILES` and concatenates `(utf8(path), 0x00,
   sha256(normalizeForHash(content)), 0x00)` tuples; the ARCHITECTURE
   pinned form `rulesetVersion = sha256(utf8(rulesetTextHashHex) ‖
   utf8("|") ‖ utf8(atlasBinaryHash))` matches the implementation
   `sha256Hex(concat([utf8(textHashHex), utf8("|"),
   utf8(atlasBinaryHash)]))` at `:140-143` — the addendum's
   ambiguous `utf8(rulesetTextHash)` is correctly interpreted as
   `utf8(sha256Hex(rulesetTextHash))` since `atlasBinaryHash` is
   unambiguously a hex string per the empty-SHA256 fallback. The
   `normalizeForHash` helper at `:69-71` strips a leading BOM
   (`stripBom` checks `s.charCodeAt(0) === 0xfeff`) and replaces
   CRLF→LF unconditionally. Tests at
   `tests/build/derive-ruleset-version.test.ts` cover: same input →
   same output (`:154-158`); atlas-hash bump (`:160-167`); rename /
   path-bytes change (`:169-184`); CRLF normalization
   (`:186-194`); BOM normalization (`:196-204`); empty content vs
   missing key (`:206-217`). The path-feeds-hash property
   (B2 property 1) is also asserted in `rulesetTextHash` directly via
   the swap-content test at `:127-143` (different (path, content)
   pairing → different hash). `bare-CR-only-no-LF` is left untouched
   per the contract (test at `:69-73`).

8. **`docs/ARCHITECTURE.md` Phase 4 update.** PASS. The Phase 4
   frozen-contract section spans `ARCHITECTURE.md:424-679`.
   Coverage verified for: recipe primitive set + signatures
   (`:436-455`); recipe ID format regex anchored to `cyberpunk`
   (`:462-470`); `streams.atlas(recipeId)` per-call invariant
   (`:472-481`) with the N20 follow-up explicitly addressed at
   `:476-481` ("repeat calls to the same key are Set-deduplicated and
   advance by 0"); atlas layout constants + B6 tile-grid resize rule
   (`:487-497`); atlas-grid placement function (`:499-505`);
   `src/atlas/seed.ts` + `atlasSeedToBytes` per B7 + `validateSeedString`
   per N19 explicitly marked as Phase 4 *addition* (`:507-524`); PNG
   encoder format with `tRNS`-16-bytes pin per N6 (`:526-536`) and
   per-pixel palette-bounds check per N5 with the exact error format
   (`:538-545`); 16-entry palette (`:547-548`); manifest schema
   (`:550-556`); `rulesetVersion` derivation per B2 (`:558-604`);
   atlas-loader DEV refusal + missing-atlas messages per N7 with
   pinned strings (`:606-623`); `ATLAS_DIGEST` + three new self-tests
   (`:625-638`); `src/atlas/**` layer-table entry as peer of
   sim/mapgen (`:640-653`); `tools/**` `node:` prefix per N10
   (`:655-662`); deferred contracts (`:664-679`). The lint-rule
   inventory (`:695-708`) lists the new `src/atlas/**` and `tools/**`
   rule rows.

9. **`atlasSeedToBytes` + `validateSeedString`.** PASS.
   `src/atlas/seed.ts:64-67` implements
   `atlasSeedToBytes(seed) = sha256(concat([utf8("icefall:atlas-seed:v1:"),
   utf8(seed)]))` per addendum B7. `ATLAS_SEED_DOMAIN_TEXT` constant
   exposed at `:12`. `tests/atlas/seed.test.ts:15-72` covers: 22-byte
   ASCII anchor + per-byte inventory (`:16-32`); 32-byte output
   (`:36-38`); same input → same output (`:40-44`); different inputs
   → different outputs (`:46-50`); pre-image format with hand-built
   reconstruction (`:54-71`); collision-free vs `seedToBytes` for
   `ATLAS_SEED_DEFAULT` (`:75-78`) and a five-input battery
   (`:80-86`). `validateSeedString` (`:32-44`) tests at `:89-139`
   cover: ASCII accept, multibyte accept, empty reject, byte-length
   > 255 reject, lone high surrogate reject, lone low surrogate
   reject, paired-surrogate emoji accept, and propagation through
   `atlasSeedToBytes`. N19 disposition: `seed.ts:25-31` documents
   `validateSeedString` as a "Phase 4 *addition* (red-team follow-up
   N19)" with explicit asymmetry rationale ("`seedToBytes` predates
   this validation discipline and is left unchanged so the existing
   run-seed fingerprint surface does not bump silently"); the same
   wording appears in `ARCHITECTURE.md:517-524`.

10. **`fdeflate → fflate` substitution (addendum-2).** PASS.
    `artifacts/decision-memo-phase-4.md:3088-3132` is the new
    "Addendum-2 (Phase 4.A.1 implementation discovery)" section
    documenting the discovery (npm 404 on `fdeflate`), the resolution
    (`fflate@0.8.2` exact-pinned), the discipline preservation
    (level-pinning, sync, deterministic IDAT, no native, integrity
    recall, cross-OS-matrix-rerun on version bumps), the doc-sync list
    (`docs/PHASES.md:199,251`, `docs/ATLAS_GENERATOR.md:63,121,206`,
    `docs/ARCHITECTURE.md:528`), the Phase 4.A.2 implication (encoder
    imports from `fflate` and the cross-runtime self-test gains an
    `fflate`-version assertion), and the no-fingerprint-bump rationale.
    The historical addendum-1 prose retains all 43 `fdeflate`
    references unchanged per the audit-trail rule (verified by
    `grep -c fdeflate decision-memo-phase-4.md`); the 8 `fflate`
    occurrences are all in addendum-2. Doc files synchronized:
    `PHASES.md:199` ("`fflate`"), `:251` (the long acceptance-criterion
    note); `ATLAS_GENERATOR.md:63-67,121,206-209`; `ARCHITECTURE.md:
    528-531` all carry the parenthetical explanation pointing readers
    back to addendum-2.

11. **Lint scope additions.** PASS. `eslint.config.js:251-313` is the
    new `src/atlas/**` block. `no-restricted-imports` `paths`
    (`:270-286`) ban `node:buffer`, `crypto`, `node:crypto`. Note
    the bare `buffer` import is not in the `paths` list; `Buffer` the
    *global* is banned via `no-restricted-globals` at `:289-301`,
    which closes the most likely accidental-use surface. The pattern
    list at `:259-265` bans `**/sim/**`, `**/mapgen/**`, `**/render/**`,
    `**/input/**`, `**/main`. `no-restricted-syntax` at `:302-311`
    has the `crypto.subtle` member-access ban with the exact selector
    style (`MemberExpression[object.name='crypto'][property.name='subtle']`)
    matching the existing `.mapgen` / `.ui` / `.sim` member-access
    pattern (`:336-345`, `:366-401`). `tools/**` bare-`fs`/`path`/`url`
    ban at `:191-234` covers `fs`, `path`, `url`, `fs/promises` with
    the pinned `node-builtin: use 'node:fs' (or 'node:path', etc.); …`
    error-message format (matches addendum N10 wording in
    `ARCHITECTURE.md:660-662`). The `lint` run completed with no
    errors.

12. **No net-new `src/atlas/**` recipe code.** PASS. `Glob
    src/atlas/**/*` returns exactly `src/atlas/seed.ts`. `Glob
    tests/atlas/**/*` returns exactly `tests/atlas/seed.test.ts`. No
    primitives, recipes, encoder (`png.ts`), manifest, palette, params,
    or atlas-recipes registry exist on disk in this phase — all
    deferred to 4.A.2 as the addendum scope demands.

13. **Final gates.** PASS. `npm run lint` exits clean (no output past
    the script header). `npm run test` reports `Test Files 40 passed
    (40)`, `Tests 639 passed | 3 skipped (642)` — matches the prompt's
    expected counts. The 3 skipped are the three `"4.A.2"`-marked
    `RULES_FILES` entries in `tests/build/rules-text.test.ts:70-73`
    (`src/atlas/palette.ts`, `src/atlas/params.ts`,
    `src/registries/atlas-recipes.ts`) — confirmed via the
    `(deferred to 4.A.2)` test names. `npm run build` reports
    `dist/assets/index-BazYhibW.js   38.91 kB │ gzip: 15.06 kB` —
    byte-exact match to Phase 3.B's bundle, so the 4.A.1 additions
    (which are all in build-time / test-time / config code, not in
    the runtime `src/main.ts` import graph) do not bloat the
    deployed bundle. Coverage gates pass on every directory; the
    new `src/atlas/seed.ts` reports 100/100/100/100.

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate. Every new module has at
least one focused test file; every new public function has a regression
test that would fail if the function were removed; every frozen-contract
byte-format pin has a hand-built byte-explicit assertion (not a
self-referential `f(x) === f(x)` round-trip). The
`tests/build/rules-text.test.ts:46-61` byte-exact list assertion is the
load-bearing canonical-order pin — reordering `RULES_FILES` is a test
failure, not a silent `rulesetVersion` bump. The
`derive-ruleset-version.test.ts` round-trip + mutation tests close the
B2 properties 1–5. The `atlas-binary-hash-plugin.test.ts` empty-vs-
populated atlas paths cover both 4.A.1 and 4.A.2 plugin behavior
(de-risking the 4.A.2 atlas landing). The `seed.test.ts` battery
includes the cross-domain collision-free assertion against `seedToBytes`,
which is the load-bearing B7 property — no other test in the suite
verifies that an atlas seed and a run seed cannot accidentally derive
the same PRNG state.

## DRY-gate / drift-detection-gate

DRY: no logic duplication introduced. `uniformIndex` is now in one
place (`src/core/prng.ts`) and re-imported by both
`src/sim/run.ts` and the new `tests/core/prng-uniform-index.test.ts`.
The `EMPTY_SHA256` literal appears in two places —
`scripts/vite-plugin-atlas-binary-hash.mjs:38-39` (as the production
constant) and `tests/build/derive-ruleset-version.test.ts:20-21` (as
the test fixture). The test could `import { EMPTY_SHA256 }` from the
plugin module to remove the duplicate literal; left as a non-blocking
suggestion below.

Drift: the `src/sim/**` `uniformIndex` removal is complete (no second
copy lurks in another sim file, verified by Grep). The `RULES_FILES`
canonical list is the single source of truth, consumed by both
`rulesetTextHash` and `rules-text.test.ts`. The doc/code drift between
addendum-1's `fdeflate` and the implementation's `fflate` is closed
by addendum-2 + the parenthetical notes in PHASES, ATLAS_GENERATOR,
and ARCHITECTURE.

## Non-blocking suggestions

- `tests/build/derive-ruleset-version.test.ts:20-21` redeclares
  `EMPTY_SHA256` as a local constant. Importing the exported
  `EMPTY_SHA256` from `scripts/vite-plugin-atlas-binary-hash.mjs`
  would remove the duplication and make the test fail loudly if the
  plugin's literal ever drifted. Cosmetic.

- `RulesFileEntry.existsInPhase` is typed as the union `"4.A.1" |
  "4.A.2"` (`src/build-info.ts:35`). When 4.A.2 lands the three
  remaining files, the natural follow-up is to either flip them to
  `"4.A.1"` (and possibly retire the field) or extend the union to
  `"4.A.1" | "4.A.2" | "4.A.3"`. A one-line comment in
  `build-info.ts:30-32` already gestures at this; an explicit
  `// 4.A.2 follow-up: retire this field once every entry exists`
  would tighten the breadcrumb. Cosmetic.

- The `eslint.config.js:270-286` `paths` list bans `node:buffer`,
  `crypto`, `node:crypto`, but does *not* ban the bare `buffer`
  module. The `Buffer` global is the realistic accident surface and
  is banned via `no-restricted-globals` (`:289-301`), so the gap is
  cosmetic, but a `{ name: "buffer", message: "…" }` entry in
  `paths` would close the audit-readability gap at zero runtime cost.

- `vite.config.ts:5` and `vitest.config.ts:4` both define the
  module-local `PLACEHOLDER_RULESET = "phase1-placeholder-do-not-share"`
  literal. The same string is exported from `src/build-info.ts:6` as
  `PLACEHOLDER_RULESET_VERSION`. Importing the constant from
  `src/build-info.ts` into the two configs would prevent silent
  drift between the build-time injection and the runtime check —
  but `src/build-info.ts` imports `@noble/hashes/sha256` (transitive
  `Uint8Array` work), which would pull a heavier graph into the
  Vite config. Leaving as-is is reasonable; flagged for awareness.

- `tests/atlas/seed.test.ts:131-139` asserts `atlasSeedToBytes`
  propagates `validateSeedString` errors. The error class is
  unchanged from the inner throw (both throw `Error`), so the
  assertion is on the message regex only. An assertion that the
  thrown object is an `Error` instance (`toBeInstanceOf(Error)`)
  would catch a future accidental `throw "string"` — but the
  thrown values come from the production code under test, so the
  assertion is essentially a smoke check. Cosmetic.

## Files reviewed

Production: `.gitattributes`, `scripts/vite-plugin-atlas-binary-hash.{mjs,d.mts}`,
`src/atlas/seed.ts`, `src/core/prng.ts`, `src/sim/run.ts`,
`src/build-info.ts`, `vite.config.ts`, `vitest.config.ts`,
`eslint.config.js`, `package.json`, `package-lock.json`.

Tests: `tests/atlas/seed.test.ts`, `tests/build/rules-text.test.ts`,
`tests/build/derive-ruleset-version.test.ts`,
`tests/build/atlas-binary-hash-plugin.test.ts`,
`tests/core/prng-uniform-index.test.ts`, `tests/sim/run.test.ts`.

Docs: `docs/PHASES.md` (lines 248–257 acceptance criteria + the
addendum-2 substitution notes at lines 199, 251),
`docs/ARCHITECTURE.md` (lines 424–708 Phase 4 frozen contracts +
lint inventory), `docs/ATLAS_GENERATOR.md` (lines 55–73, 121, 206–209),
`artifacts/decision-memo-phase-4.md` (addendum at 2026–3084 + the
new addendum-2 at 3088–3132).

Phase 4.A.1 is ready for approval. Phase 4.A.2 (sandbox-verifiable
atlas implementation) is the next phase.
