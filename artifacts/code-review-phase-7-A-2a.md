# Code Review — Phase 7.A.2a (structural NPC + shop + boss-FSM + win-screen + atlas regen)

## Verdict

**APPROVE WITH NITS.**

All eight review focus items pass. No blocking issues. Three non-blocking
nits that are appropriate carry-forward to Phase 7.A.2b or a future
drift-sweep, called out below. The structural Phase 7.A.2 work is
architecturally sound, frozen-contract-compliant, deterministic, and
adequately tested.

Verified gates:

- `npm run lint` — clean (exit 0)
- `npm run typecheck` — clean (exit 0)
- `npm run test` — 960 tests pass across 68 files
- `npm run build` — `dist/assets/index-*.js = 96.40 KB raw / 32.37 KB gzipped` (~57% headroom under the 75 KB budget)
- Coverage: `src/registries/npcs.ts = 100/100/100/100`, `src/ui/win-screen.ts = 100/100/100/100`, `src/sim/** = 96.53/95/100/90.61` (≥ thresholds), `src/core/** = 100/100/100/96.94` (≥ thresholds)

The "deferred 7.A.2b" scope (WIN_DIGEST golden + win-state reachability
test + scripted winning action log) is explicitly out of scope for this
review per the brief and is *not* blocking.

## Blocking issues

None.

## Detailed findings against the review focus list

### 1. Frozen-contract compliance

`docs/ARCHITECTURE.md:956-1067` "Phase 7 frozen contracts (NPCs + shops
+ boss)" pins:

- **NPC data shape** (`FloorNpc { kind, pos, inventory }` with
  `inventory: readonly InventoryEntry[]`) — `src/sim/types.ts:133-137`
  matches exactly.
- **NpcKindId union** of 3 entries — `src/registries/npcs.ts:23-26`
  emits `"npc.fixer" | "npc.info-broker" | "npc.ripperdoc"` in
  alphabetical order. Pinned byte-for-byte by
  `tests/registries/npcs-immutability.test.ts:71-74`.
- **Shop action vocabulary additivity** (talk/buy/sell as new string
  `Action.type` values reusing `TAG_TARGET=0x10` + `TAG_ITEM=0x20`) —
  `src/sim/params.ts:105-114` adds the constants;
  `src/sim/turn.ts:628-770` wires the handlers. No `ACTION_VERSION`
  bump is introduced (verified by inspecting `src/core/encode.ts`
  unchanged).
- **Roll-domain registry additions** (`shop:stock`, `shop:price`,
  7-bit ASCII length 1..31) — `src/sim/combat.ts:132-133` registers
  the constants; both flow through `rollBytes` (32-byte preimage,
  16-byte ROLL_DOMAIN_ANCHOR, length-prefixed domain).
- **Boss FSM** (`MonsterAIState` extended with `boss-phase-1/2/3`,
  HP-threshold transitions, deterministic, advances only on player
  attacks) — `src/sim/types.ts:35-40` extends the union;
  `src/sim/turn.ts:290-318` implements `bossPhaseTransition` /
  `bossPhaseScaling`; the transition is invoked only inside the
  `ACTION_TYPE_ATTACK` branch (`turn.ts:462-465`).
- **Boss-room spawn override** (`spawnFloorEntities(10, …)` places the
  boss with `aiState='boss-phase-1'`) — `src/sim/run.ts:126-146`.
- **Win-state UI activation** (`src/ui/win-screen.ts` reads
  `state.outcome === "won"`, the host element shown only on that
  outcome) — `src/main.ts:586-591` toggles `display`;
  `src/ui/win-screen.ts:99-110` switches the message text.
- **Atlas extension coordinate-stable for prior 26 sprites; 3 new at
  next slots** — `src/registries/atlas-recipes.ts:332-353` appends
  fixer / info-broker / boss in that order; coordinate stability is
  asserted by `tests/atlas/registry.test.ts:92-103` (first-seven
  entries pinned) and the 1610-byte regenerated `assets/atlas.png`
  preserves prior `(atlasX, atlasY)` per the row-major packer (verified
  by build-passing + cross-runtime atlas-cross-runtime-digest in
  `src/core/self-test.ts:91-92` matching the pinned `ATLAS_DIGEST`).

### 2. Determinism

- `src/registries/npcs.ts` — pure data, no time/random/floats.
- `src/sim/run.ts` `spawnFloorEntities` — NPC kind chosen via
  `uniformIndex(npcStockPrng, NPC_KINDS.length)`; stock rolled by
  `(npcPrng() & 1)` per stock-table entry. Both consume the
  `streams.npcStock(floorN)` cursor (NEW per-floor stream;
  byte-distinct from `streams.simFloor(floorN)` so existing
  `SIM_DIGEST` stays preserved — `src/core/streams.ts:216-222`). The
  guarantee-at-least-one-stock branch (`run.ts:179-181`) is
  hash-driven and integer-only.
