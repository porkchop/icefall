# Code review — Phase 8.A.1 (drift-detection sweep + scaffolding)

Scope: the eight-file sweep that lands ahead of 8.A.2's URL-router +
verifier + share-codec + save-layer implementation. Reviewed against the
seven acceptance criteria in the brief and the addendum at
`artifacts/decision-memo-phase-8.md` lines 2944-3515 (B1, B4, B6, B7,
B8, B9; advisory A1).

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`) |
| `npm run test` | 978 tests passed across 70 files (was 970/69 in 7.B; +8 / +1) |
| `npm run build` | green; 116.98 KB raw / 33.69 KB gzipped (unchanged — no production code added) |
| Reachability walker (re-run on current HEAD) | 36 reachable files, all classified under `RULES_FILES ∪ KNOWN_INFRASTRUCTURE`; zero `src/router|verifier|share|save/**` leaks |
| Lint-scope probe — `import { deflateSync } from "fflate"` under `src/share/**` | rejected with the addendum-B1 message, byte-exact |
| Lint-scope probe — `new Date()` under `src/router/**/*.ts` (non-A1 file) | rejected (`new Date() is banned in deterministic code` + `Date is banned in deterministic code`) |
| Lint-scope probe — `new Date(); .toISOString()` under `src/router/release-index-parse.ts` | green (advisory A1 exception applied) |

## Blocking issues

**None of the four blocking rejection criteria from QUALITY_GATES.md are
violated.** The change is scaffolding (no production code), so the
"new module + no test" criterion does not apply; the new test file is
the test that pins the scaffold's contract. The `tests/build/rules-files
-reachability.test.ts` has 6 tests and is itself part of the deliverable.

That said, one **lint-scope correctness defect** is severe enough to
warrant a fix in this iteration before 8.A.2 lands code under the
affected scope. It does not violate a numbered rejection criterion (no
production code is shipped under the broken scope yet), so it is filed
below as a non-blocking suggestion **N1 (recommend fixing before
8.A.2)**, but reviewers reading this should treat it as a pre-8.A.2
must-fix.

## Review focus — verdict per item

### 1. Test sufficiency — `tests/build/rules-files-reachability.test.ts`

PASS. The test pins both directions of the reachability invariant per
addendum B8:

- **Forward direction** ("reachable but not in `RULES_FILES`"): a Phase
  8.A.2 commit that adds `src/registries/whatever.ts` and imports it
  from `src/sim/turn.ts` would surface in `walkReachable(harness)` (the
  walker pushes any `.startsWith(repoRoot/src/)` target onto the
  visited stack) and fail the first test with the exact pinned message
  `"rules-files: file src/registries/whatever.ts is reachable from
  src/sim/harness.ts but not in RULES_FILES — add it to
  src/build-info.ts:RULES_FILES or remove the import"`. The em-dash is
  U+2014 byte-exact (verified by grepping the source line).
- **Reverse direction** ("in `RULES_FILES` but not reachable"): a
  removal of the import edge on a non-atlas-pipeline rules-file would
  fail the second test with the exact pinned message.
- **Anti-cycle defense (the load-bearing B8 invariant)**: a Phase 8.A.2
  commit that adds `src/sim/harness.ts → src/verifier/verify.ts` would
  fail the fifth test (`"Phase 8 layers (router, verifier, share, save)
  are NOT reachable from src/sim/harness.ts"`). It would also fail the
  first test (because `src/verifier/verify.ts` is in neither
  `RULES_FILES` nor `KNOWN_INFRASTRUCTURE`).
- **Pinned error messages**: byte-exact match against the addendum text
  at `decision-memo-phase-8.md:3394-3399` confirmed by grep — both
  strings, including the em-dash, are reproduced verbatim at
  `tests/build/rules-files-reachability.test.ts:163` and `:178`.

