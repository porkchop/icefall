# Code Review — Phase 7.A.1 (drift-detection sweep)

## Verdict

APPROVE.

All seven verification points pass. The sweep closes Phase 6.A.2
code-review nit N4 (the 3 Phase 3 items lacking atlas recipes) by
shipping `src/atlas/recipes/item-stim-patch.ts`,
`src/atlas/recipes/item-trauma-pack.ts`, and
`src/atlas/recipes/item-cyberdeck-mod-1.ts`; appending three entries
to `ATLAS_RECIPES` at positions 23..25 with matching `AtlasSlotId`
extensions and slot ids that exactly mirror the canonical
`ItemKindId` strings (`item.stim-patch`, `item.trauma-pack`,
`item.cyberdeck-mod-1` — see `src/registries/items.ts:43,44,41`);
regenerating the atlas to 1457 bytes / sha256
`a3f7e3caa857b5edbd1728a874b858484e58150658277a54dc9506f0489edb08`;
bumping `ATLAS_DIGEST` + the four preset-seed `expectedHash` values
literally in `src/core/self-test.ts:92`,
`src/atlas/preset-seeds.ts:28-46`, and
`tests/e2e/diagnostic.spec.ts:17,27,33,39,45`; bumping the registry
count test from 23 to 26 in `tests/atlas/registry.test.ts:21-22`;
and appending a ~110-line "Phase 7 frozen contracts (NPCs + shops +
boss)" section to `docs/ARCHITECTURE.md:956-1067` between the
Phase 6 frozen-contracts section and "Build-time constants".

**Coordinate stability confirmed** for the existing 23 Phase 4 +
6.A.2 sprites: a row-major dump of `assets/atlas.json` (16-wide grid
per `src/atlas/params.ts:22`) shows the existing entries at the same
`(atlasX, atlasY)` they held under HEAD@5f7823e (verified by
parsing both `git show HEAD:assets/atlas.json` and the working-tree
file: positions (0,0)..(6,0) for the Phase 4 seven, (7,0)..(15,0)
for the Phase 6.A.2 row-0 fillers, and (0,1)..(6,1) for the
remaining Phase 6.A.2 weapon/eddies entries — all byte-identical).
The 3 new sprites occupy `(7,1)`, `(8,1)`, `(9,1)` — the next
available row-major cells per `placeRecipes` at
`src/atlas/layout.ts:38-69`. (Note: the comment in
`tests/e2e/diagnostic.spec.ts:13` claims `(16,1), (0,2), (1,2)`,
which is **incorrect** as written — see suggestion 1.)

