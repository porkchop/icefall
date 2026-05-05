# Code review — Phase 7.A.2b (winning fingerprint + WIN_DIGEST + reachability test + renderer N3 + N1/N2 cleanup)

Scope: deferred half of Phase 7.A.2 against PHASES.md acceptance criteria 7.A.2 (the "win-state transition is reachable and replayable" criterion that 7.A.2a explicitly deferred), the three non-blocking nits (N1/N2/N3) flagged in `artifacts/code-review-phase-7-A-2a.md`, and the `WIN_DIGEST` mirror invariant per the Phase 4 addendum N12 pattern.

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (no warnings, no errors) |
| `npm run typecheck` | green |
| `npm test` | 970 tests passed across 69 test files |
| `npm run build` | green; 115.99 KB raw / 33.49 KB gzipped (~55% headroom under the 75 KB budget) |
| `npx tsx tools/emit-win-log-module.ts` re-run | byte-identical to checked-in `src/sim/self-test-win-log.ts` |
| WIN_DIGEST mirror grep | exactly 3 sites: `src/core/self-test.ts:139`, `src/sim/self-test-win-log.ts:16` (doc-comment), `tests/e2e/diagnostic.spec.ts:18` |
| `src/sim/**` cross-layer import to `tools/**` | none (all `tools/` references are in doc-comments only) |
| `Math.random` / `Date.now` / `performance.now` in changed files | none |

## Blocking issues

**None.**

Each blocking rejection criterion was checked:

- New module + public behavior + bug-fix-equivalent (the unreachable-win-state correction): covered by 7 dedicated tests in `tests/sim/win-replay.test.ts`, 3 dedicated tests in `tests/render/canvas.test.ts`, and the self-test-suite extension `win-cross-runtime-digest` (run by `src/core/self-test.test.ts`).
- DRY duplication: `SELF_TEST_WIN_INPUTS` is defined twice (in `tools/build-win-log.ts:70` AND in `src/sim/self-test-win-log.ts:35`). The duplication is justified (and matches the established pattern from `self-test-log.ts` and `self-test-inventory-log.ts`): a frozen-literal module cannot import the generator without creating a circular layering edge from `src/sim/**` to `tools/**`. Both copies are byte-identical on inspection; re-running `tools/emit-win-log-module.ts` produces a byte-identical module, so drift is mechanically detectable.
- Architecture / layer boundaries: `src/sim/self-test-win-log.ts` has no value imports from `tools/**` (verified by grep). The renderer N3 extension preserves the read-only-on-sim-state contract; `tests/render/render-readonly.test.ts` was extended to cover the new manifest slots and still passes against a deeply-frozen state.
- Hidden constants / magic values: `SLOT_MONSTER_BOSS` and `KIND_MONSTER_BOSS` are introduced as named constants in `src/render/canvas.ts:91-92` (no inline boss-id literal in the draw loop).
- Implementation contradicts a prior approved decision: no. The boss-stat nerf (40/9/5 → 24/6/4) is contained in `src/registries/monsters.ts`, which is one of the 12 entries in `RULES_FILES` (`src/build-info.ts:63-76`), so `rulesetTextHash` → `rulesetVersion` automatically picks up the change at build time per the Phase 4 frozen contract. The Phase 7 frozen-contract section in `docs/ARCHITECTURE.md:1016-1025` says boss "per-phase atk/def scaling is pinned in the registry" — i.e., the registry baseline is the contract, and a balance change is exactly the kind of `rulesetVersion` bump anticipated.
- Test suite was run; output shows green (970/970 in 69 files, tail confirmed).

## Review focus — verdict per item

### 1. Determinism (replay byte-equality + WIN_DIGEST)

