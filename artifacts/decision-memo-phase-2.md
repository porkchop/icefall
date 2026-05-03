# Decision Memo — Phase 2 (Map Generation)

**Status.** Drafted before any Phase 2 code is written, per the planning gate
in `docs/PHASES.md`. Architecture-red-team review is required before
implementation. Phase 1 (Deterministic Core + Public Deployment) is
approved on master at commit 2038fc9 (see `artifacts/phase-approval.json`).

## Decision summary

Phase 2 generates dungeon floors deterministically from `(seed, floorN)`.
Output is plain integer-grid data — no rendering, no entities. Every choice
below is biased toward (a) bit-identical floor JSON across Chrome / Firefox /
WebKit / Node, (b) a tile/room/door/encounter wire format that survives
Phase 5+ renderers and Phase 8 fingerprint-pinned replay without churn, and
(c) staying inside the existing determinism contracts already frozen by
Phase 1 (state-chain encoding, stream derivation, salt encoding).

The interesting decisions in this phase are not the *algorithms* (BSP +
corridor-connect is the boring, well-understood choice) but the **wire
contracts**: tile codes, room/door/encounter records, and the canonical
JSON shape that golden-output tests will pin. These shapes leak into Phase 5
(renderer reads them), Phase 6 (encounter slots resolve to monsters), and
Phase 8 (full floor JSONs may be persisted in pinned releases). Locking
them carefully now is cheaper than versioning them later.

Like Phase 1, Phase 2 is split into a sandbox-verifiable portion (2.A) and
a live-deploy verification portion (2.B), since the diagnostic-page
extension's "live URL serves updated diagnostic with ASCII preview"
acceptance criterion can only be observed after an external push runs the
GitHub Pages workflow. See decision 14.

## Decisions

### 1. Algorithm: **BSP partition → place rooms in leaves → carve corridors between sibling subtrees**

- **Chosen.** Binary Space Partitioning (BSP). Recursively split the floor
  rectangle along an alternating axis with an integer split position drawn
  from `streams.mapgen(floorN)`. Stop subdividing when a leaf is below a
  floor-dependent minimum size or after a depth cap. Place a single room of
  random integer dimensions inside each leaf, with integer padding from the
  leaf bounds. Carve corridors by walking the BSP tree bottom-up: for each
  internal node, connect a representative point of its left subtree to a
  representative point of its right subtree with an L-shaped corridor.
- **Alternatives considered:**
  - **Drunkard's walk / random-walk caves.** Produces "natural-cave" feel
    but reachability is statistical, not structural; we'd need a flood-fill
    repair pass and a retry budget. Phase 2 needs a hard reachability
    guarantee on every seed; retries make seed→floor a non-total function.
  - **Cellular automata caves** (4-5 rule). Same reachability problem plus
    a fragile rule-tuning surface that would force `rulesetVersion` bumps
    every time we tweak the parameters.
  - **Pure room-and-corridor (random rectangles + Delaunay/MST).** Works
    but the geometry primitives (point-in-polygon, edge intersection) want
    floats; staying in integer-only sim/mapgen code with these is awkward.
    BSP keeps us in integer rectangles end-to-end.
  - **Wave Function Collapse.** Overkill for v1 and brings a heavyweight
    constraint solver into the bundle.
- **Why this option:** BSP is the canonical roguelike layout, requires only
  integer arithmetic (no floats, no `Math` calls), produces a tree we can
  walk for guaranteed reachability without retries, and yields rooms with
  obvious "this is a room" shape that the renderer in Phase 5 can present
  without surprises. Floor 10 (decision 4) replaces the BSP with a single
  fixed boss-arena generator — a clean override point.
- **If wrong:** the algorithm is a single function (`generateFloor`) behind
  the JSON contract decided below. Replacing BSP with a different generator
  is a `rulesetVersion` bump and invalidates pre-bump fingerprints, but no
  caller (renderer, sim, encounter resolver) needs to change.

### 2. Floor dimensions: **fixed 60 × 24 (`width=60, height=24`) for floors 1–9; 40 × 28 for floor 10**

- **Chosen.** Phase 2 ships with two integer floor sizes:
  - Floors 1–9: 60 wide × 24 tall.
  - Floor 10: 40 wide × 28 tall (more square, dominated by the boss arena).
- **Alternative:** seed-dependent floor sizes. Rejected — it complicates
  the JSON shape (every floor advertises its own size) and the diagnostic
  ASCII preview without buying anything for v1.
- **Why this option:** 60×24 fits a typical roguelike viewport, gives
  enough room for ~6–10 BSP-leaf rooms, and prints to a terminal / ASCII
  preview in 24 lines. 40×28 lets floor 10 host a single ~20×20 boss arena
  with surrounding chamber. Both numbers are integers and lint-rule-safe.
- **If wrong:** dimensions are fields in the floor JSON (decision 3) — a
  later phase can introduce variable sizing additively (size becomes a
  function of `floorN`, fingerprint pins the function). Until then the
  width/height fields document themselves.

### 3. Tile encoding: **integer-code Uint8Array, row-major, frozen tile codes**

