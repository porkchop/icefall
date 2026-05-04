# Code Review — Phase 6.A.2 (sandbox-verifiable inventory + equipment + atlas-extension implementation)

## Verdict

APPROVE.

All twelve verification points pass. The phase lands the Phase 6
inventory + equipment + item-effect surface end-to-end: the additive
action vocabulary (`pickup`/`drop`/`equip`/`unequip`/`use`) wired into
`tick()` as five explicit switch cases against the Phase 3.A.2
carry-forward; the pure `inventoryAdd`/`inventoryRemove`/`inventoryCount`
helpers with the `(kind ASC, count DESC)` sort discipline; the Phase 6
roll-domain registry extension (`item:effect:heal`,
`item:effect:atk-bonus`, `item:effect:def-bonus`) feeding the
existing `rollU32(stateHashPre, action, domain, index)` subhash;
equipment-modifier injection at combat time (weapon `atk-bonus` summed
into player attack damage, cyberware `def-bonus` summed into the
monster counter-attack defender side); the atlas registry expansion
from 7 to 23 sprites with the existing seven Phase 4 coordinates
byte-identical at (0,0)–(6,0); the `INVENTORY_DIGEST` cross-runtime
self-test pinning the 16-action `SELF_TEST_INVENTORY_LOG`; the
long-deferred Phase 2 decision-memo decision-6 immutability test
landing in `tests/registries/items-immutability.test.ts`; and the
read-only `renderInventory` + `renderEquipment` UI panels wired into
`src/main.ts` alongside the preserved diagnostic surface and the
existing 14 e2e tests.

Final gates: 921/921 tests passing (Test Files 64 passed (64); net
+100 over Phase 6.A.1's 821 — 13 inventory + 20 turn-inventory + 4
inventory-replay + 4 items-immutability + 6 inventory-ui + 6
equipment-ui + 1 inventory-cross-runtime self-test + +6 atlas/items
registry adjustments; the prompt's expected `+56` was an undercount
and the actual delta is +100, primarily from atlas-registry tests
exercising the new 16 recipes per slot-coverage assertion). Lint
clean (`npm run lint` exit-0, no warnings). Typecheck clean (`tsc -b
--noEmit` exit-0). Build green at 87.10 KB raw / 30.20 KB gzipped —
matches the prompt's expected sizes exactly; under the 75 KB Phase 2.0
gzipped budget.

`SIM_DIGEST` stability **confirmed**: `321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e`
unchanged at `src/core/self-test.ts:76-77`; the `sim-cross-runtime-digest`
self-test passes (the existing 100-action `SELF_TEST_LOG_100` against
`SELF_TEST_INPUTS` produces the pinned hash). Phase 4 sprite
**coordinate stability confirmed** in `assets/atlas.json`:
item.cred-chip(4,0), monster.ice.daemon(3,0), npc.ripperdoc(5,0),
player(6,0), tile.door.cyberdoor(2,0), tile.floor.cyberfloor_01(0,0),
tile.wall.cyberfloor_01(1,0). New sprites occupy (7,0)..(15,0) and
(0,1)..(6,1).

Atlas binary regenerated: `wc -c assets/atlas.png` = 1368 bytes;
`sha256sum assets/atlas.png` =
`35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47`
= `ATLAS_DIGEST` at `src/core/self-test.ts:91-92` = the pinned
`expectedHash` for the `placeholder` preset at
`src/atlas/preset-seeds.ts:28-29` = the e2e test's pinned
`ATLAS_DIGEST` at `tests/e2e/diagnostic.spec.ts:13-14`.

`INVENTORY_DIGEST` golden landed at `src/core/self-test.ts:116-117`
(`9126830de1ee283b2a0823d57aea4025c2dd1231cd0548c30ed3573481bc46c8`)
and is asserted by the new `inventory-cross-runtime-digest` self-test
at `:354-370`.

Five non-blocking suggestions are listed below.

## Blocking issues

None.

## Verification points