**On current HEAD the walker visits 36 files**, all of which are
correctly partitioned: 9 `RULES_FILES` entries (registries + sim
behavior files) reachable, 3 `RULES_FILES` entries (atlas-pipeline)
unreachable but classified as `ATLAS_RULES`, and 27 `KNOWN_INFRASTRUCTURE`
entries that affect the digest chain but are intentionally NOT in
`RULES_FILES` to avoid forcing a `rulesetVersion` bump on every PRNG /
hash / mapgen refactor. The test would have caught a forgotten
classification at sweep authorship time; it gives 8.A.2 reviewers a
mechanical CI signal.

**One nit** (S1): the walker uses a regex-based import scanner
(`/^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/gm`)
rather than the TypeScript Compiler API. The regex correctly handles
the project's current import shapes (single-line, multi-line, type-only,
re-exports), but a future contributor using `import("path")` dynamic
imports or `require("path")` would silently bypass the gate. The current
codebase has zero dynamic imports under `src/sim/**` and the walker
correctly handles every actual import in the 36-file reachable set, so
this is a forward-looking risk only. Recommend adding a single test
that asserts the walker's coverage by counting expected reachable files
(currently 36) — a regression in walker coverage would surface as a
count drop. Filed as N2.

### 2. Lint-scope correctness — four new layer scope blocks

PARTIAL PASS. Three of the four scopes are correctly enforced; the
fourth has a scoping defect.

**`src/share/**` (PASS).** The `paths: [{ name: "fflate", importNames:
["deflateSync", "inflateSync"], ... }]` form correctly rejects
`import { deflateSync } from "fflate"` with the addendum-B1 message
verbatim (probe-tested live; lint output reproduced in the gates table
above). The cross-layer import group also rejects
`import { generateFloor } from "../mapgen/index"` with the
"src/share/** may import only src/core/** and the fflate
zlibSync/unzlibSync pair" message (probe-tested live). The `Date` /
`performance` / `Math.random` / `new Date()` bans are present via
`FORBIDDEN_TIME` + `no-restricted-globals`. Determinism plugin
(`no-float-arithmetic`) is NOT extended to `src/share/**` — see N3.

**`src/verifier/**` (PASS).** The cross-layer ban allows
`src/sim/harness` (the verifier's load-bearing import surface for
`runScripted`) by NOT including `**/sim/**` in the `group` list. The
correct shape: only `**/render/**`, `**/input/**`, `**/atlas/**`,
`**/router/**`, `**/save/**`, `**/main` are banned. The verifier may
import `src/sim/harness` and `src/sim/types`, matching the layer table
in `docs/ARCHITECTURE.md`. Determinism bans (`FORBIDDEN_TIME`, `Date`,
`performance`) present.

**`src/save/**` (PASS).** Cross-layer ban includes `**/sim/**`,
`**/mapgen/**`, `**/render/**`, `**/input/**`, `**/atlas/**`,
`**/router/**`, `**/verifier/**`, `**/main`. The save layer may import
only `src/core/**` and `src/share/**`, matching the layer table.
Determinism bans present.

**`src/router/**` (PARTIAL — N1, recommend fix before 8.A.2).** The
cross-layer ban + `FORBIDDEN_TIME` + `Date` / `performance`
`no-restricted-globals` are correctly present for files matching
`src/router/**/*.ts` *minus* `src/router/release-index-parse.ts`.

**However**, the advisory-A1 exception is mis-scoped. The scope block
declares:

```js
files: ["src/router/**/*.ts"],
ignores: ["src/router/**/*.test.ts", "src/router/release-index-parse.ts"],
```

ESLint's `ignores` lifts the **entire** scope block from the file —
not just the Date restriction. I confirmed this live by writing
`src/router/release-index-parse.ts` containing all four of:

```ts
import { generateFloor } from "../mapgen/index";  // should fail (cross-layer)
export const r = Math.random();                   // should fail (FORBIDDEN_TIME)
export const p = performance.now();               // should fail (FORBIDDEN_TIME)
export const d = new Date("2026-01-01");          // intentionally allowed (advisory A1)
export const s = d.toISOString();                 // intentionally allowed (advisory A1)
```

