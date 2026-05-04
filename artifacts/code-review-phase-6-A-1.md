# Code Review — Phase 6.A.1 (drift-detection sweep)

## Verdict

APPROVE.

All four PHASES.md:420-424 acceptance criteria pass. The three Phase
3.A.2 cosmetic carry-forwards (applyFloorEntry redundant param,
ROLL_DOMAIN_ANCHOR_BYTES shared constant, tick switch/case scaffold
in lieu of a defensive type-check) are addressed. The Phase 5.A.2
N1 carry-forward (canvas fillStyle hidden constant) is addressed as
`CANVAS_BACKGROUND_COLOR`. The new `docs/ARCHITECTURE.md` Phase 6
section locks the inventory shape, equipment slot enumeration,
additive action vocabulary, item-effect resolution path, and the
registry/atlas invariants ahead of any 6.A.2 implementation. Final
gates are all green: `npm run lint` clean, `npm run typecheck`
clean, `npm run test` reports `Test Files 58 passed (58)` /
`Tests 865 passed (865)` (exactly the expected `+0` from
phase-5.B), `npm run build` succeeds. Bundle delta is +0.04 KB JS /
+0.03 KB gzip vs HEAD@542e36d (verified by stash + rebuild;
phase-5.B = 69.17 KB / 26.03 KB gzip; 6.A.1 = 69.21 KB / 26.06 KB
gzip), well under the +0.1 KB budget. Zero net-new files in working
tree. The deletion of `artifacts/phase-update.json` is the
host-wrapper consumption per the brief.

The applyFloorEntry refactor and the tick switch/case refactor are
**byte-equivalent at runtime** — confirmed by the unchanged
`SIM_DIGEST` golden constant at `src/core/self-test.ts:72-73`
(`321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e`)
and the green test run that includes the cross-runtime self-test
battery. The FloorState invariant (`floorState.floor` set at the
single construction site `src/sim/run.ts:124-128` from the input
`floor` parameter) means `newFloorState.floor.entrance.{y,x}` reads
the same bytes the pre-refactor `newFloor.entrance.{y,x}` read at
both callers (`src/main.ts:578-579` and `src/sim/harness.ts:90-95`,
which pass the `floor` they just fed to `spawnFloorEntities`).

Three non-blocking findings below: (1) one inaccuracy in the new
ARCHITECTURE.md Phase 6 section (the registry-immutability test is
*claimed* to land in 6.A.1 but did not — it remains pending);
(2) a smaller wording slip in the same section (Phase 3 already
ships 5 item kinds, not 1); (3) a stylistic inconsistency between
`ROLL_DOMAIN_ANCHOR_BYTES` (uses `new TextEncoder().encode(...)`)
and the prior-art `ATLAS_SEED_DOMAIN_BYTES` (uses `utf8(...)` from
`core/hash`); (4) the new `CANVAS_BACKGROUND_COLOR` JSDoc is
sandwiched between the `spritePixelCoord` JSDoc and its function
body, orphaning the former.

## Blocking issues

None.

## Verification points

1. **applyFloorEntry redundant param removal.** PASS.
   `src/sim/run.ts:163-179` defines `applyFloorEntry(state,
   newFloorState)` — second arg dropped. The implementation reads
   the entrance from `newFloorState.floor.entrance.{y,x}` at
   `:173-174`, which is byte-equivalent to the old
   `newFloor.entrance.{y,x}` because the FloorState type
   (`src/sim/types.ts:61-65`) carries `floor: Floor` set by the
   single construction site `spawnFloorEntities` at
   `src/sim/run.ts:124-128`, and both call sites
   (`src/main.ts:578-579`, `src/sim/harness.ts:90-95`) pass the
   *same* `newFloor` object that they then (in the old code)
   passed as the now-removed second arg. The doc-comment at
   `:154-162` cites the FloorState invariant explicitly. All three
   call sites updated:
   - `src/main.ts:580` — `applyFloorEntry(state, newFloorState)`
   - `src/sim/harness.ts:99` — `applyFloorEntry(state, newFloorState)`
   - `tests/sim/run.test.ts:217` — `applyFloorEntry(state0, fs2)`
   (`grep -n "applyFloorEntry(" /workspace/src /workspace/tests -r`
   confirms three call sites, all 2-arg.) `Floor` type import
   remains needed at `run.ts:17` (consumed by `makeInitialPlayer`,
   `spawnFloorEntities`, `makeInitialRunState`). `npm run test`
   self-test-log confirms `SIM_DIGEST` golden unchanged → no
   behavior change.