- **Chosen.**
  ```
  const TILE_VOID    = 0  // out-of-bounds / un-carved
  const TILE_FLOOR   = 1  // walkable interior
  const TILE_WALL    = 2  // walkable-blocking wall
  const TILE_DOOR    = 3  // walkable, distinguishable for encounters / line-of-sight
  ```
  In-memory: `Uint8Array` of length `width * height`, addressed as
  `tiles[y * width + x]`. On the wire (JSON) the same bytes are emitted as
  a base64-encoded string field `tilesB64`; the JSON field `tilesShape` is
  the literal tuple `[width, height]` for redundancy and self-validation.
  Tile codes 0x04–0xFF are reserved for additive future tile kinds (Phase 6
  may add lockable doors, Phase 7 NPCs, etc.) — additions are
  `rulesetVersion` bumps, *not* schema breaks.
- **Alternatives considered:**
  - JSON 2D array of integers. Rejected — Phase 8 will likely persist
    floor JSONs in pinned releases; a 60×24 array of ints is
    ~14 KB minified, vs. ~2 KB base64 of 1440 raw bytes.
  - String-of-chars (one ASCII character per tile). Rejected — character
    choice becomes a frozen contract too, and we already need an ASCII
    *rendering* (decision 9) which is a *different* contract from the data
    encoding. Mixing the two invites confusion.
  - Run-length encoding. Rejected — premature; v1 floors are small and
    base64-of-Uint8Array compresses fine through gzip on the wire.
- **Why this option:** `Uint8Array` is the same primitive Phase 1 already
  uses for state-chain bytes; it imports zero new deps; integer codes are
  lint-rule-safe; the renderer in Phase 5 can use the codes as direct
  indices into a tile-table; and the wire form is small and SHA-256-able.
- **If wrong:** the tile-code constants live in one file
  (`src/mapgen/tiles.ts`). New codes are additive. Renaming a code without
  changing its numeric value is harmless. Re-numbering would be a
  `rulesetVersion` bump.

### 4. Floor 10 boss arena: **special-cased generator, single fixed-shape arena**

- **Chosen.** A separate function `generateBossFloor(floorPRNG)` replaces
  the BSP generator on `floorN === 10`. Layout:
  - A 40×28 floor.
  - A central 20×20 arena room (boss room).
  - A short antechamber room near the top edge with the entrance.
  - A 1-tile-wide corridor connecting antechamber to the arena's north
    door.
  - No exit tile; instead a `bossArena` field in the JSON identifying the
    arena's bounding rectangle so Phase 7 can spawn the boss.
  - No regular encounters in the arena; one fixed encounter slot kind
    `boss-arena.entry` outside the arena door.
- **Why this option:** the original Phase 2 acceptance criterion explicitly
  calls floor 10 out as "structurally distinguished: a single large boss
  arena reachable from the entrance." A separate code path keeps the BSP
  generator simple (no "is this floor 10?" branching) and gives the boss
  arena a stable shape that art and combat in later phases can rely on.
- **If wrong:** the boss-arena geometry is one function. Phase 7 can
  rev it; the override seam stays.

### 5. Floor JSON canonical schema: **sorted keys, no floats, fixed top-level shape**

- **Chosen.** A floor serializes as JSON with the following frozen shape
  (top-level keys are emitted in alphabetical order; integer values
  everywhere; no floats; no `null` outside the explicitly-allowed
  `bossArena` and `exit` cases):
  ```json
  {
    "bossArena": null | { "x": int, "y": int, "w": int, "h": int },
    "doors":     [ { "x": int, "y": int } , … ]   // sorted by (y, x)
    "encounters":[ { "kind": str, "x": int, "y": int } , … ]  // sorted by (kind, y, x)
    "entrance":  { "x": int, "y": int },
    "exit":      null | { "x": int, "y": int },
    "floor":     int,                // floorN, 1..10
    "height":    int,
    "rooms":     [ { "id": int, "kind": str, "x": int, "y": int, "w": int, "h": int } , … ]  // sorted by id
    "schemaVersion": 1,              // bumps with any breaking JSON-shape change
    "tilesB64":  str,                // base64 of width*height bytes
    "tilesShape":[int, int],         // [width, height]
    "width":     int
  }
  ```
- **Why this option:** every collection is sorted by an explicit integer
  or lexicographic key, which makes the JSON byte-stable across runtimes;
  every value is integer or `null` or string, which is float-safe; the
  top-level shape captures everything Phase 5 needs to render and Phase 6
  needs for encounter resolution. `schemaVersion` lets Phase 8 detect
  pre-/post-bump persisted floors and load the right release.
- **Alternatives considered:**
  - Canonical JSON via JCS (RFC 8785). Defensible but heavy — JCS handles
    floats and Unicode escapes that we have ruled out by other means; for
    integer-only / ASCII-key JSON, sorting top-level keys plus sorting each
    array by an explicit comparator is sufficient and avoids the
    dependency.
  - msgpack / CBOR. Same reasoning as Phase 1 decision 4: small surface,
    custom-binary fans want, but the diagnostic preview is a strong
    argument for *human-readable* floor data, and JSON is human-readable.
- **If wrong:** the schema sits behind one (de)serialize pair in
  `src/mapgen/serialize.ts`. Bumping `schemaVersion` and writing a
  v1→v2 migrator is the cost; existing fingerprints replay against
  pinned releases that still know v1 floors.

### 6. Stable-ID registries: **`src/registries/rooms.ts` and `src/registries/encounters.ts`**

