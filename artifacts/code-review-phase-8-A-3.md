# Code review — Phase 8.A.3 (build-pipeline extension + auto-redirect + Share This Run + history.replaceState)

Scope: the build-pipeline + page-load-routing half of Phase 8 per
memo addendum B9 + B5 + advisory A3 + A7. This iteration ships
`scripts/build-dual.mjs` (dual Vite build),
`scripts/publish-dual.mjs` (release-index merge + advisory-A7
fallback) with its TypeScript declaration `.d.mts`,
`tests/build/publish-dual.test.ts` (21 tests covering pure logic),
the `.github/workflows/deploy.yml` extension (dual-build replaces
`npm run build`; new `publish-dual` step; pages-artifact upload
switched to `dist-final`), `src/main.ts` wiring (the new
`applyRouting()` page-load entry point + Share-This-Run diagnostic
section + history.replaceState canonicalization), and the
`.gitignore` extensions for the new build trees.

Reviewed against the 9 review-focus items in the brief, the
`docs/QUALITY_GATES.md` blocking criteria, and decisions 5, 7, 11,
17 + addendum B5, B9 + advisory A3, A7 of
`artifacts/decision-memo-phase-8.md`.

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run typecheck` | green (`tsc -b --noEmit`, 0 errors) |
| `npm run test` | **1153 tests / 81 files** passed (was 1132/80; +21 / +1 from `publish-dual.test.ts`) |
| `npm run build` | green; **139.24 KB raw / 41.31 KB gzipped** (was 132.38/39.16; +6.86/+2.15 KB) — well under the 110 KB CI gate |
| Reachability walker (`tests/build/rules-files-reachability.test.ts`) | 7/7 pass; the Phase-8 anti-cycle defense holds (router/verifier/share/save NOT reachable from `src/sim/harness.ts`) |
| `tests/build/publish-dual.test.ts` | 21/21 pass |
| `npm run lint` (clean checkout, CI-shaped) | green (0 errors) |
| `npm run lint` (after `node scripts/build-dual.mjs ...` smoke) | **423 errors** — see B1 below |

The new `__SHARE_URL__`, `__ROUTER_AUTO_DECISION_KIND__`, and
`__URL_CANONICALIZED__` window flags are declared in `main.ts`; their
cross-runtime end-to-end exercise is deferred to Phase 8.B per the
brief's scope.

## Blocking issues

### B1 — `npm run lint` fails after the dual-build script runs locally

**Violates:** rejection criterion "test suite was not run, or the run
output shows failing tests" (transitively — the lint suite in the
sandbox's developer-loop is intermittently red).

`eslint.config.js:49` ignores `dist`, `coverage`, `node_modules`,
`playwright-report`, and `test-results` — but does NOT ignore
`dist-build-*/` or `dist-final/`. The `.gitignore` correctly excludes
both (`/workspace/.gitignore:9-11`), but eslint reads its own ignore
list, not git's.

Reproduction (verified in this review):

```
$ rm -rf dist-build-* dist-final && node scripts/build-dual.mjs --commit-short=deadbeef0000
build-dual: assembled /workspace/dist-final
$ npm run lint
... 423 errors, 0 warnings ...
$ npx eslint . --ignore-pattern 'dist-build-*' --ignore-pattern 'dist-final'
... exit 0 ...
```

The errors are all `@typescript-eslint/no-unused-expressions` flagged
against the **minified production JS** in
`dist-build-deadbeef0000/assets/index-*.js` and (would also fire
against) `dist-final/assets/index-*.js`.

**Why this matters.**

- The CI deploy.yml ordering (lint → typecheck → test → dual-build)
  means the GH Actions run is green: lint runs against a clean
  checkout. So the brief's "All sandbox gates green" claim is true
  *only* on a clean checkout.
- The brief's smoke-test step (`Smoke-tested node scripts/build-dual.mjs
  --commit-short=deadbeef0000`) **left the artifact on disk**. Any
  subsequent `npm run lint` from the same workspace fails with 423
  errors. The artifact is in `git status` as untracked but is not
  removed by any cleanup script.
- A developer who runs the dual-build locally to verify a Phase 8.B
  iteration loses access to the lint gate until they manually
  `rm -rf dist-build-* dist-final`. This is a developer-experience
  defect that contradicts the project's "audit-first" operating rule
  in `/workspace/.claude/CLAUDE.md`.

**Fix.** One-line edit to `eslint.config.js:49` — extend the existing
`{ ignores: [...] }` block:

```js
{ ignores: ["dist", "dist-build-*", "dist-final", "coverage", "node_modules", "playwright-report", "test-results"] },
```

Glob support is already present (eslint flat config supports glob
patterns in the `ignores` field). One-line change; symmetric with the
`.gitignore` already in this PR.

### B2 — `applyRouting`'s history.replaceState canonicalization silently strips `?mode=replay`, breaking the Replay-this-run section

**Violates:** rejection criterion "implementation contradicts an
approved architecture decision" (the Replay-this-run section in
`main.ts:826-887` is the documented post-replay-redirect contract;
the canonicalization step removes the very query parameter that
gates it).

**Reproduction by code-trace.**

URL on page load: `https://x.com/icefall/?run=ABCD&seed=foo&mode=replay#log=xxx`.