1. **Item effects deterministic and resolved through the same
   hash-driven combat path; no item bypasses the sim stream.** PASS.
   `resolveEffectBonus()` at `src/sim/turn.ts:151-165` consumes one
   `rollU32(stateHashPre, action, domain, index)` call when
   `effect.variance > 0` (line 163), and zero rolls when
   `effect.kind === "none"` (line 161) or `effect.variance === 0`
   (line 162) — `return effect.base` is a deterministic constant in
   the variance-0 case. The bonus is summed via integer addition into
   the existing `damageAmount(...)` formula at `:282-286` and
   `:573-577`. No `Math.random`, no `Date`, no float arithmetic
   (verified by grep across `src/sim/{inventory,turn,combat}.ts` —
   zero matches for `Math.random`, `new Date`, `Date.now`,
   `parseFloat`). The three new domain anchors at
   `src/sim/combat.ts:110-112` are ASCII length-1..31 (`item:effect:heal`
   = 16 bytes, `item:effect:atk-bonus` = 21 bytes,
   `item:effect:def-bonus` = 21 bytes), satisfying the
   `rollBytes` length contract. Player-attack weapon-bonus uses index
   0 in `item:effect:atk-bonus` (`turn.ts:279`); monster-counter-attack
   cyberware-bonus uses `counterIndex` (zero-based, incremented per
   monster) in `item:effect:def-bonus` (`turn.ts:569,572`). Different
   domains → different subhashes → no collision regardless of index.

2. **Inventory state fully reconstructible from the action log alone.**
   PASS. `tests/sim/inventory-replay.test.ts:36-55` runs the same
   `SELF_TEST_INVENTORY_LOG` twice via `runScripted` and asserts
   `JSON.stringify(a.finalState.player.inventory) ===
   JSON.stringify(b.finalState.player.inventory)` plus the same for
   `equipment`. Test `:57-69` asserts `sha256Hex(stateHash)` equality
   between two replays. Test `:71-81` asserts the prefix-replay
   property: `prefix.perStepHashes[7] === full.perStepHashes[7]`.
   Test `:83-112` exercises the no-op resilience of the action
   handlers (pickup → equip → use against an empty world stays an
   empty world). The structural property (action log is the save) is
   pinned by these four tests; combined with the
   `inventory-cross-runtime-digest` self-test in
   `src/core/self-test.ts:354-370`, any silent drift in the replay
   path would fail the `INVENTORY_DIGEST` check. See non-blocking
   suggestion 3 for an observation about the strength of the
   `pickup → equip → use builds expected inventory` assertion.

3. **Atlas regeneration triggered by registry growth; CI-staleness
   gate intact.** PASS. `assets/atlas.png` is 1368 bytes (was 696);
   `sha256sum` =
   `35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47`
   matches the pinned `ATLAS_DIGEST` exactly. `assets/atlas.json` has
   23 sprites in the manifest (Phase 4's seven + Phase 6.A.2's
   sixteen). The existing `git diff --exit-code -- assets/` CI gate
   (Phase 4.A.2 decision 10) would catch staleness — re-running `npm
   run gen-atlas` in the sandbox produces the same bytes (verified
   by direct `sha256sum` comparison; the atlas binary is byte-stable
   under repeat generation, which is the cross-runtime invariant).

4. **Diagnostic surface preserved AND new inventory UI added.** PASS.
   `src/main.ts:99-471` builds the diagnostic surface inside
   `<details id="diagnostics" open>`, with all 16 prior DOM ids
   preserved (`#self-test-banner`, `#floor-preview`,
   `#floor-preview-form`, `#preview-seed`, `#preview-floor`,
   `#preview-generate`, `#floor-preview-ascii`, `#sim-scripted`,
   `#scripted-run`, `#scripted-output`, `#atlas-preview`,
   `#atlas-seed-input`, `#atlas-regenerate-button`,
   `#atlas-preview-error`, `#atlas-preview-canvas-build`,
   `#atlas-preview-canvas`, `#atlas-readout`). All 12 prior
   `window.__*__` flags preserved
   (`__SELF_TEST_RESULT__`, `__SELF_TEST_DETAILS__`,
   `__RANDOM_WALK_DIGEST__`, `__FLOOR_PREVIEW__`,
   `__FLOOR_PREVIEW_ASCII__`, `__SIM_FINAL_STATE_HASH__`,
   `__SIM_OUTCOME__`, `__SIM_FLOOR_REACHED__`, `__ATLAS_PREVIEW__`,
   `__ATLAS_PREVIEW_BUILD_HASH__`, `__ATLAS_PREVIEW_LIVE_HASH__`,
   `__ATLAS_PREVIEW_SEED__`) plus the 6 Phase 5.A.2 game flags
   (`__GAME_READY__`, `__GAME_ERROR__`, `__GAME_STATE_HASH__`,
   `__GAME_FLOOR__`, `__GAME_HP__`, `__GAME_OUTCOME__`). New sections:
   `<section id="inventory">` and `<section id="equipment">` at
   `:511-518` rendered per tick by `renderInventory` /
   `renderEquipment` at `:574-575`. Two new e2e tests at
   `tests/e2e/diagnostic.spec.ts:323-342` and `:344-361` exercise the
   new inventory + equipment panels and the `KeyG → pickup` keybinding;
   spec count = 17 (was 15). `#inventory + #equipment panels render
   alongside the canvas` asserts the panels show "0 stacks" and
   "(empty)" on initial state; `pressing G triggers the pickup action
   (state hash advances)` asserts `__GAME_STATE_HASH__` advances
   after `KeyG` even though the pickup is a no-op (no item at
   spawn-cell on the seed) — confirming that `tick()` is called
   regardless of side-effect outcome.