Final gates: `npm run lint` exit-0 (no warnings); `npm run typecheck`
exit-0 (`tsc -b --noEmit`); `npm run test` exits 0 with `Test Files
64 passed (64)` / `Tests 921 passed (921)` (matches the brief's
expected 921 — pure refactor + content sweep, no net-new tests);
`npm run build` succeeds at 88.71 KB raw / 30.47 KB gzipped (matches
the brief's expected sizes exactly; +1.61 KB raw / +0.27 KB gzipped
vs Phase 6.A.2's 87.10 KB / 30.20 KB; well under the 75 KB Phase 2.0
gzipped budget — the gzipped delta of 0.27 KB across 3 new recipe
modules is in line with Phase 6.A.2's 16-recipe delta proportionally).

`SIM_DIGEST` stability confirmed: still
`321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e`
at `src/core/self-test.ts:92` (sim path untouched; the cross-runtime
self-test battery exercises the unchanged 100-action SELF_TEST_LOG).
The Phase 7.A.1 acceptance criterion's "no net-new NPC / shop /
boss-FSM code" is honored: `git status --short` shows zero new files
under `src/sim/`, no modifications to `src/sim/turn.ts` or
`src/sim/types.ts`, and no shop-logic plumbing — the only net-new
files are three atlas-pipeline recipe modules under
`src/atlas/recipes/`, which is content-pipeline carry-forward, not
NPC/shop/boss code.

Two non-blocking findings below: (1) the diagnostic.spec.ts comment
miscalls the new sprite coordinates as `(16,1)/(0,2)/(1,2)` when
they actually land at `(7,1)/(8,1)/(9,1)`; (2) the registry append
order (stim-patch, trauma-pack, cyberdeck-mod-1) is not alphabetical
— intentional per the append-only contract, but the cosmetic
ordering nit may surface in a future review.

## Blocking issues

None.

## Verification points

1. **3 missing recipes added.** PASS. `src/atlas/recipes/item-stim-patch.ts:15-54`,
   `src/atlas/recipes/item-trauma-pack.ts:15-58`, and
   `src/atlas/recipes/item-cyberdeck-mod-1.ts:15-54` each export a
   single recipe function with the canonical
   `(prng: PRNG, palette: Palette, _ctx: RecipeContext) => Uint8Array`
   signature, matching the existing recipe shape from Phase 6.A.2
   (e.g., `src/atlas/recipes/item-consumable-syringe.ts`). Each
   allocates a `new Uint8Array(TILE_SIZE * TILE_SIZE)` (16 × 16 = 256
   bytes — confirmed by the buffer arithmetic). Each consumes one
   `prng()` call per cell in its noise/sparkle region via
   `valueNoise2D(prng, x, y)` (stim-patch:
   8 cells = `for y in 4..11 × x in 7..8`; trauma-pack:
   16 cells = `for y in 5..6 × x in 4..11`; cyberdeck-mod-1:
   8 cells = `for y in 6..7 × x in 6..9`), keeping the PRNG cursor
   advancement deterministic per addendum N3.

   `src/registries/atlas-recipes.ts:57-59` adds the three imports;
   `:90-92` extends the `AtlasSlotId` union with the three new slot
   ids; `:285-306` appends three Object.frozen entries at positions
   23..25 with `tilesWide: 1` / `tilesHigh: 1` and recipe IDs
   matching `ATLAS_RECIPE_ID_REGEX` at `:113-114`
   (`atlas-recipe.cyberpunk.item.stim-patch`, etc.). The slot ids
   `item.stim-patch`, `item.trauma-pack`, `item.cyberdeck-mod-1`
   match the canonical `ItemKindId` strings at
   `src/registries/items.ts:43,44,41` exactly — the renderer can
   look them up directly via `floorItem.kind` per the Phase 6 frozen
   contract.

   The brief's claim of "alphabetical order (cyberdeck-mod-1,
   stim-patch, trauma-pack)" does not match the actual append order
   (stim-patch → trauma-pack → cyberdeck-mod-1). This is **correct**
   for the append-only contract — alphabetical insertion would shift
   coordinates of later-Phase-6.A.2 sprites — but the brief's
   description is incorrect. See suggestion 2.