2. **`ROLL_DOMAIN_ANCHOR_BYTES` shared constant.** PASS.
   `src/sim/params.ts:32-34` exports
   `ROLL_DOMAIN_ANCHOR_BYTES: Uint8Array = new TextEncoder().encode(
   ROLL_DOMAIN_ANCHOR_TEXT)`. The doc-comment at `:19-31` explicitly
   notes "Not `Object.freeze`-ed because `Object.freeze` rejects
   array-buffer views with elements" and points the reader at the
   analogous `ATLAS_SEED_DOMAIN_BYTES` discipline — exactly the
   caveat the brief asked for. `src/sim/combat.ts:29` imports
   `ROLL_DOMAIN_ANCHOR_BYTES` from `./params` (no longer imports
   `ROLL_DOMAIN_ANCHOR_TEXT`); `:68` uses it directly inside the
   `concat([...])` call. The local `const ROLL_DOMAIN_ANCHOR =
   utf8(ROLL_DOMAIN_ANCHOR_TEXT)` line from before is gone (verified
   `grep -n "ROLL_DOMAIN_ANCHOR" /workspace/src/sim/combat.ts`
   returns only the one `import` and the one `concat` reference).
   `tests/sim/combat.test.ts:13,37` STILL imports
   `ROLL_DOMAIN_ANCHOR_TEXT` and re-encodes via `utf8(...)` —
   intentional and correct (the byte-explicit pre-image audit
   reconstructs the pre-image from text to prove byte-exact contract
   conformance; sharing the bytes constant would defeat the
   audit-hostile-reader purpose, as documented in the original
   3.A.2 carry-forward at `code-review-phase-3-A-2.md:98-102`).
   See suggestion 3 for a stylistic note on TextEncoder usage.

3. **tick switch/case refactor.** PASS. `src/sim/turn.ts:122-185`
   replaces the prior if/else chain with a `switch (action.type) {
   case ACTION_TYPE_WAIT / MOVE / ATTACK / DESCEND / default }`.
   The four explicit cases match the existing 4 ACTION_TYPE_*
   constants (`params.ts:37-40`). The `default` branch at
   `turn.ts:179-184` is a `break` no-op (does NOT throw) with a
   doc-comment that articulates the additive-vocabulary contract
   ("Phase 1 frozen contract; addendum decision 3"). The structural
   refactor surfaces missing-case bugs at code-review time when
   Phase 6.A.2 adds pickup/drop/equip/unequip/use, which is the
   stated 6.A.1 motivation. No behavior change at runtime — every
   pre-refactor branch maps 1:1 to a post-refactor case body
   (verified by `git diff HEAD -- src/sim/turn.ts` line by line).
   The `SIM_DIGEST` golden at `src/core/self-test.ts:72-73` is
   unchanged and the green test run includes the
   `self-test-log.ts` verifier — byte-equivalence confirmed.