- **Chosen.** Two registries shipped in Phase 2:
  - `rooms.ts` exports a frozen list of room *kinds* with stable string
    IDs: `room.entrance`, `room.exit`, `room.regular`, `room.boss-arena`,
    `room.boss-antechamber`. Each entry has metadata used by mapgen
    (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `allowedFloors`).
  - `encounters.ts` exports a frozen list of encounter *slot kinds* with
    stable string IDs: `encounter.combat.basic`, `encounter.combat.elite`,
    `encounter.loot.basic`, `encounter.boss-arena.entry`. Each entry has
    metadata used by mapgen (`weight`, `allowedFloors`, `placement`:
    `"in-room"|"corridor"|"door-adjacent"`).
- **Why this option:** Phase 6 and 7 will populate the *content* (which
  monster spawns at `encounter.combat.basic` on floor 4); Phase 2 only
  cares about the *slots*. Locking the slot ID strings now means a Phase 6
  PR adds content without touching Phase 2 deliverables. SPEC.md principle
  5 ("designed for mods even before mods exist") is honored by stable IDs
  from day one.
- **Alternatives considered:**
  - Inline string literals scattered across the code. Rejected — the IDs
    *are* the contract; centralizing them is the only way the lint /
    typecheck can flag a typo.
  - Numeric registry IDs. Rejected — strings survive renumbering and are
    self-documenting in the JSON.
- **If wrong:** registries are append-only by convention. Renaming an ID
  is a `rulesetVersion` bump. Adding new kinds is additive.

### 7. Stream isolation: **`streams.mapgen(floorN)` is the *only* PRNG mapgen consumes**

- **Chosen.** Mapgen's public entry point takes `(rootSeed, floorN)`,
  derives a single PRNG via `streamsForRun(rootSeed).mapgen(floorN)`, and
  passes that PRNG (and *only* that PRNG) into every internal helper.
  Helpers receive the PRNG by parameter; no helper looks at module-level
  state, no helper consults `streams.sim()` or `streams.ui()`, no helper
  accepts a `RunStreams` bundle. **Three layers of enforcement:**
  1. *Type-level.* Helper signatures take `prng: PRNG`, never
     `streams: RunStreams`.
  2. *Lint rule.* `src/mapgen/**` may not import any symbol named
     `streams.sim` or `streams.ui` (extension of the existing
     `no-restricted-imports` boundary).
  3. *Runtime guard.* The mapgen entry point wraps the PRNG it produces in
     a thin proxy that records a "consumed by mapgen" mark on the stream;
     a `streams.sim()` wrapper checks that the mapgen mark is *not* set
     before yielding numbers, and throws if it is. Inverse check: at the
     end of `generateFloor` we assert that the only stream touched on the
     `RunStreams` was `mapgen(floorN)`. (See decision 7a for the
     implementation shape that avoids leaking ambient state across runs.)
- **Why this option:** the original Phase 2 acceptance criterion calls for
  *both* a runtime guard *and* a lint rule. Defense-in-depth is cheap here
  and the failure mode (silent coupling of layout to combat) would only
  show up on a Phase 8 verification audit — far too late.
- **If wrong:** the runtime guard lives in one wrapper. If it produces
  false positives, swap it for a counter-based assertion that runs only
  in test/dev builds. The lint rule and type discipline survive
  independently.

### 7a. Runtime guard implementation: **per-`RunStreams` consumption tracker**

- **Chosen.** `streamsForRun` (already in Phase 1) is extended *additively*
  to attach an opaque `__consumed: Set<string>` to the returned
  `RunStreams`. Each accessor (`mapgen`, `sim`, `ui`) records its
  fully-qualified key (`"mapgen:0"`, `"sim"`, `"ui"`) into the set on first
  call. `generateFloor` accepts the `RunStreams` (not just the PRNG),
  derives `mapgen(floorN)`, runs the BSP, and at exit asserts `[
  ...consumed ] === ["mapgen:" + floorN]`. **No global state is added; no
  Phase 1 contract is changed; the consumed set is per-`RunStreams`
  instance.**
- **Why this option:** this is the *narrowest* runtime check that catches
  "mapgen accidentally pulled from the sim stream" without introducing
  ambient state, without touching the streamSeed contract, and without
  perturbing the shape of `RunStreams` for Phase 1 tests.
- **If wrong:** the tracker is one Set; remove it and the stream-isolation
  guarantee falls back to the lint rule and type discipline alone.

### 8. JSON canonicalization implementation: **a single `serializeFloor` function with explicit field-by-field write order**

- **Chosen.** `serializeFloor(floor: Floor): string` builds the output by
  appending fields in their canonical (alphabetical) order, with each array
  pre-sorted by its decision-5-specified comparator. No reliance on
  `JSON.stringify` insertion order. `parseFloor(s: string): Floor` validates
  the schemaVersion, asserts `tilesShape[0] * tilesShape[1] ===
  base64-decoded(tilesB64).length`, and rejects floats anywhere in the
  parse output.