`npx eslint` exits 0 with no errors. The scope-block comment at
`eslint.config.js:573-580` and `docs/ARCHITECTURE.md`'s "Date-API
exception (advisory A1)" subsection both promise that *only* Date is
allowed; `Math.random`, `performance.now`, and the cross-layer import
ban should remain enforced. The current `ignores` list is too broad.

**Fix.** Split `release-index-parse.ts` into a separate scope block
that re-applies every restriction except the Date `no-restricted-globals`
+ `NewExpression[callee.name='Date']`. The shape (rough sketch — the
8.A.2 author may prefer `eslint-disable` line-level comments, but the
scope-level fix matches the project's existing pattern):

```js
{
  files: ["src/router/release-index-parse.ts"],
  rules: {
    "no-restricted-imports": [/* same group/patterns as router scope */],
    "no-restricted-syntax": ["error",
      // FORBIDDEN_TIME minus the new-Date() rule:
      { selector: "MemberExpression[object.name='Math'][property.name='random']", ... },
      { selector: "MemberExpression[object.name='Date'][property.name='now']", ... },
      { selector: "MemberExpression[object.name='performance'][property.name='now']", ... },
    ],
    "no-restricted-globals": ["error",
      { name: "performance", ... },  // Date global allowed for toISOString consumption
    ],
  },
},
```

This is a real defect in the scaffolding contract — a Phase 8.A.2
implementer who reads only the comment would write
`release-index-parse.ts` assuming `Math.random` is banned, then
discover at runtime that determinism is broken silently. The defect
is currently dormant (no production code under `src/router/**` exists
yet), so it does not block phase approval, but it must be fixed before
any code lands in 8.A.2 under that path. **The fix belongs in 8.A.1 —
this scaffolding phase is the right place to land the lint-scope
contract.**

### 3. Fingerprint test coverage

PASS. The original semantic surface is preserved:

- `commitHash` sensitivity — `changes when commitHash changes` test at
  `:32` (now uses 12-char fixtures `"abcd123def56"` vs `"ffff999aaaaa"`).
- `rulesetVersion` sensitivity — `:40`.
- `seed` sensitivity — `:48`.
- `modIds` permutation invariance — `:54`.
- Empty-modIds vs single-empty-string modId — `:68`.
- NUL rejection in any field — `:77`.
- Comma rejection in any modId — `:92`.
- Surrogate rejection in any field — `:98`.
- DEV- prefix under placeholder — `:121`.
- Original 22-char golden — `:143` (recomputed: `"iyFf_akWHbsMe8lprGyrH6"`).

The two new tests at `:151` and `:163` each pin a distinct golden:

- **12-char-commit golden (addendum B4)** — `:151`. Asserts both the
  fixture shape (`baseInputs.commitHash.length === 12 && /^[0-9a-f]{12}$/`)
  AND the resulting fingerprint (`"iyFf_akWHbsMe8lprGyrH6"`). The shape
  assertion would fail if a future drift sweep silently re-shortened
  the fixture.
- **Synthetic-mod-ID golden (decision 1 + 1a)** — `:163`. Asserts that
  `modIds: ["icefall.mod.test-vector-1"]` produces the byte-distinct
  fingerprint `"lTehjjHQfSlG1G9okHmwhT"` AND that this differs from the
  empty-modIds fingerprint. This exercises the mod-slot pre-image path:
  if a future implementer changed the canonical-modIds-encoding (e.g.,
  added a separator, changed the comma to a semicolon), this golden
  would fail.

Both goldens are recomputed and the test suite passes (978/978).
Coverage remains at 100% for `src/core/fingerprint.ts`.

### 4. Documentation accuracy

PASS with one minor slip noted.

**`docs/ARCHITECTURE.md` Phase 8 frozen contracts.** Spot-checked
against `decision-memo-phase-8.md`:

- Layer-additions table mirrors the addendum's layer table.
- One-way verifier import direction (verifier may import harness;
  harness must NEVER import verifier) reproduced from addendum B8.
- fflate `zlibSync`/`unzlibSync` pin from addendum B1 — exact phrase.
- Action-log envelope `[ICE\x01][actionCount:u32 LE][concat(...)]`
  matches decision 2 + addendum B1.
- URL syntax matches decision 3 + addendum B7.
- `URL_FULL_LENGTH_THRESHOLD = 2000` + `URL_FULL_LENGTH_HARD_CAP =
  32000` from addendum B7 (note: the threshold landed in addendum B7,
  not in the original decision 3 — the doc correctly attributes both).
- Nine pinned error strings reproduced verbatim including the new
  `ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED` from addendum B3.
- `releases/<commit-short>/` layout uses 12-char `commitShort` from
  addendum B4.
- `releases/index.json` schema with `schemaVersion: 1`,
  `commitShort: /^[0-9a-f]{12}$/`, `commitHash: /^[0-9a-f]{12}$/`,
  `rulesetVersion: /^[0-9a-f]{64}$/`, `atlasBinaryHash:
  /^[0-9a-f]{64}$/`, `publishedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`.
  Matches addendum B5.
- localStorage persistence keys (`icefall:save:v1:<fingerprintShort>`)
  + auto-save cadence (every 10 actions + `beforeunload`) +
  build-mismatched-slots-preserved invariant — all from addendum B6.
- `VerifyArgs` / `VerifyResult` discriminated union matches decision 10
  + advisory A4 (the `expectedAtlasBinaryHash` is REQUIRED, not optional).
- `__COMMIT_HASH__` 12-char pin from addendum B4.
- Bundle budget bump from 75 KB to 110 KB from decision 16.
- Phase decomposition 8.0 → 8.A.1 → 8.A.2 → 8.A.3 → 8.B with
  `8.A.3` rationale ("dual-build CI extension cannot be sandbox-verified
  because the second tree's URL routing requires the live GH-Pages
  host") matches addendum B9.

**Build-time-constants section update**: `commitHash` doc-comment
correctly bumped to "12-char hex when built (Phase 8.A.1 addendum B4);
'dev000000000' in tests" — matches the production code's `dev000000000`
fallback.

**Spot-check on decompression-bomb math in `docs/PROD_REQUIREMENTS.md`.**
The doc claims:

> `URL_FULL_LENGTH_HARD_CAP = 32000` chars (~24 KB
> post-base64url-decode → 24 KB compressed). Even at the
> DEFLATE-best-case ~1024:1 ratio, the maximum decompressed
> envelope is ~24 MB

Verified:
- 32000 base64url chars × (3/4) = 24000 bytes — base64 expansion is
  4 output chars per 3 input bytes, so the inverse is correct. **PASS.**
- DEFLATE's theoretical maximum decompression ratio is ~1032:1 (the
  longest-repeated-byte trick); the doc rounds to 1024:1 which is
  conservative-by-rounding. **PASS** (worst-case is upper-bounded; the
  bomb-bound is correct).
- 24000 × 1024 ≈ 24 MB — arithmetic correct. **PASS** (note: 24000 ×
  1024 = 24,576,000 ≈ 24.6 MB, which the doc rounds to "~24 MB"; the
  rounding direction is generous-toward-attacker, which is the
  conservative direction for a security claim).

**Slip (S2, cosmetic).** The doc says "input length is already capped
by `URL_FULL_LENGTH_HARD_CAP = 32000` chars (~24 KB
post-base64url-decode)". Strictly the URL hard cap is the *full URL*
length, including origin + path + query — the `#log=` payload alone is
≤ 32000 minus the prefix, which is closer to ~31900 chars in the
worst case. The bomb-bound argument still holds (the upper bound is
weaker, not tighter), but a precise reader could argue the math
under-counts the prefix overhead by ~100 chars. Cosmetic; the security
claim is unchanged at one significant figure.

### 5. Drift sweep coverage

PASS. The Phase 7.A.2b carry-forwards (S2 stale boss-fsm fixture stats,
S3 untested probe/trace tools, S4 untested build-win-log walker) were
not addressed in this sweep, and that is the **correct call** per the
phase-approval doc's `follow_ups_carried_forward` list:

- **S2** (stale `hpMax: 40, atk: 9, def: 5` Monster fixtures in
  `tests/sim/boss-fsm.test.ts:47-48` and `tests/sim/turn.test.ts:419-447`):
  the tests still pass because the fixtures isolate FSM behavior from
  the registry. Updating them is documentation-only churn; pulling it
  into 8.A.1 would distract from the load-bearing scaffolding goals.
- **S3 / S4**: `tools/probe-seeds.ts`, `tools/trace-seed.ts`,
  `tools/build-win-log.ts` are operational diagnostic CLIs. The
  established pattern (Phase 7.A.2b approval verdict) is to leave them
  untested; 8.A.2 will add `tools/verify.ts` as a peer per addendum B9,
  at which point the tools/-testing posture should be reconsidered as
  a single sweep.

The Phase 7.A.2a S1 (drift in `src/render/canvas.ts:149` body docstring
on the layering-order comment) was also not addressed and is also
correctly deferred for the same reason — pure cosmetic, not in the
8.A.1 deliverable list.

No prior-phase carry-forward was missed that 8.A.1 should have swept.

### 6. Hidden coupling / overlap — duplication across the four new scope blocks

ACCEPTABLE. Each of the four new layer scopes ends with the same
five-line tail:

```js
"no-restricted-syntax": ["error", ...FORBIDDEN_TIME],
"no-restricted-globals": [
  "error",
  { name: "Date", ... },
  { name: "performance", ... },
],
```

This duplicates the same pattern that `src/render/**`, `src/input/**`,
`src/ui/**`, and `src/atlas/**` already use (the existing layer scopes
have the same boilerplate). The `FORBIDDEN_TIME` array is hoisted to a
module-level const at `eslint.config.js:13-32`, which already DRYs the
selector logic. The remaining duplication is the
`no-restricted-globals` Date / performance entries; refactoring those
into a `FORBIDDEN_TIME_GLOBALS` constant would save 3 × 6 = 18 lines.

For Phase 8.A.1 scaffolding, I judge this **acceptable boilerplate**:
the duplication is self-similar and the pattern matches the existing
Phase 5/4 layer scopes (consistency with prior phases is itself a DRY
property at the meta-level). A future drift sweep that touches
multiple layer scopes simultaneously could fold the pattern into a
helper. Filed as advisory N4, not a blocker.

The cross-layer import patterns are NOT duplicated — each scope's
`group: [...]` list is genuinely different (banning the layer-table's
specific forbidden imports for that layer). That is correct
domain-modeling, not duplication.

## Non-blocking suggestions

**N1 (recommend fix before 8.A.2 lands code under `src/router/**`).**
The `ignores: [..., "src/router/release-index-parse.ts"]` on the
`src/router/**/*.ts` scope block at `eslint.config.js:585` lifts the
ENTIRE scope from the file, not just the Date `no-restricted-globals`
+ `NewExpression[callee.name='Date']` rule. Probe-tested live: a
hypothetical `src/router/release-index-parse.ts` with `import
{ generateFloor } from "../mapgen/index"; const r = Math.random(); const
p = performance.now(); new Date("2026-01-01")` lints clean. The intent
per the comment + `docs/ARCHITECTURE.md`'s "Date-API exception
(advisory A1)" is that *only* Date is allowed; `Math.random`,
`performance.now`, and the cross-layer import bans should remain
enforced. Fix: add a dedicated scope block for
`src/router/release-index-parse.ts` that re-applies every router
restriction except the Date global + new-Date() selector. **Filed as
non-blocking only because the file does not yet exist; the defect is
dormant. Must be fixed before 8.A.2 ships any file under
`src/router/**`.**

**N2 (advisory, scaffolding hardening).** The reachability walker at
`tests/build/rules-files-reachability.test.ts:108` uses a regex
import scanner (`/^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/gm`)
rather than the TypeScript Compiler API. The regex correctly handles
every import shape in the current 36-file reachable set, but a future
contributor using `import("path")` dynamic imports or `require("path")`
would silently bypass the gate. Recommend adding one assertion that
pins the count of reachable files (currently 36), so a coverage
regression in the walker would surface as a count drop. Cosmetic; the
addendum-B8 contract is satisfied as written.

**N3 (advisory, alignment).** The determinism plugin
(`determinism/no-float-arithmetic`) is NOT extended to the four new
Phase 8 layers. Routing, verification, share-codec, and save-layer
modules SHOULD be integer-only by construction (the codec is
byte-deterministic; the verifier hashes integers; the save layer
serializes integer counters). For symmetry with `src/render/**`,
`src/input/**`, `src/ui/**`, `src/atlas/**`, `src/sim/**`, and
`src/mapgen/**` (all of which apply `no-float-arithmetic`), the four
new layers should too. The omission does not break a contract; it just
removes a defense-in-depth lint signal. Recommend adding a single
scope block:

```js
{
  files: ["src/router/**/*.ts", "src/verifier/**/*.ts",
          "src/share/**/*.ts", "src/save/**/*.ts"],
  ignores: ["src/router/**/*.test.ts", /* ... */ ],
  plugins: { determinism: determinismPlugin },
  rules: { "determinism/no-float-arithmetic": "error" },
},
```

**N4 (advisory, optional DRY).** Each of the four new scope blocks
duplicates the same `no-restricted-globals` Date / performance entries
(3 lines × 4 layers = 12 lines of self-similar boilerplate). The
existing `src/render/**`, `src/input/**`, `src/ui/**`, `src/atlas/**`
scope blocks have the same duplication. A future drift sweep could
hoist a `FORBIDDEN_TIME_GLOBALS` const; for 8.A.1 the consistency with
prior-phase scopes is itself a DRY property at the meta-level.

**S1 (cosmetic, doc).** `docs/PROD_REQUIREMENTS.md`'s
decompression-bomb math says "input length is already capped by
`URL_FULL_LENGTH_HARD_CAP = 32000` chars (~24 KB
post-base64url-decode)". Strictly, the cap is the *full URL* length
including origin + path + query — the `#log=` payload alone is ≤
~31900 chars in the worst case (the prefix overhead is ~100 chars).
The bomb-bound argument is unaffected (the upper bound is weaker, not
tighter). One-significant-figure approximation; cosmetic.

**S2 (cosmetic, doc).** `docs/PROD_REQUIREMENTS.md` line 48 says
"DEFLATE-best-case ~1024:1 ratio". The theoretical maximum
decompression ratio for raw DEFLATE is closer to 1032:1
(longest-repeated-byte trick); the round to 1024:1 is generous-toward
the attacker (under-counts the maximum) by ~1%. The doc's "~24 MB"
upper-bound claim should be ~24.8 MB; both round to "~24 MB" at one
sig-fig. Cosmetic.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is satisfied for the
work that lands:

- **New module / public behavior**: this phase ships no production
  code; `tests/build/rules-files-reachability.test.ts` IS the test
  surface that pins the scaffolding contract. 6 tests cover the
  forward direction (reachable-but-not-classified), reverse direction
  (in-RULES-but-not-reachable-and-not-atlas), atlas-rules-classification-
  in-sync, RULES_FILES / KNOWN_INFRASTRUCTURE disjointness, Phase 8
  layer anti-cycle, and a sanity check on the walker. Each would fail
  if the underlying invariant were violated (verified by mental
  execution + the live walker re-run).
- **Bug fix**: not applicable; this phase fixes no regressions. The
  978-test suite includes the existing 970-test 7.B baseline preserved
  byte-for-byte.
- **Test names describe behavior, not implementation**: confirmed
  ("every reachable-from-harness file is either in RULES_FILES or
  KNOWN_INFRASTRUCTURE", "every RULES_FILES entry is reachable from
  harness OR is an atlas-pipeline file", etc.).
- **Edge cases**: forward direction, reverse direction, classification
  disjointness, anti-cycle, walker-sanity all covered.
- **Coverage thresholds**: unchanged from 7.B baseline (`src/core/**`
  100/100/100/90 branches, `src/sim/**` 95/95/100/85, etc.); no new
  production source under coverage so thresholds are inherited.

The fingerprint test extension at `src/core/fingerprint.test.ts` adds
two new goldens (12-char-commit and synthetic-mod-ID) and recomputes
the existing 22-char golden under the bumped fixture. Coverage on
`src/core/fingerprint.ts` remains 100/100/100/90.

## Approval verdict

**APPROVE WITH NITS.**

Five out of six review-focus items pass cleanly. The sixth
(lint-scope correctness) has a real defect at the advisory-A1
exception scope (`ignores:` lifts the entire scope rather than just
the Date `no-restricted-globals` rule), but the defect is **dormant**
in 8.A.1 because no production file exists yet under
`src/router/**`. The fix belongs in the same scaffolding sweep — N1
is filed as non-blocking only on the strict reading that
QUALITY_GATES.md's blocking criteria refer to shipped code. **The
8.A.2 author MUST land the N1 fix in the same commit as the first
file under `src/router/release-index-parse.ts`, or land it in a
follow-up 8.A.1 amendment commit.**

All gates green: 978 tests / 70 files / 0 lint / 0 typecheck / 116.98
KB raw / 33.69 KB gzipped (unchanged from 7.B). Cross-runtime
SIM_DIGEST + WIN_DIGEST + INVENTORY_DIGEST preserved byte-unchanged.
The reachability test correctly catches the two failure modes the
addendum prescribes (B8 forward + reverse + anti-cycle directions),
with byte-exact pinned error messages. The four new lint scopes
correctly enforce the layer-table cross-layer bans (verified live via
probe lint) — the only defect is the advisory-A1 exception scoping.
Documentation faithfully mirrors the addendum's frozen contracts.

Phase 8.A.2 (URL router + verifier + share-codec + save-layer
implementation) is unblocked once N1 is addressed.

## Files relevant to this review

Source / config (in scope):

- `/workspace/eslint.config.js`
- `/workspace/src/build-info.ts`
- `/workspace/vite.config.ts`
- `/workspace/vitest.config.ts`

Tests (in scope):

- `/workspace/tests/build/rules-files-reachability.test.ts` (new)
- `/workspace/src/core/fingerprint.test.ts`

Documentation (in scope):

- `/workspace/docs/ARCHITECTURE.md` (extended)
- `/workspace/docs/PROD_REQUIREMENTS.md` (rewritten)

Phase context:

- `/workspace/artifacts/decision-memo-phase-8.md` (lines 2944-3515 for the addendum's B1, B4, B6, B7, B8, B9 + advisory A1)
- `/workspace/artifacts/red-team-phase-8.md` (the red-team review that drove the addendum)
- `/workspace/artifacts/phase-approval.json` (Phase 8.0 approval — current `master` HEAD)
- `/workspace/artifacts/code-review-phase-7-A-2b.md` (carry-forward S1/S2/S3/S4 — none resolvable in 8.A.1)
- `/workspace/docs/PHASES.md` (Phase 8 spec at lines 534-567)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, drift detection gate)

Production reachability (verified by re-running the walker):

- `/workspace/src/sim/harness.ts` (the walker root)
- 36 reachable files total, partitioned correctly into 9 in-`RULES_FILES`-and-reachable + 27 `KNOWN_INFRASTRUCTURE`; 3 atlas-pipeline `RULES_FILES` entries unreachable-but-classified
