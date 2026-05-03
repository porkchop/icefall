# Code Review — Phase 2.0 (Planning Gate)

## Verdict

APPROVE WITH NITS.

The Phase 2.0 deliverable — decision memo, red-team review, addendum, two
carry-forward tests, and the PHASES.md split — is internally consistent,
addresses every red-team blocker, and ships zero implementation code (correct
posture for a planning gate). The two carry-forward tests are correct and
verified-green. Nothing in this commit blocks Phase 2.A from beginning. A
small number of nits below would tighten the planning record without
requiring a re-spin.

## Blocking issues

None.

## Non-blocking issues

### N1. Combinatoric test relies on hand-maintenance of `FIELDS` to catch *future*-field regressions

`src/core/encode.test.ts:104` declares `FIELDS = ["target","item","dir"]
as const`. The test enumerates `1 << FIELDS.length` subsets. If a future
optional field is added to `Action` and to `encodeAction` but the
developer forgets to extend `FIELDS`, the test still passes (the new
field is simply absent from every subset under test, and the
`readOptionalTagsInOrder` walker would only throw if the new field
*also* uses an unknown tag byte that doesn't match TAG_TARGET / TAG_ITEM
/ TAG_DIR — which it would, but only if the new field's tag landed
between two existing tags such that the test exercises a subset that
includes it). The comment at lines 94–96 documents the intent but does
not enforce it.

Suggested patch (lightweight): add a one-line assertion that
`Object.keys(TAG_BY_FIELD).length` matches the count of `TAG_*`
constants exported from `./encode`, so a future field added to the
source forces a test update. Or: the test imports an internal "list of
optional-field names" constant from `encode.ts` and walks that. Neither
is required for Phase 2.0; flagging for the next time `Action` is
extended.

### N2. New invalid-fixture additions in `eslint-rules/no-float-arithmetic.test.ts` reinforce existing branches rather than cover new ones

The new fixtures at lines 85–100 add: `0.0`, `.5`, `Math.trunc`,
`Math.atan2`, `Math.LN2`, `Number.MIN_VALUE`, `let a=5; a=a/2;`. All
seven hit branches the prior 20 fixtures already covered
(`decimalLiteral`, `mathMember`, `numberMember`, `divOperator`).
`let a = a / 2;` in particular is the same `BinaryExpression`-with-`/`
branch as the existing `const x = 1 / 2;` — the AssignmentExpression
overload is `/=` (already covered at line 48). This is not a defect —
the value is in pinning specific entries of `BANNED_MATH_MEMBERS` and
`BANNED_NUMBER_MEMBERS` (an additional, real, regression class: a
contributor accidentally removing an entry from those sets). But the
27-vs-25 count is incidental. The phase-1A follow-up wording in
`artifacts/phase-approval.json:42` ("target ~25") is satisfied as
written.

Optional patch: add at least one fixture that *would have* found a real
hole. Two candidates: a `BigInt`-mixed expression (currently silently
unhandled), and a `for...in` over an object (cousin of the
"un-ordered-iteration" rule mentioned in `docs/PHASES.md:58` but not
this rule's scope). Skip if out of scope for this carry-forward.

### N3. PHASES.md Phase 2.A acceptance-criteria line 115 hard-codes the addendum's per-call-delta wording without naming the addendum

`docs/PHASES.md:115` says "the runtime guard contract pinned in the
decision memo's addendum (per-call delta on `RunStreams.__consumed`
equals exactly `{"mapgen:"+floorN}`)". This is correct content but
duplicates the contract spec across two documents. A single-source
formulation — PHASES.md cites
`artifacts/decision-memo-phase-2.md` addendum B4 / frozen-contract 11
by reference, and the contract text lives only in the memo — would
prevent future drift. Non-blocking; the current wording is consistent
with the addendum.

### N4. Original Phase 2 acceptance criterion "never the sim stream" was strengthened to "never the sim or ui streams" without an explicit note

The pre-edit `docs/PHASES.md` line 91 said *"never the sim stream."*
The post-edit `docs/PHASES.md:115` says *"never the sim or ui streams."*
This is a strengthening (correct: mapgen has no business reading the
ui stream either) and is consistent with the memo's decision 7 and the
addendum's frozen-contract 11. But a strengthened criterion is itself a
scope change worth calling out. Non-blocking; consider a one-line note
in the next phase-approval.

### N5. Decision-memo addendum B3 leaves a small ambiguity on registry-immutability test wording

`artifacts/decision-memo-phase-2.md:589–594` says the registry-mutation
enforcement test is "explicitly deferred to Phase 6." Good. But the
sentence "Phase 2 documentation in `docs/ARCHITECTURE.md` notes the
deferred test" (line 594) is a documentation task. A grep of
`/workspace/docs/ARCHITECTURE.md` shows no such note yet. Phase 2.0's
`docs/ARCHITECTURE.md` is unchanged in this commit. The doc note is
arguably a Phase 2.A scope item (the addendum line 749 lists
`docs/ARCHITECTURE.md` as a Phase 2.A documentation task), so this is
not a Phase 2.0 omission — but the addendum could be more explicit
that B3's documentation lands in 2.A, not 2.0.