- `src/sim/turn.ts` shop handlers — buy price computed via
  `shopBuyPrice(basePrice, variance, stateHashPre, action)` which
  consumes one `rollU32(_, _, ROLL_DOMAIN_SHOP_PRICE, 0)` call and
  applies `(r % variance)` (integer modulo on the u32). Sell price is
  `>>> 1` integer divide-by-2 with floor-at-1.
- No `Math.random` anywhere in the diff (verified by `grep` over the
  changed files). The single `Math.min` in `turn.ts:603` is the
  pre-existing Phase 6 heal-clamp on integer HP.
- `src/ui/win-screen.ts` is a read-only sink on `RunState` — no PRNG
  consumption, no `Math.*`, no `Date.now`. Calls `fingerprint(...)`
  which is itself deterministic SHA-256.
- `tick()` signature unchanged — no `RunStreams` parameter, so
  per-tick `__consumed`-empty invariant remains structurally enforced
  (Phase 3 frozen-contract item 9). Asserted by `sim-stream-isolation`
  self-test (`src/core/self-test.ts:372-403`).

### 3. Action vocabulary additivity

`src/sim/params.ts:85-114` adds three new string constants
(`talk`/`buy`/`sell`) and a new `ACTION_TYPES_PHASE_7` array that
extends `ACTION_TYPES_PHASE_6`. The wire-tag reuse (TAG_TARGET=0x10 +
TAG_ITEM=0x20) is verified by `tick()` reading
`action.target` / `action.item` via the existing Phase 1 fields — no
`ACTION_VERSION` bump and no new wire tag. The Phase 1 frozen
"additive vocabulary" rule is preserved.

### 4. Sorted-collection invariant on `FloorState.npcs`

`src/sim/run.ts:207-212` sorts `npcs` by `kind ASC` then `(y, x)` — matches the documented invariant. `src/sim/turn.ts:244-252` `npcsReplaceAt` uses `slice` + index replacement which preserves the sort because shop transactions only ever touch the NPC's `inventory`, never its `kind` or `pos`. The sort is trivially preserved on single-NPC-per-floor; the comparator is in place for future multi-NPC cases.

### 5. Boss FSM determinism

`bossPhaseTransition(current, hp, hpMax)` (`turn.ts:290-304`) uses
integer threshold comparison `hp * 100 < hpMax * 66` and `< hpMax * 33`
— no floats, no random. Transition is invoked **only** inside the
`ACTION_TYPE_ATTACK` branch when the target is the boss and `newHp >
0` (`turn.ts:462-465`). The boss is excluded from
`decideMonsterAction`'s idle/chasing FSM by the
`isBossKind(cur.kind)` guard (`turn.ts:833-836`), so monster ticks do
not advance the boss phase. Tests `boss FSM — phase transitions`
(7 cases) cover `phase-1 → phase-2`, `phase-2 → phase-3`, "no
transition above threshold", "phase-3 stays", and an explicit
deterministic-equality test (same input HP → same phase across two
fresh fixtures).

### 6. Atlas coordinate stability

The 3 new recipe modules
(`monster-boss-black-ice.ts`/`npc-fixer.ts`/`npc-info-broker.ts`) are
appended to `ATLAS_RECIPES` after the 26 prior entries
(`src/registries/atlas-recipes.ts:327-353`). The row-major packer in
`src/atlas/generate.ts` slots them at the next 3 grid positions
(`(10,1)`, `(11,1)`, `(12,1)` per the recipe doc-comments). Existing
sprite coordinates are preserved (`tests/atlas/registry.test.ts:92-103`
asserts the first-seven Phase 4 declaration order). The 1610-byte
regenerated `assets/atlas.png` and the bumped `ATLAS_DIGEST`
(`8ca99389…`) plus the 4 preset-seed `expectedHash` values are
mirrored consistently across `src/core/self-test.ts:91-92`,
`src/atlas/preset-seeds.ts:28-46`, and
`tests/e2e/diagnostic.spec.ts:18-49` — the Phase 4 addendum N12
mirror invariant holds.

### 7. Test sufficiency

Each new surface is exercised by behavior-level tests that would fail
if the feature were removed:

- `tests/sim/boss-fsm.test.ts` (7 tests) — covers initial
  `boss-phase-1` spawn, `phase-1→2`, `phase-2→3`, no-transition
  above-threshold, phase-3 sticky, deterministic equality, and
  outcome→won detection.
- `tests/sim/shop.test.ts` (12 tests) — covers `talk` (3 cases:
  state-hash advance + no world mutation, no-target, out-of-range
  ordinal), `buy` (5 cases: happy path, no chips, non-adjacent, no
  stock, deterministic equality), `sell` (3 cases: happy path, no
  item, non-adjacent), and a hash-driven price determinism test
  contrasting two fresh fixtures.