1. `applyRouting` (`src/main.ts:1096`) calls `decideRouting(href, build, null)`.
2. `parseShareUrl` (`src/router/url-parse.ts:102`) extracts only
   `?run=`, `?seed=`, `?mods=`, and `#log=` — `?mode=replay` is not
   in the recognized parameter set, so it's discarded into the URL
   parser's "ignored other params" bucket.
3. `decideRouting` returns `{kind: "boot-replay", inputs:
   {seed:"foo", modIds:[]}, claimedFingerprint:"ABCD",
   logWire:"xxx"}` if the fingerprint matches the current build.
4. `applyRouting` at `main.ts:1123-1128` calls
   `formatShareUrl(probeDecision.inputs, "ABCD", "xxx",
   window.location.origin + window.location.pathname)`.
   Note: passing `origin + pathname` (NOT including
   `window.location.search`).
5. `formatShareUrl` (`src/router/url-parse.ts:230`) builds:
   `https://x.com/icefall/?run=ABCD&seed=foo#log=xxx`.
6. `canonical !== href` is true (the `mode=replay` is gone), so
   `history.replaceState(null, "", canonical)` fires.
7. The Replay-this-run section at `main.ts:829-830` then reads
   `window.location.href` and computes
   `replayUrl.searchParams.get("mode") === "replay"` → **false**.
8. The replay section renders the idle "Append `?mode=replay&run=...`
   to this URL" help text — even though the user explicitly opened
   the page in replay mode.

The user-visible symptom: opening a `?mode=replay&...` URL silently
falls back to the default game. The diagnostic page's window flags
that 8.A.2b's replay e2e relies on (`__REPLAY_MODE__ === "active"`,
`__REPLAY_FINAL_STATE_HASH__`, `__REPLAY_OUTCOME__`) NEVER fire,
because the `isReplayMode` check at `main.ts:830` short-circuits.

**Why this matters.**

- The Phase 8.A.2b replay-mode contract was the load-bearing path for
  cross-runtime replay verification (the
  `__REPLAY_FINAL_STATE_HASH__` matches `WIN_DIGEST` byte-for-byte
  on chromium / firefox / webkit). Phase 8.A.3 silently breaks it.
- The Phase 8.B acceptance criterion at `decision-memo-phase-8.md:2655-2657`
  reads: "Replay viewer reaches the same final state hash as the
  original run. (`__REPLAY_FINAL_STATE_HASH__` matches the pinned
  `WIN_DIGEST` across all three browsers.)" This will fail in 8.B
  because the replay viewer never activates on the canonical URL.
- The `redirect.ts:185-188` path correctly preserves the entire
  search string (`url.search.slice(1)`) when generating a redirect
  target. The canonicalize path in `main.ts:1127` should preserve
  unrecognized search params with the same fidelity.

**Fix options (in order of preference).**

1. **Preserve unrecognized search params in `formatShareUrl`.** Pass
   `window.location.search` through and merge known params
   (`run`, `seed`, `mods`) with unknown ones. Most defensible — the
   share URL is *additive*, not replacing.
