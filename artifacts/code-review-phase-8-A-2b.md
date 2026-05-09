# Code review — Phase 8.A.2b (sandbox-verifiable JS implementation, wiring half)

Scope: the wiring half of the Phase 8.A.2 split (mirroring the
Phase 7.A.2a / 7.A.2b precedent). This iteration ships
`src/router/{messages,url-parse,release-index-parse,redirect}.ts`,
`src/save/storage.ts`, three new diagnostic UI sections in
`src/main.ts` (Verify a Pasted Log + Save Slots + Replay This Run),
the `eslint.config.js` lint-scope adjustment for the new boundary
layers, and the `.github/workflows/deploy.yml` bundle-budget bump
from 75 KB → 110 KB. Auto-redirect on page load is deliberately NOT
wired (deferred to 8.A.3, which lands `releases/index.json`).

Reviewed against the 9 review-focus items in the brief and decisions
5, 6, 7, 8, 15 + addendum B3, B5, B6, B7, B8, B9 + advisory A1, A5
of `artifacts/decision-memo-phase-8.md`.

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`) |
| `npm run test` | 1132 tests passed across 80 test files (was 1049/75 in 8.A.2a; +83 tests / +5 files) |
| `npm run build` | green; **132.38 KB raw / 39.16 KB gzipped** (was 124.04 / 36.46 in 8.A.2a; +8.34 / +2.70). Well under the new 110 KB CI gate. |
| Reachability walker (`tests/build/rules-files-reachability.test.ts`) | 7/7 pass; the Phase-8 anti-cycle defense (router/verifier/share/save NOT reachable from `src/sim/harness.ts`) holds. |
| `src/router/**` coverage | 100/100/100/100 (all 4 files) |
| `src/save/**` coverage | 100/100/100/100 |

Cross-runtime golden chain preserved unchanged: RANDOM_WALK_DIGEST +
MAPGEN_DIGEST + SIM_DIGEST + ATLAS_DIGEST + 4 preset-seed values +
INVENTORY_DIGEST + WIN_DIGEST + REPLAY_DIGEST.

## Blocking issues

**None of the four blocking rejection criteria from QUALITY_GATES.md
are violated.**

- Every new module / public behavior has accompanying tests
  (router/messages 19, router/url-parse 20, router/release-index-parse
  15, router/redirect 14, save/storage 15 — total +83 tests / +5 files
  matching the brief's claimed delta).
- No bug fix in this iteration; not applicable.
- No business-logic duplication — `decideRouting` delegates fingerprint
  computation to `core/fingerprint`; URL parsing to `parseShareUrl`;
  schema validation to `parseReleaseIndex`; action-log decoding to
  `share/decode`. The save layer parametrizes over a `StorageLike`
  interface so the same code runs in browser + tests.
- Implementation matches the memo's frozen contracts (decisions 5–8,
  15 + addendum B3, B5, B6, B7, B8, B9 + advisory A1, A5); see
  review-focus items 1–9 below.
- No hidden constants — `SAVE_KEY_PREFIX`, `SAVE_INTERVAL_ACTIONS`,
  `SAVE_SCHEMA_VERSION`, `FP_SHORT_LEN`, `BASE64URL_RE`, `NUL_CHAR`,
  `SCHEMA_VERSION`, `COMMIT_HEX_RE`, `SHA256_HEX_RE`, `ISO_8601_UTC_RE`
  are all named.
- Test suite ran clean (1132/1132 across 80 files).

The items below are non-blocking suggestions / observations.

**One factual nit on the brief (not on the code).** The brief claims
release-index-parse has 16 tests and storage has 14 tests; the
actual counts are 15 and 15 respectively. Total is +83 tests as
claimed (15 + 15 + 19 + 20 + 14 = 83). The per-file tallies in the
brief are slightly off but the aggregate is correct and the tests
themselves are sound.

## Review focus — verdict per item

### 1. Test sufficiency

PASS with two specific gaps noted (S1, S2 below).

**(a) Pinned-message byte coverage (10/10).** The 10 ROUTE_ERR_*
constants are all asserted byte-exact in
`tests/router/messages.test.ts:27-86`. Confirmed via Python codepoint
scan of the production constants in `src/router/messages.ts`:

| Constant | em-dash U+2014 present | length |
|---|---|---|
| `ROUTE_ERR_FP_INVALID` | n/a | 60 |
| `ROUTE_ERR_FP_BAD_CHAR` | n/a | 59 |
| `ROUTE_ERR_SEED_MISSING` | yes (col 38) | 62 |
| `ROUTE_ERR_SEED_INVALID` | yes (col 20) | 71 |
| `ROUTE_ERR_MODS_INVALID` | n/a | 65 |
| `ROUTE_ERR_LOG_DECODE` | yes (col 28) | 43 |
| `ROUTE_ERR_NO_MATCHING_RELEASE` | n/a (B9 amended text has no em-dash; `'<seed>'` substitution present) | 309 |
| `ROUTE_ERR_FP_TAMPERED` | yes (col 62) | 156 |
| `ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED` | n/a (`<seed-repr>` substitution present) | 320 |
| `ROUTE_ERR_RELEASE_INDEX_FETCH` | yes (col 44) | 121 |

Programmatic equality check between `messages.ts` and
`messages.test.ts` literal string values: **all 10 match byte-exact**.

**(b) Advisory A5 `<repr>` substitution path coverage in
`url-parse.test.ts`.** PARTIAL.

`escapeForDisplay` itself is exercised across the printable ASCII /
NUL / control / high-byte / backslash matrix in
`tests/router/messages.test.ts:88-108`. **However**, the integration
through `parseShareUrl` — i.e., a URL like `?run=<22 chars including
a non-printable byte>` producing a `<repr>` field with `\xHH` escapes
— is NOT asserted in `tests/router/url-parse.test.ts`. The closest
assertion at `url-parse.test.ts:42` checks
`/got 8: tooShort/`, where `tooShort` is purely printable ASCII so
`escapeForDisplay` is the identity. The non-printable-byte
substitution rule is end-to-end testable but not currently
end-to-end tested. **Filed as S1 below — non-blocking.**

**(c) Redirect test surface — phase-1, phase-2, sub-case 5c.** PASS.

| Branch | Test |
|---|---|
| `boot-fresh` (no `?run=`) | `redirect.test.ts:50-55` |
| `boot-fresh` (standalone `?seed=`) | `redirect.test.ts:57-62` |
| URL-parse error surfaces as `kind: "error"` | `redirect.test.ts:64-67` |
| `boot-replay` (fp matches current build) | `redirect.test.ts:78-86` |
| `boot-replay` with `#log=` | `redirect.test.ts:88-100` |
| `ROUTE_ERR_RELEASE_INDEX_FETCH` (null index) | `redirect.test.ts:104-112` |
| `ROUTE_ERR_RELEASE_INDEX_FETCH` (malformed JSON) | `redirect.test.ts:114-125` |
| Phase-1 redirect to matching release | `redirect.test.ts:128-162` |
| Phase-1 preserves `#log=` through redirect | `redirect.test.ts:164-197` |
| Phase-2 → `ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED` | `redirect.test.ts:200-235` |
| Sub-case 5c → `ROUTE_ERR_FP_TAMPERED` | `redirect.test.ts:238-265` |
| Final fall-through → `ROUTE_ERR_NO_MATCHING_RELEASE` w/ `<seed>` substitution | `redirect.test.ts:268-283` |

All seven branches in the prompt's enumeration are exercised.

**Subtle: the sub-case-5c test fixture at `:255` sets `fp = "Z".repeat(22)`,
which won't match anything in phase 1 OR phase 2.** The ordering
(phase-1 → phase-2 → 5c → final) is therefore correctly tested for
the path "5c fires when phase-1 and phase-2 both fail and the URL is
at `releases/<commit>/`". The prompt's hypothetical sub-case ("5c
where the URL also has `?seed=` mismatching") is implicit here: a
mismatched seed would still produce `parsed.inputs.seed` that doesn't
match what produced the original fingerprint, so phase-1 would not
short-circuit, phase-2 would not short-circuit, and 5c would fire.
The current test fixture at `:255` accomplishes this via a totally-
synthetic 22-Z fingerprint that no seed could produce — which is a
stronger statement than seed-tampering specifically. PASS.

**(d) `findStaleReleaseSlots` + `evictOldestSlots` protection
(addendum B6 "stale-release slot never deleted").** PASS.

`tests/save/storage.test.ts:281-308` writes a stale-release slot
(commit B, seed shared) AND an unrelated slot (commit A, seed other),
calls `evictOldestSlots(storage, 5, { seed: "shared-seed",
currentBuildCommitHash: BUILD_A_COMMIT })` requesting eviction of 5
slots, and asserts only `fp-other-old` was evicted (count = 1) while
`fp-stale-protected` survives. This pins the addendum-B6 invariant.

`findStaleReleaseSlots` is tested at `:154-191`: positive (1 stale
match, ignoring same-seed-current-build and other-seed-different-build)
and negative (no match → empty array).

**Quota-exceeded paths.** Three branches at `:194-247`:
`QuotaExceededError` (Chrome name), `NS_ERROR_DOM_QUOTA_REACHED`
(Firefox name), and a non-quota error (re-thrown as plain Error).
PASS.

### 2. Pinned-message correctness

PASS.

**Memo cross-walk:** decision 5 prose (`decision-memo-phase-8.md:953-984`)
defines 8 of the 10 constants. Addendum B3 (line 3090-3148) adds
`ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED` (the 9th). Addendum B9 (line
3475-3494) amends `ROUTE_ERR_NO_MATCHING_RELEASE`'s text for the
bootstrap-window case with the `<seed>` substitution — and the
implementation reflects this verbatim:

```
src/router/messages.ts:50-51:
"router: this run was created with a build that is not present in
 releases/index.json. The release may not yet be published (try
 refreshing in a minute) or may have been pruned. If this URL was
 shared before per-release pinning was live (Phase 8.A.3), the run
 can be re-created with seed '<seed>' on 'latest/'."
```

The B9-amended text replaces the original decision-5 text at line
976-977 (which lacked the bootstrap-recovery prose). The
implementation uses the B9 text. Confirmed.

**`<seed>` substitution wiring.** `decideRouting` calls
`fillTemplate(ROUTE_ERR_NO_MATCHING_RELEASE, { "<seed>": escapeForDisplay(parsed.inputs.seed) })`
at `redirect.ts:257-259`. Test at `redirect.test.ts:269-282` confirms
the `seed 'tomorrow's-seed'` substring appears in the message.
**Nit:** the test only asserts `r.message.toContain("seed 'tomorrow")`
which is partial — a tighter assertion would pin the closing
quote (`"seed 'tomorrow's-seed'"`). Filed as S2 (non-blocking).

**`<seed-repr>` vs `<seed>` placeholder names.** The two
template tokens are deliberately different: `ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED`
uses `<seed-repr>` (memo addendum B3 line 3098) and
`ROUTE_ERR_NO_MATCHING_RELEASE` uses `<seed>` (memo addendum B9 line
3484). Both implementations call `escapeForDisplay` on the value so
the substitution behavior is functionally identical; the two
distinct placeholder names are an authoring readability choice (the
memo prose uses both). The `fillTemplate` helper substitutes by
exact key match (`split(key).join(value)`), so a `<seed>` token in
one constant and a `<seed-repr>` token in another are mutually
non-interfering. PASS.

### 3. Router decision correctness

PASS with one observation (O1).

The control flow walks correctly through every branch the prompt
enumerated:

| Case | Branch | Where |
|---|---|---|
| URL has no `?run=` | `boot-fresh` | `redirect.ts:127-129` |
| URL has `?run=` matching current build | `boot-replay` | `redirect.ts:148-157` |
| URL has `?run=` not matching, no index | `error: ROUTE_ERR_RELEASE_INDEX_FETCH` | `redirect.ts:162-168` |
| URL has `?run=`, index has matching release | `redirect` | `redirect.ts:190-210` |
| URL has `?run=`, index has match-w/-empty-mods only | `error: ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED` | `redirect.ts:215-232` |
| URL is at `releases/<commit>/` but fp doesn't match | `error: ROUTE_ERR_FP_TAMPERED` | `redirect.ts:237-251` |
| URL has `?run=`, index empty | `error: ROUTE_ERR_NO_MATCHING_RELEASE` w/ seed | `redirect.ts:254-260` |

**Sub-case 5c ordering safety check.** The prompt asked: "URL is at
the right `releases/<commit>/` but the URL also has `?seed=`
mismatching — does the phase-1 enumeration match (no, because the
seed is what we'd compute the fp from), then phase-2 fires (also no),
then sub-case 5c fires."

Walking through: if `parsed.inputs.seed` is wrong, then in phase-1,
`fingerprintShort({commitHash: entry.commitHash, ..., seed:
parsed.inputs.seed, modIds: parsed.inputs.modIds})` computes a fp
under the wrong seed — won't match `parsed.claimedFingerprint`.
Phase-2 same with `modIds: []` — same wrong seed, won't match. So
both phases fall through, sub-case 5c then fires (URL path contains
`releases/<commit>/`, commit is in index, → `ROUTE_ERR_FP_TAMPERED`).
The ordering does NOT short-circuit incorrectly. PASS.

**O1 (observation, non-blocking).** Sub-case 5c uses a bare
`pathSegments.indexOf("releases")` check; if the host's `basePath`
itself contained the literal segment `releases` (e.g., a hypothetical
deploy at `/releases/icefall/`), this would fire spuriously. The
current production `basePath` is `/icefall/` — safe. Future-proofing
worth a comment but not a code change.

**Edge case (no test, but structurally fine).** What if the URL is
at `releases/<commit-X>/` AND the fingerprint matches `<commit-X>`
itself? Phase-1 would short-circuit on the match and return a
`redirect` to `releases/<commit-X>/...` — i.e., the SAME URL. In
production this would be an infinite redirect loop. **However**,
because `decideRouting` is called from main.ts with the CURRENT
build's `commitHash`, and if the URL is at `releases/<commit-X>/`
served by Vite's static publishing, the page's runtime build IS
`<commit-X>`, so the early `boot-replay` check at `:148-157` catches
this BEFORE phase-1 runs. The structural soundness depends on the
deploy serving `releases/<commit>/` with that `<commit>`'s build
context. Memo decision 17 + addendum B5 establish this invariant.
Not a Phase 8.A.2b concern since auto-redirect isn't wired here, but
worth noting for the 8.A.3 wiring.

### 4. localStorage layer correctness

PASS with one design observation (O2).

**Stale-release protection logic** (`storage.ts:213-217`):

```ts
if (
  protectSeedForCurrentBuild !== null &&
  slot.inputs.seed === protectSeedForCurrentBuild.seed &&
  slot.inputs.commitHash !== protectSeedForCurrentBuild.currentBuildCommitHash
) continue;
```

Correctly skips a slot only if (seed matches AND commitHash differs).
A slot whose commitHash MATCHES the current build is NOT protected
by this branch and remains evictable — defensible because such a
slot is the active save for the current build (not stale; the
addendum-B6 invariant only applies to stale slots).

**O2 (DoS / starvation question raised by the prompt).** If 1000
slots all match `seed === protectedSeed && commitHash !==
currentBuild`, every one is skipped, the `evicted` counter remains
0, and the loop exits naturally without freeing space. The caller
(write-quota retry path) would observe `evicted === 0` and surface
a hard `QuotaExceededError` to the UI. This is a soft DoS: an
attacker who can plant 1000 stale-release slots locks the user's
storage. **Acceptable behavior** — silently deleting them would
violate addendum B6 (the user's stale-release recovery path is the
load-bearing UX). The right escalation is a UI affordance for
manual cleanup (Phase 9 polish per the inline comment at
`storage.ts:91-92`). The current code does not prevent this DoS
and that is by design. **Non-blocking; would be worth a follow-up
note in `docs/PROD_REQUIREMENTS.md` describing the threat-model
trade-off.**

**Subtle note: the `evictOldestSlots` API has no test for the
"shouldn't evict the active slot" case.** If the user's most-recent
save is for the currently-running seed AND the current build (the
active slot), and there are 5 older slots from the same build, a
`evictOldestSlots(storage, 10, null)` call would evict EVERYTHING,
including the active slot. In the current 8.A.2b scope the
write-quota path is not wired (`writeSlot` doesn't call evict
internally; the caller would), so this is theoretical. Worth a
comment when the writeSlot retry-loop is wired.

**`StorageLike` interface boundary.** `storage.ts:65-71` defines a
5-method subset of `Storage` (length, key, getItem, setItem,
removeItem). The browser side passes `window.localStorage` (which
implements this); tests pass `MemoryStorage` (which also implements
it). Clean separation; no leakage of browser-isolated globals into
the test surface. PASS.

**`parseSlotJson` runtime trust.** Line 114-115 says: "Trust shape
minimally — JSON.parse already validated structure; a corrupt field
surfaces as a runtime error in the consumer." This is a deliberate
weakness: a slot with `schemaVersion: 1` but a malformed `inputs`
field would deserialize and crash in `findStaleReleaseSlots`'s
`slot.inputs.seed` access. **This is acceptable for 8.A.2b** because
the only writer is `writeSlot` (which serializes a typed `SaveSlot`),
so a malformed slot can only originate from cross-version drift OR
storage tampering — both rare. Phase 9 polish could add a structural
runtime check.

### 5. Diagnostic UI correctness

PASS with two scope-limited observations (O3, O4).

**Verify a Pasted Log section** (`main.ts:560-636`).

`__VERIFY_RESULT_KIND__` flag lifecycle:
- Initial: `"idle"` (set at `main.ts:565`).
- On click: replaced with `result.kind` from `verify(...)` at `:630`.

The form supplies five inputs: seed, fingerprint (22 or 43 char),
claimed final state hash, action-log wire, and (implicitly via
`atlasBinaryHash` from build-info) the expectedAtlasBinaryHash. The
caller does NOT supply `expectedRulesetVersion` or `expectedOutcome`,
so those checks are skipped (they're optional per memo decision 10).

**O3 (observation, non-blocking).** Because `expectedAtlasBinaryHash`
is always set to the current build's `atlasBinaryHash`, the diagnostic
form CANNOT produce `kind: "atlas-mismatch"` via user input — it would
require the user to type the exact wrong atlas hash, but the form has
no field for it. Reachable kinds via this UI:
- `valid` — happy path
- `fingerprint-mismatch` — user types wrong fp
- `state-hash-mismatch` — user types wrong claimedFinalStateHash
- `log-rejected` — user pastes malformed log
- (`outcome-mismatch` and `ruleset-mismatch` skipped since neither is supplied)

The `__VERIFY_RESULT_KIND__` flag is reachable in 5 of 7 union
variants from the diagnostic form. The remaining two (`atlas-mismatch`,
`ruleset-mismatch`, `outcome-mismatch`) are reachable only through
`tests/verifier/verify.test.ts` which directly calls `verify(...)`.
This is a UI scope decision, not a correctness concern; the verifier
is fully tested at the function-API surface. Worth noting for the
8.A.3 author — if the verify form is intended to be the e2e-verify
contract, an "expected atlas hash" field could be added.

**Save Slots section** (`main.ts:638-705`). The `refreshSaveSlots`
function:
- Catches `localStorage` access errors (private-browsing fallback).
- Sets `__SAVE_SLOTS_COUNT__` to the slot count.
- Renders each slot with:
  - `code` element showing `fp short  seed=...  floor=...  hp=...
    outcome=...  saved=...`
  - A `[Open in pinned release]` link if `slot.inputs.commitHash !==
    commitHash` (stale).
- The `<li>` element gets class `save-slot stale` for stale slots
  (vs `save-slot` for current). **Distinguishable via CSS class +
  the link itself.** PASS.

**Replay this run section** (`main.ts:707-776`).

Three states:
- `?mode=replay` absent → `__REPLAY_MODE__ = "idle"`, `__ROUTER_DECISION_KIND__`
  unset, help text shown.
- `?mode=replay` present + valid `?run=` + valid `#log=` →
  `__REPLAY_MODE__ = "active"`, `__ROUTER_DECISION_KIND__ =
  decision.kind`, `__REPLAY_FINAL_STATE_HASH__` + `__REPLAY_OUTCOME__`
  set after `runScripted`.
- `?mode=replay` + malformed `?run=` → `decideRouting` returns
  `kind: "error"`, `__REPLAY_MODE__ = "active"`,
  `__ROUTER_DECISION_KIND__ = "error"`, error text shown, no replay.

The decision is called with `null` for `indexJson` (`main.ts:736`)
— deliberate per the brief (auto-redirect not wired). The
`null` path produces `boot-replay` for current-build matches and
`error: ROUTE_ERR_RELEASE_INDEX_FETCH` for mismatches. The replay
section checks `replayDecision.kind === "boot-replay"` AND
`replayDecision.logWire !== null` before running; otherwise shows
the decision kind + message. PASS.

**O4 (observation, non-blocking).** When `?mode=replay` is set but
`?run=` is missing, the URL parses as `kind: "no-run-param"` and
`decideRouting` returns `boot-fresh`. The replay section's branch at
`:739` requires `kind === "boot-replay"`, so `boot-fresh` falls
through to the `else` at line 764, which renders `replay-mode URL
did not parse as a boot-replay: boot-fresh`. The user message is
mildly confusing ("did not parse as a boot-replay" when the URL
parsed fine — it just doesn't have a `?run=`). Worth a more
specific user-facing message in 8.A.3, though not blocking.

### 6. Reachability impact (memo addendum B8)

PASS.

`tests/build/rules-files-reachability.test.ts:197-203` explicitly
pins:

```ts
expect(path.startsWith("src/router/")).toBe(false);
expect(path.startsWith("src/verifier/")).toBe(false);
expect(path.startsWith("src/share/")).toBe(false);
expect(path.startsWith("src/save/")).toBe(false);
```

Re-run locally: 7/7 pass. Imports inspected:

- `src/router/url-parse.ts` imports: `core/fingerprint` (type),
  `core/hash`, `share/decode`, `core/encode` (type), `./messages` —
  all upstream / lateral. No `sim/`/`render/`/`mapgen/` import.
- `src/router/redirect.ts` imports: `core/fingerprint`, `./url-parse`,
  `./release-index-parse`, `./messages` — same.
- `src/router/release-index-parse.ts` imports: nothing (pure parser).
- `src/router/messages.ts` imports: nothing.
- `src/save/storage.ts` imports: `core/fingerprint` (type) only.

The only new entry point that COULD pollute the harness reachability
is `src/main.ts`'s new imports (verifier, listSlots, decideRouting,
decodeActionLog) — but `main.ts` is not on the harness's reachability
path. Confirmed via the test pass.

### 7. Lint-scope correctness

PASS with one architectural observation (O5).

The diff at `eslint.config.js:834-861` removes `src/router/**` and
`src/save/**` from the `determinism/no-float-arithmetic` plugin
scope, leaving only `src/verifier/**` and `src/share/**`. The
in-file comment at `:840-848` documents the rationale: the rule
bundles a `JSON.parse` ban (verified at
`eslint-rules/no-float-arithmetic.cjs:142-146`) which is wrong for
data-ingestion boundary layers (URL-routing parses
`releases/index.json`; save-slot parses persisted JSON).

**Float-arithmetic risk left unguarded?** Spot-checked:
`grep -rE '(Math\.(PI|E|floor|ceil|round|sqrt|random)|parseFloat|Number\.(EPSILON|MAX_VALUE|MIN_VALUE))'`
across `src/router/` and `src/save/` — 0 hits. No actual float
arithmetic in the new code (the layers handle hex strings, base64url,
integer indices, and JSON envelopes). The guard is removed but the
underlying risk surface is empty. PASS.

**The narrow advisory-A1 Date override at `:663-690` for
`release-index-parse.ts` is preserved** (the broader Date ban for
`src/router/**` at `:625-639` excludes that file). Confirmed by
reading the file: `new Date(publishedAt).toISOString()` is used at
`release-index-parse.ts:141` for round-trip ISO-8601 validation.
The `Date.now()` ban is preserved via the explicit `no-restricted-
syntax` selector at `eslint.config.js:672-677`.

**The cross-layer import bans for router/** and save/** at
`:587-611` and `:799-822`** are also preserved — the only thing
removed by 8.A.2b is the float-arithmetic plugin. All other Phase 8
lint scopes survive intact.

**O5 (observation, non-blocking).** The current
`determinism/no-float-arithmetic` rule conflates two concerns:
floating-point arithmetic (decimal literals, `/`, Math.*) and
data-boundary discipline (`JSON.parse` ban). Splitting the rule
into `no-float-arithmetic` and `no-json-parse` would let
`src/router/**` and `src/save/**` opt back into the float ban.
The 8.A.2b comment at `eslint.config.js:846-849` explicitly notes
this as future polish. Filed as a follow-up; not blocking.

### 8. Bundle budget

PASS.

The diff at `.github/workflows/deploy.yml:34-50` bumps the budget
from `76800` (75 KB) to `112640` (110 KB). The current build is
**39.16 KB gzipped**, well under both the old and new budget — so
the bump is forward-looking, not back-pressure-driven.

**Rationale check.** The new comment (`deploy.yml:42-45`) reads
"fflate (~30 KB) + the Phase 8 router + verifier + share + save
layers (~15 KB combined). Phase 8.A.2b actual is ~40 KB gzipped;
the headroom carries Phase 9 polish." Defensible:

- fflate's gzipped size in the bundle is ~10–15 KB (not 30 KB —
  the comment overstates by roughly 2x; fflate is a small library
  by design). The actual delta from 8.A.2a (36.46 → 39.16 = +2.70
  KB gzipped) is in line with this.
- The 110 KB budget gives ~70 KB future headroom, which is generous
  for Phase 9 (UI polish + accessibility + Phase 10 sound). The
  bump is the right shape; the prose understates fflate's true size.

**Minor**: the comment says "Phase 8.A.2b actual is ~40 KB gzipped"
which is slightly off (actual is 39.16 KB). Within rounding.

PASS as designed; the bump is appropriately conservative.

### 9. Hidden coupling / overlap

PASS with one observation (O6).

**`indexJson: string | null` → tampered/stale handling.** The
caller passes a raw JSON string. `decideRouting` at
`redirect.ts:170-179` calls `parseReleaseIndex` which performs:

- JSON syntactic validity (`:84-88`)
- Top-level object check (`:89-91`)
- `schemaVersion === 1` (`:92-97`)
- `releases` is an array (`:98-101`)
- Per-entry: object shape, all five string fields present, all
  five regex patterns (`commitShort`, `commitHash`, `rulesetVersion`,
  `atlasBinaryHash`, `publishedAt`)
- Per-entry: `publishedAt` round-trip via `new Date(s).toISOString()`
  (advisory A1 — defends against e.g., `2026-13-32T25:99:99Z` which
  matches the regex but is calendar-invalid)

Any failure throws an `Error` with a `release-index:`-prefixed
message; `decideRouting` catches and re-surfaces as
`ROUTE_ERR_RELEASE_INDEX_FETCH` with the inner-error appended. **A
malicious index can only inject values through fields that pass the
regex** — i.e., `commitShort` is a 12-char hex literal, so cannot
contain path-traversal characters; `rulesetVersion` is 64-char hex
so cannot contain quotes/HTML; etc. The redirect-target construction
at `:82-101` interpolates `entry.commitShort` into the URL path, but
since `commitShort` matches `/^[0-9a-f]{12}$/`, it cannot inject
URL-meaningful characters (`/`, `?`, `#`, `&`).

**Defended.** A stale or malicious index cannot redirect to a target
outside the deploy's `releases/<hex12>/` subtree. PASS.

**`parseShareUrl`'s `inputs.commitHash = ""` placeholder leak.**
Searched for callers of `parseShareUrl` (production):

- `src/router/redirect.ts:125` — IMMEDIATELY overrides `commitHash`
  via `claimedInputs = { commitHash: build.commitHash, ... }` at
  `:140-145`. The placeholder does NOT reach `fingerprint(...)` or
  any downstream consumer.
- `src/router/url-parse.ts` — defines the placeholder; doesn't consume.

The `formatShareUrl` inverse at `:230-246` uses `inputs.seed` and
`inputs.modIds` only — the placeholder commitHash is unused by the
formatter. **The placeholder is contained.** PASS.

**O6 (observation, non-blocking).** The `inputs.commitHash = ""`
literal at `url-parse.ts:184` looks suspicious without context — a
future maintainer could easily forget to override it. A typed
discriminated union (`UrlDerivedInputs` separate from
`FingerprintInputs`) would prevent the leak structurally. The
current contract relies on the `decideRouting` author remembering to
re-construct `claimedInputs` with the build's commitHash. Worth a
comment block at the placeholder line (the existing comment at
`:178-182` is decent but could be louder — "WARNING: callers MUST
override commitHash + rulesetVersion before passing to fingerprint(...)").

**Verifier delegates correctly.** Spot-checked: `decideRouting` does
NOT call `verify(...)`; the diagnostic UI's "Verify a Pasted Log"
section calls `verify(...)` directly with form input. The verifier
uses `decodeActionLog` (already pinned in 8.A.2a). No business-logic
duplication. PASS.

## Non-blocking suggestions

**S1 (test depth).** `tests/router/url-parse.test.ts` does not
exercise the advisory-A5 `<repr>` substitution end-to-end with
non-printable bytes in `?run=`. The `escapeForDisplay` function
itself is fully tested in `messages.test.ts`, but a single
integration test along the lines of:

```ts
const r = parseShareUrl(`${BASE}?run=${encodeURIComponent("\x01\x02ABC")}&seed=s`);
expect(r.kind).toBe("error");
if (r.kind === "error") {
  expect(r.message).toContain("\\x01\\x02ABC");
}
```

would lock the integration. Currently the substitution happens via
`fillTemplate` + `escapeForDisplay` in production but is only
covered transitively.

**S2 (test depth).** The seed-substitution test at
`redirect.test.ts:280` only asserts `r.message.toContain("seed
'tomorrow")` — partial pin. A tighter assertion like
`expect(r.message).toContain("seed 'tomorrow's-seed' on 'latest/'.")`
would lock the full B9 amended text. Non-blocking; the message
constant itself is byte-pinned in `messages.test.ts:64-66`.

**S3 (UI scope).** The "Verify a Pasted Log" form does not surface
a field for `expectedAtlasBinaryHash`, `expectedRulesetVersion`, or
`expectedOutcome`. Only 5 of 7 `VerifyResult` kinds are reachable
via the UI (the unit tests cover the other 2 directly). Phase 8.A.3
or Phase 9 could add either the missing fields OR an explicit
"Advanced" disclosure with all VerifyArgs. Not a contract violation;
a UX scope choice.

**S4 (UI nit).** The Replay section's "URL did not parse as a
boot-replay" message at `main.ts:769` is shown for both `boot-fresh`
(no `?run=`) and any `error` kind. The message could be more
specific — e.g., "replay-mode requires `?run=<fp>&seed=<seed>` in
the URL; got: <actual kind>". Cosmetic.

**O1 (defensive coding).** `pathSegments.indexOf("releases")` at
`redirect.ts:238` would false-positive if the deploy's basePath
itself contained the literal segment `releases`. Current
`/icefall/` is safe but a comment ("safe iff basePath doesn't
contain a `releases` segment") would future-proof.

**O2 (threat model).** Document the soft-DoS trade-off in
`docs/PROD_REQUIREMENTS.md`: 1000+ stale-release slots locking
storage is a deliberate cost of preserving addendum-B6 recovery —
the user can always manually clear via DevTools, and Phase 9 can
add a "Clear stale slots" UX affordance.

**O5 (lint architecture).** Split
`determinism/no-float-arithmetic` into two rules
(`no-float-arithmetic` + `no-json-parse-in-deterministic-core`)
so `src/router/**` and `src/save/**` can opt back into the float
ban while keeping JSON.parse access. Future polish; the inline
comment at `eslint.config.js:846-849` already flags this.

**O6 (typing).** The `inputs.commitHash = ""` placeholder in
`parseShareUrl`'s ok-path is structurally fragile — a typed
discriminated union (`UrlDerivedInputs` distinct from
`FingerprintInputs`) would make the override mandatory at the type
level. Refactor target for 8.A.3.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is satisfied:

- **New module / public behavior** — every new module has an
  accompanying test file. messages 19, url-parse 20,
  release-index-parse 15, redirect 14, save/storage 15. Total +83
  tests / +5 files since 8.A.2a baseline.
- **Test names describe behavior** — confirmed by reading: "decodes
  a valid hash-fragment action log", "rejects publishedAt that's
  syntactically valid but semantically invalid (advisory A1
  round-trip)", "PRESERVES stale-release slots for the protected
  seed (addendum B6 'never deleted')", "surfaces ROUTE_ERR_FP_TAMPERED
  when the URL is at releases/<commit>/ but fp doesn't match".
- **Edge cases** — every memo-prescribed branch tested. Phase-1 and
  phase-2 enumeration both reachable; sub-case 5c distinct from
  phase-2; bootstrap fall-through with `<seed>` substitution; quota
  errors for both Chrome and Firefox name conventions; advisory-A1
  round-trip rejection of calendar-invalid ISO-8601 strings.
- **Bug fix** — not applicable; this iteration adds new code.
- **Coverage thresholds** — `src/router/**` and `src/save/**` both
  100/100/100/100 (above the 100/100/100/90 gate set in
  `vitest.config.ts`).

The cross-runtime golden chain (RANDOM_WALK_DIGEST + MAPGEN_DIGEST +
SIM_DIGEST + ATLAS_DIGEST + INVENTORY_DIGEST + WIN_DIGEST +
REPLAY_DIGEST) is preserved unchanged from 8.A.2a — the wiring half
adds no new cross-runtime invariants (the load-bearing byte-level
contracts were all pinned in 8.A.2a).

## Approval verdict

**APPROVE-WITH-NITS.**

All nine review-focus items pass cleanly. The 10 ROUTE_ERR_*
constants are byte-exact (em-dashes U+2014 verified via codepoint
scan; B3 + B9 amendments folded in correctly). The redirect
control-flow walks through every memo-prescribed branch (boot-fresh,
boot-replay, redirect, fingerprint-fetch error, phase-2
disambiguation, sub-case 5c FP_TAMPERED, bootstrap fall-through with
seed substitution). The save layer's stale-release protection is
addendum-B6-compliant and tested. The reachability walker holds at
its pinned count; router/verifier/share/save are NOT reachable from
`src/sim/harness.ts`. The lint-scope adjustment is defensible (the
`JSON.parse` ban inside `determinism/no-float-arithmetic` is wrong
for data-ingestion boundary layers; no actual float arithmetic is
present in the unguarded scopes). The bundle-budget bump 75 → 110 KB
is conservative; current is 39.16 KB gzipped.

The non-blocking suggestions (S1-S4, O1-O6) are minor — test-depth
extensions, message-pinning tightening, UI scope choices, and a
follow-up structural refactor for the placeholder commitHash. None
are gating; all can be addressed in 8.A.3 or as future polish.

All gates green: 1132 tests / 80 files / 0 lint / 0 typecheck /
132.38 KB raw / 39.16 KB gzipped (well under the new 110 KB CI gate).
Cross-runtime golden chain preserved unchanged.

Phase 8.A.2 is now complete (8.A.2a foundation + 8.A.2b wiring).
Phase 8.A.3 (auto-redirect on page load + `releases/index.json`
publish step + "Share This Run" button + `history.replaceState`
canonicalization) is unblocked.

## Files relevant to this review

Source (in scope):

- `/workspace/src/router/messages.ts` (10 ROUTE_ERR_* constants + escapeForDisplay + fillTemplate)
- `/workspace/src/router/url-parse.ts` (parseShareUrl + formatShareUrl)
- `/workspace/src/router/release-index-parse.ts` (advisory A1 Date consumer)
- `/workspace/src/router/redirect.ts` (decideRouting two-phase + sub-case 5c)
- `/workspace/src/save/storage.ts` (StorageLike + readSlot + writeSlot + listSlots + findStaleReleaseSlots + evictOldestSlots)
- `/workspace/src/main.ts` (3 new diagnostic UI sections + 6 new window flags)

Tests (in scope):

- `/workspace/tests/router/messages.test.ts` (19 tests — pinned-string assertions)
- `/workspace/tests/router/url-parse.test.ts` (20 tests — URL parsing variants)
- `/workspace/tests/router/release-index-parse.test.ts` (15 tests — schema + regex + round-trip)
- `/workspace/tests/router/redirect.test.ts` (14 tests — decision branches incl. phase-1/phase-2/5c)
- `/workspace/tests/save/storage.test.ts` (15 tests — round-trip + stale-protection + quota)

Configuration / build (in scope):

- `/workspace/eslint.config.js` (determinism/no-float-arithmetic plugin scope adjustment)
- `/workspace/.github/workflows/deploy.yml` (bundle budget 75 → 110 KB)

Phase context:

- `/workspace/artifacts/decision-memo-phase-8.md` (decisions 5, 6, 7, 8, 15 + addendum B3, B5, B6, B7, B8, B9 + advisory A1, A5)
- `/workspace/artifacts/red-team-phase-8.md`
- `/workspace/artifacts/code-review-phase-8-A-2a.md` (foundation half code review)
- `/workspace/artifacts/phase-approval.json` (Phase 8.A.2a approved on master at caf05d0)
- `/workspace/docs/PHASES.md` (Phase 8 spec at lines 534-567)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, drift detection gate)

Reachability invariant (verified by re-running the walker):

- `/workspace/tests/build/rules-files-reachability.test.ts` (7/7 pass; src/router/, src/save/, src/share/, src/verifier/ NOT reachable from `src/sim/harness.ts` — the Phase 8 anti-cycle defense holds)