- **Alternatives considered:**
  - Calling `JSON.stringify(obj, sortedKeys)`. Works for keys but doesn't
    sort *array elements*; we'd still need explicit sort calls. Once we
    have those, the win from `JSON.stringify` is small — and the lint rule
    bans `JSON.parse` in `mapgen/`. Adding a one-off allow is worse than
    just writing the serializer.
  - Hand-writing the JSON byte-by-byte. Overkill — V8/SpiderMonkey/JSC
    agree on JSON output shape for ASCII-keyed integer-valued objects.
- **Why this option:** explicit serialization function makes the canonical
  ordering visible at the call site, which is the place reviewers will
  look. The byte-equality test (decision 11) catches any cross-runtime
  drift.
- **If wrong:** swap to JCS or canonical CBOR; both are pinned by
  `schemaVersion`.

### 9. ASCII rendering: **frozen character mapping, separate from data encoding**

- **Chosen.**
  ```
  '#' → wall (TILE_WALL)
  '.' → floor (TILE_FLOOR)
  '+' → door (TILE_DOOR)
  ' ' → void (TILE_VOID)
  '<' → entrance (overrides whatever tile is there)
  '>' → exit (overrides whatever tile is there)
  'B' → boss-arena marker (only on floor 10; overrides)
  'e' → encounter marker (overlay; overrides)
  ```
  `renderAscii(floor: Floor): string` produces `height` newline-separated
  lines, each `width` characters wide, with overlays applied in a fixed
  precedence (`< > B` outrank `e`, `e` outranks tile codes, tile codes
  outrank `' '`). Trailing newline; `\n` only (no `\r\n`).
- **Why this option:** the ASCII rendering is a *human-facing diagnostic
  and golden-test fixture* — it does not need to be the same encoding as
  the wire JSON, and conflating the two would mean a future ASCII tweak
  becomes a `rulesetVersion` bump. Keeping them separate lets the wire
  JSON evolve under `schemaVersion` and the ASCII evolve under a separate
  cheap-to-bump knob.
- **If wrong:** `renderAscii` is one function with one switch statement.
  Rev it freely; only the fixture-pack golden files need to be regenerated.
  The action-log fingerprint contract is not affected.

### 10. CLI tool: **`tools/gen-floor.ts`, Node-only, prints ASCII to stdout**

- **Chosen.** A Node entry script at `tools/gen-floor.ts`. Run via `npm
  run gen-floor -- --seed <seedString> --floor <N>`. Reads CLI args,
  derives the rootSeed via the same `seedToBytes` function the browser
  uses, runs `generateFloor`, prints `renderAscii(floor)` to stdout. Does
  **not** import any browser-only module; uses only `src/core/` and
  `src/mapgen/`. Lives under `tools/`, which is the existing layer carved
  out in `docs/ARCHITECTURE.md` for build-time-only Node code.
- **Alternatives considered:**
  - A web-only "generate floor" UI. Eventually yes (decision 12), but a
    CLI is the simplest fixture-pack regenerator and a good debugging
    tool.
  - A Vitest test that prints ASCII via `console.log`. Hostile to
    debugging — Vitest swallows stdout in CI.
- **Why this option:** mirrors the precedent set by the Phase 4 atlas
  generator (`tools/gen-atlas.ts`). Same pattern, same import boundaries,
  same ergonomics.
- **If wrong:** `tools/gen-floor.ts` is one file. The browser preview and
  the JSON contract are independent of it.

### 11. Fixture pack: **20 (seed, floor) pairs, JSON + ASCII golden files, regenerator script**

- **Chosen.** 20 pairs covering:
  - 10 pairs across distinct seeds for floor 1 (most-played floor; surface
    of any drift first).
  - 9 pairs covering the same seed across floors 1, 2, …, 9 (regression
    against the floor-N salt).
  - 1 pair on floor 10 to pin the boss-arena layout.

  Each pair has two committed files under `tests/fixtures/floors/`:
  - `<seedSlug>__floor<N>.json` — output of `serializeFloor`.
  - `<seedSlug>__floor<N>.ascii` — output of `renderAscii`.

  A Vitest test loads each pair, regenerates, and asserts byte-equality.
  A `npm run gen-fixtures` script regenerates the pack from a single
  manifest file; CI fails if `git diff tests/fixtures/floors` is non-empty
  after regeneration.
- **Why this option:** the byte-equality CI check is the canary for the
  same drift class that the Phase 1 random-walk-digest test catches in
  `core/`. Two separate files (JSON + ASCII) catch separate drift
  surfaces — JSON drift = wire-format change; ASCII drift = renderer
  change. Either one demands a deliberate review.
- **If wrong:** the fixture-pack format is convention only. We can grow
  it (more pairs) freely; we cannot shrink it without justifying the
  regression-coverage drop in a new memo.

### 12. Diagnostic page extension: **add ASCII preview, keep self-tests**

- **Chosen.** The Phase 1 diagnostic page is extended with a new section
  *below* the existing self-tests:
  - A textfield for "seed" (defaults to `"diagnostic-sample"`).
  - A "Generate floor" button.
  - A select for `floor` (1–10).
  - A `<pre>` element rendering `renderAscii(floor)` in a monospace font.
  - The select+seed are reflected in the URL hash so a user can share
    `https://porkchop.github.io/icefall/#seed=foo&floor=3` to deep-link a
    floor.

  The self-test banner remains the canonical "is this build healthy?"
  signal. The new section is purely an interactive preview; it does not
  affect `window.__SELF_TEST_RESULT__`. A *new* `window.__FLOOR_PREVIEW__`
  flag is set to `"ready"` when the preview component has rendered, so the
  Phase 2.B Playwright job can wait for it.