2. **Compare canonical excluding "expected to differ" params.** Only
   fire `replaceState` if the `run`/`seed`/`mods` ordering or
   encoding actually changed.
3. **Don't canonicalize in 8.A.3.** Defer the canonicalization to
   Phase 9 polish; the URL bar showing slightly non-canonical form
   is acceptable for the first 8.A.3 deploy.

The minimum fix that unblocks the Phase 8.B replay e2e is option 2
(skip the replaceState if no semantic change to share-form params).
Option 1 is the right long-term contract.

This is testable in-sandbox via JSDOM or a happy-dom mock; the test
would assert that `history.replaceState` is NOT called when the URL
is `?mode=replay&run=<matching-fp>&seed=foo`. No test currently
covers the canonicalization path at all.

## Non-blocking suggestions

### S1 — `parseArgs` not exported from `publish-dual.d.mts` initially

The `.d.mts` declaration includes `parseArgs` (line 33) and the test
imports it (line 5 of `tests/build/publish-dual.test.ts`); this works.
However, the `.mjs` re-exports `parseArgs` at the BOTTOM (line 256)
in the named-exports re-bundle, which is correct but counter-pattern
for `.mjs` modules (typical pattern is `export function ...`). Read
order: the function is `function parseArgs` at line 123 (file-private),
then re-exported at the bottom. This works but a future maintainer
might miss that it's exposed. Move the `function parseArgs` at line
123 to `export function parseArgs` and drop the bottom re-export
chain. Cosmetic.

### S2 — Dead `dirname` import in `publish-dual.mjs`

```
src/scripts/publish-dual.mjs:41   import { dirname, join, resolve } from "node:path";
src/scripts/publish-dual.mjs:260  void dirname;
```

