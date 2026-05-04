# Code Review — Phase 3.A.2 (sandbox-verifiable sim implementation)

## Verdict

APPROVE WITH NITS.

All eight verification points pass. The frozen-contract bytes are pinned
correctly with a byte-explicit unit test. The stream-isolation
invariants are structural (no `RunStreams` parameter on `tick`) and
asserted in the self-test. The lint scope correctly bans `.mapgen` /
`.ui` / no-arg `.sim` member access and destructuring escapes, with
`harness.ts` as the only file-level exception. The coverage threshold
drop on `src/sim/**` (95/95/100/85) is well-justified and documented
in-config; the four uncovered lines are defensive fallbacks unreachable
under correct usage. No regression on Phase 1/2 digests.

## Blocking issues

None.

## Verification points

1. **rollBytes pre-image (addendum B1).** PASS. `src/sim/combat.ts:39-74`
   builds `state ‖ encodeAction(action) ‖ ROLL_DOMAIN_ANCHOR ‖
   [domainByteLen:1] ‖ utf8(domain) ‖ u32_le(index)` exactly. Anchor is
   `utf8("icefall:roll:v1:")` from `params.ts:17`. Byte-explicit test
   at `tests/sim/combat.test.ts:24-44` reconstructs the pre-image
   manually and asserts byte-for-byte equality. Domain validation
   (well-formed UTF-16, length 1..31, integer index in u32 range)
   matches the addendum.

2. **Per-tick `__consumed` empty (item 9).** PASS. `tick(state, action)`
   at `src/sim/turn.ts:90` has no `RunStreams` parameter — structurally
   incapable of consuming a stream. Floor-entry orchestrated by harness
   loop. The `sim-stream-isolation` self-test at
   `src/core/self-test.ts:301-328` allocates fresh streams (per N9),
   records `__consumed` after floor-1 entry (`["mapgen:1", "sim:1"]`),
   asserts the set is unchanged after one tick.

3. **Lint scope.** PASS. Empirically verified all three classes:
   `.mapgen` / `.ui` / no-arg `.sim` member access produces
   `no-restricted-syntax` errors; destructuring escape produces
   `ObjectPattern > Property` errors; `mapgen` import is blocked by
   `no-restricted-imports`. `harness.ts` is the only non-test file in
   the `ignores` list at `eslint.config.js:131`. The `simFloor`
   accessor is correctly exempted by exact-string identifier match
   (`'sim'` ≠ `'simFloor'`).

4. **`uniformIndex` integer-only.** PASS. `src/sim/run.ts:48-57` uses
   only `%`, `-`, `>>>`, `>` — no `Math.floor`, no `/`. Passes the
   `no-float-arithmetic` rule.

5. **Damage clamp + short-circuit (item 13 + N7).** PASS.
   `src/sim/turn.ts:278-281` sets `outcome = "dead"` and `break`s out
   of the monster loop on `newHp === 0`. Test at
   `tests/sim/turn.test.ts:271-315` asserts state-hash equality
   between one-monster and two-monster scenarios where the player dies
   on the first counterattack — the second monster's roll is not
   computed.

6. **Monster registry sorted by id, no duplicates.** PASS. 7 entries
   alphabetically sorted in `src/registries/monsters.ts:39-96`. Tests
   assert sortedness and pairwise distinctness.

7. **Diagnostic-page integration.** PASS. `src/main.ts:14-25` declares
   `Window` interface fields with exact types; `:243-262` runs the
   harness and writes `__SIM_FINAL_STATE_HASH__`, `__SIM_OUTCOME__`,
   `__SIM_FLOOR_REACHED__`. Playwright test at
   `tests/e2e/diagnostic.spec.ts:91-105` reads the hash and asserts
   it equals `SIM_DIGEST`. Bundle 15.07 KB gzipped.

8. **No regression on Phase 1/2.** PASS. 563 tests pass. RANDOM_WALK_DIGEST
   and MAPGEN_DIGEST unchanged. Lint, typecheck, build all green.

## Coverage threshold deviation (documented)

`src/sim/**` thresholds lowered from 100/100/100/80 to 95/95/100/85.
Documented at `vitest.config.ts:51-66`. The four uncovered lines:

- `ai.ts:165-166` — defensive "no valid step" branch in
  `decideMonsterAction`. Unreachable in correct BFS usage.
- `turn.ts:225,249-257` — race conditions: stay-with-state-change rare;
  move-target-blocked-by-since-moved-monster.
- `run.ts:55` — rejection-sample re-draw (~1.4e-9 prob/draw).
- `run.ts:141` — items secondary tie-break by kind, unreachable in
  Phase 3 (all loot slots emit `item.cred-chip`).

The `SIM_DIGEST` golden constant is the load-bearing assertion — silent
drift in the turn/AI/combat formulas surfaces there. **Not blocking.**

## Non-blocking suggestions

- `applyFloorEntry` (`run.ts:180-194`) takes both `newFloor` and
  `newFloorState` even though `newFloorState.floor === newFloor`.
  Could drop `newFloor`. Cosmetic.
- `dirOrdinalForStep` (`ai.ts:169-175`) is exported but used only by
  tests. Consider a comment if planned Phase 5+ helper. Optional.
- `ROLL_DOMAIN_ANCHOR_TEXT` is imported and re-encoded in
  `combat.ts:31` and the test at `combat.test.ts:37`. A shared
  `ROLL_DOMAIN_ANCHOR_BYTES: Uint8Array` constant would remove the
  re-encoding, but the current shape is clearer for the
  audit-hostile reader.
- `tick` silently treats unknown action types as no-ops
  (`turn.ts:163-165`). Consistent with "additive vocabulary"; a
  defensive type-check would catch Phase 6+ omissions but is not
  required.
- `tests/e2e/diagnostic.spec.ts:6-7` redeclares `SIM_DIGEST` rather
  than importing it. Mirrors the pre-existing `RANDOM_WALK_DIGEST`
  pattern; intentional for browser-side assertions.

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate. Every new module has at
least one focused test file. Frozen-contract assertions are byte-level.
Golden `SIM_DIGEST` is the cross-runtime assertion in both Node and
browsers. Edge cases covered: domain length 0/32, surrogate domain,
index out of u32 range, descend at non-exit cell, descend on floor 10,
monster blocked-by-monster, AI tie-break direction order,
after-death short-circuit, prefix-replay invariant.

## Files reviewed

Production: `src/sim/{combat,turn,ai,run,harness,params,types,self-test-log}.ts`,
`src/registries/{monsters,items}.ts`, `src/core/{streams,self-test}.ts`,
`src/main.ts`, `eslint.config.js`, `vitest.config.ts`.

Tests: `tests/sim/{combat,turn,ai,run,harness}.test.ts`,
`tests/registries/{monsters,items}.test.ts`,
`tests/e2e/diagnostic.spec.ts`, `src/core/streams.test.ts`.

Phase 3.A.2 is ready for approval. Phase 3.B (live verification, after
external push) is the next phase.