- **Why this option:** the original Phase 2 acceptance criterion is "the
  deployed diagnostic page includes an in-browser ASCII floor preview, so
  anyone visiting the live URL can see mapgen working." This is the
  smallest UI that satisfies that.
- **If wrong:** Phase 5 will replace the diagnostic page with the actual
  game. The preview is throw-away by design.

### 13. Bundle size budget: **≤ 75 KB minified+gzipped for the diagnostic page**

- **Chosen.** Phase 1's budget was ≤ 50 KB. Phase 2 raises it to 75 KB to
  accommodate the BSP generator, the registries, the ASCII renderer, and
  the URL-hash plumbing. Tracked via `vite build --report` in CI; the
  workflow fails if the budget is exceeded.
- **Alternatives considered:**
  - Hold at 50 KB. Plausible — mapgen code is small and registries are
    sparse — but a strict budget pre-Phase 5 risks a thrash where Phase 3
    needs another 10 KB and we're back here.
  - Drop the budget entirely. Rejected — the budget exists precisely to
    catch the "we accidentally pulled in a 200 KB dep" failure mode.
- **Why this option:** 75 KB is generous enough for Phase 2's surface and
  still small enough that any unexpected blowup will fail the budget
  visibly. Phase 5 (renderer) and beyond will rev the budget again.

### 14. Phase split: **2.A (sandbox) and 2.B (live verification), mirroring Phase 1's split**

- **Chosen.** Phase 2 ships in two commits:
  - **Phase 2.A — sandbox-verifiable.** All code, tests, registries,
    fixture pack, CLI tool, diagnostic-page extension, lint-rule extension,
    runtime guard. `npm ci && npm run lint && npm run test && npm run
    build && npm run test:e2e` all green inside the sandbox. Carries the
    Phase 1 follow-ups already landed in this commit cycle (no-float-
    arithmetic fixture expansion to ≥ 25, encodeAction tag-order
    combinatoric test).
  - **Phase 2.B — live verification.** Push 2.A to master, observe the
    deploy workflow run green, observe the live URL serves the new
    diagnostic page with the ASCII preview rendering, observe the
    cross-runtime Playwright job (extended with a `floor-preview-ready`
    assertion) runs green on chromium / firefox / webkit. No new code
    expected.
- **Why this option:** the Phase 1.A / 1.B split worked. Repeating it
  preserves the audit trail, keeps each commit's review surface small,
  and matches the operating rule "next smallest verified step."
- **If wrong:** if Phase 2.B reveals a regression, that becomes a Phase 2.B
  blocker and is fixed before approval. We do not approve 2.A on the basis
  of "it'll probably work in CI."

### 15. Determinism guard: **two new self-tests + golden floor digest**

- **Chosen.** Add to `src/core/self-test.ts`:
  - `mapgen-cross-runtime-digest`: generate floors 1–10 from a fixed
    rootSeed, serialize each via `serializeFloor`, concatenate, SHA-256
    the result, assert against a hardcoded golden digest. Same rationale
    as the Phase 1 random-walk digest: any silent cross-runtime drift in
    BSP, tile encoding, JSON serialization, or registry order shows up
    immediately.
  - `mapgen-stream-isolation`: generate a floor, then assert the
    `RunStreams.__consumed` set is exactly `["mapgen:" + floorN]`. Also
    runs in the browser self-test page, so a regression that only shows
    up under a non-Node engine is caught.
- **Why this option:** keeps the same "the diagnostic page is the proof"
  posture established in Phase 1. The mapgen-digest test will live next
  to the random-walk digest test forever and will be a maintenance burden
  measured in single-digit lines.
- **If wrong:** removing the golden digest is a `rulesetVersion` bump and
  reviewed by `architecture-red-team`. Adding more digest probes is
  additive and never reviewed.

## Frozen contracts established by this phase

These join the Phase 1 frozen contracts in `docs/ARCHITECTURE.md`. Changing
any of them is a `rulesetVersion` bump and breaks every fingerprint shared
before the change.

1. **Tile codes.** `TILE_VOID=0, TILE_FLOOR=1, TILE_WALL=2, TILE_DOOR=3.`
   Codes 4–255 reserved for additive expansion.
2. **Floor JSON shape.** Fields, sort orders, and `schemaVersion` per
   decision 5.
3. **Room kind IDs.** `room.entrance`, `room.exit`, `room.regular`,
   `room.boss-arena`, `room.boss-antechamber`.
4. **Encounter slot kind IDs.** `encounter.combat.basic`,
   `encounter.combat.elite`, `encounter.loot.basic`,
   `encounter.boss-arena.entry`.
5. **BSP generator parameters.** Min leaf size, depth cap, room padding —
   pinned in `src/mapgen/params.ts`.
6. **Boss-arena geometry.** Floor 10 layout (decision 4) is pinned.
7. **Stream-derivation salt for mapgen.** Already frozen in Phase 1
   (`encodeSalt(floorN)`); this phase exercises it but does not change it.

## Out of scope for Phase 2 (deferred to later phases)

- Monsters, items, NPCs (Phase 3 and later) — encounter slots are *empty*
  containers in Phase 2.