- `tests/ui/win-screen.test.ts` (8 tests) — covers `outcome !==
  "won"` skeleton render, fingerprint/floor/HP fields, won-state
  message swap, and idempotency on re-render.
- `tests/registries/npcs-immutability.test.ts` (8 tests) — pins
  `(id, displayName, basePrice, priceVariance, stockTable)` tuple
  byte-for-byte for all 3 entries; verifies sort order; asserts
  ordinal/id round-trip; rejects unknown ids; cross-references each
  stockTable entry against the items registry.
- `tests/sim/run.test.ts` extensions (6 net-new cases) — covers the
  per-floor `npc-stock:N` stream consumption, NPC count on floors
  1..9 vs floor 10, boss `aiState='boss-phase-1'` on initial spawn.
- `tests/sim/harness.test.ts` extensions — `mapgen:1` + `sim:1` +
  `npc-stock:1` after `buildInitialRunState` (was 2 keys, now 3).
- `tests/atlas/registry.test.ts` — count assertion bumped from 26 to 29.
- `src/core/streams.test.ts` — adds 2 `npcStock` cases (positive
  determinism + invalid-floor branch); closes the line-coverage gap
  on the new accessor.

The testing gate is satisfied: removing any of the new behaviors
(boss FSM transition, shop `buy` chip transfer, win-screen on `outcome
=== "won"`, NPC registry shape) would fail at least one of the new
tests.

### 8. Code quality

- **No hidden constants**: thresholds (66/33), per-phase scaling
  (+1/+0, +2/+1), shop sell-price floor (1) all appear inline with
  named-constant doc-comments. The 66/33 magic numbers are the
  load-bearing frozen-contract values and are documented inline plus
  in `docs/ARCHITECTURE.md:1023-1024`.
- **Type safety**: the `MonsterAIState` union extension is structural;
  the boss handler narrows via `isBossKind(...)`. The `as MonsterAIState`
  cast at `turn.ts:836` is the documented Phase 3→7 contract gap (the
  legacy `decideMonsterAction` returns `"idle" | "chasing"`, which is
  a sub-union, and the cast is widening — safe).
- **Stringly-typed contracts**: `ItemKindId` / `NpcKindId` are typed
  unions; the wire-tag values reuse the Phase 1 frozen tags;
  `npcKindOrdinal` returns `-1` (sentinel) and `npcKindIdAtOrdinal`
  returns `null` (sentinel) — both are documented and tested. Action
  type strings are exported as named constants and consumed via
  identity comparison in the `tick()` switch.
- **Separation of concerns**: domain logic stays in
  `src/sim/turn.ts`; the win-screen renderer in `src/ui/win-screen.ts`
  reads `RunState` only and does not import sim write paths or
  `core/streams`. Registry data is in `src/registries/npcs.ts`.

## Non-blocking nits

**N1 — Pass-through wrappers for `npcInventoryAdd` / `npcInventoryRemove`.**
`src/sim/turn.ts:262-277` defines two wrapper functions whose entire
body is `return inventoryAdd(inv, kind, count)` /
`return inventoryRemove(inv, kind, count)`. The doc-comment claims the
local helpers exist "to avoid a circular import path" but the
implementation just delegates back to the imported helpers (which
*are* successfully imported at `turn.ts:65-69`, so there is no
circular-import problem). The wrappers add no value. Either remove
them and call `inventoryAdd` / `inventoryRemove` directly at the call
sites, or update the comment to reflect what they actually do (i.e.,
nothing). Suggested cleanup in 7.A.2b or a future drift sweep.

**N2 — Underscore-prefixed shop write-staging variables.**
`src/sim/turn.ts:385-386` and the corresponding write-back at
`turn.ts:963` use `_shopNextNpcs` and `_shopNpcsTouched`. The
leading-underscore convention typically signals "intentionally
unused" in TS/ESLint discipline (e.g., `_ctx` in recipe signatures);
these variables are very much used. Recommend renaming to
`shopNextNpcs` / `shopNpcsTouched` for clarity. Cosmetic; not
blocking.

**N3 — Renderer does not yet draw NPCs.**
`src/render/canvas.ts` (the Phase 5.A.2 renderer) does not iterate
`state.floorState.npcs` and therefore never blits NPC sprites onto
the playable-game canvas. The atlas recipes ship (3 new sprites at
`(10,1)`, `(11,1)`, `(12,1)`); the manifest has `npc.fixer` /
`npc.info-broker` / `monster.boss.black-ice-v0` slot ids; the sim
state populates `floorState.npcs`. But the renderer's blit loop only
draws tiles, items, monsters, and the player. The user therefore
cannot visually locate an NPC to walk up to and `talk`/`buy`/`sell`,
which limits the playable surface of 7.A.2a. The atlas recipe and
sim state are correctly in place for a renderer extension; this
appears to be a deliberate scope decision (the win-screen activation
path is unreachable without a winning action log, which is 7.A.2b's
scope, so visually-locating the NPCs is also reasonably 7.A.2b's
problem). Recommend an explicit follow-up note in 7.A.2b or a fresh
drift sweep so the renderer extension lands before live deploy in
7.B. **NOT blocking** because the structural sim contract is
correct and the headless `runScripted` API exercises every shop
behavior without rendering.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is satisfied:

- Every new module / public behavior has at least one test exercising
  its primary path: `boss-fsm.test.ts` for the boss FSM,
  `shop.test.ts` for the three shop handlers, `win-screen.test.ts`
  for the UI panel, `npcs-immutability.test.ts` for the registry
  surface, `run.test.ts` extensions for `spawnFloorEntities` NPC
  placement, `streams.test.ts` extensions for the new `npcStock`
  accessor.
- Test names describe behavior, not implementation: e.g., "transitions
  phase-1 → phase-2 when HP drops below 66% via player attack",
  "transfers item from NPC to player and chips from player to NPC",
  "shows the victory message when state.outcome === 'won'".
- Edge cases covered: out-of-range ordinals, non-adjacent NPC, no
  stock, no chips, no item to sell, invalid floorN range, idempotent
  re-render, unknown id throws, deterministic equality across fresh
  fixtures.
- Coverage thresholds met for every changed module:
  `src/registries/** = 100/100/100/100`,
  `src/ui/win-screen.ts = 100/100/100/100`, `src/sim/** =
  96.53/95/100/90.61` (≥ 95/95/100/85), `src/core/streams.ts`
  remains 100% lines.

The gap: there is no test that asserts a *winning* run produces
`outcome === "won"` end-to-end through `runScripted`, and no
`WIN_DIGEST` golden constant. This gap is explicitly Phase 7.A.2b's
scope per the phase-update.json memo, and the brief instructs not to
block on it. The structural pieces tested in 7.A.2a are exactly the
ones a future winning-log test will exercise; nothing about that
deferred test will require revisiting 7.A.2a's structural surface.

## Approval verdict

**APPROVE WITH NITS.**

No blocking issues. Three non-blocking nits (N1: pass-through wrapper
removal, N2: underscore-prefix rename, N3: NPC rendering follow-up)
appropriate for 7.A.2b or a future drift sweep. All eight review focus
items pass; all four CI gates green; coverage thresholds met; frozen
contracts respected; determinism preserved.

## Files relevant to this review

Source (in scope):

- `/workspace/src/registries/npcs.ts`
- `/workspace/src/sim/types.ts`
- `/workspace/src/sim/params.ts`
- `/workspace/src/sim/combat.ts`
- `/workspace/src/sim/run.ts`
- `/workspace/src/sim/turn.ts`
- `/workspace/src/sim/inventory.ts` (read-only context)
- `/workspace/src/sim/ai.ts` (read-only context)
- `/workspace/src/sim/harness.ts` (read-only context)
- `/workspace/src/core/streams.ts`
- `/workspace/src/core/self-test.ts`
- `/workspace/src/main.ts`
- `/workspace/src/ui/win-screen.ts`
- `/workspace/src/render/canvas.ts` (read-only — flagged in N3)
- `/workspace/src/atlas/recipes/monster-boss-black-ice.ts`
- `/workspace/src/atlas/recipes/npc-fixer.ts`
- `/workspace/src/atlas/recipes/npc-info-broker.ts`
- `/workspace/src/atlas/preset-seeds.ts`
- `/workspace/src/registries/atlas-recipes.ts`

Tests (in scope):

- `/workspace/tests/sim/boss-fsm.test.ts`
- `/workspace/tests/sim/shop.test.ts`
- `/workspace/tests/ui/win-screen.test.ts`
- `/workspace/tests/registries/npcs-immutability.test.ts`
- `/workspace/tests/sim/run.test.ts`
- `/workspace/tests/sim/harness.test.ts`
- `/workspace/tests/atlas/registry.test.ts`
- `/workspace/tests/e2e/diagnostic.spec.ts`
- `/workspace/src/core/streams.test.ts`

Tools (out of `src/` coverage scope per the phase split — flagged in
the phase-update memo, not blocking):

- `/workspace/tools/build-win-log.ts`
- `/workspace/tools/probe-seeds.ts`
- `/workspace/tools/compute-win-digest.ts`

Authoritative references consulted:

- `/workspace/docs/ARCHITECTURE.md:956-1067` (Phase 7 frozen contracts)
- `/workspace/docs/QUALITY_GATES.md`
- Git commit `882a475` `artifacts/phase-update.json` (split rationale)