- `runScripted({inputs: SELF_TEST_WIN_INPUTS, actions: SELF_TEST_WIN_LOG})` reaches `outcome === "won"` on floor 10 with player HP > 0 and boss HP === 0. Asserted by 4 of the 7 win-replay tests + the new `win-cross-runtime-digest` self-test entry.
- `sha256Hex(result.finalState.stateHash)` matches the pinned `WIN_DIGEST` literal `fb36a2fe54e3581a6105ed0ef80afcf8269fc5f97ba633612028c54039828447`. Verified end-to-end.
- Two consecutive runs of `runScripted` on the same `(inputs, actions)` produce byte-identical state hashes (test 3 in `win-replay.test.ts`).
- Three prefix points (100 actions, mid-log, log-minus-1) are individually replay-deterministic (test 5).

### 2. WIN_DIGEST mirror invariant (Phase 4 addendum N12)

- `src/core/self-test.ts:139` — canonical constant (with doc-comment that names it a `rulesetVersion` bump if changed; matches `INVENTORY_DIGEST` / `SIM_DIGEST` doc shape).
- `tests/e2e/diagnostic.spec.ts:18` — mirrored; the dummy `void WIN_DIGEST;` reference at line 24 keeps the constant load-bearing for the linter (the value-mirror invariant is the intent — the actual cross-runtime assertion will land in Phase 7.B per the comment).
- `src/sim/self-test-win-log.ts:16` — included in the doc-comment header.
- All three sites contain the exact same 64-char lowercase hex string (verified by full-repo grep).

### 3. Boss balance change safety on SIM_DIGEST + INVENTORY_DIGEST

- `SELF_TEST_LOG_100` contains zero `descend` actions (verified by grep). It runs 100 actions on floor 1 only; the floor-10 boss is structurally never spawned during this sim, so its registry stats cannot influence the final state hash.
- `SELF_TEST_INVENTORY_LOG` likewise contains zero `descend` actions; same argument.
- Empirically: `npm test` runs both `sim-cross-runtime-digest` and `inventory-cross-runtime-digest` self-test entries against their pinned goldens and both pass. Their digests in `src/core/self-test.ts` (`SIM_DIGEST` line 81, `INVENTORY_DIGEST` line 121) are byte-unchanged from Phase 7.A.2a.

### 4. Renderer N3 correctness

- `drawScene` iterates `state.floorState.npcs` (a new draw block at `src/render/canvas.ts:213-228`) and resolves each NPC's `kind` directly to a slot id, mirroring how items already resolve.
- The boss draws via the dedicated `monster.boss.black-ice-v0` slot when `m.kind === KIND_MONSTER_BOSS`; otherwise falls back to `SLOT_MONSTER_DEFAULT`. Both constants are named at module scope (`canvas.ts:91-92`) — no inline magic strings in the hot path.
- Three new tests in `tests/render/canvas.test.ts:348-446` verify each path: (a) every NPC gets a draw call at its cell; (b) the boss uses sx=204 sy=17 (the (12, 1) stubbed slot); (c) a non-boss monster uses sx=51 sy=0 (the (3, 0) ice-daemon stubbed slot). The boss test would fail if the slot resolution were swapped; the daemon test would fail if the fallback were broken.
- `tests/render/render-readonly.test.ts:46-56` adds the new manifest slots so the read-only test passes against a deeply-frozen state that now contains NPCs.

### 5. N1 cleanup correctness (pass-through wrapper removal)

- `npcInventoryAdd` / `npcInventoryRemove` removed from `src/sim/turn.ts` (lines 254-277 in the old file). Call sites in the BUY (line 652-656) and SELL (lines 720-728) handlers now invoke `inventoryAdd` / `inventoryRemove` directly. The signatures match (both helpers were one-line aliases), so behavior is preserved.
- The 7 shop tests in `tests/sim/shop.test.ts` continue to pass (verified inside the 970-test run).
- `INVENTORY_DIGEST` is unchanged across the cleanup (verified — same constant, still pinned).

### 6. N2 cleanup correctness (rename `_shopNextNpcs` → `shopNextNpcs`)