- Renderer (Phase 5) — only the ASCII preview is shipped.
- Atlas integration (Phase 4) — floor data does not yet reference atlas
  IDs.
- Action-log persistence of mapgen seed (Phase 8) — the floor is currently
  *recomputed* from `(rootSeed, floorN)` on every run. Phase 8's pinned-
  release routing is what guarantees stability across releases.
- Save / resume of partially-explored floors (Phase 8). Mapgen output is
  pure data; visibility / fog-of-war is Phase 5+.

## Phase 2 acceptance criteria — restated, with this memo's decisions

- `same (rootSeed, floor) → same floor JSON`: golden test, byte-equal.
  *(decision 11)*
- Every floor 1–9: exactly one `entrance`, exactly one `exit`. Floor 10:
  exactly one `entrance`, `exit === null`, `bossArena !== null`. Asserted
  by a runtime invariant inside `generateFloor` plus a unit test on each
  fixture-pack floor. *(decisions 4, 5)*
- All rooms reachable from the entrance: BFS over walkable tiles
  (`TILE_FLOOR | TILE_DOOR`) reaches every room's interior. Asserted as a
  runtime invariant inside `generateFloor`; unit-tested on fixture floors
  for fast feedback. *(decision 1)*
- Floor 10 structurally distinguished: `bossArena.w * bossArena.h ≥ 16 ×
  16` and a path of length ≤ `width + height` reaches the entrance.
  Asserted by a unit test. *(decision 4)*
- Mapgen consumes only the `mapgen` stream: runtime guard (decision 7a)
  plus lint rule (decision 7) plus a self-test invocation that runs in
  the browser (decision 15).
- The deployed diagnostic page serves the ASCII preview on the live URL:
  observed in Phase 2.B. *(decisions 12, 14)*

## Risks (Phase 2 specific)

- **BSP generator parameters are frozen at decision time.** Tweaking
  min-leaf-size or depth cap after release is a `rulesetVersion` bump.
  Mitigation: the parameters live in one file (`src/mapgen/params.ts`)
  and the golden floor digest in self-test catches an accidental change.
- **JSON canonical-form drift across runtimes.** Mitigated by explicit
  field-by-field serialization (decision 8) and a byte-equality
  cross-runtime test in CI (decision 11) plus the in-browser self-test
  golden digest (decision 15).
- **base64 encoding drift across runtimes.** Mitigated by using a single
  Node-and-browser implementation: a hand-rolled base64 encoder in
  `src/core/base64.ts` (≤ 30 lines) — same path Phase 1 took with the
  hash library. We do *not* rely on `btoa` / `Buffer.toString("base64")`
  because their handling of binary input differs.
  > **Superseded — see addendum B1.** No new module is created; reuse the
  > existing `src/core/hash.ts:base64url` (RFC 4648 §5, unpadded).
- **Encounter-slot kind churn between Phase 2 and Phase 6.** Mitigated by
  the registry being explicit and append-only by convention; reviewed by
  `architecture-red-team` if any future phase wants to remove or rename
  an existing slot kind.
- **Runtime guard false positive.** If `generateFloor` itself is called
  twice for different floors on the same `RunStreams`, the consumed set
  will contain `mapgen:1, mapgen:2, …` — which is fine and intended. The
  test asserts the consumed-set is a subset of `mapgen:*`, not an exact
  singleton. Documented in decision 7a.
  > **Superseded — see addendum B4.** The correct invariant is per-call
  > delta: `generateFloor(floorN, streams)` increments
  > `streams.__consumed` by exactly `{"mapgen:"+floorN}`. The "subset"
  > wording above is replaced by the addendum's per-call-delta semantics.

## Open questions deferred from this memo

- Whether floor sizes should be a pure function of `floorN` (e.g.
  expanding through floors 1–9) or stay fixed. Deferred to Phase 5+ when
  we know what fits a real viewport. The JSON shape supports either.
- Whether the encounter-slot ID set should subdivide further (e.g.
  `encounter.combat.basic.melee` vs `.ranged`). Deferred to Phase 6 when
  the actual content arrives.
- Whether the diagnostic page should expose the *JSON* in addition to the
  ASCII. Deferred — the JSON is large and would clutter the diagnostic
  page; users who want the JSON can run the CLI.

---

## Addendum — architecture-red-team review response

`architecture-red-team` reviewed this memo (see
`artifacts/red-team-phase-2.md`) and returned verdict **REVISE BEFORE
IMPLEMENTATION** with four blocking issues and six non-blocking concerns.
Each issue is addressed below; the original decision text above is left
intact for audit-trail clarity, and this addendum overrides any
conflicting prose. Once the addendum lands, the verdict reverts to
**APPROVE** and Phase 2.A code may be written.

### Resolution of B1 — base64url reuse and alphabet/padding pinning

**Override.** `tilesB64` is encoded by the existing
`src/core/hash.ts:base64url(bytes: Uint8Array): string` function, which
implements RFC 4648 §5 (URL-safe alphabet) **unpadded**. No new
`src/core/base64.ts` is created; the speculative new module is
**deleted from this memo's plan**. The field name `tilesB64` is retained
purely for brevity; the encoding it carries is explicitly base64url.