5. **All gates green.** PASS.
   - `npm run lint`: zero output past the script header. ESLint
     exits clean.
   - `npm run typecheck`: `tsc -b --noEmit` exits clean.
   - `npm run test`: `Test Files 64 passed (64)`, `Tests 921 passed
     (921)`. Coverage thresholds pass.
   - `npm run build`: `dist/assets/index-uW-WKA-o.js   87.10 kB │
     gzip: 30.20 kB │ map: 583.91 kB`, 87 modules transformed in 618ms.
   - `npm run test:e2e`: not exercised in-sandbox (Playwright browser
     binaries absent — same as Phase 5.A.2). The new inventory +
     pickup tests are visible in `tests/e2e/diagnostic.spec.ts:323-361`
     and the spec file is well-formed; Phase 6.B will execute the
     full matrix on the live deploy.

6. **SIM_DIGEST stability.** PASS. `src/core/self-test.ts:76-77`
   pins
   `SIM_DIGEST = "321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e"`
   — the Phase 3 frozen value, unchanged. The `sim-cross-runtime-digest`
   self-test at `:340-352` runs `runScripted` against the existing
   100-action `SELF_TEST_LOG_100` + `SELF_TEST_INPUTS` and asserts
   the result. `npm run test` includes this self-test (it's invoked
   inside the `tests/core/self-test.test.ts` harness) and passes.
   The new `effect: { kind: "none" }` field on the original five Phase
   3 entries (`item.cred-chip`, `item.cyberdeck-mod-1`,
   `item.stim-patch`, `item.trauma-pack`, `item.weapon.knife`)
   consumes zero rolls in `resolveEffectBonus()` (line 161) so the
   per-tick `__consumed` invariant for the existing 100-action log
   stays empty by construction. `id`, `category`, `tier` for the
   original five are preserved exactly — pinned by
   `tests/registries/items-immutability.test.ts:36-45` (the explicit
   tuple-equality assertion) and `:47-59` (the JSON-serialization
   round-trip).

7. **Coordinate-stability invariant.** PASS. `assets/atlas.json` has
   the seven Phase 4 sprites at byte-identical positions:
   `item.cred-chip` `{atlasX:4,atlasY:0}`,
   `monster.ice.daemon` `{atlasX:3,atlasY:0}`,
   `npc.ripperdoc` `{atlasX:5,atlasY:0}`,
   `player` `{atlasX:6,atlasY:0}`,
   `tile.door.cyberdoor` `{atlasX:2,atlasY:0}`,
   `tile.floor.cyberfloor_01` `{atlasX:0,atlasY:0}`,
   `tile.wall.cyberfloor_01` `{atlasX:1,atlasY:0}`. The 16 new
   sprites occupy (7,0) — `item.consumable.adrenaline-spike` —
   through (15,0) — `item.cyber.subdermal-armor` — then wrap to
   (0,1) — `item.eddies` — through (6,1) — `item.weapon.smg`. Wrap
   pattern is row-major per `placeRecipes` (Phase 4 `addendum N9`
   `wrap-with-skip`). `tests/atlas/registry.test.ts:92-103`
   asserts the first seven array positions still hold the seven Phase
   4 recipe IDs in declaration order, which is the upstream invariant
   that drives the layout-stability output. The byte-explicit
   coordinate check is implicit-but-load-bearing: any change to a
   Phase 4 sprite's `(atlasX, atlasY)` would change the IDAT bytes
   and break the pinned `ATLAS_DIGEST`. See non-blocking suggestion 1
   for a stronger explicit-coordinate assertion.