4. **canvas `CANVAS_BACKGROUND_COLOR` named constant.** PASS.
   `src/render/canvas.ts:112` defines
   `const CANVAS_BACKGROUND_COLOR = "#000";`. The only consumer is
   `:160` (`ctx.fillStyle = CANVAS_BACKGROUND_COLOR;`) inside
   `drawScene`. The doc-comment at `:104-111` explicitly justifies
   the choice ("matches the cyberpunk-neon-v1 palette's transparent
   slot's RGB (#000000)"), tying back to the palette. Behavior
   unchanged; no test changes required (existing
   `tests/render/canvas.test.ts` battery covers `drawScene` and is
   green). One non-blocking placement issue — see suggestion 4.

5. **No net-new inventory/equipment/item-recipe code.** PASS.
   `git status --short` shows only modifications to existing files
   plus the deleted `artifacts/phase-update.json`. `git ls-files
   --others --exclude-standard` returns empty (zero untracked
   files). No new files under `src/sim/`, `src/atlas/recipes/`,
   `src/registries/`, or `src/ui/`. The Phase 6.A.1 acceptance
   criterion's "no net-new" is honored exactly.

6. **`docs/ARCHITECTURE.md` Phase 6 section.** PASS (with one
   accuracy slip — see suggestion 1).
   `docs/ARCHITECTURE.md:797-950` is the new "Phase 6 frozen
   contracts (items + currency + equipment)" section, positioned
   between "Phase 5 frozen contracts" (ending `:795`) and
   "Build-time constants" (starting `:952`). Coverage:
   - Inventory data shape with deterministic ordering (sorted by
     `kind` ASC, count DESC) at `:812-836`; capacity unbounded in
     Phase 6 (deferred to Phase 9) at `:835-836`.
   - Equipment slot enumeration `weapon`, `cyberware` at `:838-846`
     with the "frozen for Phase 6" rule and the Phase 9 expansion
     escape hatch at `:848-851`.
   - 5 additive action types `pickup/drop/equip/unequip/use`
     tabulated with required/optional fields at `:855-866`; the
     wire-format note at `:867-872` explicitly states `item` reuses
     `TAG_ITEM = 0x20` (verified vs `src/core/encode.ts:6`) and
     spells out "reusing an existing tag for a new `type` value
     does NOT bump `ACTION_VERSION`" — articulates unambiguously.
   - Item-effect resolution path through the existing `rollBytes`
     subhash with 3 new domain anchors (`item:effect:heal`,
     `item:effect:atk-bonus`, `item:effect:def-bonus`) at
     `:874-892`, with the "no item bypasses the sim stream" claim
     and the ASCII / 1..31-byte domain conformance check.
   - Equipment-modifier injection at combat time as integer
     arithmetic addition at `:894-900`.
   - Registry append-only invariant at `:902-913` (with one
     wording slip — see suggestion 1 and 2).
   - Atlas extension coordinate-stability at `:915-921`.
   - `ATLAS_DIGEST` + 4 preset-seed `expectedHash` values bumped
     in 6.A.2 at `:923-930`.
   - Inventory-from-log reconstruction invariant at `:932-938`.
   - Deferred Phase 6 contracts (capacity bound, stack/unstack
     actions, rarity tiers, flavor text) at `:940-950`.

7. **Final gates green.** PASS. `npm run lint` exits clean (no
   output past the `eslint .` script header). `npm run typecheck`
   (`tsc -b --noEmit`) exits clean. `npm run test` reports
   `Test Files 58 passed (58)` / `Tests 865 passed (865)` — exactly
   the +0 expected (the changes are pure refactors + a doc
   addition + an import rewire; no new test files, no removed
   tests). `npm run build` reports
   `dist/assets/index-CKw_B9TT.js   69.21 kB │ gzip: 26.06 kB`.
   Stash + rebuild against HEAD@542e36d produces `69.17 kB / 26.03
   kB gzip` (filename hash `BD3iH2N-`); delta is +0.04 KB JS / +0.03
   KB gzip — well under the +0.1 KB budget the brief allows.
   Coverage gates pass on every directory; no regression.

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate.

The `applyFloorEntry` 2-arg signature is exercised by
`tests/sim/run.test.ts:212-227` (`makeInitialRunState +
applyFloorEntry` describe-block), which constructs a real
`FloorState` from `spawnFloorEntities(2, floor2, streams)` and
asserts `state1.player.pos` matches `floor2.entrance` — so
removing the entrance-read from the function (or breaking the
FloorState invariant) would fail the test loudly. The test was
correctly migrated to the new signature at `:217`.

The `ROLL_DOMAIN_ANCHOR_BYTES` shared constant is exercised
indirectly by every `combat.test.ts` and `self-test.ts` invocation
of `rollBytes(...)`. The byte-explicit pre-image audit at
`tests/sim/combat.test.ts:24-44` re-encodes
`ROLL_DOMAIN_ANCHOR_TEXT` via `utf8(...)` and asserts byte-equality
against `rollBytes(...)`'s output — so a typo or accidental
re-encoding drift in `params.ts` would fail loudly. The dual-source
discipline (text constant + bytes constant; test reads the text,
production reads the bytes) is correct: changing one without the
other would produce a digest mismatch immediately.

The tick switch/case refactor is exercised by the entire
`tests/sim/turn.test.ts` battery (~70 tests across the four
ACTION_TYPE_* cases) plus the `SIM_DIGEST` cross-runtime self-test
golden at `src/core/self-test.ts`. A switch-case body that swapped
WAIT and MOVE (or any other reordering with semantic effect) would
fail the SIM_DIGEST assertion in any runtime — exactly the
"would fail if the feature drifted" criterion.

The `CANVAS_BACKGROUND_COLOR` named constant has no dedicated test
(a runtime test for a string-literal extraction would be a
self-referential round-trip with no mutation surface). The
existing `tests/render/canvas.test.ts` battery exercises
`drawScene` end-to-end; behavior is unchanged. Acceptable.

No new module went untested. No regression test elided.

The ARCHITECTURE.md Phase 6 section claims "the long-deferred Phase
2 decision-memo 'registry-immutability enforcement test' (decision
6) finally lands in 6.A.1 as a regression-failing test"
(`:907-909`). **It does not actually land.**
`tests/registries/items.test.ts` and `tests/registries/monsters.ts`
contain only the Phase 3 sort/distinct/category assertions; no test
asserts append-only mutation across commits (no test checks that
prior entries' string IDs and metadata are unchanged from a pinned
list). This is doc drift, not a missing acceptance criterion (the
6.A.1 acceptance criteria at PHASES.md:420-424 do NOT require the
test to land), but the doc claim is false as written. See
suggestion 1.

## DRY-gate / drift-detection-gate

**DRY:** This phase's principal DRY win is the
`ROLL_DOMAIN_ANCHOR_BYTES` consolidation: `src/sim/combat.ts:29,68`
no longer redundantly re-encodes the 16-byte ASCII anchor on every
`rollBytes` call (the prior code had a module-scope
`utf8(ROLL_DOMAIN_ANCHOR_TEXT)` evaluated once at import — already
DRY at runtime, but the *source bytes* of the encoded form lived
in two places: `combat.ts` and `tests/sim/combat.test.ts`). The
new shape pins production to a single source, while preserving the
audit-hostile dual-source discipline in the test (the test
intentionally re-encodes from text — see verification point 2).

The `applyFloorEntry` 2-arg refactor closes a redundant-parameter
gap rather than a duplication gap, but it removes a misalignment
surface (the old 3-arg signature accepted a `newFloor` that *could*
disagree with `newFloorState.floor`; the FloorState invariant said
they wouldn't, but nothing structurally enforced it). Cosmetic
hardening, no behavior change.

The `CANVAS_BACKGROUND_COLOR` extraction is the canonical "no
hidden constants" DRY-adjacent fix: `"#000"` is now named with a
docstring tying it to the palette's transparent-slot RGB.

**Drift:** The Phase 6 ARCHITECTURE.md section is the canonical
drift-prevention pattern — pinning the inventory shape, equipment
slot enumeration, action-vocabulary additions, and roll-domain
extensions *ahead* of any 6.A.2 code lines being written. A 6.A.2
builder reading `:855-872` cannot accidentally introduce a new
TAG_* byte (the doc explicitly says reuse `TAG_ITEM = 0x20`); a
builder reading `:874-892` cannot accidentally add a new domain
that bypasses the rollBytes subhash; a builder reading `:902-913`
knows the registry expansion order is alphabetical and cannot
silently reorder Phase 3's existing entries.

The tick switch/case refactor is *also* a drift-prevention play:
the explicit `case ACTION_TYPE_*:` lines surface a Phase 6+
forgot-to-wire-it bug at code-review time rather than at
production-replay time (when a mismatched action type would
silently no-op via the `default` branch instead of crashing).

The lint-rule inventory at `ARCHITECTURE.md:954-1001` does not yet
have rows for the Phase 6 contracts (e.g., a registry append-only
test, a roll-domain registry extension lint). Consistent with the
section text saying these contracts are "refined as 6.A.2's
implementation lands" (`:803-809`) — but the registry-immutability
test claim at `:907-909` is the one place where this consistency
is broken (the doc says the test ships in 6.A.1; it does not).

## Non-blocking suggestions

1. **`ARCHITECTURE.md:907-909` claims the registry-immutability
   test "lands in 6.A.1" — it does not.** No `tests/registries/`
   file (or anywhere in `tests/`) was added or modified that
   asserts append-only mutation across commits.
   `grep -rn "immutab\|append.only" /workspace/tests` returns
   zero matches. `tests/registries/items.test.ts` continues to
   assert sort order and pairwise-distinct ids only; no test
   pins prior entries' ids/metadata against a frozen golden
   list. This is doc-drift, not a missing acceptance criterion
   (the 6.A.1 criteria at PHASES.md:420-424 do NOT require the
   test). Two safe fixes: either change the doc wording to "lands
   in 6.A.2 alongside the registry expansion" (consistent with
   Phase 2 decision-memo's deferral language at
   `decision-memo-phase-2.md:594-600`), or land the test in
   6.A.1 as an empty-state baseline (assert the 5 existing Phase
   3 entries against a frozen string list, with the comment
   "expand at 6.A.2 to include the new ~15 entries"). The first
   fix is one-line; the second is a small added test file.
   Recommend the first fix at the next commit.

2. **`ARCHITECTURE.md:902-905` claims Phase 3 has a "single entry
   (`item.cred-chip`)"; it actually has 5.** `src/registries/items.ts:28-34`
   ships 5 entries (cred-chip, cyberdeck-mod-1, stim-patch,
   trauma-pack, weapon.knife) — frozen by Phase 3 decision-memo
   item 13. The doc text "Phase 6 expands `src/registries/items.ts`
   from the Phase 3 single entry (`item.cred-chip`) to ~20 starter
   items" should read "from the Phase 3 5 entries (`item.cred-chip`,
   `item.cyberdeck-mod-1`, `item.stim-patch`, `item.trauma-pack`,
   `item.weapon.knife`) to ~20 starter items". Cosmetic accuracy
   slip; one-line fix at the same time as suggestion 1.

3. **TextEncoder usage style inconsistency.**
   `src/sim/params.ts:32` uses `new TextEncoder().encode(...)`
   directly. The analogous prior-art at
   `src/atlas/seed.ts:14` uses `utf8(...)` from `core/hash`,
   which itself wraps `TextEncoder` (`hash.ts:109-113`). Both
   produce byte-identical Uint8Arrays for ASCII inputs, so this
   is purely stylistic. Consider switching to
   `utf8(ROLL_DOMAIN_ANCHOR_TEXT)` so the two anchor-bytes
   constants in the codebase use the same encoder helper. The
   docstring's reference to `ATLAS_SEED_DOMAIN_BYTES` already
   sets the reader's expectation; aligning the source style
   would close the loop. Cosmetic.

4. **`CANVAS_BACKGROUND_COLOR` JSDoc is sandwiched between
   `spritePixelCoord`'s JSDoc and its function body.**
   `src/render/canvas.ts:97-103` is the JSDoc for
   `spritePixelCoord` (the function definition begins at `:114`),
   but `:104-112` is a second JSDoc block + the
   `CANVAS_BACKGROUND_COLOR` constant inserted between them. The
   reader / IDE may attach the wrong JSDoc to either the constant
   or the function. The fix is to move the constant + its JSDoc
   either (a) above `spritePixelCoord`'s JSDoc, sitting next to
   the other module-top constants `SLOT_TILE_FLOOR` etc. at
   `:82-86`, or (b) below `spritePixelCoord`'s definition,
   immediately above `drawScene` where it is consumed. Option (a)
   matches the existing constant-grouping pattern at the top of
   the file. Cosmetic.

## Files reviewed

Production: `src/sim/run.ts`, `src/sim/turn.ts`, `src/sim/combat.ts`,
`src/sim/params.ts`, `src/sim/harness.ts`, `src/main.ts`,
`src/render/canvas.ts`. Read-only verification: `src/sim/types.ts`,
`src/atlas/seed.ts`, `src/core/encode.ts`, `src/core/hash.ts`,
`src/core/self-test.ts`, `src/registries/items.ts`.

Tests: `tests/sim/run.test.ts`. Read-only verification:
`tests/sim/combat.test.ts`, `tests/sim/turn.test.ts`,
`tests/registries/items.test.ts`, `tests/render/canvas.test.ts`.

Docs: `docs/ARCHITECTURE.md:797-950` (new Phase 6 section);
`docs/PHASES.md:413-431` (Phase 6 callout block + acceptance
criteria); `artifacts/code-review-phase-5-A-2.md:351-389` (Phase
5.A.2 carry-forwards N1, N2, N3); `artifacts/code-review-phase-3-A-2.md:91-109`
(Phase 3.A.2 carry-forwards including the three landed in 6.A.1);
`artifacts/decision-memo-phase-2.md:594-600` (the deferred
registry-immutability test).

Phase 6.A.1 is ready for approval. Phase 6.A.2
(sandbox-verifiable inventory + equipment + atlas-extension
implementation) is the next phase.