The Phase 1 frozen-contract row "every byte that crosses the wire goes
through `src/core/hash.ts`" stands. Decision 3, decision 5, and the
"Risks" section are amended in spirit by this override; the words above
in those sections that say "base64-encoded" or "hand-rolled" are
superseded.

### Resolution of B2 — null fields in canonical JSON are always present, never omitted

**Override.** Every key listed in the decision-5 schema is **always
present** in the serialized JSON, regardless of value:

- `bossArena` is the literal JSON `null` for floors 1–9 and an object for
  floor 10. The key `"bossArena"` is never omitted.
- `exit` is the literal JSON `null` for floor 10 and an object for
  floors 1–9. The key `"exit"` is never omitted.

`parseFloor` rejects any input where any required key is missing.
`parseFloor` rejects an object whose `bossArena` is `null` *and* whose
`exit` is `null` (degenerate floor) and rejects an object whose
`bossArena` is non-null *and* whose `exit` is non-null
(category-error floor).

### Resolution of B3 — strict parsing of unknown JSON keys; registry mutation review explicitly deferred

**Override — parsing.** `parseFloor` is **strict**: unknown top-level
keys cause a parse error. Unknown values inside known keys cause the
same. The reasoning is conservative: Phase 8 may load floor JSON from
external (potentially adversarial) sources, and a lax parser there is
the same class of bug as a lax wire-protocol parser anywhere else.
Phase 6 / 7 / 8 may add fields, and adding a field is therefore a
`schemaVersion` bump and a deliberate review event — which is what
`architecture-red-team` review at the planning gate is *for*. The
fixture pack will be re-saved on each `schemaVersion` bump; the
re-save event is the audit log.

**Override — registry mutation.** Decision 6 said registries are
"append-only by convention." This addendum explicitly defers the
*enforcement* test (assert prior entries' string IDs and metadata are
unchanged across commits) to **Phase 6**, when the second writer of
the registry exists and the mutation surface is real. Phase 2 commits
the registries; Phase 6 commits the mutation-immutability test. Phase
2 documentation in `docs/ARCHITECTURE.md` notes the deferred test.

### Resolution of B4 — runtime guard contract, Phase 1 contract change, and reconciliation of risk-section text

**Override — Phase 1 contract change is acknowledged.** Decision 7a's
claim "no Phase 1 contract is changed" was incorrect. Adding
`__consumed: Set<string>` to `RunStreams` is a structural addition to
Phase 1's `streamsForRun` return shape. This addendum classifies that
addition as a **Phase 1 addendum**, applied as part of Phase 2.A's
implementation. Specifically:

1. `streamsForRun(rootSeed)` is extended to attach an opaque
   `__consumed: ReadonlySet<string>` view (the underlying mutable set
   is private to the module). Each accessor — `mapgen(floor)`,
   `sim()`, `ui()` — records its key on first call.
2. Phase 1's existing self-test "streamsForRun accessors are
   consistent" (`src/core/self-test.ts:134`) is left functionally
   unchanged. The check creates its own `streamsForRun(...)` and
   touches `mapgen(0)`. Under the addendum, that touch records
   `"mapgen:0"` into *that check's* `__consumed`, never leaking to any
   other check's instance. The self-test is therefore not perturbed.