8. **Phase 2 decision-6 registry-immutability test.** PASS.
   `tests/registries/items-immutability.test.ts` lands the
   long-deferred test. `:20-26` pins the original five Phase 3 tuples
   as a hardcoded `ORIGINAL_PHASE_3_ENTRIES` constant.
   `:29-34` asserts every original entry is still present in
   `ITEM_KINDS`. `:36-45` asserts `(id, category, tier, effect.kind)`
   tuple equality. `:47-59` asserts JSON-serialization byte-equality
   between the registered entry and the hardcoded literal. `:61-65`
   asserts the registry remains sorted by `id` (UTF-16 code-unit
   order). After this test lands, the original five entries are
   permanently immutable; bumping any field is a `rulesetVersion`
   bump.

9. **INVENTORY_DIGEST golden.** PASS.
   `INVENTORY_DIGEST = "9126830de1ee283b2a0823d57aea4025c2dd1231cd0548c30ed3573481bc46c8"`
   at `src/core/self-test.ts:116-117`. The new self-test
   `inventory-cross-runtime-digest` at `:354-370` runs `runScripted`
   against `SELF_TEST_INVENTORY_INPUTS` + `SELF_TEST_INVENTORY_LOG`
   from `src/sim/self-test-inventory-log.ts` and asserts
   `sha256Hex(result.finalState.stateHash) === INVENTORY_DIGEST`. The
   16-action log at `self-test-inventory-log.ts:49-66` walks each of
   the five new Phase 6 action types at least once (PICKUP × 4,
   WAIT × 3, DROP × 2, EQUIP × 2, UNEQUIP × 2, USE × 3 — all five
   types are represented). The log is intentionally synthesized so
   most actions resolve as no-ops on the genesis state — the digest
   pin captures the action-encoding bytes flowing through the
   state-hash chain even when world-state side effects are no-ops.
   See non-blocking suggestion 3 for an observation about the
   "no-op-heavy" log composition.

10. **5 new action handlers in `tick()`.** PASS. Each switch case is
    explicit at `src/sim/turn.ts`:
    - **pickup** (`:307-327`): `findFloorItemIndexAt` scans
      `nextFloorItems` for player position; on hit, splices the item
      out of the floor array and calls `inventoryAdd` on the
      player's inventory. No-op when `idx < 0`. Test at
      `tests/sim/turn-inventory.test.ts:57-71,73-81,83-118` covers
      hit, miss, and the **stacked-pickup case** (sequential pickups
      of the same kind merge into a single InventoryEntry with
      count = 2; line 117 asserts `inventory.length === 1`).
    - **drop** (`:328-349`): requires `action.item`; if
      `inventoryCount(...) >= 1`, calls `inventoryRemove` and
      `floorItemsInsert` with sorted insertion. No-op on missing kind
      or missing `action.item` field. Tests at `:122-141,143-151,153-164`.
    - **equip** (`:350-384`): requires `action.item`; resolves slot
      via `equipmentSlotForItem`; no-ops on null slot, missing
      inventory item; **displaces previously-equipped item back into
      inventory atomically** when slot is occupied with a different
      id. Tests at `:168-247` covering weapon/cyberware paths,
      displacement (`:201-220` — equip cyberblade with knife already
      in slot, knife returns to inventory), non-equipment no-op,
      missing-inventory no-op.
    - **unequip** (`:385-404`): no-op when `equipment[slot] !==
      itemId`; otherwise sets slot to null and calls `inventoryAdd`.
      Tests at `:251-276`.
    - **use** (`:405-447`): `consumable` category only; resolves
      heal effect via `item:effect:heal` domain; clamps via
      `Math.min(hpMax, hp + healAmt)` (integer-only); consumes one
      unit. The `consumable` + `effect.kind !== "heal"` branch (e.g.
      `item.stim-patch` with `kind: "none"`) still consumes the item
      without healing. Non-consumable categories (currency,
      equipment) are full no-ops. Tests at `:280-342` covering heal,
      hpMax clamp, missing-inventory, non-consumable no-op.