2. **Atlas regenerated correctly.** PASS. `stat -c '%s' assets/atlas.png`
   reports 1457 bytes; `sha256sum assets/atlas.png` reports
   `a3f7e3caa857b5edbd1728a874b858484e58150658277a54dc9506f0489edb08`
   (exact match to brief). `assets/atlas.json` parses to 26 sprite
   entries (`Object.keys(atlas.sprites).length === 26`).

   **Coordinate stability of the existing 23 sprites verified
   byte-identically.** A row-major comparison (`atlasY` ASC,
   tie-break `atlasX` ASC) of the working tree vs `git show
   HEAD:assets/atlas.json`:
   - Phase 4 seven: `tile.floor.cyberfloor_01(0,0)`,
     `tile.wall.cyberfloor_01(1,0)`, `tile.door.cyberdoor(2,0)`,
     `monster.ice.daemon(3,0)`, `item.cred-chip(4,0)`,
     `npc.ripperdoc(5,0)`, `player(6,0)` — unchanged.
   - Phase 6.A.2 sixteen at `(7,0)..(15,0)` and `(0,1)..(6,1)` —
     unchanged byte-for-byte (consumables row 0; cyber + eddies +
     weapons row 1).
   - Phase 7.A.1 three new entries: `item.stim-patch(7,1)`,
     `item.trauma-pack(8,1)`, `item.cyberdeck-mod-1(9,1)`.

   The 16-wide row-major packer at `src/atlas/layout.ts:38-69`
   places the 24th, 25th, 26th entries at indexes 23, 24, 25 →
   `(col=23%16=7, row=23/16=1)`, `(8,1)`, `(9,1)` exactly as
   observed. The brief's claim of "(16,1), (0,2), (1,2)" is
   inconsistent with both the packer code and the regenerated
   manifest — the comment at `tests/e2e/diagnostic.spec.ts:13`
   inherits the same error. See suggestion 1.

   `assets/atlas.json:1` also bumps the embedded `atlasBinaryHash`
   field from `35069834…` to `a3f7e3ca…` — matches the PNG hash and
   the bumped `ATLAS_DIGEST` exactly (the json-side hash and the
   self-test constant are pinned to the same value by construction).

3. **Goldens bumped in three places.** PASS.
   - `src/core/self-test.ts:91-92` — `ATLAS_DIGEST` =
     `"a3f7e3caa857b5edbd1728a874b858484e58150658277a54dc9506f0489edb08"`.
   - `src/atlas/preset-seeds.ts:28-46` — placeholder
     `"a3f7e3ca…"`, variant-A `"5fea9dee…"`, variant-B
     `"61f8b72f…"`, variant-C `"51ac6293…"` (all four entries
     bumped).
   - `tests/e2e/diagnostic.spec.ts:16-17` — top-level `ATLAS_DIGEST`
     mirrors `self-test.ts`; `:22-47` — the `PRESET_HASHES` array
     entries match `preset-seeds.ts:28-46` exactly (each `id` /
     `seed` / `expectedHash` triple).

   The placeholder preset's `expectedHash` (a3f7e3ca…) equals
   `ATLAS_DIGEST` (a3f7e3ca…) because the placeholder uses
   `ATLAS_SEED_DEFAULT` (`src/atlas/preset-seeds.ts:27` →
   `src/atlas/params.ts:51`) and the Phase 4 frozen contract is that
   `ATLAS_DIGEST` is the SHA-256 of `generateAtlas(ATLAS_SEED_DEFAULT).png`.
   Verified.

   `tests/atlas/registry.test.ts:21-22` bumps the count assertion
   from 23 to 26 with an updated test name documenting the Phase
   7.A.1 carry-forward additions.

4. **No net-new NPC/shop/boss-FSM code.** PASS. `git status --short`:
   ```
   D artifacts/phase-update.json
    M assets/atlas.json
    M assets/atlas.png
    M docs/ARCHITECTURE.md
    M src/atlas/preset-seeds.ts
    M src/core/self-test.ts
    M src/registries/atlas-recipes.ts
    M tests/atlas/registry.test.ts
    M tests/e2e/diagnostic.spec.ts
    M tsconfig.tsbuildinfo
   ?? src/atlas/recipes/item-cyberdeck-mod-1.ts
   ?? src/atlas/recipes/item-stim-patch.ts
   ?? src/atlas/recipes/item-trauma-pack.ts
   ```
   - Zero new files under `src/sim/` (no `npcs.ts`, no `boss.ts`).
   - No modifications to `src/sim/turn.ts`, `src/sim/types.ts`,
     `src/sim/run.ts`, `src/sim/inventory.ts`, `src/sim/combat.ts`,
     `src/sim/ai.ts`, or `src/sim/harness.ts`.
   - Zero new shop-logic files (no `src/sim/shop*.ts`,
     `src/registries/npcs.ts`, `src/ui/shop*.ts`,
     `src/ui/win-screen.ts`).
   - The 3 net-new files are atlas-pipeline content (`src/atlas/recipes/*.ts`),
     which is the carry-forward fix per the brief. The deletion of
     `artifacts/phase-update.json` is the host-wrapper consumption
     per the brief; the file is preserved in commit `5f7823e`.
   - `tsconfig.tsbuildinfo` is a build artifact, not source.