- Rename is purely lexical; the underscore-prefix anti-pattern (which signals "intentionally unused" in the project's lint discipline) is removed. The variable is read at the FloorState assembly site (`turn.ts:935-938`) and the doc-comment at line 935 was updated to match.
- All references inside `tick()` now use the new name; lint + typecheck green.

### 7. Self-contained module pattern for `src/sim/self-test-win-log.ts`

- Imports are limited to: `Action` type from `../core/encode`, `FingerprintInputs` type from `../core/fingerprint`, and a small set of `ACTION_TYPE_*` / `DIR_*` named constants from `./params`. No runtime import of `tools/**` (matches the established `self-test-log.ts` and `self-test-inventory-log.ts` patterns).
- The doc-comment explicitly documents the regen path (`npx tsx tools/emit-win-log-module.ts > src/sim/self-test-win-log.ts`) and pins the commit-hash / ruleset / seed fields used to derive the digest.
- I re-ran the emit script and confirmed it produces a byte-identical module.

### 8. Test sufficiency (testing gate)

The 7 win-replay tests + 3 canvas tests + the `win-cross-runtime-digest` self-test entry together would all fail if any of the following were reverted:

| Revert | Failing test(s) |
|---|---|
| Boss-stat balance change (24/6/4 → 40/9/5) | `the scripted winning log reaches outcome === 'won'` (boss survives), `the boss is defeated (HP 0) when outcome === 'won'`, `the final state hash matches the pinned WIN_DIGEST`, `win-cross-runtime-digest` |
| WIN_DIGEST constant edit | `the final state hash matches the pinned WIN_DIGEST`, `win-cross-runtime-digest` |
| Walker rewrite that produces a different log | `the final state hash matches the pinned WIN_DIGEST`, `win-cross-runtime-digest` |
| Renderer N3 revert (no NPC draw block) | `emits a drawImage call for every NPC at its (x, y) cell` |
| Renderer N3 revert (boss → daemon slot) | `renders the boss with its dedicated sprite slot on floor 10` |
| Daemon slot fallback revert | `falls back to monster.ice.daemon sprite for non-boss monsters` |
| `SELF_TEST_WIN_LOG` shop participation removed | `the scripted log includes at least one BUY action` |
| Floor-descent count edit | `the scripted log includes 9 DESCEND actions` |

Test names describe behavior, not implementation. Edge-case + risky-path coverage: prefix replay, two-runs replay, BUY presence, DESCEND count, boss-defeat-implies-won-state, win-state-implies-floor-10. Coverage thresholds met (the spec field claims 100/100/100/100 on `src/sim/self-test-win-log.ts` and the test output confirms).

### 9. Bundle budget

33.49 KB gzipped vs. 75 KB cap → 55.3% headroom (delta from 7.A.2a's 32.37 KB is +1.12 KB, almost entirely the 1217-entry frozen literal).

## Non-blocking suggestions

**S1 — Drift in `src/render/canvas.ts:149` body docstring.**
The body docstring on `drawScene` claims the layering order is `tiles → items → monsters → player`. The actual implementation now draws `tiles → items → NPCs → monsters → player` (the new NPC block at lines 213-228 sits between items and monsters). The header docstring at lines 20-46 was updated correctly to mention NPCs but the body docstring at line 149 was missed. Recommend updating the comment to match. Trivial; bundle into the next drift sweep.

**S2 — Stale boss stats in `tests/sim/boss-fsm.test.ts` + `tests/sim/turn.test.ts` synthetic fixtures.**
Several FSM tests construct synthetic `Monster` objects with `hpMax: 40, atk: 9, def: 5` (the pre-7.A.2b registry values). The tests still pass — they isolate FSM behavior from the registry — but the divergence from the registry baseline reduces readability. Recommend either (a) having the FSM tests source the boss kind from `getMonsterKind("monster.boss.black-ice-v0")` and apply per-test HP overrides only, or (b) adding a comment near each synthetic instance noting the values are deliberately decoupled from the registry. Cosmetic; not blocking.

**S3 — `tools/probe-seeds.ts` and `tools/trace-seed.ts` have no automated tests.**
Both are one-shot diagnostic CLIs and were used purely during the seed-search exercise that produced `gamma-195`. The canonical artifact is the frozen log + WIN_DIGEST, both of which are exercised. This is acceptable per the established pattern (`tools/probe-seeds.ts` was also untested in 7.A.2a). No action required.

**S4 — `tools/build-win-log.ts` walker is large (890 lines) and untested.**
The walker is the input-side oracle for the frozen log; if it bit-rots the digest will not change (since the `SELF_TEST_WIN_LOG` literal is checked in directly). However, future regenerations would surface failures only at the `emit-win-log-module.ts` `outcome === "won"` assertion. Acceptable as long as the team treats the log as the contract surface; consider adding a small `tools/build-win-log.test.ts` smoke test (e.g., "buildWinLog() with the canonical inputs returns >= 1 BUY action and reaches outcome === 'won'") in a future drift sweep.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is satisfied:

- Every new module / public behavior has at least one test exercising its primary path: 7 `win-replay` tests for the win-state surface, 3 canvas-render tests for the renderer N3 extension, the `win-cross-runtime-digest` self-test entry exercised by `src/core/self-test.test.ts`. Each would fail if the underlying behavior were reverted (table above).
- Test names describe the behavior under test, not implementation details.
- Edge cases covered: prefix replays, two-call replay determinism, BUY presence, DESCEND count, boss-HP-zero-implies-won, won-implies-floor-10, NPC draw-call presence per cell, boss-vs-daemon slot dispatch, monster.ice.daemon fallback for non-boss monsters.
- Coverage thresholds met for changed modules: `src/sim/self-test-win-log.ts = 100/100/100/100`, `src/sim` aggregate at 98.33/91.63/100/98.33, `src/render/canvas.ts = 97.12/93.75/100/97.12`.

The single retrofit-shaped concern from 7.A.2a's review (the win-state was structurally reachable but no test asserted it end-to-end) is now closed.

## Approval verdict

**APPROVE WITH NITS.**

No blocking issues. Four non-blocking suggestions (S1: body-docstring drift on `drawScene` layering order; S2: stale boss stats in FSM-test fixtures; S3: untested probe CLIs; S4: untested walker) are all cosmetic / drift-sweep candidates and do not affect the Phase 7.A.2 acceptance criteria. All nine review focus items pass; all four CI gates green; coverage thresholds met; frozen contracts respected; determinism preserved end-to-end (the WIN_DIGEST mirror invariant is intact across all three sites).

Phase 7.B (live deploy + cross-runtime + cross-OS) is unblocked.

## Files relevant to this review

Source (in scope):

- `/workspace/src/registries/monsters.ts`
- `/workspace/src/render/canvas.ts`
- `/workspace/src/sim/turn.ts`
- `/workspace/src/sim/self-test-win-log.ts`
- `/workspace/src/core/self-test.ts`

Tests:

- `/workspace/tests/sim/win-replay.test.ts`
- `/workspace/tests/render/canvas.test.ts`
- `/workspace/tests/render/render-readonly.test.ts`
- `/workspace/tests/e2e/diagnostic.spec.ts`
- `/workspace/src/core/self-test.test.ts`

Tools (not shipped to runtime):

- `/workspace/tools/build-win-log.ts`
- `/workspace/tools/emit-win-log-module.ts`
- `/workspace/tools/probe-seeds.ts`
- `/workspace/tools/trace-seed.ts`

Strategy / phase context:

- `/workspace/artifacts/strategy-phase-7-A-2b.md`
- `/workspace/artifacts/code-review-phase-7-A-2a.md` (origin of N1/N2/N3 nits)
- `/workspace/docs/PHASES.md` (Phase 7.A.2 acceptance criteria, lines 520-525)
- `/workspace/docs/ARCHITECTURE.md` (Phase 7 frozen contracts, lines 956-1055)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, drift detection gate)