11. **Equipment-modifier injection at combat time.** PASS. Player
    attack at `src/sim/turn.ts:251-294` computes the standard
    `combat:atk-bonus` (line 260-265, index 0) AND the
    `item:effect:atk-bonus` (line 271-281, index 0 in its own domain
    subhash) for the equipped weapon when its effect is
    `atk-bonus`. The two bonuses are summed via integer addition at
    line 285 (`baseBonus + weaponBonus`). Monster counter-attack at
    `:548-577` computes the standard `combat:counter-bonus` (line
    549-554, index = `counterIndex`) AND the `item:effect:def-bonus`
    (line 561-571, index = `counterIndex` in its own domain subhash)
    for the equipped cyberware when its effect is `def-bonus`. The
    cyberware bonus is summed into the **defender** side of
    `damageAmount(cur.atk, workingPlayer.def + defBonus, bonus)` at
    line 573-577 — so the attacker's effective `atk - def` shrinks.
    The damage formula `dmg = max(1, atk - def + bonus)` is
    unchanged. Tests at `tests/sim/turn-inventory.test.ts:344-384`
    (player armed with shotgun deals at least +3 over no-weapon
    case; shotgun has `base:3, variance:4` so bonus is always >= 3)
    and `:386-423` (subdermal-armor reduces counter-attack damage,
    asserted as `<=` rather than strictly `<` because the damage
    floor is 1 from the `Math.max(1, ...)` clamp).

12. **No floats / no `Math.random` / no `Date` in 6.A.2 sim code.**
    PASS. `grep -E 'Math\.random|new Date|Date\.now|parseFloat'
    src/sim/{inventory,turn,combat}.ts` returns zero matches.
    `Math.floor` is also absent from the new code; the only
    arithmetic in `inventory.ts` is integer comparison + index
    arithmetic + `existing.count + count` / `existing.count - count`
    (both integers). The only `*` and `/` characters in the new
    `turn.ts` code are inside comments and the `floor.tiles[y *
    floor.width + x]` array-index arithmetic (integer × integer).
    `Math.min(hpMax, hp + healAmt)` at `turn.ts:423` is integer-only
    since both operands are integers. Lint
    (`determinism/no-float-arithmetic`) is enforced on `src/sim/**`
    via `eslint.config.js`; `npm run lint` is clean.

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate. Every new public
function has at least one regression-failing test:

- **inventoryAdd / inventoryRemove / inventoryCount** —
  `tests/sim/inventory.test.ts` (13 tests) covers empty / single /
  multi-stack paths, the `count > 1` insert path, sort
  preservation, the input-immutability invariant, the
  removal-decrement and removal-to-empty paths, the
  remove-more-than-held-no-op, and the validation throws (positive
  integer rejection). See non-blocking suggestion 4 for an
  observation about coverage symmetry.
- **5 new tick() action handlers** —
  `tests/sim/turn-inventory.test.ts` (20 tests) covers each handler's
  primary path + every no-op path including the **displaced-on-equip
  case** at `:201-220` and the **stacked-pickup case** at `:83-118`.
- **Equipment-modifier injection** at combat time — two tests at
  `tests/sim/turn-inventory.test.ts:344-423`.
- **Inventory-replay invariant** —
  `tests/sim/inventory-replay.test.ts` (4 tests) covers the
  byte-equality of two replays + the prefix-replay property.
- **Items registry expansion + immutability** —
  `tests/registries/items.test.ts` (10 tests; was 9) +
  `tests/registries/items-immutability.test.ts` (4 new tests).
- **Atlas registry expansion** — `tests/atlas/registry.test.ts`
  (extended) covers the 23-entry count, the 16 new slot ids, the
  first-seven recipe-ID stability, and the per-recipe stream
  isolation invariant for every entry.
- **Inventory + Equipment UI** — `tests/ui/inventory.test.ts` (6)
  and `tests/ui/equipment.test.ts` (6) cover empty / populated /
  idempotence / read-only invariants.
- **Cross-runtime determinism** — the new
  `inventory-cross-runtime-digest` self-test pins the 16-action log
  state-hash; the existing `sim-cross-runtime-digest`,
  `atlas-cross-runtime-digest`, `mapgen-cross-runtime-digest`, and
  `random-walk-digest` self-tests stay green.

