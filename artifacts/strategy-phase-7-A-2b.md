# Strategy memo — Phase 7.A.2b (winning fingerprint + WIN_DIGEST + reachability test)

## 1. Recommendation

**Pursue option (3): hand-crafted action log, pinned in `src/sim/self-test-win-log.ts` as a constant analogous to `SELF_TEST_LOG_100`.** It is the only path with confidence-of-landing-today *and* it composes cleanly with the existing two self-test golden patterns (SIM_DIGEST, INVENTORY_DIGEST) the project has already normalized.

## 2. Why the other two are worse for THIS iteration

- **(1) Walker strengthening** — the walker is already 854 lines and has been probed across 8000 seeds with 0 winners; the bottleneck (1 NPC/floor with a 1/3 chance of being the heal-stocking info-broker) is structural, not a tactics bug. Marginal returns are unpredictable, and probing-then-tuning loops do not fit a single focused iteration.
- **(2) Balance tuning** — every alternative probed (boss 40→30, 40→25, atk 9→7, ripperdoc heals) produced 0 winners. Tuning further means re-probing on every change, and any touch of NPC stockTables risks shifting `npcStock` stream consumption in ways the SIM_DIGEST/INVENTORY_DIGEST goldens currently *happen* not to exercise — a "likely preserved" guarantee is not a today-deliverable guarantee.

Both (1) and (2) are open-ended search problems. (3) reduces the win-fingerprint problem to a finite authoring task with a deterministic completion check.

## 3. Sub-steps for the chosen approach

1. Pick a `FingerprintInputs` (e.g. `seed: "phase7-self-test-win"`, `commitHash: "dev0000"`, `rulesetVersion: "phase1-placeholder-do-not-share"`), then enumerate the deterministic NPC-kind sequence on floors 1..9 by running `spawnFloorEntities` once per floor in a scratch script — record which floors yield info-broker.
2. Author `src/sim/self-test-win-log.ts` exporting `SELF_TEST_WIN_INPUTS` and `SELF_TEST_WIN_LOG: readonly Action[]`. Mirror the doc-comment from `self-test-log.ts`: any change is a `rulesetVersion` bump.
3. Build the action sequence iteratively in a one-shot REPL script (kept under `tools/`) that calls `runScripted` after each appended floor segment, asserting `outcome !== "lost"` and the expected floor index — converging on `outcome === "won"` after the boss segment. Final log is copy-pasted as a frozen array.
4. Add `WIN_DIGEST` constant in `src/core/self-test.ts` (placed next to `INVENTORY_DIGEST`; same `sha256Hex` of `finalState.stateHash` shape).
5. Add a new self-test entry `win-cross-runtime-digest` in `src/core/self-test.ts` that runs `runScripted({inputs: SELF_TEST_WIN_INPUTS, actions: SELF_TEST_WIN_LOG})`, asserts `result.outcome === "won"`, and asserts `sha256Hex(result.finalState.stateHash) === WIN_DIGEST`.
6. Add `tests/sim/win-replay.test.ts` that (a) runs the log, asserts `outcome === "won"`; (b) runs it a second time from genesis with fresh streams; (c) asserts byte-identical `finalState.stateHash` (Buffer.equals or hex compare) and identical fingerprint string.
7. Mirror `WIN_DIGEST` literal in `tests/e2e/diagnostic.spec.ts` alongside the existing ATLAS/SIM/INVENTORY/MAPGEN/RANDOM_WALK digests (Phase 4 addendum N12 mirror invariant).
8. Bundle Renderer N3 + cleanup N1/N2 (see §5).
9. Run all gates: `npm ci && npm run lint && npm run test && npm run build && npm run test:e2e`. Confirm bundle stays under 75 KB gzipped.
10. Write `artifacts/phase-approval.json` for 7.A.2b and stop.

## 4. Risks and mitigations

- **Brittleness to rule changes.** Mitigated by Phase 7 frozen-contract surface (locked at 7.A.2a). Future ruleset change is an explicit `rulesetVersion` bump, exactly as SIM_DIGEST and INVENTORY_DIGEST already require — this is a feature, not a bug.
- **Authoring time on a ~1000-entry log.** Mitigate by writing a tiny scaffolder under `tools/` that emits patterns (`move-to(x,y)`, `attack-until-dead(monsterId)`, `talk+buy(npcOrdinal,itemKindId)`) and concatenates Action[] segments — keeps the human work to ~10 high-level decisions, not 1000 keystrokes.
- **Boss-segment uncertainty (counter-attack RNG kills player).** Mitigate by probing the boss segment in isolation against the chosen seed before committing the digest; if a heal-pause must be injected, the scaffolder appends `use(med-injector)` actions. The seed is *chosen*, not *given* — pick one whose boss-room counter-attack rolls land the player above 0 HP.
- **Coverage on the new module.** A constant + frozen-array module is trivially 100% covered the moment the self-test consumes it.
- **WIN_DIGEST drift after merge.** Mitigated by the 3-way mirror (self-test.ts, e2e diagnostic.spec.ts, win-replay.test.ts) — any silent re-run regenerates and the test fails loudly.

## 5. Bundle vs. split renderer N3 + cleanup N1/N2

**Bundle them.** Renderer N3 is genuinely small (one new iteration block in `canvas.ts` + `Monster.kind === "monster.boss.black-ice-v0"` sprite resolution + a 3-entry NPC-kind→slot mapping; ~30 LOC). N1 (delete two pass-through wrappers) and N2 (rename `_shopNextNpcs` → `shopNextNpcs`) are mechanical refactors with no behavior change and are already flagged in the Phase 7.A.2a code review. Landing them in the same approval keeps Phase 7.A.2b's review surface coherent ("the win-state path is fully wired, end to end, pinnable, and visually reachable") and avoids a fourth sub-phase before Phase 7.B's live-deploy gate. The renderer change is read-only on sim state, so it cannot disturb WIN_DIGEST.

## Files referenced

- `/workspace/docs/PHASES.md` (acceptance criteria 7.A.2)
- `/workspace/artifacts/code-review-phase-7-A-2a.md` (N1/N2/N3 specifics)
- `/workspace/src/sim/self-test-log.ts` (SELF_TEST_LOG_100 pattern to mirror)
- `/workspace/src/sim/self-test-inventory-log.ts` (SELF_TEST_INVENTORY_LOG pattern to mirror)
- `/workspace/src/core/self-test.ts:76,116` (digest constants + self-test entries to extend)
- `/workspace/tests/e2e/diagnostic.spec.ts` (mirror site for WIN_DIGEST)
- `/workspace/src/render/canvas.ts` (N3 extension surface)
- `/workspace/src/sim/turn.ts:262-277,385-386,963` (N1/N2 cleanup sites)
- `/workspace/tools/build-win-log.ts` (kept in `tools/` as probe tool; not the production fixture)
