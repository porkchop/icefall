# Code review — Phase 9.A.2 (title-screen UI)

Scope: the title-screen UI half of Phase 9 per docs/PHASES.md:582
deliverable + acceptance criterion 1. This iteration ships
`src/ui/title-screen.ts` (`renderTitleScreen` pure function),
`src/main.ts` wiring (the new `shouldShowTitleScreen` predicate +
`todayUtcDate` helper + bootstrap branch + `__TITLE_SCREEN__` window
flag + `?seed=`/`#seed=` precedence in `startGame`), an extension
to `tests/ui/fake-dom.ts` (addEventListener / dispatch / style /
focus / typed input properties), 16 net-new unit tests in
`tests/ui/title-screen.test.ts`, 8 net-new e2e tests in
`tests/e2e/diagnostic.spec.ts`, 5 existing e2e test surgeries (bare
URL → `?seed=diagnostic-sample`), and ~100 lines of
title-screen CSS at the tail of `style.css`.

Reviewed against the 9 review-focus items in the brief, the
`docs/QUALITY_GATES.md` blocking criteria, and the Phase 5 frozen
contracts (`docs/ARCHITECTURE.md:698-805`).

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`, 0 errors) |
| `npm run test` | **1170 tests / 82 files** passed (was 1154/81 in 9.A.1; +16 / +1 from `title-screen.test.ts`) |
| `npm run build` | green; **143.68 KB raw / 42.42 KB gzipped** (was 139.20/41.30 in 9.A.1; +4.48/+1.12 KB) — well under the 110 KB CI gate |
| Reachability walker (`tests/build/rules-files-reachability.test.ts`) | 7/7 pass; `src/ui/title-screen.ts` is NOT reachable from `src/sim/harness.ts` (the new module is consumed by `src/main.ts` only, downstream of the harness reachability surface) |
| `src/ui/**` lint scope (eslint.config.js:266-315) | 0 violations — Date / performance / write-path imports remain banned for the layer; the new file passes |
| Coverage on `src/ui/title-screen.ts` | 97.24% lines / 88.23% branches / 100% functions — uncovered lines are the paste-fp toggle close path (S1 below) |

## Blocking issues

None of the QUALITY_GATES.md rejection criteria are violated by this
iteration. There are no failing tests, no implementation drift from
prior phases, no hidden constants or magic values, no business logic
duplicated across layers. The Phase 5 frozen contract is preserved
(see C1 below). The build / lint / test gates all green.

## Non-blocking suggestions

### S1 — `onPasteFingerprint` URL navigation has an XSS-style hole on `javascript:` / `data:` URIs

**Severity:** medium (UX risk; not a blocking quality-gate violation
because it requires the user to actively paste a malicious URL into
their own browser's title-screen textarea — i.e. self-XSS, not a
remote attack).

**Location:** `src/main.ts:1306-1310`:

```ts
try {
  const u = new URL(pasted);
  window.location.assign(u.toString());
  return;
} catch {
  // Not a URL — treat as raw fingerprint.
}
```

**Reproduction.** `new URL("javascript:alert(1)")` succeeds (returns
a URL with `protocol === "javascript:"`); `new URL("data:text/html,<script>...")`
also succeeds. Both then flow into `window.location.assign(u.toString())`,
which executes the JS in the page origin context (or renders the
data: payload).

The realistic exposure is low — a title-screen Paste Fingerprint
flow is not where attackers find victims; the user has to
deliberately paste a URL they don't trust. But the page is otherwise
careful about input handling (`parseShareUrl` validates seeds + fp
+ mods + log; `?run=` malformed gets surfaced as a routing error
rather than navigated to), so the accept-anything-with-a-scheme
behavior here is an outlier worth tightening.

**Fix.** Allowlist the protocols the share-URL flow is meant to
accept:

```ts
try {
  const u = new URL(pasted);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    // Reject non-http(s) scheme — fall through to "treat as raw fp" below.
    throw new Error("non-http(s) scheme");
  }
  window.location.assign(u.toString());
  return;
} catch {
  // Not an http(s) URL — treat as raw fingerprint.
}
```

Cosmetic refinement: also reject hosts that don't match the current
deploy origin or `porkchop.github.io`/the configured Pages host
(prevents accidental cross-origin redirects from a typo). Optional
defense-in-depth.

### S2 — `shouldShowTitleScreen`'s `?seed=` (empty value) skips the title screen and silently boots a hardcoded "diagnostic-sample" seed

**Severity:** low (UX surprise; not a security or determinism
issue).

**Location:** `src/main.ts:1223-1234` + `src/main.ts:989-994`.

The predicate uses `searchParams.has("seed")`, which returns true
for `?seed=` (empty value) — so the title screen is skipped. Then
`startGame`'s seed read at `:991-994` checks `querySeedRaw.length > 0`
and falls through to `hashState.seed` (default `"diagnostic-sample"`)
when the value is empty. Net effect: a URL like
`https://porkchop.github.io/icefall/?seed=` (which a user could
generate by clicking "New Run" with the seed input cleared, except
that the title-screen handler protects against empty-seed clicks at
`title-screen.ts:213-214`) would boot the diagnostic-sample run
silently.

This is **defended at the title-screen layer** (the empty-seed
click is a no-op per `title-screen.ts:214`), so the predicate's
behavior matters only for user-typed URLs. The fix options:

1. **Tighten the predicate** to skip the title screen only for
   non-empty `?seed=` values:
   ```ts
   const seedRaw = search.get("seed");
   if ((seedRaw !== null && seedRaw.length > 0) || search.has("run")) return false;
   ```
2. **Tighten startGame** to surface an error on empty `?seed=`
   rather than silently substituting the default. The current
   behavior masks user error.
3. **Document** the precedence in a comment at `:1223`.

Either (1) or (2) is a one-line fix; recommend (1) for symmetry
with the `?seed=` handling already in `startGame` (which DOES treat
empty as null). The current asymmetry — predicate uses `has`, the
consumer uses `length > 0` — is the kind of subtle invariant drift
the project's audit-first rule is meant to catch.

### S3 — `pasteFpInput.value.trim()` is not exercised by unit tests

**Location:** `src/ui/title-screen.ts:240-245` (the pasteSubmit
click handler) + `tests/ui/title-screen.test.ts:238-296`.

The unit tests exercise:
- pasted value with content → fires `onPasteFingerprint`
- empty string → does NOT fire `onPasteFingerprint`

But NOT:
- whitespace-only pasted value (e.g. `"   "`) — should NOT fire
  per the `trim()` + `length === 0` guard, but no test pins this.
- pasted value with surrounding whitespace (e.g. `"  https://...  "`)
  — should fire with the trimmed value, but no test pins this.

Mirror of the seed-input trim test at `title-screen.test.ts:130-146`;
copying that pattern to the paste-fp surface is a 10-line addition.

### S4 — Paste-fp toggle close path uncovered (lines 234-237)

**Coverage gap:** the `pasteFpButton` click handler (`:233-238`)
toggles `pasteRow.style.display` between `"none"` and `"block"`.
The `"none" → "block"` path is exercised by the e2e test at
`diagnostic.spec.ts:744-758`; the `"block" → "none"` path (clicking
the button a second time to hide the textarea) is NOT exercised in
unit OR e2e tests. The fake DOM's `style` property and the
`.focus()` no-op are in place, so a unit test would be 5 lines.

This is a real behavior (the button is a toggle, not a one-shot
opener); should have a regression test.

### S5 — `pasteFpInput.focus()` is a no-op in the fake DOM but exercises real-browser behavior

**Location:** `src/ui/title-screen.ts:236` + `tests/ui/fake-dom.ts:84-86`.

The fake DOM's `focus()` returns void without effect; the unit
tests don't assert focus state. The e2e test at `diagnostic.spec.ts:756-758`
asserts the textarea is *visible* but not that it has focus. The
focus contract is documented in `title-screen.ts:235-236` (focus
the textarea after revealing it for keyboard accessibility), but
not regression-tested. A `page.evaluate(() => document.activeElement?.id)`
assertion in the e2e would close this gap.

### S6 — `__TITLE_SCREEN__` window flag is `"active" | "skipped" | undefined` but never `undefined` post-bootstrap

**Location:** `src/main.ts:107` (declaration) + `:1277` + `:1331`.

The flag is set to `"active"` or `"skipped"` in every code path
through `bootstrap()`. The `undefined` variant in the type
declaration is technically reachable via the `if (redirecting)
return` early exit at `:1257-1258` — when a redirect is in flight,
neither branch fires, leaving `__TITLE_SCREEN__` undefined. This
is correct behavior (no title-screen state is meaningful when the
page is about to navigate away), and matches the pattern from
Phase 8 (`__GAME_READY__`, `__VERIFY_RESULT_KIND__`, etc.), but is
worth a brief comment at `:107` ("undefined when applyRouting
redirects before bootstrap completes").

Cosmetic.

### S7 — `todayUtcDate()`'s `getUTCFullYear().padStart(4, "0")` is defensive against year < 1000 but JS dates can't represent that

**Location:** `src/main.ts:1242-1248`.

`new Date().getUTCFullYear()` returns a 4-digit year for any date
the JS Date can represent (year >= -271820 to <= 275760). The
`.padStart(4, "0")` is harmless but signals that the author was
defending against an impossible case. Cosmetic — can be removed.

### S8 — Title-screen subtitle text is hardcoded; theme-registry refactor (9.A.3) will need to plumb it through

**Location:** `src/ui/title-screen.ts:122-124`.

The subtitle reads `"Deterministic-shareable cyberpunk roguelike.
Pick a seed and start descending the stack."` — hardcoded in the UI
module. Per the Phase 9 split (`docs/PHASES.md` next_phase: `9.A.3
theme registry refactor — all UI text routed through src/ui/theme/`),
this string will need to move. The deferral is explicit and
documented; flagged here only as a reminder that 9.A.3 has a
pre-existing target.

The same applies to the heading `"ICEFALL"` (already hardcoded in
`win-screen.ts` and `main.ts:912`), the footer help text at `:206-207`,
the placeholder URL at `:189`, and the button labels.

### S9 — Bundle delta (+4.48 KB raw / +1.12 KB gzipped) is reasonable

The 252-line title-screen module + ~100 lines of CSS + ~50 lines of
main.ts wiring → 4.48 KB raw / 1.12 KB gzipped is consistent with
the prior phase's per-module budget (Phase 8.A.3 was +6.86/+2.15
KB for a comparable scope of work). No easy wins; the module is
already DRY (single querySelector + branch on whether the skeleton
exists, idempotent re-render).

The 110 KB CI gate has ~67 KB headroom remaining, which is
generous given Phase 9 still has the CRT shader (9.A.4), theme
registry (9.A.3), and ARCHITECTURE.md polish (9.A.7) ahead.

### S10 — Test surgery on the 5 game tests is correct

The 5 surgeries (`tests/e2e/diagnostic.spec.ts:300, 316, 338, 396, 417`)
all target the playable-game tests (`__GAME_READY__`, HUD, movement,
inventory, pickup) which require the canvas to render. Adding
`?seed=diagnostic-sample` is the minimal change that bypasses the
title-screen gate while preserving the previously-implicit "boot
into the game with the diagnostic-sample seed" behavior.

Worth noting: the implicit pre-Phase-9 behavior (bare URL → boots
game with the hardcoded `"diagnostic-sample"` seed) is now ONLY
exercised by `?seed=diagnostic-sample` — there's no longer a
"happy path bare URL → game" e2e. This is correct (the bare URL
now correctly renders the title screen), but it does mean the
"game boots with the right seed when the URL specifies one" path
is the only path covered. A future test that exercises "click New
Run with a typed seed → page reloads → game boots with that
typed seed" would close the loop end-to-end; the current e2e at
`:712-727` asserts the URL changes after the click but not that
the game then boots with that seed (it asserts only that
`__TITLE_SCREEN__` becomes `"skipped"` post-navigation).

### S11 — `randomSeedButton` click handler captures `seedInput` from the closure but Phase 9 polish may want to refresh on re-render

**Location:** `src/ui/title-screen.ts:227-231`.

The click handler is wired ONCE on the first render. On a subsequent
re-render (the idempotent path at `:246-251`), only the
`randomSeedButton.textContent` updates; the closure-captured
`seedInput` reference is the original element. Since the idempotent
path doesn't recreate the input either, this is correct. But it's
a subtle invariant — if a future refactor of the idempotent path
ever recreates any DOM nodes, the closure would point at a stale
reference. A defensive `host.querySelector(...)` inside each handler
would eliminate the dependency on render-time element identity at
the cost of one extra DOM walk per click.

Defensive; not blocking.

### S12 — `parseShareUrl` rejects empty seeds at the URL parser layer; title-screen onNewRun handler also rejects them

**Location:** `src/ui/title-screen.ts:212-216`.

Belt-and-suspenders defense — the title-screen `activateNewRun`
function rejects empty seeds at click time (no `onNewRun` call is
made). This is good — it prevents an invalid `?seed=` URL from
even being constructed. But the symmetry caveat in S2 above still
applies: a user-typed `?seed=` URL bypasses this guard.

The real defense is `parseShareUrl`'s `isValidSeed` (required
length > 0 + well-formed UTF-16 + no NUL); the title screen's
guard is a UX nicety. Worth a comment at `title-screen.ts:213`
referencing the parser's validation as the load-bearing check.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is **satisfied**:

- **`src/ui/title-screen.ts` unit coverage**: 16 tests covering DOM
  structure (heading + subtitle + seed input + 3 buttons + paste
  row + footer present, primary-action class, host class), handlers
  (onNewRun click, trim, empty-seed rejection, Enter activation,
  non-Enter ignored, onRandomSeed click, seed-input update on
  random, onPasteFingerprint, empty-paste rejection), and
  idempotent re-render (no DOM dup, label updates across midnight,
  user-typed seed preserved). Coverage 97.24% lines / 88.23%
  branches / 100% functions. Three small gaps (S3 + S4 + S5
  above) — none of them load-bearing for the documented contract.

- **`src/main.ts` `shouldShowTitleScreen` + `todayUtcDate` +
  bootstrap title-branch**: NO direct unit tests. This is consistent
  with the project's existing `main.ts` test coverage policy
  (Phase 8 also lacked unit tests for `applyRouting`, flagged
  as S4 in the 8.A.3 review and carried forward). Behavioral
  coverage comes from the 8 e2e tests in `diagnostic.spec.ts:659-789`.
  The `shouldShowTitleScreen` predicate's edge cases (`?seed=`
  empty, `?mods=` alone, `#seed=&floor=` legacy) are not exercised
  by the e2e suite (the e2e tests cover only the bare URL +
  `?seed=foo` cases). S2 above identifies one such gap that yields
  surprising behavior; a JSDOM-based unit test for the predicate
  would close this.

- **8 e2e tests** at `diagnostic.spec.ts:659-789` exercise: title
  renders on bare URL with active flag; today's date pre-fills the
  seed input; ?seed= skips the title screen; New Run navigates;
  Random Seed navigates; Paste Fingerprint reveals textarea;
  Enter on seed input activates New Run; diagnostic still renders
  below title screen. **Sufficient** for the documented happy paths.

- **5 existing test surgeries** (`/` → `/?seed=diagnostic-sample`)
  correctly preserve the prior tests' intent (S10 above).

- **Cross-runtime golden chain** (RANDOM_WALK_DIGEST + MAPGEN_DIGEST
  + SIM_DIGEST + ATLAS_DIGEST + 4 preset-seed values + INVENTORY_DIGEST
  + WIN_DIGEST + REPLAY_DIGEST) is preserved verbatim — title-screen
  changes touch no rules-bearing files.

- **Reachability + lint scope**: PASS. `src/ui/title-screen.ts` is
  reachable from `src/main.ts` only (NOT from `src/sim/harness.ts`);
  the 7 reachability tests still pass; the `src/ui/**` lint scope
  rejects Date / performance / write-path imports and the new file
  passes the scope.

## Compliance check (review-focus items 1-9)

### C1 — Phase 5 frozen contract preserved (focus item 2)

`src/ui/title-screen.ts` contains zero references to `Date`,
`Math.random`, `performance.now()`, or any time/PRNG global.
Verified by `grep -n 'Date\|Math\.random\|performance\.now\|new Date\|getUTCFullYear' src/ui/`
(the only matches are in comments). The date is correctly passed in
as `options.todayDate` from `main.ts` (which IS allowed to use
Date). The `src/ui/**` lint scope at `eslint.config.js:266-315`
enforces this; the file passes lint. PASS.

### C2 — `shouldShowTitleScreen` correctness (focus item 3)

Trace via `node`:

| URL | Result | Expected | Notes |
|---|---|---|---|
| `/icefall/` | true | true | Bare URL → title screen |
| `/icefall/?seed=foo` | false | false | Phase 8 query convention skips title |
| `/icefall/?seed=` | false | **questionable** | Empty seed silently boots default — see S2 |
| `/icefall/?run=ABC` | false | false | Phase 8 share URL skips title |
| `/icefall/?mods=foo,bar` | true | true | mods alone (invalid; no seed) → title screen, correct |
| `/icefall/?floor=3` | true | true | floor alone → title screen, correct |
| `/icefall/#seed=abc` | false | false | Phase 5 hash legacy preserved |
| `/icefall/#seed=&floor=3` | false | false | Phase 5 hash legacy with floor |
| `/icefall/#floor=3` | true | true | floor-only hash → title screen |
| `/icefall/#log=xyz` | true | true | orphaned log fragment → title screen, correct |

The `?seed=` empty case is the only edge case worth flagging
(S2). Otherwise PASS — the predicate correctly handles all
documented Phase 5 + Phase 8 URL forms.

### C3 — Navigation correctness (focus item 4)

Verified via `node` smoke test that `target.search = ""; target.searchParams.set("seed", ...)`:
- preserves the basePath when at `/icefall/releases/<commit>/`;
- clears prior `?run=`/`?mods=`/`?mode=replay` query params (correct — the title screen is the start of a new run, not a continuation);
- preserves the origin.

Edge case found in `onPasteFingerprint`: `new URL(pasted)` accepts
`javascript:` and `data:` URIs, which would then `window.location.assign(...)`
into a JS-execution context. See S1 for the fix. Otherwise PASS.

### C4 — Existing test surgeries (focus item 5)

The 5 changed tests (lines 300, 316, 338, 396, 417) are all
playable-game tests that require the canvas. The change is correct
and minimal. No tests were implicitly relying on the bare URL
booting into the game without an explicit seed (the bare URL pre-9.A.2
booted the diagnostic-sample seed by hardcoded default; post-9.A.2
the bare URL renders the title screen, and `?seed=diagnostic-sample`
explicitly recreates the prior behavior). PASS.

### C5 — Bundle size (focus item 6)

+4.48 KB raw / +1.12 KB gzipped is well within budget; no easy
wins identified. The 252-line title-screen module is the bulk; the
~100 lines of CSS contribute a smaller share. The new `applyRouting`-adjacent
wiring in `main.ts` is incremental. The 110 KB CI gate has ~67 KB
headroom. PASS.

### C6 — Accessibility (focus item 7)

The DOM order in `renderTitleScreen` (`:115-208`) is heading →
subtitle → seed input → button row (New Run, Random Seed, Paste
Fingerprint) → paste row (textarea + submit, hidden initially) →
footer. Tab order follows DOM order with default `tabindex` (the
file does not set explicit `tabindex` on any of these). Default
focus order:

1. Seed input (`#title-seed-input`)
2. New Run button (`#title-new-run`)
3. Random Seed button (`#title-random-seed`)
4. Paste Fingerprint button (`#title-paste-fp`)
5. Paste textarea + submit (only when revealed)

This matches the brief's acceptance criterion. Focus rings from
9.A.1 (`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`)
apply to inputs and buttons; the Phase 9.A.1 `prefers-reduced-motion`
gate still applies (no new animations introduced — the only
`style.display` toggle is for paste-row, which has no transition).
PASS.

### C7 — Reachability + lint scope (focus item 8)

Verified: the reachability walker pass (7/7 tests). `src/ui/title-screen`
is imported only by `src/main.ts:30`; `src/main.ts` is downstream of
`src/sim/harness.ts` in the dependency graph (the harness has no
imports back into `main.ts`). The `src/ui/**` lint scope rules
(`eslint.config.js:266-315`) ban Date / performance / write-path
imports; the new file passes. PASS.

### C8 — Hidden coupling (focus item 9)

`src/ui/title-screen.ts` imports nothing — zero `import` statements.
It accepts an `options` object and operates only on the `host`
DOM node. The main.ts wiring imports `parseShareUrl` indirectly
through `decideRouting` via the existing `applyRouting` path, so
`onPasteFingerprint`'s URL navigation flows through the page-load
routing flow on the next page load. This is the correct
composition — the title screen module has no knowledge of router /
share / save / verifier, and the caller is the only point of
coupling. PASS.

## Approval verdict

**APPROVE-WITH-NITS.**

No blocking quality-gate violations. All sandbox gates green:
1170 tests / 82 files / 0 lint / 0 typecheck / 143.68 KB raw /
42.42 KB gzipped (well under the 110 KB CI gate). Cross-runtime
golden chain preserved unchanged. Reachability gate holds. The
`src/ui/**` layer-scope lint rules pass — no Date / performance /
write-path imports.

The non-blocking suggestions (S1-S12) are minor:

- **S1** (XSS-style hole on `javascript:` / `data:` URIs in
  `onPasteFingerprint`) is the only suggestion with a concrete
  user-impact path; the realistic exposure is self-XSS only (the
  user has to deliberately paste a malicious URL into their own
  browser), but the fix is one line and matches the page's
  otherwise-careful input-validation posture. **Recommend addressing
  this in 9.A.2 before landing**, or carrying it forward as a
  Phase 9.A.7 polish target with explicit memo acknowledgment.
- **S2** (`?seed=` empty value asymmetry between predicate and
  consumer) is a subtle UX surprise. The title-screen layer
  defends against it for click-generated URLs; only user-typed
  URLs hit the gap. One-line fix.
- **S3 + S4 + S5** are coverage gaps in the unit + e2e tests:
  paste-fp trim with whitespace; paste-fp toggle close; focus
  state after toggle. Each is a 5-10 line test addition.
- **S6 + S7 + S11 + S12** are documentation / cosmetic.
- **S8** is a deferral pointer to 9.A.3 (theme registry).
- **S9 + S10** are passing observations on bundle size and test
  surgery.

The cross-runtime golden chain preserved unchanged is the load-
bearing invariant; the title-screen layer touches no rules-bearing
files. The `__TITLE_SCREEN__` flag pattern matches the existing
`__GAME_READY__` / `__VERIFY_RESULT_KIND__` / `__REPLAY_MODE__` /
`__ROUTER_AUTO_DECISION_KIND__` pattern. The Phase 5 frozen
contract is preserved. The deliverable correctly maps to the
docs/PHASES.md:582 line ("title screen with: seed input, "New
Run", "Random Seed", "Paste Fingerprint" buttons") and the
acceptance criterion 1 ("a first-time visitor can land on the
GitHub Pages URL, click "New Run", and play to floor 1 without
reading docs") — verifiable on the live deploy in 9.B.

Phase 9.A.2 is structurally sound. With S1 + S2 fixed (both are
one-line changes), the phase is ready to land. The remaining
suggestions (S3-S12) can be addressed in 9.A.3 / 9.A.7 polish or
deferred to a future iteration.

## Files relevant to this review

Source (in scope):

- `/workspace/src/ui/title-screen.ts` (252 lines, new — `renderTitleScreen` pure function)
- `/workspace/src/main.ts` (`shouldShowTitleScreen` + `todayUtcDate` + bootstrap title-branch + `?seed=` precedence in `startGame` + `__TITLE_SCREEN__` window flag)
- `/workspace/style.css` (lines 351-447 — title-screen styling)

Tests (in scope):

- `/workspace/tests/ui/title-screen.test.ts` (16 tests — DOM structure + handlers + idempotent re-render)
- `/workspace/tests/ui/fake-dom.ts` (extended with addEventListener / dispatch / style / focus / typed input properties for 9.A.2)
- `/workspace/tests/e2e/diagnostic.spec.ts` (8 net-new title-screen tests at lines 659-789; 5 surgeries at lines 300, 316, 338, 396, 417)

Phase context:

- `/workspace/artifacts/phase-approval.json` (Phase 9.A.1 approved on master at b769cb1; next_phase field documents the 9.A.* split)
- `/workspace/docs/PHASES.md:571-593` (Phase 9 spec — title screen at :582; acceptance criterion 1 at :589)
- `/workspace/docs/ARCHITECTURE.md:698-805` (Phase 5 frozen contracts for renderer + input + ui)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, layer compliance gate)
- `/workspace/eslint.config.js:266-315` (`src/ui/**` lint scope — Date / performance / write-path bans)
- `/workspace/artifacts/code-review-phase-8-A-3.md` (prior code-review format reference)

Pre-existing files inspected for context (NOT changed by this PR):

- `/workspace/src/router/url-parse.ts:88-95` (`isValidSeed` — the load-bearing seed validation referenced in S12)
- `/workspace/src/router/url-parse.ts:102-221` (`parseShareUrl` — what the auto-redirect path uses on the next page load after onPasteFingerprint navigates)
- `/workspace/src/ui/win-screen.ts` (peer module the brief calls out as the structural model)
- `/workspace/tests/build/rules-files-reachability.test.ts` (reachability gate — confirms title-screen is NOT reachable from harness)

VERDICT: APPROVE-WITH-NITS