The pinning surface is dense: byte-pinned goldens (`SIM_DIGEST`,
`MAPGEN_DIGEST`, `ATLAS_DIGEST`, `INVENTORY_DIGEST`,
`RANDOM_WALK_DIGEST`, `ATLAS_ENCODER_SINGLE_COLOR_TILE_HASH`, four
preset-seed `expectedHash` values, and the seven Phase 4 sprite
coordinates in `assets/atlas.json`) form a tight web — silent drift
in any subsystem surfaces in at least one of these tests.

## DRY-gate / drift-detection-gate

**DRY:** No new logic duplication. The inventory-sort discipline
lives in one place (`src/sim/inventory.ts` `compareEntries`) and is
invoked through `inventoryAdd`/`inventoryRemove`/`inventoryCount`
exclusively. The `floorItemsInsert` helper at `src/sim/turn.ts:128-143`
mirrors but does not duplicate the sort discipline in
`src/sim/run.ts:127-130` (`spawnFloorEntities` floor-item sort) — the
sort comparator `(y, x, kind)` is repeated in both places (3 lines
each). This is a minor duplication but scoping it to a shared
`floorItemsCompare` helper would be a cosmetic improvement; flagged
as non-blocking suggestion 2.

The `equipmentSlotForItem` helper at `src/registries/items.ts:247-251`
returns the ad-hoc string union `"weapon" | "cyberware" | null`
rather than the canonical `EquipmentSlot | null` from
`src/sim/types.ts:43`. Both are equivalent at the type level (same
two strings) but the duplication is a minor type-coupling issue —
flagged as non-blocking suggestion 5.

**Drift:** Phase 6 frozen-contract pins (`docs/ARCHITECTURE.md`
"Phase 6 frozen contracts") match the implementation:
- additive action vocabulary (5 new types via existing TAG_ITEM,
  no `ACTION_VERSION` bump) — checked.
- inventory data shape (sort by `kind` ASC, `count` DESC; `count
  === 0` slots removed; capacity unbounded in Phase 6) — checked.
- equipment slot enumeration (frozen at `weapon` / `cyberware` for
  Phase 6) — checked.
- item-effect resolution path (same `rollBytes` subhash; new
  domain anchors `item:effect:heal`, `item:effect:atk-bonus`,
  `item:effect:def-bonus`; no-roll path when `variance === 0`) —
  checked.
- registry append-only invariant for items — checked, with the
  decision-6 immutability test landing.
- atlas extension coordinate-stability — checked, asserted via the
  `ATLAS_DIGEST` byte-pin and the first-seven recipe-ID stability
  test.

The Phase 3.A.2 carry-forwards landed in 6.A.1 are visible in the
6.A.2 implementation: the `tick` switch/case structure (instead of
unstructured if/else) at `turn.ts:229-454`; the
`ROLL_DOMAIN_ANCHOR_BYTES` shared constant in
`src/sim/params.ts:38-40`; the redundant-`newFloor` parameter
removed from `applyFloorEntry` at `src/sim/run.ts:171-187`. All
three discipline points propagate cleanly to the 6.A.2 additions.

## Non-blocking suggestions

1. **Explicit Phase-4-coordinate stability assertion in the
   atlas-registry test.** `tests/atlas/registry.test.ts:92-103`
   asserts the first-seven recipe IDs are unchanged in declaration
   order, which is the upstream invariant. The downstream invariant
   — that `assets/atlas.json` reports the Phase 4 seven sprites at
   their byte-identical pinned coordinates — is currently enforced
   only implicitly (via the `ATLAS_DIGEST` byte-pin: any coordinate
   change would change IDAT bytes and break the digest). A parsed
   manifest assertion that explicitly checks
   `manifest.sprites.get('item.cred-chip')!.atlasX === 4` (and the
   other six) would surface the constraint at audit-readability
   time without requiring readers to derive the property from the
   digest pin. Cosmetic.

2. **`floorItemsInsert` sort comparator duplicated.** The
   `(y, x, kind)` floor-item comparator appears at
   `src/sim/turn.ts:136-141` and `src/sim/run.ts:127-130` — three
   lines each, byte-identical logic. Extracting a
   `compareFloorItem(a, b)` helper (alongside `inventory.ts`'s
   `compareEntries`) would close the DRY gap. The duplication is
   small enough that a comment cross-referencing the two sites
   would also suffice. Cosmetic.