3. The new `mapgen-stream-isolation` self-test allocates a **fresh**
   `streamsForRun(...)` (separate from any other check's instance) and
   asserts that, after `generateFloor(floorN, streams)`, `[...streams.
   __consumed]` equals `["mapgen:" + floorN]` exactly — singleton.

**Override — singleton vs subset reconciliation.** The risk section's
"subset" wording is wrong; the correct invariant is per-call delta:
**a single call to `generateFloor(floorN, streams)` increments
`streams.__consumed` by exactly the singleton `{"mapgen:"+floorN}` and
nothing else.** The runtime guard inside `generateFloor` snapshots
`streams.__consumed` at entry and asserts at exit that the difference
is that singleton. Cross-floor batch generation (e.g. fixture-pack
regeneration calling `generateFloor` for floors 1, 2, …, 10 in a loop
on the *same* `RunStreams` instance) is therefore valid: each call
asserts its own per-call delta, and the cumulative `__consumed` after
ten calls is `{"mapgen:1", "mapgen:2", …, "mapgen:10"}`.

The "Runtime guard false positive" risk text above is superseded by
this addendum.

### Resolution of N1 — `tools/` boundary is established by Phase 2, not "precedented" by Phase 4

**Patch.** Decision 10 is amended in spirit: Phase 2 *establishes* the
`tools/` boundary; Phase 4 will adopt the same pattern. As part of
Phase 2.A:

- `eslint.config.js` gains a `tools/**` scope. Within that scope,
  Node-only globals are allowed (`process`, `console`), and `import` of
  any path matching `/render/`, `/input/`, or any browser-only module
  is forbidden (matching the existing layer-boundary patterns).
- `docs/ARCHITECTURE.md` line 47–53 (the layer table) is updated to
  refer to `tools/` as live in Phase 2, not "build-time only" in some
  abstract future.
- `tsconfig.json` is reviewed to ensure `tools/**` is type-checked.

### Resolution of N2 — `seedToBytes` contract pinned

**Override.** `seedToBytes(seed: string): Uint8Array` is defined to
return `sha256(utf8(seed))` — a fixed-32-byte digest of the UTF-8 bytes
of the seed string. This:

- normalizes seed-string entropy to 32 bytes regardless of input length;
- decouples mapgen's rootSeed from the seed-string surface that Phase 8
  will URL-route on (the URL routing keys on `fingerprint`, not on the
  raw seed string);
- gives `streamsForRun` a uniform 32-byte input;
- is implementable in two lines using `sha256` and `utf8` already
  exported from `src/core/hash.ts`.

The Phase 1 fingerprint function takes a *separate* `seed: string` and
hashes it as part of a larger pre-image (`fingerprint.ts:52`); that
contract is unchanged. `seedToBytes` is a new, narrowly-scoped
function used by mapgen, the diagnostic page, and the CLI. It is added
to `src/core/seed.ts` (or merged into `src/core/streams.ts`,
implementer's choice — both are inside `src/core/`).

### Resolution of N3 — ASCII overlay precedence, no top-tier collisions, trailing newline pinned

**Override — top-tier exclusivity invariant.** At most one of `<`, `>`,
`B` may appear at any cell. `generateFloor` enforces the invariant by
construction (entrance and exit are placed in distinct rooms; on floor
10 the entrance is in the antechamber and `B` marks the boss-arena
bounding rect, which is geometrically disjoint). A unit test on every
fixture-pack floor asserts the invariant.

**Override — door-under-entrance is impossible.** Entrances are placed
on `TILE_FLOOR` cells inside their room interior, never on door cells.
Asserted by the same generation-time invariant.

**Override — trailing newline.** `renderAscii(floor)` returns
`lines.join("\n") + "\n"`. Exactly one trailing `\n`. Pinned.

### Resolution of N4 — property-style reachability sweep added to test plan

**Override.** Decision 1's reachability assertion is now backed by:

1. The runtime invariant inside `generateFloor` (existing).
2. A unit test on each of the 20 fixture-pack floors (existing).
3. A new property-style test: 200 deterministically-chosen seeds (drawn
   from a fixed root seed via `streamPrng(rootSeed, "test:reach")`
   so the test is itself deterministic); for each seed, generate
   floors 1–10 and assert reachability holds. Total: 2,000 floors per
   test run. Duration budget: ≤ 5 seconds in `npm run test`. If the
   budget is exceeded, the seed count is reduced and the choice noted
   in the next phase-approval verification sprint.

This catches the "1-in-1000 seed" regression class the reviewer flagged.

### Resolution of N5 — bundle budget enforced via CI report artifact

**Override.** Decision 13's 75-KB budget is enforced by:

1. CI fails if `dist/`-gzipped exceeds 75 KB (existing pattern).
2. CI uploads `vite build --report` (the rollup-plugin-visualizer
   treemap) as a workflow artifact named `bundle-report`. Future phases
   read this artifact when proposing budget bumps.

This is a deliverable item in Phase 2.A.

### Resolution of N6 — `parseFloor` is only ever called on `serializeFloor` output

**Override.** `parseFloor` is **only** called on the output of
`serializeFloor`, never on user-supplied floor JSON. The function
signature is internal-only; it is not exported from any public entry
point of `src/mapgen/` and is not exposed on the diagnostic page. The
fixture-pack tests use `parseFloor` to round-trip canonical floor JSON
through deserialization to confirm structural equality. Phase 8, which
*may* need to load floor JSON from URL parameters, will introduce a
*separate* `parseExternalFloor` function that runs hostile-input
validation (regex-rejecting decimal points outside string fields,
schema-version-pinning, etc.) at that time, with its own decision
memo.

### Frozen-contracts list — additions from this addendum

These join the frozen contracts in section "Frozen contracts established
by this phase":

8. **Base64 alphabet for `tilesB64`.** RFC 4648 §5 URL-safe alphabet,
   unpadded. Implementation: `src/core/hash.ts:base64url`.
9. **Always-present JSON keys.** Every key in the floor JSON schema is
   always present; `null` is the sentinel for absent values where
   permitted (`bossArena`, `exit`).
10. **Strict JSON parser.** Unknown top-level keys cause `parseFloor` to
    throw. Adding a field is a `schemaVersion` bump.
11. **Per-call stream-consumption invariant.** `generateFloor(floorN,
    streams)` increments `streams.__consumed` by exactly
    `{"mapgen:"+floorN}`.
12. **`seedToBytes(seed) = sha256(utf8(seed))`.**
13. **ASCII top-tier exclusivity.** At most one of `<`, `>`, `B` per
    cell; trailing newline `lines.join("\n") + "\n"`.

### Documentation tasks added to Phase 2.A scope

- `docs/ARCHITECTURE.md` updated to (a) reflect `tools/` as a live layer
  with its own lint scope, (b) document the `__consumed` extension to
  `RunStreams`, (c) list the new frozen contracts above.
- `docs/PHASES.md` Phase 2 acceptance criteria amended to call out the
  property-style reachability sweep (N4) and the bundle-report artifact
  upload (N5) explicitly. (See `phase-update.json` companion artifact
  for the canonical edit.)

### Verdict after addendum

Per the red-team review's own closing line ("Once addressed, this memo
is APPROVE and Phase 2.A may begin"), the verdict is **APPROVE WITH
ADDENDUM**. Phase 2.A implementation may proceed in the next phase
cycle.
