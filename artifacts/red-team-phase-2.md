# Architecture Red-Team Review — Phase 2 Decision Memo

Reviewer: `architecture-red-team`
Subject: `artifacts/decision-memo-phase-2.md`
Phase 1 baseline: commit `2038fc9` on master, Phase 1.A and 1.B both
approved per `artifacts/phase-approval.json`.

## Verdict

**REVISE BEFORE IMPLEMENTATION.**

The memo is well-structured and the algorithmic choice is sound. But three
contracts are under-specified in ways that two competent implementers would
*not* converge on byte-identically, two reuse decisions silently duplicate
or contradict Phase 1 code, and one runtime-guard claim ("no Phase 1
contract is changed") is wrong as written. Each of these is cheap to fix
in the memo before any Phase 2 code is written, and each gets harder to
fix once code exists. After the addendum below, this memo is APPROVE.

The Phase split (2.A / 2.B) is correct, and the algorithm and
fixture-pack strategies are endorsed without modification.

## Blocking issues (must address before any code)

### B1. `tilesB64` is not specified as base64 vs base64url, and Phase 1 already ships `base64url` not standard base64

Decision 3 says `tilesB64` is "base64-encoded." Decision 5's schema field
`"tilesB64": str` repeats "base64." The risk section then says a new
`src/core/base64.ts` will be hand-rolled.

Three problems compound:

1. **Existing reuse missed.** `src/core/hash.ts:22` already exports
   `base64url(bytes: Uint8Array): string` (RFC 4648 §5 alphabet,
   unpadded). Phase 1 chose this *deliberately* (decision-memo-phase-1
   decision 5). Per the **DRY and reuse gate** in `docs/QUALITY_GATES.md`
   line 47 — *"builders must check for existing utilities and shared
   modules before creating new ones"* — a second base64 module is a
   gate violation unless explicitly justified. The risk section's
   appeal to "same path Phase 1 took with the hash library" is wrong:
   Phase 1 reused `@noble/hashes`, it did not hand-roll a competing
   implementation.

2. **Alphabet ambiguity is a frozen-contract gotcha.** `tilesB64` is a
   `rulesetVersion`-bumping field. If the implementer reuses the existing
   `base64url` function, `tilesB64` will contain `-` and `_`. If a
   reviewer later assumes "base64" means standard alphabet (`+/`),
   they will *not* see byte-equality drift in fixtures (CI catches that)
   but will mis-document the contract for Phase 8 sharing tools and for
   any external mod author reading the schema. Two implementers reading
   the memo today cannot produce byte-identical output without a
   coin-flip.

3. **Padding is not specified.** Standard base64 of 1440 raw bytes
   (60×24) has zero pad characters. But standard base64 of 1120 bytes
   (40×28) — also pad-zero — vs. an arbitrary `width*height` like a
   future 51×30=1530 has *two* trailing `=`. The memo says nothing
   about padding. Padded vs unpadded vs alphabet are three independent
   bits, and the memo specifies zero of them.

**Fix.** State explicitly: "`tilesB64` is RFC 4648 §5 base64url alphabet,
*unpadded*, computed via the existing `base64url` function in
`src/core/hash.ts`. No new base64 module is created. The field name
`tilesB64` is retained for brevity but the encoding is base64url — a
field-name rename is purely cosmetic and not worth the contract bump."
Drop the planned `src/core/base64.ts`. Update the risk section
accordingly.

### B2. Encoding of `bossArena: null` and `exit: null` in canonical JSON is unspecified

Decision 5 says "no `null` outside the explicitly-allowed `bossArena`
and `exit` cases." Decision 8 says the serializer "appends fields in
their canonical (alphabetical) order." Two implementers reading this
will diverge:

- Implementer A emits `"bossArena":null,...` for floors 1–9.
- Implementer B emits the floor object *without* the `bossArena` key
  for floors 1–9 (treating the null as "field absent").

Both readings are defensible; the memo does not rule one out. The two
JSON byte streams are not equal, so `tests/fixtures/floors/*.json`
locks in whichever the first implementer happens to pick — and a
later reviewer or Phase 8 persistence consumer will not know whether
absence of `bossArena` is allowed or forbidden.

There is also a parser-side hole: decision 8 says `parseFloor` "rejects
floats anywhere in the parse output" but says nothing about rejecting
`{ "bossArena": undefined }` (impossible in JSON), missing keys
(possible if implementer B is wrong), or extra keys (forward-compat
concern, see B3).

**Fix.** State explicitly: every key in the schema is *always present*;
`bossArena` is `null` for floors 1–9 and an object for floor 10; `exit`
is `null` for floor 10 and an object for floors 1–9. `parseFloor`
rejects any input where any required key is missing. Specify whether
unknown extra keys are rejected or ignored (see B3).

### B3. Forward compatibility of the floor JSON for Phases 6/7/8 is silently underspecified

The memo's "If wrong" rationale for decision 5 says future content can
be added "by writing a v1→v2 migrator." But the listed forward
extensions in section "Out of scope" — Phase 6 lockable doors, Phase 7
NPC slots, Phase 8 persisted floors — are exactly the kind of additions
that *should* be additive without a `schemaVersion` bump if the schema
is right.

The memo has no rule for **strict** vs **lax** parsing of unknown keys.
Two equally defensible readings:

- **Strict.** `parseFloor` rejects unknown keys. Then Phase 6 adding
  `{ "lockedDoors": [...] }` *is* a `schemaVersion=2` bump and every
  Phase 2 fixture has to be re-saved or annotated. Heavy.
- **Lax.** `parseFloor` ignores unknown keys. Then Phase 6 can add
  fields additively under `schemaVersion=1`, but a maliciously crafted
  floor (Phase 8 import-from-URL) could carry junk that bypasses
  validation.

The memo picks neither. This affects whether any of decisions 5, 6, 11
hold under Phase 6/7/8 evolution.

A second, related, hole: decision 6 says encounter slot IDs are
"append-only by convention." Convention is not enforcement. The lint
rule mentioned in decision 7 covers stream isolation, not registry
mutation. There is no test asserting that the registry's prior
entries' string IDs and metadata are unchanged across commits. This
is fine if the project lead accepts the convention; it should be
*called out* as a deferred test rather than implied by "by convention."

**Fix.** Decide: parser ignores unknown top-level keys but rejects
unknown values inside known keys (the typical "extensible JSON" stance),
*or* the parser is strict and Phase 6 commits to a `schemaVersion`
bump. Either is defensible. State the choice. Also add an explicit
follow-up note: "registry-immutability test deferred to Phase 6 when
the second writer of the file exists."

### B4. Decision 7a's claim "no Phase 1 contract is changed" is wrong as written

Decision 7a proposes attaching `__consumed: Set<string>` to the
`RunStreams` returned by `streamsForRun`. It then claims this is
"additive" and changes no Phase 1 contract.

Two concrete contract changes are introduced:

1. **`streamsForRun` is now stateful per call.** Every `mapgen()` /
   `sim()` / `ui()` accessor is now a write, not just a read. The Phase
   1 self-test "streamsForRun accessors are consistent"
   (`src/core/self-test.ts:134`) calls `streams.mapgen(0)` — under the
   new contract, this *mutates* the consumed set as a side effect of
   the existing test. Any later code that asserts the consumed set is a
   subset of `["mapgen:N"]` must run *before* any other accessor-touching
   self-test, or the assertion's universe of allowed values must include
   self-test pollution. The memo's risk section ("Runtime guard false
   positive") acknowledges *cross-floor* pollution but not
   *cross-self-test* pollution within the same `RunStreams` instance.

2. **Test ordering is now load-bearing.** Phase 1's self-test framework
   (`runChecks` at `src/core/self-test.ts:208`) iterates the `checks`
   array in order, but neither the check author nor a future
   maintainer is told that the new `mapgen-stream-isolation` check has
   to run on a fresh `RunStreams`. The memo decision-15 says the new
   check "generates a floor, then asserts the `RunStreams.__consumed`
   set is exactly `["mapgen:" + floorN]`" — but if anything earlier in
   the self-test sequence has already pulled `mapgen` or `sim` from
   the same `RunStreams` instance, the assertion fails for the wrong
   reason. The memo should specify that this self-test allocates its
   *own* fresh `streamsForRun(...)` and is not coupled to any other.

3. **Risk-section text contradicts decision 15.** Decision 7a's "If
   wrong" says the test asserts `consumed === ["mapgen:" + N]` exactly.
   The risk section under "Runtime guard false positive" says "The
   test asserts the consumed-set is a subset of `mapgen:*`, not an
   exact singleton." These are different invariants. Pick one. The
   subset rule is the safer one for fixture-pack regeneration that
   walks 10 floors over one run, but the exact-singleton rule is what
   *catches* the bug class the guard exists for ("mapgen accidentally
   asked sim()"). The right rule is: **mapgen's `generateFloor` for one
   `floorN` consumes exactly `mapgen:floorN` and nothing else** — i.e.
   the assertion is per-call, evaluated against a per-call snapshot
   of the consumed set, not against the cumulative one. The memo
   doesn't say this.

**Fix.** Replace decision 7a's prose with: (a) the consumed set is
attached to `RunStreams` (additive structural change to Phase 1's
return shape — *call out* as a Phase 1 addendum, not as "no change");
(b) the runtime guard records `consumed-before-call` and
`consumed-after-call` and asserts the *delta* is exactly
`{"mapgen:"+floorN}`; (c) the self-test allocates its own fresh
`RunStreams`; (d) reconcile with the risk section's "subset" wording.

## Non-blocking concerns (address as addendum or in implementation)

### N1. Decision 10 cites a precedent that does not yet exist

Decision 10 says `tools/gen-floor.ts` "mirrors the precedent set by the
Phase 4 atlas generator (`tools/gen-atlas.ts`). Same pattern, same import
boundaries, same ergonomics."

There is no Phase 4 yet. There is no `tools/` directory in the repo
(verified: `ls /workspace/tools` fails). The "precedent" is itself
forward-cited from `docs/PHASES.md` Phase 4 deliverables and
`docs/SPEC.md`. This is fine *as a design pointer* but is incorrect as
a "precedent" reference — it implies prior approved code that does not
exist. Reword to "anticipates the same pattern Phase 4 will adopt for
`tools/gen-atlas.ts`," and acknowledge that Phase 2 is establishing
the `tools/` boundary first. This makes the import-boundary table in
`docs/ARCHITECTURE.md` line 47–53 *load-bearing* now and not later.

Concrete consequence: `eslint.config.js` does not currently scope
anything to `tools/**`. Phase 2 needs to add at least one
`tools/**`-targeted rule (e.g. allow `process.argv`, allow `console.*`,
forbid `import` from any browser-only module) or it inherits whatever
the default project rules say. Spell this out.

### N2. `seedToBytes` is referenced as if it exists; it does not

Decision 10: "Reads CLI args, derives the rootSeed via the same
`seedToBytes` function the browser uses." Grep:

```
$ grep -rn "seedToBytes" /workspace/src
(no matches)
```

The function is novel to Phase 2. The memo doesn't specify its
contract: does it `utf8(seed)`? `sha256(utf8(seed))`? The choice
matters because it determines the entropy distribution of the
diagnostic-page hash-fragment URLs (`#seed=foo&floor=3`) and the CLI
behavior. A short ASCII seed like `"diagnostic-sample"` going through
naive `utf8(...)` produces an 18-byte rootSeed; via `sha256(utf8(...))`
it produces 32. Decision 7a / 1 / etc. depend on the rootSeed shape
flowing into `streamsForRun`.

Specify `seedToBytes(seed: string): Uint8Array` exactly. Spec it as a
frozen contract — Phase 8 URL routing will hit this. The Phase 1
fingerprint already takes `seed: string` and `utf8`s it directly into
the digest pre-image (`src/core/fingerprint.ts:52`); reusing that
encoding here is the cheapest reuse-friendly choice.

### N3. Decision 9 ASCII overlay precedence is incomplete

Decision 9 says overlay precedence is `< > B` outrank `e`, `e` outranks
tile codes, tile codes outrank `' '`. But what about overlap *within*
the top tier? If the entrance and the boss arena's bounding rect
overlap on floor 10 (they shouldn't, but the memo doesn't *prove* they
can't), which wins? What if there's a door under an entrance? Say
explicitly: at most one of `< > B` ever appears at any given cell, and
the runtime invariant inside `generateFloor` proves this. Otherwise
the ASCII golden file silently locks in whichever wins by source
order, and a later refactor of the rendering loop reorders the wins
without bumping anything visible.

Also: the memo specifies `\n` only and a trailing newline. `\n` between
rows is clear; "trailing newline" should say whether there is exactly
one trailing newline or zero. (One is the typical Unix-tool convention;
zero matches "join lines with `\n`".) Fixture authors will diverge on
this if not pinned. Pick `lines.join("\n") + "\n"` and say so.

### N4. Acceptance criterion "all rooms reachable from the entrance" is testable but not for the regression case

The memo says reachability is "a runtime invariant inside
`generateFloor` plus a unit test on each fixture-pack floor." The
runtime invariant fails at *generation time* and the unit test pins
the fixture pack. Neither catches the actual regression class: a
future BSP-parameter tweak that produces an unreachable room *for some
seed not in the fixture pack*.

The cheapest patch is a property-style sweep: pick 200 random seeds
(seeded from a fixed root so the test is itself deterministic),
generate floors 1–10 for each, assert reachability holds. Add this to
the test suite spec. Without it, the acceptance criterion is satisfied
by the runtime invariant alone — i.e. a bug that occurs on 1 in 1000
seeds passes review until that seed shows up in production.

### N5. Bundle budget reasoning understates the registry growth path

Decision 13 raises the budget from 50 KB to 75 KB. That's fine for
Phase 2, but the rationale says Phase 5 will rev again. The memo
should call out a concrete budget *test* — i.e. CI fails if `dist/`
gzipped is over 75 KB *and* the "where did the bytes go" output is
written to the build log. `vite build --report` produces a treemap;
require it be uploaded as a CI artifact so the next phase has data,
not vibes, when it asks for another bump.

This is non-blocking because a missing artifact upload doesn't break
Phase 2 deliverables; it just makes Phase 3 and 4 budget review
harder.

### N6. "Float-safe" claim for the schema does not check `JSON.parse` round-trip

Decision 5 says values are "integer or `null` or string … float-safe."
Decision 8 says `parseFloor` "rejects floats anywhere in the parse
output." Good — but `JSON.parse('{"x":1}')` returns `{ x: 1 }` and
`JSON.parse('{"x":1.0}')` returns `{ x: 1 }` (V8 / SpiderMonkey / JSC
all collapse `1.0` to integer-looking number). Two identical-looking
numeric values can have arrived via different source bytes. The memo
needs to specify that `parseFloor` *also* runs against the *raw input
string* — e.g. via a regex that rejects any decimal point or `e/E` in
numeric positions outside string fields, or by re-serializing and
asserting byte-equality with the input. Otherwise a hand-edited
fixture with `1.0` would parse, generate, and re-serialize cleanly,
and a determinism contract that promised "no floats" would have been
silently bypassed.

Cheaper alternative: state explicitly that `parseFloor` is only ever
called on the output of `serializeFloor`, never on user-supplied
floor JSON. If true, the round-trip risk vanishes (the serializer
emits no decimal points). Either choice is fine; pick one.

## Confirmations (decisions specifically endorsed)

### C1. BSP algorithm choice (decision 1) is the right call.
Integer-only, no float math, no retries needed for reachability,
forward-compatible with the floor-10 override seam. The rejection of
drunkard's walk / cellular automata on the "non-total seed function"
basis is correct and exactly the bar SPEC.md principle 1 demands.

### C2. Phase split into 2.A / 2.B (decision 14) is correct.
The acceptance criterion "live URL serves the updated diagnostic
page" cannot be observed inside the sandbox. The Phase 1.A / 1.B
precedent worked. Repeating it preserves the audit trail. This is
not cargo-culted — it is load-bearing for the "deploy pipeline is
battle-tested gradually" property called out in `docs/PHASES.md`
line 9.

### C3. Decision 6 (registries with stable string IDs from day one) is correct.
SPEC.md principle 5 ("designed for mods even before mods exist")
demands it. The choice of strings over integers for IDs is the right
trade — stable across renumbering, self-documenting in JSON, and
typeable.

### C4. Decision 11 (fixture-pack with both JSON and ASCII golden files) is correct.
Two separate drift surfaces (wire format and renderer). The 20-pair
breakdown (10 floor-1 seeds + 1 seed across floors 1–9 + 1 floor-10)
covers the regression directions a one-line BSP-param change would hit
first. Endorsed without modification.

### C5. Decision 8's choice to hand-write a serializer over `JSON.stringify(obj, sortedKeys)` is sound.
The lint rule already bans `JSON.parse` in mapgen (per Phase 1 B6
fixture rule 6). A one-off allow is worse than the explicit
serializer. Reviewer attention to canonical order at the call site is
the actual win.

### C6. Decision 3's choice of `Uint8Array` over JSON-array of ints is sound.
The 14 KB → 2 KB minified size win matters once Phase 8 starts
persisting. The base64 encoding question (B1) is the only thing
holding this otherwise-clean decision back.

## Cross-references — which decisions interact with which Phase 1 frozen contracts

| Phase 1 contract | Phase 2 decision touching it | Risk |
|---|---|---|
| `streams.mapgen(floorN)` salt encoding (Phase 1 ARCH §"Stream derivation") | 7, 7a, 15 | Low if memo respects `(name, floorN)` shape; B4 above flags the hidden-side-effect on `RunStreams`. |
| `base64url` function in `src/core/hash.ts` | 3, 5 | B1 above — memo proposes a new module ignorant of the existing one. |
| ESLint determinism config in `eslint.config.js` | 7 (lint extension) | Phase 1 already scopes `no-float-arithmetic`, `no-restricted-imports`, etc. to `src/mapgen/**`. The new `streams.sim`/`streams.ui` ban is consistent. Must use `no-restricted-imports` patterns scoped via existing `overrides` block, not a new file. |
| `encodeAction` / `encodeSalt` (Phase 1 ARCH §"Action descriptor encoding") | none directly | Phase 2 does not touch action encoding. Confirmed clean — mapgen output is *not* on the action-log chain. |
| Phase 1 self-test framework `runChecks` (`src/core/self-test.ts:208`) | 15 | New checks must allocate their own `RunStreams` (B4); existing checks must not be reordered. |
| `RANDOM_WALK_DIGEST` golden constant | none | Mapgen's golden digest is a *separate* constant; do not collapse them. The memo does not propose collapsing them; confirmed. |

## Deferred questions that should remain deferred

The three open questions at the end of the memo (variable floor sizes,
encounter-slot subdivision, JSON exposure on the diagnostic page) are
all correctly deferred. Endorsed:

- **Variable floor sizes** — JSON shape supports it additively if it
  ever lands; deferral is risk-free.
- **Encounter slot subdivision** — defer to Phase 6 when content
  exists. Premature subdivision today locks an arbitrary taxonomy.
- **JSON on the diagnostic page** — the CLI tool covers debug needs;
  the diagnostic page does not need to grow. Fine.

The memo does *not* defer one question that I think it should: **what
is the BSP min-leaf-size and depth-cap actually frozen at, numerically?**
"Pinned in `src/mapgen/params.ts`" (frozen-contract item 5) is the
right shape, but the memo doesn't pick the numbers. This is not
strictly a planning-gate question — the implementer can pick numbers
and the fixture pack pins them — but a future "we tweaked min-leaf
from 7 to 6" PR will need the architecture-red-team review the memo
already promises (frozen contracts list, item 5). Document the
review trigger explicitly: any PR touching `src/mapgen/params.ts`
requires `architecture-red-team` review and a `rulesetVersion` bump.

## Summary

The memo is close to APPROVE quality. The blockers are:

- B1 — base64 vs base64url alphabet/padding ambiguity, plus
  unjustified duplication of `src/core/hash.ts:base64url`.
- B2 — `null` field handling in canonical JSON unspecified.
- B3 — strict vs lax parsing of unknown JSON keys unspecified;
  affects every later phase.
- B4 — runtime-guard contract is internally inconsistent and
  understates the change to Phase 1's `RunStreams` shape.

Each is a one- or two-paragraph addendum to the existing memo. None
require an algorithmic change. Once addressed, this memo is APPROVE
and Phase 2.A may begin.

## Relevant files cited in this review

- `/workspace/artifacts/decision-memo-phase-2.md`
- `/workspace/artifacts/decision-memo-phase-1.md`
- `/workspace/artifacts/phase-approval.json`
- `/workspace/docs/SPEC.md`
- `/workspace/docs/ARCHITECTURE.md`
- `/workspace/docs/PHASES.md`
- `/workspace/docs/QUALITY_GATES.md`
- `/workspace/src/core/hash.ts` (existing `base64url`)
- `/workspace/src/core/streams.ts` (existing `RunStreams` shape)
- `/workspace/src/core/self-test.ts` (existing self-test framework)
- `/workspace/src/core/fingerprint.ts` (existing seed-string handling)
- `/workspace/eslint.config.js` (existing lint scoping for `src/mapgen/**`)