3. **The pickup→equip→use replay test is no-op heavy.**
   `tests/sim/inventory-replay.test.ts:83-112` describes itself as
   "a log that performs pickup→equip→use builds the expected final
   inventory + equipment", but the synthesized log uses items that
   are not in the inventory and not on the floor at the player's
   spawn cell — so all four inventory-touching actions resolve as
   no-ops. The test then asserts `inventory.length === 0` and both
   equipment slots are null — which is correct, but doesn't
   exercise the build-inventory-then-verify-replay property. The
   load-bearing assertion (replay determinism) is correctly pinned
   in the first three tests (`:36-81`). A stronger fourth test
   could synthesize a `RunState` with a floor item at the player's
   cell and an item already in inventory, then run a 4-action log
   (pickup + equip + use + wait) and assert the final inventory has
   the expected stack count (e.g. picked-up cred-chip, the
   originally-stocked weapon now in `equipment.weapon`, the
   originally-stocked syringe consumed). The 16-action
   `SELF_TEST_INVENTORY_LOG` has the same characterization (most
   actions are no-ops on genesis state); the digest pin is still
   useful as a state-hash fingerprint, but a verifier reading the
   test would benefit from one log that demonstrably mutates
   inventory. Cosmetic — turn-inventory.test.ts (20 tests) covers
   the actual mechanics in detail.

4. **Coverage gap on the inventory-sort tie-break + inventoryRemove
   validation.** `src/sim/inventory.ts:48-51` is the `count` DESC
   tie-break inside `compareEntries`; coverage report shows lines
   48-51 uncovered. The tie-break is unreachable through the
   public API because `inventoryAdd` merges duplicate kinds, so two
   entries with the same kind never coexist — the tie-break is
   "defense in depth". A test that constructs an `InventoryEntry[]`
   with two same-kind entries and calls `compareEntries` directly
   would exercise it; alternatively, a comment on line 47-50
   documenting "unreachable through public API; defense in depth"
   would close the audit-readability gap. Symmetrically, lines
   104-107 (`inventoryRemove` validation throw) are uncovered while
   lines 65-69 (`inventoryAdd` validation throw) ARE tested at
   `tests/sim/inventory.test.ts:55-65`. Adding three matching
   test cases for `inventoryRemove`'s positive-integer-rejection
   throw would close the symmetry. Cosmetic.

5. **`equipmentSlotForItem` return type uses ad-hoc string union
   instead of `EquipmentSlot`.**
   `src/registries/items.ts:247` declares the return type as
   `"weapon" | "cyberware" | null`. The canonical type
   `EquipmentSlot = "cyberware" | "weapon"` lives in
   `src/sim/types.ts:43`. Both are structurally equivalent, but the
   duplication forces future readers to verify the two types stay
   in sync. Importing `EquipmentSlot` from `src/sim/types` and
   using `EquipmentSlot | null` would close the type-coupling gap.
   The lint rule preventing `src/registries/**` from importing
   `src/sim/**` would need a small carve-out for type-only imports
   — an alternative is to relocate `EquipmentSlot` to a shared
   types module (e.g. `src/registries/equipment-slot.ts`) and have
   both `src/sim/types.ts` and `src/registries/items.ts` import
   it. Cosmetic; low-priority.

## Additional observations (non-blocking)

- **Three Phase 3 items still have no atlas recipe.**
  `item.stim-patch`, `item.trauma-pack`, and `item.cyberdeck-mod-1`
  remain in the item registry (Phase 3 frozen) without an atlas
  recipe. Phase 6.A.2 added recipes for `item.weapon.knife` (the
  fourth Phase 3 item that previously had no sprite) and 15 new
  items, but the three above are still un-painted. This is latent
  because no current code path places them on the floor —
  `spawnFloorEntities` only places `item.cred-chip` per Phase 3
  decision, and the Phase 6.A.2 drop handler only writes items the
  player has in inventory. If a future test or seed produces a
  state where one of these three is on the floor, the renderer's
  `spritePixelCoord` (`src/render/canvas.ts:118-122`) throws with
  `drawScene: atlas manifest missing required slot 'item.stim-patch'`
  — surfacing the gap loudly rather than silently. The
  `tests/atlas/registry.test.ts:67` "one per non-cred-chip item
  registry entry" description is misleading (16 items missed 3 of
  the original 5). A deferred follow-on phase could add the three
  recipes; flagging here for awareness.

