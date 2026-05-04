# Code Review — Phase 3.A.1 (drift-detection sweep)

## Verdict

APPROVE WITH NITS.

The Phase 3.A.1 deliverable — the N7 decoder relocation, focused unit
tests on `src/core/hash.ts`, the N3 `tools/gen-fixtures.ts` unit test,
the PHASES.md split into 3.0/3.A.1/3.A.2/3.B, and the new
`docs/ARCHITECTURE.md` "Phase 3 frozen contracts" section — is internally
consistent, satisfies the addendum's drift-detection scope, and ships
zero net-new `src/sim/**` code (correct posture for the drift sweep).
The two cleanest reviewer nits (`lookup` hoist + short-circuit guard
comment) were folded back into the commit; remaining nits are
cosmetic and recorded as Phase 3.A.2 carry-forwards.

## Blocking issues

None.

## Verification

- 443 tests passing (411 baseline at HEAD of Phase 2.B + 32 net-new
  in 3.A.1: 15 `decodeBase64Url` branch + property tests, 17
  `tools/gen-fixtures` tests).
- `vitest run --coverage` reports 100% lines / 100% statements /
  100% functions on `src/core/**`, `src/mapgen/**`,
  `src/registries/**`. Branch coverage `hash.ts` = 100% (independent
  of mapgen transitive coverage; the N7 deliverable's stated goal).
- `eslint .` — 0 errors.
- `tsc -b --noEmit` — 0 errors.
- `vite build` — green; bundle 11.80 KB gzipped (84% headroom under
  the 75 KB budget); no new chunks introduced.
- `B64URL_REVERSE` exists only in `src/core/hash.ts:52-58` (not
  duplicated in `src/mapgen/serialize.ts`).
- Error-message prefix in the relocated decoder is
  `decodeBase64Url:` (`src/core/hash.ts:79,87`); `parseFloor:` prefix
  in `src/mapgen/serialize.ts` is preserved for `parseFloor`'s own
  errors and is correct.
- `docs/PHASES.md:80-184` documents the Phase 3 split with
  acceptance criteria for 3.0, 3.A.1, 3.A.2, and 3.B.
- `docs/ARCHITECTURE.md:292-421` lists all thirteen frozen contracts
  from the addendum plus the deferred contracts (one-way descent,
  verifier trailing-after-terminal).

## Non-blocking — folded into the commit

- Reviewer N1: `lookup` closure hoisted to module-scope
  `b64urlLookup` (`src/core/hash.ts:62-67`); avoids per-call function
  allocation.
- Reviewer N2: short-circuit guard comment added explaining why
  `c >= 128 || B64URL_REVERSE[c]! < 0` is correct
  (`src/core/hash.ts:60-61`).

## Non-blocking — recorded for Phase 3.A.2 / Phase 5

- Reviewer N3: the gen-fixtures `process.env.VITEST` test is an
  implicit existence-check, not a direct guard test. Acceptable for
  3.A.1; a stronger version (mock `mkdirSync` and assert no fixture
  file mtime changed) is a Phase 3.A.2 carry-forward if the file is
  edited again.
- Reviewer N4: test name "propagates the slug-validation error …
  via the path helper used downstream by main()" overstates what
  it tests (the test only invokes `fixturePathFor`, which is the
  validation point). Rename to "fixturePathFor rejects slash
  characters" if the test file is touched in 3.A.2.
- Reviewer N5: JSDoc on `decodeBase64Url` in `src/core/hash.ts`
  cites addendum B6 but not the test file; optional.

## Files reviewed

- `/workspace/src/core/hash.ts` (relocated decoder + reverse table)
- `/workspace/src/core/hash.test.ts` (new branch + property tests)
- `/workspace/src/mapgen/serialize.ts` (decoder import; local copy
  removed)
- `/workspace/tools/gen-fixtures.ts` (no edits — covered by new test
  file)
- `/workspace/tests/tools/gen-fixtures.test.ts` (new file — 17 tests)
- `/workspace/docs/PHASES.md` (Phase 3 split section)
- `/workspace/docs/ARCHITECTURE.md` (new "Phase 3 frozen contracts"
  section)
- `/workspace/artifacts/decision-memo-phase-3.md` (binding spec; not
  edited in 3.A.1)

Phase 3.A.1 is ready for approval. Phase 3.A.2 may begin after the
3.A.1 commit lands externally.