### N6. Decision-memo body retains the superseded "subset" wording in the Risks section

`artifacts/decision-memo-phase-2.md:514–518` ("Runtime guard false
positive… The test asserts the consumed-set is a subset of `mapgen:*`,
not an exact singleton.") directly contradicts decision 15
(line 429: "exactly `["mapgen:" + floorN]`") and the addendum's
per-call-delta override (lines 620–633). The addendum at line 632
explicitly supersedes this risk text. The "this addendum overrides any
conflicting prose" clause at line 540 covers it. The contradiction is
audit-trail-correct (planning-gate convention is "leave original text,
add override") but a future reader scanning the Risks section for
runtime-guard semantics will read the wrong invariant. Consider an
inline `> Superseded — see addendum B4` annotation in the body. Not
required for approval.

### N7. ASCII rendering's trailing-newline pinning still has a residual ambiguity

Addendum N3 at line 685 says
`renderAscii` returns `lines.join("\n") + "\n"`. Memo body decision 9
at line 298 says "Trailing newline; `\n` only." Addendum is more
specific (exactly one trailing `\n`). Risk: if a Phase 2.A
implementer reads only decision 9 they could emit zero or two trailing
newlines without contradicting it. The override clause covers this;
the implementer should be told to read the addendum first. Standard
planning-gate workflow (the addendum is canonical) handles this — but
a one-line "see addendum first" banner at the top of the memo body
would prevent the misread.

## Confirmations

### C1. Carry-forward acceptance criteria are met and verified-green

- `code-review #2`: invalid-fixture count went from 20 to 27 (≥ 25 target).
  Source: `eslint-rules/no-float-arithmetic.test.ts:40–101`.
- `code-review #8`: 8 tests covering every subset of `{target, item, dir}`,
  walking the wire-form bytes against `src/core/encode.ts:57–90` and
  asserting strictly-increasing tag order plus an exact-equals against
  the sorted expected-tag list.
  Source: `src/core/encode.test.ts:97–153`.

### C2. The combinatoric test's byte-walk matches the wire format

`readOptionalTagsInOrder` at `src/core/encode.test.ts:106–128` skips
`[version:1][type_len:1][type_bytes...]` and then walks each tag with
the right field-size: TAG_TARGET advances by `1+4` (1-byte tag + 4-byte
int32), TAG_ITEM by `1+1+len` (1-byte tag + 1-byte length + variable),
TAG_DIR by `1+1` (1-byte tag + 1-byte direction). This exactly matches
the encoding logic in `src/core/encode.ts:64–87`. Unknown tag bytes
throw with a descriptive error.

### C3. The combinatoric test fails loudly on source-order-vs-tag-order regressions

If any of the three existing emit blocks in `encodeAction` are
re-ordered relative to source, the resulting wire bytes will not be
in strictly-increasing tag order, and the
`expect(observed[i-1]).toBeLessThan(observed[i])` assertion at line
146 fails. Confirmed by inspection. (See N1 for the *future*-field
case, which is partly but not fully covered.)

### C4. Phase 2 acceptance-criteria partition between 2.A and 2.B is correct

The original six criteria (HEAD `docs/PHASES.md` lines 92–97) map to:
1. "same (seed, floor) → same floor" → 2.A criterion 1.
2. "exactly one entrance/exit, except floor 10" → 2.A criterion 2.
3. "all rooms reachable" → 2.A criterion 3 (now augmented by 200-seed
   property sweep, per N4 of red-team).
4. "Floor 10 structurally distinguished" → 2.A criterion 4.
5. "mapgen consumes only mapgen stream — runtime guard + lint" → 2.A
   criterion 5 (strengthened to also forbid `ui`, see N4 above).
6. "live URL serves diagnostic page with ASCII preview" → 2.B
   criterion 1.

No original criterion is silently dropped. New 2.A criteria (frozen
contracts, bundle budget + report, sandbox gate command) are
consistent with the memo body and addendum.

### C5. The addendum addresses each red-team blocker concretely

- B1 (base64url alphabet/padding + missed reuse): addendum line 544–557
  explicitly reuses `src/core/hash.ts:base64url`, deletes the
  speculative `src/core/base64.ts`, and locks in unpadded RFC 4648 §5.
  Frozen-contract 8.
- B2 (null-field absence/presence): addendum line 559–573 mandates
  always-present keys, with `parseFloor` rejecting missing or
  contradictory pairings. Frozen-contract 9.
- B3 (strict vs lax parser): addendum line 575–586 picks strict;
  registry-immutability test deferred to Phase 6 with documentation
  task. Frozen-contract 10.
- B4 (Phase 1 contract change + per-call delta): addendum line 596–633
  classifies `__consumed` as a Phase 1 addendum applied in 2.A,
  reconciles the singleton-vs-subset contradiction by switching to
  per-call delta semantics, mandates fresh `RunStreams` allocation
  in the new self-test. Frozen-contract 11.

Each addressed concretely with a frozen-contract row, not just a
gesture.

### C6. Frozen-contracts items 8–13 in the addendum are a complete list of what the addendum locks in

The addendum's six new contracts (8–13) cover:
- 8: base64url alphabet (B1).
- 9: always-present keys (B2).
- 10: strict parser (B3).
- 11: per-call stream-consumption invariant (B4).
- 12: `seedToBytes(seed) = sha256(utf8(seed))` (N2).
- 13: ASCII top-tier exclusivity + trailing newline (N3).

N4 (property sweep) and N5 (bundle-report artifact) are deliverables,
not wire/behavioral contracts; correctly excluded from the frozen list.
N6 (parseFloor only on serializeFloor output) is a code-organization
constraint; defensible to omit, but borderline. No silently-locked
contract is missing.

### C7. DRY / reuse-gate compliance verified against the actual repo

The red-team flagged that the original memo missed
`src/core/hash.ts:base64url`. Verified the addendum's claim by reading
`src/core/hash.ts` directly: the file exports `sha256`, `sha256Hex`,
`base64url`, `sha256B64Url`, `utf8`, `concat`, `isWellFormedUtf16`. The
addendum reuses `base64url` (B1) and `sha256` + `utf8` (N2 / `seedToBytes`)
correctly. `concat` is not re-implemented anywhere in the new memo
text. `streamPrng` (`src/core/streams.ts:86`) is reused by the
property-sweep test (N4: `streamPrng(rootSeed, "test:reach")`) — correct
reuse. No silent duplication of `utf8`, `concat`, `sha256`, or any
other Phase 1 export is introduced.

### C8. Test posture is correct for a planning-gate-only commit

This commit ships zero mapgen code. The two new tests are explicitly
the carry-forward Phase 1.A follow-ups, not Phase 2 mapgen tests.
166 tests pass; 100% line / stmt / func coverage on `src/core/*`. No
doc-validation test asserting "PHASES.md and ARCHITECTURE.md don't
contradict the memo's frozen-contract list" is mandated by the
addendum, and writing one now is premature (the contracts have no
implementation to validate against until Phase 2.A).

### C9. Comment hygiene and identifier naming in the new test code is appropriate

`src/core/encode.test.ts:94–96` is a 3-line comment explaining *why*
the combinatoric test exists. This is the kind of non-obvious boundary
the project's style allows. Identifiers (`FIELDS`, `TAG_BY_FIELD`,
`readOptionalTagsInOrder`, `present`, `mask`, `label`, `observed`,
`expected`) are clear and behavior-oriented. `describe` and `it`
strings describe behavior ("optional-field tags emit strictly
increasing"), not implementation detail. No emojis, no leakage.

## Verification results

- typecheck: `npm run typecheck` → `tsc -b --noEmit` exit 0, 0 errors.
- lint: `npm run lint` → `eslint .` exit 0, 0 errors.
- test: `npm run test` → vitest run --coverage, **8 test files, 166
  tests passed**, 100% lines / 100% statements / 100% functions on
  `src/core/*` (branch 95.97%, all uncovered branches in
  `self-test.ts` lines 59, 63–64, 113–129, unchanged from Phase 1
  baseline).

All three gates green. The 166 = 158-prior + 8-combinatoric headcount
is consistent (eslint-rules suite went from ~35 to 42 tests; encode
suite went from 20 to 28 tests; the 7 carry-forward eslint-fixture
additions appear collectively in the eslint suite count).

## Files reviewed

- `/workspace/artifacts/decision-memo-phase-2.md` (new file, 762 lines, full read)
- `/workspace/artifacts/red-team-phase-2.md` (new file, 413 lines, full read)
- `/workspace/docs/PHASES.md` (modified — Phase 2 section, lines 75–127)
- `/workspace/eslint-rules/no-float-arithmetic.test.ts` (modified — invalid fixtures expanded to 27)
- `/workspace/eslint-rules/no-float-arithmetic.cjs` (referenced — confirmed which branches the new fixtures exercise)
- `/workspace/src/core/encode.test.ts` (modified — added tag-order combinatoric describe block)
- `/workspace/src/core/encode.ts` (referenced — verified wire format matches the test's byte-walk)
- `/workspace/src/core/hash.ts` (referenced — verified `base64url` exists for B1 reuse claim; verified `sha256`, `utf8`, `concat` exist for N2 / property-sweep reuse)
- `/workspace/src/core/streams.ts` (referenced — verified `streamsForRun`, `streamPrng`, `RunStreams` shape against B4 claims)
- `/workspace/src/core/self-test.ts` lines 125–154 (referenced — verified the addendum's citation `src/core/self-test.ts:134` is correct)
- `/workspace/docs/QUALITY_GATES.md` (referenced — DRY-gate text the red-team cites at line 47)
- `/workspace/docs/ARCHITECTURE.md` lines 40–60 (referenced — confirmed `tools/` row already exists in the layer table; addendum's update to it is a 2.A doc task)
- `/workspace/artifacts/phase-approval.json` (referenced — confirmed carry-forward follow-ups #2 and #8 are exactly what this commit closes)