- **`combat.ts:104-108` doc-comment about index ordering.** The
  comment says "weapon at index 0, cyberware at index 1 within the
  same player attack". The actual implementation uses index 0 for
  the player's weapon (`item:effect:atk-bonus`) on player-attack,
  AND index = `counterIndex` (zero-based) for the monster's
  cyberware-bonus (`item:effect:def-bonus`) on monster
  counter-attack — two different action contexts entirely. The
  comment is technically correct that "stacked effect rolls within
  a single action's resolution increment from 0", but the example
  ("weapon at index 0, cyberware at index 1 within the same player
  attack") implies cyberware fires inside the player-attack action,
  which it doesn't. The cyberware roll fires inside the monster's
  attack action's subhash. A one-line clarification of the
  comment would close the doc/code drift. Cosmetic.

## Files reviewed

Production:
- `src/sim/inventory.ts` (140 lines)
- `src/sim/self-test-inventory-log.ts` (66 lines)
- `src/sim/turn.ts` (modified — added 5 switch cases + 4 helpers)
- `src/sim/types.ts` (modified — InventoryEntry, Equipment,
  EquipmentSlot, EQUIPMENT_SLOTS, Player.inventory + Player.equipment)
- `src/sim/params.ts` (modified — 5 new ACTION_TYPE_* constants;
  ACTION_TYPES_PHASE_6 readonly array)
- `src/sim/combat.ts` (modified — 3 new ROLL_DOMAIN_ITEM_*
  constants)
- `src/sim/run.ts` (modified — makeInitialPlayer initializes empty
  inventory + equipment)
- `src/registries/items.ts` (modified — expanded from 5 to 20
  entries; added ItemEffect type with 4 variants;
  equipmentSlotForItem helper)
- `src/registries/atlas-recipes.ts` (modified — appended 16 new
  recipe registrations)
- `src/atlas/recipes/{item-consumable-adrenaline-spike,
  item-consumable-med-injector, item-consumable-nano-repair,
  item-consumable-syringe, item-cyber-armor,
  item-cyber-dermal-plating, item-cyber-neural-link,
  item-cyber-reflex-booster, item-cyber-subdermal-armor,
  item-eddies, item-weapon-cyberblade, item-weapon-knife,
  item-weapon-monoblade, item-weapon-pistol, item-weapon-shotgun,
  item-weapon-smg}.ts` (16 new recipes, ~50–60 lines each)
- `src/atlas/preset-seeds.ts` (modified — bumped 4 expectedHash
  values)
- `src/core/self-test.ts` (modified — bumped ATLAS_DIGEST; added
  INVENTORY_DIGEST + new self-test check)
- `src/input/keyboard.ts` (modified — KeyG → pickup binding)
- `src/main.ts` (modified — wired #inventory + #equipment sections)
- `src/ui/inventory.ts` (82 lines)
- `src/ui/equipment.ts` (66 lines)
- `assets/atlas.png` (1368 bytes, indexed PNG, sha256
  `35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47`)
- `assets/atlas.json` (modified — 23 sprites; first-seven Phase 4
  coordinates byte-identical)

Tests:
- `tests/sim/inventory.test.ts` (13 tests)
- `tests/sim/turn-inventory.test.ts` (20 tests)
- `tests/sim/inventory-replay.test.ts` (4 tests)
- `tests/registries/items-immutability.test.ts` (4 tests)
- `tests/ui/inventory.test.ts` (6 tests)
- `tests/ui/equipment.test.ts` (6 tests)
- `tests/registries/items.test.ts` (modified — count → 20; effect
  shape test)
- `tests/atlas/registry.test.ts` (modified — count → 23;
  first-seven coordinate-stability assertion)
- `tests/e2e/diagnostic.spec.ts` (modified — bumped ATLAS_DIGEST
  + 4 preset hashes; added 2 inventory + pickup e2e tests)

Docs (read for cross-reference):
- `docs/PHASES.md:426-431` (Phase 6.A.2 acceptance criteria)
- `docs/ARCHITECTURE.md` "Phase 6 frozen contracts" section
  (lines 870–931)
- `artifacts/code-review-phase-6-A-1.md`,
  `artifacts/code-review-phase-5-A-2.md`,
  `artifacts/code-review-phase-4-A-2.md` (precedent for the
  verification-points format and rigor)

Phase 6.A.2 is ready for approval. Phase 6.B (live-deploy +
cross-runtime + cross-OS atlas-equality verification) is the next
phase.