`dirname` is imported but only "used" via `void dirname` to silence
the unused-import warning. The accompanying comment ("silence
unused-import warning for `dirname` in case downstream importers want
to use it without a separate import") is not a compelling
justification — JS/TS callers should import what they need directly.
Either remove the import or actually use it. Cosmetic.

### S3 — Defensive pin missing on `computeDefinePayload` import contract

Per review-focus item 9: `publish-dual.mjs:42` imports
`computeDefinePayload` from `scripts/vite-plugin-atlas-binary-hash.mjs`
and consumes `payload.rulesetVersion`, `payload.hash`, `payload.missing`.
A future signature change in the helper (e.g. renaming `hash` to
`atlasBinaryHash`, or returning `Promise<{...}>` instead of `{...}`)
would break publish-dual silently — there's no test pinning the call.

The risk is low (the helper is also used by `vite.config.ts` at build
time and would break the Vite build first), but a one-line defensive
test in `publish-dual.test.ts` would harden the contract:

```ts
import { computeDefinePayload } from "../../scripts/vite-plugin-atlas-binary-hash.mjs";
it("computeDefinePayload returns the shape publish-dual expects", () => {
  const p = computeDefinePayload(process.cwd());
  expect(typeof p.hash).toBe("string");
  expect(typeof p.rulesetVersion).toBe("string");
  expect(typeof p.missing).toBe("boolean");
});
```

Non-blocking; the live deploy would catch a contract break loudly
(the bundle-gate or pages-artifact step would surface the error).

### S4 — No test for `applyRouting`; the entire control flow is in main.ts

The `applyRouting` function (`main.ts:1096-1190`) is non-trivial
control flow:

- Probe-decide → boot-fresh / boot-replay / error / fall-through-to-fetch
- Optionally fetch index with 5s AbortController timeout + graceful fallback
- Re-decide with index → redirect / error / boot-fresh
- Apply `history.replaceState` or `window.location.replace`

NONE of this is unit-tested. The 5s timeout, the abort race, the
fallback-on-fetch-error, the canonicalize-only-when-different check
are all only exercisable via JSDOM / happy-dom or a real browser.
The brief acknowledges this ("DOM-dependent; relies on cross-runtime
e2e on the deploy"), and 8.A.3 is explicitly NOT-sandbox-verifiable
for the live deploy. **However**, the JSDOM-friendly portion
(probeDecision branching, canonicalize-skip, redirect-target
construction) is testable in-sandbox via vitest with `happy-dom`
environment. Without a test, B2 above slipped through.

Phase 8.B should add an `applyRouting.test.ts` covering at minimum:

- `?run=` matching current build → no replaceState if URL is already
  canonical.
- `?run=` matching current build with extra params (`?mode=replay`,
  `?floor=N`) → preserve them through canonicalization (the B2 fix).
- `?run=` not matching → fetch + redirect target construction.
- Fetch timeout / fetch failure → graceful error surface.

### S5 — Bundle budget overstates Phase 8 layer cost; understates fflate size

The deploy.yml comment at `:48-51` says "Phase 8.A.3 actual is ~45 KB
gzipped" — actual is **41.31 KB gzipped** (the brief lists this
correctly; the deploy.yml comment is slightly stale). Same nit as
the 8.A.2b review's "actual is ~40 KB" comment. Minor.

The 110 KB budget gives ~70 KB future headroom, which remains
generous. PASS.

### S6 — Share button label regex is fragile under Phase 9 BASE_URL changes

`src/main.ts:664`:

```ts
const isPinnedRelease = /\/releases\/[0-9a-f]{12}\/$/.test(baseUrl);
```

This relies on `BASE_URL` ending with the literal `/releases/<commit-12>/`
suffix. The current Vite config sets `BASE_URL = "/icefall/"` for
latest and `BASE_URL = "/icefall/releases/<commit-12>/"` for pinned
(by the dual-build script's `--base` flag). Per memo addendum B5
("Custom-domain deploys (Phase 9 polish) update BASE_LATEST_PATH at
build time"), a future custom domain might be `/`, in which case
both the latest and pinned cases need re-thinking — a custom domain
serving the latest at `https://icefall.example/` would have
`BASE_URL = "/"`, and the pinned would be
`https://icefall.example/releases/<commit-12>/` with
`BASE_URL = "/releases/<commit-12>/"`. The regex would still match,
so this is actually **safe** for a single-segment-domain deploy.

However, if Phase 9 introduces e.g. `/v2/icefall/` as the BASE_URL
(version namespacing), the regex still matches `/v2/icefall/releases/<commit>/`.
**Robust enough**; the regex anchors on `/releases/<commit>/$` which
is invariant. PASS as designed.

The bigger weakness is that the test from advisory A3 ("A regression
test asserts the button label differs in the two contexts") is NOT
present in the unit tests; it's deferred to e2e on the live deploy.
Acceptable for X.A.3 scope per the brief.

### S7 — Share-button minting silently passes invalid seeds through to `fingerprintFull`

`main.ts:702-720`: `runShare` reads `shareSeedInput.value` and passes
it directly to `fingerprintFull(inputs)`. The seed validation (NUL,
malformed UTF-16) lives in `parseShareUrl`'s `isValidSeed` (NOT in
`fingerprintFull`). A user typing a NUL byte or surrogate would NOT
be rejected at the share-mint step; instead, `fingerprintFull` would
either succeed (producing an unsharable URL) or throw (caught at the
generic catch at `:717-720`, surfaced in the `<pre>` as
`error: <message>`).

The correct guard is:

```ts
if (!isValidSeed(seed)) {
  shareOutput.textContent = "error: seed contains NUL or is not well-formed UTF-16";
  return;
}
```

…or to call `parseShareUrl(formatShareUrl(...))` as a round-trip
self-check. Currently the failure mode is "the URL gets minted; the
recipient's `parseShareUrl` rejects it". Filed as S7 (UX nit; not
blocking — the minting is best-effort and the recipient would surface
the error).

### S8 — Clipboard write is best-effort but the user has no visual confirmation

`main.ts:734-742`: the clipboard write is wrapped in `.catch(() =>
{})` — silent fallback. The `<pre>` shows the URL which the user can
manually copy. No "Copied!" or "Copy failed" feedback. UX choice.
Acceptable for X.A.3 scope; Phase 9 polish should add the feedback
toast.

### S9 — `dirname` import is dead-code-y in `publish-dual.mjs`

(See S2 above.) Repeated for emphasis: `void dirname;` at line 260
is not idiomatic. Remove the import.

### S10 — The bundle-budget step's `find ... -exec gzip -c {} \; | wc -c` measures cumulative gzip size

`.github/workflows/deploy.yml:46`:

```bash
gzip_size=$(find dist-final/assets -name '*.js' -exec gzip -c {} \; | wc -c)
```

If `dist-final/assets/` contains multiple `.js` files (e.g. code-
split chunks), this measures the **sum** of their gzipped sizes, not
the size of any single chunk. Currently Vite produces ONE `index-*.js`
in `dist/assets/` (a single bundle), so the metric is correct. If
Phase 9 introduces dynamic imports / code-splitting, the metric will
overstate (the user pays the network cost for only the bundles they
load — the metric pays for all of them at once).

This is the right metric for "total JS shipped to first paint" if
all chunks are loaded eagerly; it's a conservative measure if chunks
are lazy-loaded. **PASS** as written; revisit when Phase 9 adds code-
splitting.

### O1 — Defensive comment on the 5-second AbortController timeout

`main.ts:1156`: `setTimeout(() => controller.abort(), 5000)`. 5
seconds is reasonable for the median GH-Pages CDN latency (sub-200
ms) plus a 25x slack budget. Worth a brief comment ("5s tolerates
3G mobile networks; the fetch only fires when the URL has `?run=`
and the fp doesn't match the current build, which is rare on bare
URL"). Cosmetic.

### O2 — `applyRouting`'s probe re-runs `decideRouting` twice

The probe at `main.ts:1104-1112` calls `decideRouting(href, build, null)`,
then if the kind is `redirect` or `error` (with index needed), the
fetch fires and `decideRouting(href, build, indexJson)` is called
again. The first call is wasted work (the probe could be replaced by
just calling `parseShareUrl(href)` directly to detect `no-run-param`
/ `boot-replay` early without the full fingerprint computation +
release-index branching). For the bare-URL path this is invisible
overhead (5 ms-ish). Cosmetic optimization opportunity.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is **partially**
satisfied:

- **`scripts/publish-dual.mjs`**: 21 unit tests cover the three pure
  functions (`mergeReleaseIndex` 11 tests including 6 validation
  rejections + bootstrap; `tryParsePriorIndex` 6 tests including
  partial-write defense; `parseArgs` 5 tests including required-arg +
  optional-arg + unrecognized-arg). The fetch / filesystem-write
  paths are NOT unit-tested (they're exercised on the live deploy);
  this is acceptable per the brief's scope (script-only, thin
  orchestration over `fetch` + `writeFileSync`).

- **`scripts/build-dual.mjs`**: NO unit tests. The `parseArgs` and
  `ensureEmpty` / `copyTree` exports could be smoke-tested with a
  tmp directory, but the dual-`vite build` invocation is the load-
  bearing logic and is best exercised on the live deploy. Acceptable
  per the brief.

- **`src/main.ts` `applyRouting` + Share This Run + history.replaceState**:
  NO unit tests. Per S4 above, a happy-dom or JSDOM environment could
  cover the JSDOM-friendly branches (probeDecision branching,
  canonicalize-skip, redirect-target construction). The lack of any
  test for `applyRouting` is what allowed B2 to slip through: a
  vitest suite running `applyRouting` with the URL
  `?run=<matching>&seed=foo&mode=replay` would have caught the
  `?mode=replay` strip immediately.

- **deploy.yml ordering**: NOT testable in-sandbox; verified by
  reading the YAML.

- **Reachability + lint scope**: PASS (7/7 reachability tests pass;
  the new `main.ts` imports of `formatShareUrl` and `fingerprintFull`
  are upstream of the harness reachability surface, verified).

The testing gap on `applyRouting` is the structural cause of B2.
**Phase 8.B should add an `applyRouting.test.ts`** as a structural
follow-up; even a happy-dom-based smoke test of the canonicalization
path would prevent regressions of B2's class.

The cross-runtime golden chain (RANDOM_WALK_DIGEST + MAPGEN_DIGEST +
SIM_DIGEST + ATLAS_DIGEST + 4 preset-seed values + INVENTORY_DIGEST +
WIN_DIGEST + REPLAY_DIGEST) is preserved unchanged — the wiring half
adds no new cross-runtime invariants (the load-bearing byte-level
contracts were all pinned in 8.A.2a).

## Approval verdict

**NEEDS-REWORK.**

Two blocking issues:

- **B1 (lint config)** — `eslint.config.js`'s ignore list does not
  match the `.gitignore` additions. Any developer who runs the dual-
  build script locally hits 423 lint errors on the next `npm run
  lint`. CI is unaffected (lint runs first), but the developer-
  experience contract is broken. One-line fix.
- **B2 (canonicalize strips `?mode=replay`)** — `applyRouting`'s
  `history.replaceState` path silently strips unrecognized query
  parameters, including `?mode=replay`. This breaks the Replay-this-
  run section's gating check in 8.A.2b — the replay viewer never
  activates on a canonical URL with `?mode=replay`. The Phase 8.B
  acceptance criterion at `decision-memo-phase-8.md:2655-2657`
  ("Replay viewer reaches the same final state hash as the original
  run") will fail at the live-deploy verification step because the
  viewer never activates. Needs a fix before the dual-build deploy
  goes live.

The non-blocking suggestions (S1-S10, O1-O2) are minor — dead-import
cleanup, defensive type pins, UI clarification, comment tightening,
and a structural follow-up to add a happy-dom-based test for
`applyRouting`. None are gating; all can be addressed in 8.B or as
future polish.

All other gates green: 1153 tests / 81 files / 0 typecheck errors /
139.24 KB raw / 41.31 KB gzipped (well under the 110 KB CI gate).
Cross-runtime golden chain preserved unchanged. Reachability gate
holds. The advisory-A7 publish-dual fallback is correctly tested for
all four bootstrap branches (null prior, undefined prior, malformed
JSON, schema-mismatch). The dual-build leaves `dist/` populated as
the latest tree, so `vite preview` for e2e continues to work.

Phase 8.A.3 is otherwise structurally sound. With B1 + B2 fixed, the
phase is ready for live-deploy verification in Phase 8.B.

## Files relevant to this review

Source (in scope):

- `/workspace/scripts/build-dual.mjs` (dual Vite build orchestrator)
- `/workspace/scripts/publish-dual.mjs` (release-index merge + advisory-A7 fallback)
- `/workspace/scripts/publish-dual.d.mts` (TypeScript declaration)
- `/workspace/src/main.ts` (`applyRouting` + Share-This-Run section + history.replaceState)
- `/workspace/.github/workflows/deploy.yml` (dual-build + publish-dual + dist-final upload)
- `/workspace/.gitignore` (added `dist-build-*/` and `dist-final/`)

Tests (in scope):

- `/workspace/tests/build/publish-dual.test.ts` (21 tests — pure logic)

Phase context:

- `/workspace/artifacts/decision-memo-phase-8.md` (decisions 5, 7, 11, 17 + addendum B5, B9 + advisory A3, A7)
- `/workspace/artifacts/red-team-phase-8.md`
- `/workspace/artifacts/code-review-phase-8-A-2b.md` (prior phase code review)
- `/workspace/artifacts/phase-approval.json` (Phase 8.A.2b approved on master at 1da126a)
- `/workspace/docs/PHASES.md` (Phase 8 spec at lines 534-567)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, drift detection gate)

Pre-existing files inspected for context (NOT changed by this PR):

- `/workspace/src/router/redirect.ts` (decideRouting — unchanged from 8.A.2b)
- `/workspace/src/router/url-parse.ts` (parseShareUrl + formatShareUrl — unchanged from 8.A.2b)
- `/workspace/scripts/vite-plugin-atlas-binary-hash.mjs` (computeDefinePayload — consumed by publish-dual)
- `/workspace/eslint.config.js` (the ignore list is too narrow per B1)
- `/workspace/playwright.config.ts` (vite preview serves dist/ — works because build-dual leaves dist/ populated)
- `/workspace/tests/build/rules-files-reachability.test.ts` (7/7 still pass; reachability gate holds)