5. **`docs/ARCHITECTURE.md` Phase 7 section.** PASS.
   `docs/ARCHITECTURE.md:956-1067` is the new
   "Phase 7 frozen contracts (NPCs + shops + boss)" section,
   positioned between "Phase 6 frozen contracts" (ending `:954`)
   and "Build-time constants" (starting `:1069`). Coverage:
   - **NPC data shape** at `:970-988`: `FloorState` gains
     readonly `npcs` sorted by `kind ASC` tie-break `(y,x)`;
     `NpcKindId` union (`npc.ripperdoc | npc.fixer |
     npc.info-broker`); `FloorNpc` carries `kind | pos |
     inventory: readonly InventoryEntry[]`; explicit "no
     `hp`/`atk`/`def` — distinct from Monsters" callout at
     `:973-976`.
   - **Shop interaction action vocabulary** at `:990-1001`:
     2-4 additive `Action.type` strings (talk/buy/sell), explicit
     "reuse existing TAG_TARGET=0x10 + TAG_ITEM=0x20 wire tags —
     no ACTION_VERSION bump per the Phase 1 frozen 'additive
     vocabulary' rule" at `:998-1000`. This is the byte-explicit
     wire format the PHASES.md:517 acceptance criterion requires.
   - **Deterministic shop-transaction resolution** at `:1003-1018`:
     `rollBytes` subhash with two new domain anchors
     (`shop:stock` rolled at floor-spawn time;
     `shop:price` at action time), 7-bit ASCII length 1..31 bytes
     conformance check, "No `Math.random` for stock generation"
     callout, "stock rolled per-floor (`streams.simFloor`), not
     per-action — keeps the per-action `__consumed` empty
     invariant intact" — preserves the Phase 3 frozen contract
     item 9.
   - **Boss FSM contract** at `:1020-1031`: extension to
     `Monster.aiState` adding `boss-phase-1 | boss-phase-2 |
     boss-phase-3`; HP-threshold transitions (deterministic; no
     random); per-phase atk/def scaling pinned in the registry.
   - **Boss-room spawn override** at `:1033-1037`: wires
     `spawnFloorEntities(10, floor, streams)` to place the boss
     at `bossArena.center`; no mapgen-level changes.
   - **Win-state transition** at `:1039-1047`: `src/ui/win-screen.ts`
     reads `state.outcome === "won"`; replayability invariant
     re-asserted; new `tests/sim/boss-replay.test.ts` planned.
   - **Atlas extension coordinate-stable for Phases 4 + 6.A.2** at
     `:1049-1058`: existing 26 sprite coordinates remain unchanged
     (Phase 4's 7 + Phase 6.A.2's 16 + Phase 7.A.1's 3); 7.A.2
     adds ~4 NPC + boss recipes that APPEND.
   - `ATLAS_DIGEST` after Phase 7.A.1 at `:1060-1064`: pinned to
     `a3f7e3ca…`.
   - **Deferred Phase 7 contracts** at `:1066-1075`: exact action
     vocabulary (single `talk` vs discrete `buy`/`sell`), boss-FSM
     phase count + scaling values, win-screen layout +
     fingerprint format, NPC dialog text — all sensibly deferred
     to 7.A.2 / Phase 8 / Phase 9 polish.

6. **Phase 6.A.2 cosmetic carry-forwards N1/N2/N3/N5.** PASS
   (deferred). `git diff --stat HEAD` shows no modifications to
   `src/sim/inventory.ts`, `tests/sim/inventory.test.ts`,
   `tests/sim/inventory-replay.test.ts`, or `src/sim/turn.ts` —
   the four files where the N1 (count DESC tie-break test), N2
   (`inventoryRemove` validation throw test), N3 (deeper
   inventory-replay mutation), and N5 (per-domain index comment)
   carry-forwards would land. Per the Phase 7.A.1 acceptance
   criterion at PHASES.md:516, these are deferred to 7.A.2 if those
   files are touched (which they will be — 7.A.2 ships the
   shop-transaction inventory mutation logic). Acceptable. The
   deferral is consistent with the Phase 6.A.1 → 6.A.2 pattern (the
   Phase 5.A.2 N1 carry-forward landed in 6.A.1 because canvas.ts
   was touched; the Phase 3.A.2 carry-forwards landed in 6.A.1 for
   the same reason).

7. **Final gates green.** PASS.
   - `npm run lint` exits 0; output is exactly the `eslint .`
     script header with no warnings or errors.
   - `npm run typecheck` (`tsc -b --noEmit`) exits 0 silently.
   - `npm run test` exits 0 with `Test Files 64 passed (64)` /
     `Tests 921 passed (921)` — exactly the brief's expected 921
     (no net-new tests; refactor + content-only sweep). Coverage
     on `src/atlas/recipes/**` reports 100% statements / 100%
     branches / 100% functions / 100% lines (verified in the
     coverage table tail at `tasks/bl9r5i7sc.output` —
     atlas-recipes.ts row reads `100|100|100|100`). The 3 new
     recipes are exercised implicitly via the atlas regeneration
     path: the count assertion at `tests/atlas/registry.test.ts:22`
     forces every recipe to be packed, the byte-explicit
     ATLAS_DIGEST + 4 preset hashes round-trip the full
     `generateAtlas` pipeline through the cross-runtime self-test
     battery, and the slot-id alphabet at
     `src/registries/atlas-recipes.ts:90-92` is type-checked at
     compile time. Per-recipe goldens are not required (Phase
     6.A.2 also added 16 recipes without per-recipe unit tests
     since the whole-atlas ATLAS_DIGEST + per-OS matrix are the
     load-bearing assertions).
   - `npm run build` succeeds: `dist/assets/index-Cwtldseu.js
     88.71 kB / gzip 30.47 kB / map 594.40 kB`. Bundle delta vs
     Phase 6.A.2's 87.10 KB / 30.20 KB: +1.61 KB raw / +0.27 KB
     gzipped — well under the 75 KB Phase 2.0 gzipped budget. The
     0.27 KB gzipped delta from 3 new recipe modules is in line
     with Phase 6.A.2's 16-recipe gzipped delta (~1.4 KB) divided
     by ~5.3, which scales correctly (each recipe is ~50-60 bytes
     gzipped of post-tree-shaking code).

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate.

The 3 new recipes are exercised by the existing whole-atlas
regeneration pipeline:
- `src/registries/atlas-recipes.ts` is the single source of truth
  for the recipe registry; the count assertion at
  `tests/atlas/registry.test.ts:21-23` (`expect(ATLAS_RECIPES.length).toBe(26)`)
  would fail if any recipe import was dropped or any registry entry
  was removed.
- The `regex` test at `tests/atlas/registry.test.ts:25-29`
  ("every entry has a regex-conforming recipe ID") would fail if a
  new recipe id violated `ATLAS_RECIPE_ID_REGEX` — the three new
  ids (`atlas-recipe.cyberpunk.item.stim-patch` etc.) are confirmed
  to match by structure.
- The `tests/atlas/preset-seeds.test.ts` battery exercises all four
  preset seeds end-to-end (re-runs `generateAtlas(seed)` and
  asserts the SHA-256 matches the pinned `expectedHash`); a
  byte-drift in any new recipe's pixel output would fail all four
  preset assertions immediately.
- The `src/core/self-test.test.ts` battery includes the
  cross-runtime `ATLAS_DIGEST` pinning (`atlas-cross-runtime-digest`);
  drift in any recipe's pixel output would fail this test in every
  runtime.
- The `tests/e2e/diagnostic.spec.ts` Playwright suite (Phase 6.B
  cross-runtime) re-asserts `ATLAS_DIGEST` + 4 preset hashes on
  the live deployed page; a byte-drift would fail in
  chromium/firefox/webkit (and the Phase 4.B `cross-os-atlas-equality`
  matrix would fail on macOS/Windows).

The PRNG-cursor advancement contract from addendum N3 is enforced
by all three new recipes:
- `recipeItemStimPatch` calls `valueNoise2D(prng, x, y)` exactly
  8 times (one per cell in `y in [4..11], x in [7..8]`).
- `recipeItemTraumaPack` calls it exactly 16 times (`y in [5..6],
  x in [4..11]`).
- `recipeItemCyberdeckMod1` calls it exactly 8 times (`y in
  [6..7], x in [6..9]`).
A typo in any loop bound would shift the PRNG cursor and silently
re-roll every subsequent recipe's pixel output — caught by the
ATLAS_DIGEST assertion at the next test run.

No new module went untested. No regression test elided. Phase 7.A.1
adds zero behavior surface (it is a content-only carry-forward fix
plus a doc addition); the testing gate's "every new public behavior
has a test" criterion is satisfied via the whole-atlas regeneration
goldens.

## DRY-gate / drift-detection-gate

**DRY:** The 3 new recipes follow the same `(prng, palette, _ctx) =>
Uint8Array` signature and the same `paletteIndex` + `rectMask` +
`valueNoise2D` primitives shared with the Phase 6.A.2 recipe corpus
(e.g., `src/atlas/recipes/item-consumable-syringe.ts`). No new
primitives introduced; no recipe scaffolding duplicated. The PRNG
cursor advancement pattern (one `valueNoise2D` call per cell in the
sparkle region) matches the Phase 6.A.2 recipes verbatim.

**Drift:** This phase IS the drift-prevention play — closing the
nit N4 latent-throw risk before Phase 7.A.2's shop NPCs can stock
the 3 missing items. The new ARCHITECTURE.md section pins the
boundaries Phase 7.A.2 will respect:
- The `npcs` sort discipline (`kind ASC`, tie-break `(y,x)`) at
  `:973` is the parallel of the Phase 3 monster sort at
  `src/sim/types.ts` and the Phase 6 inventory sort at
  `src/sim/inventory.ts` — a 7.A.2 builder cannot accidentally
  introduce an unsorted collection.
- The "no ACTION_VERSION bump for additive types reusing existing
  tags" callout at `:998-1000` re-anchors the Phase 1 frozen
  contract; a 7.A.2 builder cannot accidentally introduce a new
  TAG_* byte for `buy`/`sell` (TAG_TARGET=0x10 + TAG_ITEM=0x20 are
  already in `src/core/encode.ts`).
- The "stock rolled per-floor, not per-action" rule at `:1011-1015`
  preserves the Phase 3 frozen `__consumed`-empty invariant.
- The `bossArena` reuse at `:1033-1037` cites the existing Phase 2
  mapgen slot — preventing a 7.A.2 builder from inventing a
  parallel boss-room placement strategy.

The `lint-rule inventory at ARCHITECTURE.md:1100-1147` does not yet
have rows for the Phase 7 contracts (no NPC-sort enforcement, no
shop-domain registry-extension lint). Consistent with the section
text at `:961-963` saying these contracts are "refined as 7.A.2's
implementation lands" — but a future review could call this out as
a follow-up if the 7.A.2 implementation lands without lint coverage.

## Non-blocking suggestions

1. **`tests/e2e/diagnostic.spec.ts:13` comment misstates the new
   sprite coordinates.** The comment reads
   `"3 new sprites append at (16,1), (0,2), (1,2)"` but the
   16-wide row-major packer at `src/atlas/layout.ts:38-69` actually
   places the 24th–26th entries at `(7,1)`, `(8,1)`, `(9,1)`
   (verified in the regenerated `assets/atlas.json`). The
   `(16,1)/(0,2)/(1,2)` triple is inconsistent both with
   `ATLAS_TILES_WIDE = 16` (col `16` is out of bounds for a
   `0..15` indexed grid; the wrap to row 2 happens after `col=15`)
   and with the actual manifest. The brief inherits the same error.
   Fix is one line: change to `"at (7,1), (8,1), (9,1) per the
   addendum 3a row-major placement function"`. Cosmetic; does not
   affect any byte-load-bearing assertion.

2. **Recipe append order is not alphabetical.** The Phase 7.A.1
   imports + slot ids + registry entries are added in the order
   stim-patch → trauma-pack → cyberdeck-mod-1
   (`src/registries/atlas-recipes.ts:57-59,90-92,285-306`), not
   alphabetical (cyberdeck-mod-1 → stim-patch → trauma-pack). This
   is **correct** for the append-only coordinate-stability contract
   — alphabetical insertion would shift later coordinates — but it
   diverges from the Phase 6.A.2 within-batch convention (which
   appended in alphabetical order for new entries:
   adrenaline-spike → med-injector → nano-repair → syringe →
   armor → dermal-plating → ..., per
   `src/registries/atlas-recipes.ts:36-51`). Cosmetic; either
   reorder the three new entries alphabetically (cyberdeck-mod-1
   → stim-patch → trauma-pack would still APPEND past position
   22, so coordinate-stability for the prior 23 holds; the 3 new
   entries' coordinates would shuffle: cyberdeck-mod-1 at (7,1),
   stim-patch at (8,1), trauma-pack at (9,1) — a different
   ATLAS_DIGEST), or keep the current order and add a one-line
   comment at `:285` explaining why these three aren't
   alphabetical (e.g., "appended in nit-N4-original-flag order
   from `code-review-phase-6-A-2.md`"). The current order is
   defensible but undocumented. Recommend the comment fix at the
   next commit.

## Files reviewed

Production: `src/registries/atlas-recipes.ts`,
`src/atlas/recipes/item-stim-patch.ts`,
`src/atlas/recipes/item-trauma-pack.ts`,
`src/atlas/recipes/item-cyberdeck-mod-1.ts`,
`src/core/self-test.ts`, `src/atlas/preset-seeds.ts`. Read-only
verification: `src/atlas/layout.ts`, `src/atlas/params.ts`,
`src/atlas/recipes/item-consumable-syringe.ts` (recipe-shape
prior art), `src/registries/items.ts` (canonical `ItemKindId`
strings), `src/sim/types.ts`, `src/core/encode.ts`.

Tests: `tests/atlas/registry.test.ts`, `tests/e2e/diagnostic.spec.ts`.
Read-only verification: `tests/atlas/preset-seeds.test.ts`,
`src/core/self-test.test.ts`, `tests/atlas/registry.test.ts`.

Assets: `assets/atlas.png` (1457 bytes; sha256 `a3f7e3ca…`),
`assets/atlas.json` (26 sprites; existing 23 byte-identical to
HEAD@5f7823e per row-major dump).

Docs: `docs/ARCHITECTURE.md:956-1067` (new Phase 7 section);
`docs/PHASES.md:514-518` (Phase 7.A.1 acceptance criteria);
`docs/QUALITY_GATES.md` (testing + DRY + drift-detection gates);
`artifacts/code-review-phase-6-A-2.md` (the N1/N2/N3/N4/N5
carry-forward source).

Phase 7.A.1 is ready for approval. Phase 7.A.2
(sandbox-verifiable NPC + shop + boss-FSM + win-state
implementation) is the next phase.
