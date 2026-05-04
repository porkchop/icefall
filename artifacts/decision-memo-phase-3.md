# Decision Memo — Phase 3 (Entity Model, Turn Loop, Combat)

**Status.** Drafted before any Phase 3 code is written, per the planning gate
in `docs/PHASES.md`. Architecture-red-team review is required before
implementation. Phase 2 (Map Generation) is approved on master at commit
0ad18da (Phase 2.B; see `artifacts/phase-approval.json`).

## Decision summary

Phase 3 builds the headless simulation that sits on top of the deterministic
floors Phase 2 produces. It introduces:

1. The **player and monster entity models** in their in-memory shape.
2. The **turn loop**: player input → resolve → monster ticks → resolve.
3. **Combat resolution** computed solely from `H(stateHash ‖ encodeAction(action))`,
   with no other entropy entering the per-action path (the Phase 3 acceptance
   criterion in `docs/PHASES.md`).
4. The **`RunState` machine**: `(fingerprintInputs, actionLog) → RunState`, the
   load-bearing contract Phase 8's replay viewer and verifier will both read.
5. A **headless playthrough harness**: scripted action log → final state hash.
6. A **diagnostic-page extension** with a "scripted playthrough" button that
   exercises the harness in the live deployment, plus a `window.__SIM_FINAL_STATE_HASH__`
   flag for cross-runtime Playwright assertions.

The interesting decisions in this phase are not the algorithms — turn-based
combat with FSM monster AI is the boring, well-understood choice — but the
**wire contracts that flow into Phase 8**: the action-type vocabulary, the
roll-derivation function, the per-floor sim-stream key, and the in-memory
shape of `RunState`. These shapes leak into Phase 5 (renderer reads sim
state), Phase 6 (item-use action descriptors), Phase 7 (boss FSM, win-state
transition), and Phase 8 (verifier API + replay viewer). Locking them now
is cheaper than versioning them later.

The Phase 1 frozen action-descriptor schema (`{ type, target?, item?, dir? }`
with strictly-increasing tag order) is honored unchanged. Phase 3 adds new
*string values* for `action.type` (`wait`, `move`, `attack`, `descend`) and
the per-`type` field-presence rules; it does **not** change the binary
encoding. This is the same kind of additive-by-design extension Phase 1
explicitly anticipated (decision memo Phase 1, decision 8).

Like Phase 1 and Phase 2, Phase 3 is split into a sandbox-verifiable
portion (3.A) and a live-deploy verification portion (3.B), since the
diagnostic-page extension's "live URL serves scripted-playthrough button"
acceptance criterion can only be observed after an external push runs the
GitHub Pages workflow. See decision 14.

## Decisions

### 1. Algorithm: **player tick → resolve → monsters tick in stable id order → resolve**

- **Chosen.** A turn is one player action followed by one tick from each
  alive monster on the current floor, in ascending `entity.id` order.
  Each monster's tick is a deterministic FSM transition (decision 7) with
  no PRNG consumption. The state hash advances **once per player action**
  via `advance(stateHash, playerAction)`; monster decisions do not appear
  on the chain themselves (frozen by `docs/ARCHITECTURE.md`'s "Action
  descriptor encoding" prose).
- **Alternatives considered:**
  - **Speed/initiative-based scheduler** (entities with `speed` integers
    queued by next-action-tick). Rejected — speed scheduling is the right
    answer for Phase 7+ when monster variety justifies it; introducing it
    now would bake a more complex contract into `RunState` than we have
    test coverage for, and the test harness would need to know about
    fractional turns.
  - **Simultaneous resolution** (everybody declares, then everybody
    resolves). Rejected — gives surprising "I attacked but the monster
    moved out of the square" interactions and is harder to replay
    in a deterministic step order.
  - **Player ticks twice per monster tick** (player-favored). Rejected
    for v1; reserve for difficulty options in Phase 9 polish.
- **Why this option:** classical roguelike turn order, easy to reason
  about for replay (one player action = one chain advance), no PRNG
  consumed during a tick, monster-tick determinism falls out of the
  ascending-id iteration plus FSM transitions. `RunState` after a tick
  is a pure function of `RunState` before plus the player action.
- **If wrong:** the turn loop is one function (`tick`); Phase 7 can
  swap in a speed scheduler behind the same `(state, action) → state'`
  signature. Replacing it post-release is a `rulesetVersion` bump.

### 2. Entity model: **stable integer ids; integer-only attributes**

- **Chosen.** Two entity kinds in Phase 3:

  ```ts
  type Player = {
    readonly id: 0;                  // pinned: player is always id 0
    readonly kind: "player";
    pos: Point;                      // mutable; turn loop writes
    hp: int;                         // 0 → outcome="dead"
    hpMax: int;
    atk: int;                        // base attack rating
    def: int;                        // base defense rating
  };

  type Monster = {
    readonly id: int;                // 1..N, assigned at floor entry
    readonly kind: MonsterKindId;    // string from registry
    pos: Point;
    hp: int;
    hpMax: int;
    atk: int;
    def: int;
    aiState: MonsterAIState;         // FSM state, integer-tagged union
  };
  ```

  All numeric fields are integers. No floats anywhere in `src/sim/**`
  (already enforced by the `no-float-arithmetic.cjs` lint rule). The
  player's `id` is **pinned to 0**; monsters get ids `1..N` assigned
  at floor entry by the `streams.simFloor(floorN)` shuffle order
  (decision 6).
- **Alternatives considered:**
  - **String-ULID ids.** Rejected — ULIDs require a clock, banned.
  - **UUIDv4-style ids.** Rejected — random; `Math.random` banned.
  - **Position-based ids** (`(x,y)` packed). Rejected — entities move,
    making an "id" that mutates with position confusing to reason about.
  - **Per-floor reassignment of monster ids starting from 0.** Rejected —
    if a monster persists across a floor transition (Phase 6+ may add
    follower NPCs), its id would change. Pin player at 0; monster ids
    are assigned in spawn order and persist for the entity's life.
- **Why this option:** integer ids are the simplest stable referent;
  pinning the player at 0 means the very first action's resolution
  knows who it applies to. The `id` is also the comparator for the
  monster tick order (decision 1), so monster behavior is byte-stable
  across runtimes regardless of object iteration order.
- **If wrong:** entity-id assignment lives in one function
  (`spawnFloorEntities` — decision 6). A v2 scheme is a `rulesetVersion`
  bump.

### 3. Action type vocabulary: **`wait | move | attack | descend` for Phase 3**

- **Chosen.** Phase 3 defines four `action.type` string values:

  | type       | required fields | optional fields | purpose                                         |
  |------------|------------------|------------------|------------------------------------------------|
  | `wait`     | (none)           | (none)           | Pass turn; monsters still tick.               |
  | `move`     | `dir`            | (none)           | Step one cell in direction. Blocked by walls/monsters. |
  | `attack`   | `dir`            | (none)           | Melee attack the entity in adjacent cell `dir`. No-op if empty. |
  | `descend`  | (none)           | (none)           | Descend stairs. Only valid on a floor's `exit` cell (or on floor 10 boss-arena entry, see decision 11). |

  The Phase 1 binary encoding is unchanged; only the *string set* of
  legal `type` values is named. A new `useItem` action lands in Phase 6
  with `type: "use"` and `item: ItemKindId`; ranged attacks land in
  Phase 6 with the existing `target` field; neither is in scope for
  Phase 3.
- **Alternatives considered:**
  - **Combine `move` and `attack` into one `step(dir)` action that
    auto-attacks if cell is occupied.** Rejected — the action log is the
    save (SPEC.md principle 2), so a verifier reading a log must be able
    to tell *intent* apart from *outcome*. A `step` that silently became
    an attack would obscure the player's intent in the persisted log.
  - **Add `pickup` / `drop` now.** Rejected — Phase 6 is the inventory
    phase; Phase 3 has items only as **registry data**, not inventory
    mechanics (per `docs/PHASES.md` Phase 3 deliverable line).
- **Why this option:** the four-action vocabulary covers death and
  boss-kill state transitions (the Phase 3 acceptance criteria), is
  unambiguous in the action log, and binds Phase 6/7/8 extensions to
  *additive* schema growth via new `type` strings (which is fine — the
  binary encoding doesn't care, see Phase 1 frozen-contract item 7).
- **If wrong:** the vocabulary is one switch in
  `src/sim/turn.ts:resolvePlayerAction`. Adding a `type` is additive.
  Removing or renaming one is a `rulesetVersion` bump.

### 4. Combat resolution: **per-roll `H(stateHashPre ‖ encodeAction(action) ‖ domain ‖ index)` derivation**

- **Chosen.** A *roll* is the only source of entropy inside an action's
  resolution. Rolls are derived from a deterministic per-call subhash:

  ```ts
  // domain is a short ASCII string ≤ 31 bytes (pinned by decision 4a)
  // index is an int32 (≥ 0; multiple rolls per action are zero-indexed in declaration order)
  function rollBytes(stateHashPre: Uint8Array, action: Action,
                     domain: string, index: int32): Uint8Array {
    const lpDomain = lp_utf8(domain);              // [len:1][utf8...]
    const idxLE    = u32_le(index);                // 4 bytes
    return sha256(concat([
      stateHashPre,                                // 32 bytes
      encodeAction(action),                        // Phase 1 wire format
      lpDomain,
      idxLE,
    ]));                                            // 32 bytes
  }

  function rollU32(stateHashPre, action, domain, index): uint32 {
    const b = rollBytes(stateHashPre, action, domain, index);
    return (b[0] | (b[1]<<8) | (b[2]<<16) | (b[3]<<24)) >>> 0;
  }
  ```

  `stateHashPre` is the state hash *before* the action advances the chain.
  The chain advance (`stateHashPost = advance(stateHashPre, action)`) is
  computed once per player action; rolls are derived from `stateHashPre`,
  not `stateHashPost`, so the roll is fixed by the time the action is
  resolved (and the same input log produces the same rolls regardless of
  whether the implementation stores pre- or post-state).

  **Combat damage formula (Phase 3 v1):**

  ```ts
  // dmg = max(1, atk - def + bonus) where bonus ∈ [0..3]
  const bonus = rollU32(statePre, action, "combat:atk-bonus", 0) & 0x03;
  const dmg = Math.max(1, atk - def + bonus);
  ```

  `bonus` is integer-only (bitwise mask of the high-entropy u32); no
  floats, no `Math.random`. The `Math.max` call is integer-safe.
- **Alternatives considered:**
  - **Roll bytes drawn from `streams.sim()`.** Rejected — the Phase 3
    acceptance criterion is "computed solely from `H(stateHash ‖ action)` —
    no other entropy enters the sim path." A `streams.sim()`-driven roll
    would make the per-action result depend on PRNG cursor history, which
    in turn depends on whether the player did anything earlier in the run
    that touched `streams.sim()` — defeating the audit clarity the
    acceptance criterion is buying.
  - **Roll bytes = `stateHashPost[0..4]`.** Rejected — recycles one
    32-byte hash for every roll on a turn; if a turn has multiple rolls
    (player attack + monster counterattack + player crit-check), they'd
    all read the same 4 bytes. The `domain ‖ index` extension is the
    cheap fix.
  - **Roll bytes = `H(state ‖ tagBytes)` without `encodeAction(action)`.**
    Rejected — two consecutive `attack` actions on the same target would
    produce the same roll (same state, same tag, same index). Including
    the action's encoded bytes guarantees uniqueness across same-state-different-action.
- **Why this option:** auditable from the formula alone, no hidden state,
  no PRNG cursors, deterministic across runtimes (the only primitives are
  SHA-256 and integer/bitwise ops, all already pinned by Phase 1). The
  per-roll subhash also matches the Phase 1 idiom for `streamSeed`
  derivation (domain-tagged length-prefixed concatenation).
- **If wrong:** roll derivation is one function (`rollU32` in
  `src/sim/combat.ts`). Replacing it is a `rulesetVersion` bump.

### 4a. Roll domain registry: **frozen string set, ASCII, ≤ 31 bytes each**

- **Chosen.** Each named roll uses one `domain` string from a frozen
  registry. Phase 3 ships:

  | domain                  | purpose                                      |
  |-------------------------|----------------------------------------------|
  | `combat:atk-bonus`      | Damage roll bonus (decision 4).             |
  | `combat:counter-bonus`  | Damage roll bonus on monster counterattack. |
  | `ai:tiebreak`           | Reserved — used in decision 7 ties.          |
  | `spawn:monster-pick`    | Used in decision 6's per-floor spawn.       |
  | `spawn:monster-pos`     | Used in decision 6's per-floor spawn.       |

  Domains are bare ASCII (no UTF-8 surprises) and ≤ 31 bytes. Adding a
  domain is additive; removing or renaming one is a `rulesetVersion`
  bump.
- **Why this option:** frozen string set means a Phase 6 PR adding
  `combat:crit-check` does not retroactively change the bytes of any
  Phase 3 roll. The `domain ‖ index` separation lets one action emit
  multiple rolls without collisions and with reviewer-readable intent.
- **If wrong:** domains are integer-prefixed bytes in the subhash
  pre-image. Reorganizing them is a `rulesetVersion` bump.

### 5. RunState in-memory shape: **canonical fields, no JSON serialization in Phase 3**

- **Chosen.**

  ```ts
  type RunState = {
    readonly fingerprintInputs: FingerprintInputs;  // commit/ruleset/seed/mods
    readonly stateHash: Uint8Array;                 // 32 bytes; advances per player action
    readonly floorN: int;                           // 1..10
    readonly floorState: FloorState;                // entities + items currently on floor
    readonly player: Player;                        // includes hpMax, atk, def, pos, hp
    readonly outcome: "running" | "dead" | "won";
    readonly actionLogLength: int;                  // count of player actions resolved
  };

  type FloorState = {
    readonly floor: Floor;                          // Phase 2 type, untouched
    readonly monsters: readonly Monster[];          // sorted by id
    readonly items: readonly FloorItem[];           // sorted by (y, x, id) -- Phase 6 grows this
  };
  ```

  Phase 3 does **not** serialize `RunState` to JSON. The action log is
  the save (SPEC.md principle 2). Phase 8 will introduce a separate
  `RunStateSnapshot` schema for the verifier API (with its own decision
  memo and frozen JSON shape). Phase 3 keeps `RunState` as an in-memory
  contract only, exposing it through `src/sim/run.ts` and read-only
  to the renderer (Phase 5).
- **Alternatives considered:**
  - **Mutable RunState** (`tick(state, action)` mutates in place).
    Rejected — replay invariant ("any prefix of an action log replays
    to the same intermediate state", from `docs/PHASES.md` Phase 3
    acceptance criteria) is much easier to test against an immutable
    `RunState` because each intermediate state can be captured and
    compared.
  - **Lazy deferred-action model** (build a transcript, resolve later).
    Rejected — over-engineered for v1; Phase 3's harness is already
    "scripted log → final state hash."
- **Why this option:** the immutable shape lets tests assert
  `tick(tick(tick(s0, a0), a1), a2)` equals replaying from `s0` on the
  log `[a0, a1, a2]`, which *is* the replay invariant the phase
  acceptance criteria ask for. Sorting collections by an explicit
  comparator (`monsters` by `id`, `items` by `(y, x, id)`) is the same
  determinism discipline Phase 2 uses for floor JSON.
- **If wrong:** `RunState` is one type declaration. Adding fields is
  additive; reshaping is a `rulesetVersion` bump only if the *fingerprint
  contract* changes — and Phase 3 doesn't change the fingerprint
  contract because `RunState` isn't on the fingerprint pre-image.

### 6. Per-floor sim sub-stream: **add `streams.simFloor(floorN)` accessor**

- **Chosen.** Extend `RunStreams` (Phase 1 + Phase 2 addendum B4) with a
  new accessor:

  ```ts
  // ADDED in Phase 3:
  simFloor(floorN: int32): PRNG
  // derives streamPrng(rootSeed, "sim", floorN)
  // records `"sim:" + floorN` into __consumed
  ```

  `streams.simFloor(floorN)` is the per-floor PRNG used for **floor-entry
  setup** only: the spawn shuffle (decision 6a) and item placement.
  Per-action combat **never** calls `streams.simFloor` — it only consumes
  the per-roll subhash from decision 4. This is the same defense-in-depth
  pattern Phase 2 used for `mapgen`: type-discipline + lint rule + runtime
  guard.

  The pre-existing `streams.sim()` (no-arg, frozen Phase 1) is **not
  changed**. It remains a no-arg accessor reserved for run-global entropy
  needs that don't exist yet (e.g., a future "shuffle starting inventory"
  step). Phase 3 does not consume `streams.sim()` at all; it consumes
  `streams.simFloor(floorN)` for floor-entry setup. Whether `streams.sim()`
  ever gets a Phase 3 caller is an open question deferred to the addendum.
- **Alternatives considered:**
  - **Salt the existing `streams.sim()` with floor inline.** I.e., have
    sim consumers call `streamPrng(rootSeed, "sim", floorN)` directly.
    Rejected — bypasses the per-instance `__consumed` tracker that
    Phase 2 added for stream-isolation auditing. The new accessor is the
    smaller change.
  - **Reuse `streams.mapgen(floorN)` for sim setup.** Rejected — mapgen's
    stream isolation lint rule (Phase 2 decision 7) explicitly forbids
    sim from touching mapgen's PRNG cursor. Even read-only "let me see
    what mapgen used" would couple the two layers in a way Phase 8's
    fingerprint pinning is intolerant of.
  - **Per-monster-id sub-stream.** Over-engineered; `simFloor(floorN)`
    plus the spawn shuffle's deterministic ordering produces a stable
    per-monster outcome without per-monster state.
- **Why this option:** narrowest extension to the Phase 1+2 frozen
  contract; preserves the per-call-delta `__consumed` audit (decision 8);
  keeps per-action combat free of PRNG cursor history.
- **If wrong:** the new accessor lives in `src/core/streams.ts` with a
  one-line decision-memo cite. Removing it (going back to inline
  `streamPrng` calls from sim) is a `rulesetVersion` bump because
  the salt encoding `(name="sim", salts=[floorN])` is the same; the
  *bytes consumed* don't change.

### 6a. Spawn placement: **deterministic shuffle of floor's encounter slots**

- **Chosen.** When the player enters a floor (including floor 1 at run
  start), `spawnFloorEntities(floorN, floor, runStreams)`:
  1. Allocates a fresh PRNG via `runStreams.simFloor(floorN)`.
  2. Iterates the floor's `encounters` array (Phase 2 sorts it by
     `(kind, y, x)` deterministically) and, for each slot whose kind
     allows the current floor (per the Phase 2 encounter registry's
     `allowedFloors` field), draws a `MonsterKindId` from the floor's
     eligible monster pool (decision 12) using the
     `spawn:monster-pick` roll domain seeded from a *snapshot of the
     spawn PRNG* (so the per-call subhash discipline still applies for
     audit; the PRNG provides the index into the eligible-monster array,
     not the bonus roll).
  3. For each spawned monster, assigns a stable id (`nextMonsterId++`,
     starting at 1).
  4. Returns the populated `FloorState`.

  Loot-slot encounters in Phase 3 are placeholders — they record an
  `item.cred-chip` data marker but no inventory mechanics fire. Phase 6
  wires in the actual loot logic.
- **Alternatives considered:**
  - **Deterministic round-robin** through the eligible-monster list
    (no PRNG needed). Rejected — produces same monster every time at
    every slot; trivially exploitable and aesthetically dull.
  - **Use the per-roll subhash (decision 4) keyed on the slot
    coordinates.** Defensible — but the spawn happens *before* the
    first action, so there is no `action` to feed the subhash. The
    per-floor sub-stream is the natural fit.
- **Why this option:** the spawn shuffle is a one-shot per-floor event,
  exactly the use case `streams.simFloor(floorN)` exists for. Using the
  PRNG only here keeps the per-action combat path free of stream-cursor
  state, satisfying the acceptance criterion.
- **If wrong:** `spawnFloorEntities` is one function. The eligibility-pool
  rules and the shuffle are revisable in Phase 6 (when content density
  shifts) without changing the floor-data contract from Phase 2.

### 7. Monster AI: **deterministic FSM, no PRNG, ascending-id tick order**

- **Chosen.** Phase 3 monster AI is a 2-state FSM per monster:

  ```ts
  type MonsterAIState = "idle" | "chasing";
  ```

  Per tick, in ascending `id` order:
  1. Compute `los = bfsDistance(monster.pos, player.pos, walkable, MAX_LOS_RADIUS)`.
  2. If `los <= MAX_LOS_RADIUS`: state ← `chasing`. Move one step toward
     the player along the BFS-optimal path (lexicographic tiebreak:
     prefer cardinal directions in the order `N, E, S, W`, then diagonals
     `NE, SE, SW, NW`). If adjacent to player, attack instead of moving.
  3. If `los > MAX_LOS_RADIUS` and state is `idle`: stay put.
  4. If `los > MAX_LOS_RADIUS` and state is `chasing`: revert to `idle`,
     stay put.

  `MAX_LOS_RADIUS` is pinned in `src/sim/params.ts` at **8 tiles**. No
  PRNG inside an AI tick; the lexicographic direction tiebreak makes
  every transition deterministic without randomness. Monster
  counterattack damage uses the per-roll subhash with domain
  `combat:counter-bonus` (decision 4a), keyed on the *player's* triggering
  action — so monster damage is still a function of `H(state ‖ action)`,
  honoring the acceptance criterion.
- **Alternatives considered:**
  - **Random walk when idle** drawn from `streams.simFloor(floorN)`.
    Rejected for v1 — adds PRNG-cursor consumption to the AI path,
    which is harder to audit. Phase 7 boss FSM (multi-phase) may
    need it; deferred.
  - **Pathfinding via A* with floats.** Rejected — floats banned in
    `src/sim/**`; BFS over the integer tile grid is sufficient for the
    LOS radius we're using.
  - **Each monster has its own `aiTick` PRNG sub-stream.** Over-engineered
    for v1.
- **Why this option:** zero-randomness AI means the replay invariant
  ("any prefix of an action log replays to the same intermediate state")
  falls out of the FSM definition; no PRNG-cursor synchronization issue
  is possible. The lexicographic tiebreak ensures cross-runtime
  consistency without depending on any object-iteration order.
- **If wrong:** AI is one function (`monsterTick`). Phase 7 will rev it;
  Phase 3's contract is just "deterministic, integer-grid, no floats,
  no PRNG."

### 8. Stream isolation for `src/sim/**`: **lint rule + runtime guard mirroring Phase 2's mapgen pattern**

- **Chosen.** Three layers, mirroring Phase 2 decision 7:
  1. *Type-level.* `tick(state: RunState, action: Action): RunState`
     and `monsterTick(state, monster): RunState` take `RunState`, not
     `RunStreams`. The PRNG is only available inside `spawnFloorEntities`
     (decision 6a) and is passed in by parameter; no helper consults
     module-level state.
  2. *Lint rule.* `src/sim/**` may not import or member-access
     `streams.mapgen`, `streams.ui`, or the Phase 1 `streams.sim()`
     no-arg accessor. (Sim *is allowed* to use `streams.simFloor(floorN)`
     inside `spawnFloorEntities` only.) Implemented as a new
     `eslint.config.js` scope with `no-restricted-syntax` selectors on
     `MemberExpression[property.name='mapgen' | 'ui']` and the existing
     `no-restricted-imports` patterns for `**/render/**`, `**/input/**`.
  3. *Runtime guard.* `tick(state, action)` snapshots
     `runStreams.__consumed` at entry and asserts at exit that the delta
     is *empty* — i.e., a single tick consumes no PRNG state. The
     spawn-only PRNG consumption happens at floor-entry (decision 6a)
     and asserts the per-floor delta is exactly `{"sim:" + floorN}`.
- **Why this option:** the same defense-in-depth Phase 2 used; auditing
  the per-action chain is then a question of "did anything enter the
  log that wasn't a player action?" — which the action-log shape
  trivially answers.
- **If wrong:** the lint scope and the runtime guard live in two
  files; both are easily revisable. The per-call delta semantic is
  re-used from Phase 2 addendum B4 with a single line of new prose.

### 9. Headless playthrough harness: **`runScripted({inputs, log}) → {finalState, perStepHashes}`**

- **Chosen.** A test-only entry point at `src/sim/harness.ts`:

  ```ts
  function runScripted(args: {
    inputs: FingerprintInputs;
    actions: readonly Action[];
  }): {
    finalState: RunState;
    perStepHashes: readonly string[];   // hex(stateHash) after each action
    logLength: int;
    outcome: "running" | "dead" | "won";
  };
  ```

  The harness is the single entry point for both the unit tests and
  the diagnostic-page "scripted playthrough" button. It does not load
  or write any DOM; it is pure function over its inputs.
- **Why this option:** the replay invariant (`any prefix → same state`)
  is testable directly: assert
  `runScripted({...args, actions: actions.slice(0, k)}).finalState`
  equals the k'th element of the longer run's intermediate states.
- **If wrong:** one function. Phase 8 replay viewer will reuse the
  same harness with an `onStep` callback to drive UI updates.

### 10. Diagnostic page extension: **add scripted-playthrough section under the floor preview**

- **Chosen.** Extend `src/main.ts` with a new `<section id="sim-scripted">`
  *below* the Phase 2 floor-preview section:
  - A button "Run scripted playthrough" (id `#scripted-run`).
  - On click, executes a hard-coded 100-action scripted log against a
    fixed seed (the same `ROOT` self-test seed, pinned).
  - Displays final state hash (hex), outcome (`running|dead|won`), and
    floor reached.
  - Sets `window.__SIM_FINAL_STATE_HASH__` (string, hex) and
    `window.__SIM_OUTCOME__` (one of the three strings) so Playwright
    can assert determinism cross-runtime.
  - The self-test banner remains the canonical "is this build healthy?"
    signal; the scripted-playthrough section is supplementary.
- **Why this option:** the Phase 3 acceptance criterion is "diagnostic
  page extended with a 'run a scripted playthrough' button that
  exercises the harness in the live deployment." This is the smallest
  UI satisfying it. Reusing the floor-preview pattern means the section
  shape is already familiar to the Phase 2 review.
- **If wrong:** the section is throw-away by design. Phase 5 replaces
  the diagnostic page with the actual game; the scripted-playthrough
  section is dropped or moved to a dev-mode dropdown.

### 11. Death and boss-kill state transitions: **outcome field, transition rules pinned**

- **Chosen.** `RunState.outcome` is a string-tagged sum:
  - `"running"` — initial state; allowed actions are the four from
    decision 3.
  - `"dead"` — set when `player.hp` drops to ≤ 0 *during action
    resolution*. Once `dead`, all further actions are no-ops (the
    state is terminal). The state hash *does not* advance after
    `dead` is reached; trailing actions in the log are discarded by
    `runScripted`.
  - `"won"` — set when the boss monster on floor 10 has `hp ≤ 0`.
    The boss is the singleton monster spawned in the floor-10
    `bossArena` (Phase 2 frozen contract).

  `descend` action on floor `n` (`1 ≤ n ≤ 9`) at the floor's `exit`
  cell moves the player to floor `n+1`'s entrance. `descend` on
  floor 10 is invalid (no `exit` per Phase 2 frozen contract; the
  win condition is killing the boss).
- **Why this option:** pinned now so Phase 7's win-screen and Phase 8's
  verifier-API contract have a stable signal. The "trailing actions
  ignored after death" rule means a 100-action scripted log that
  kills the player on action 47 has a deterministic final state and
  hash regardless of what's in actions 48–100; this is what the
  prefix-replay invariant requires.
- **If wrong:** the transition rules live in `src/sim/run.ts`. Adding
  a `"surrendered"` outcome later would be additive.

### 12. Monster registry (real content, ~6 kinds): `src/registries/monsters.ts`

- **Chosen.** Phase 3 ships a single registry file with ~6 monster
  kinds and one boss:

  | id                          | floors    | hpMax | atk | def | role                   |
  |-----------------------------|-----------|-------|-----|-----|------------------------|
  | `monster.ice.daemon`        | 1–3       | 4     | 2   | 0   | early-floor melee     |
  | `monster.ice.spider`        | 2–5       | 6     | 3   | 1   | mid-floor melee        |
  | `monster.corp.sec-rookie`   | 3–6       | 8     | 4   | 2   | mid-floor armored     |
  | `monster.corp.sec-veteran`  | 5–9       | 12    | 6   | 3   | late-floor armored    |
  | `monster.drone.sentry`      | 4–9       | 9     | 5   | 1   | late-floor glass-cannon |
  | `monster.gang.razorgirl`    | 6–9       | 14    | 7   | 4   | late-floor heavy       |
  | `monster.boss.black-ice-v0` | 10        | 40    | 9   | 5   | boss                   |

  All values are integers. `allowedFloors` follows the floor column.
  Stat numbers are placeholders; balance tuning is Phase 9 polish.
  Stable IDs from day one (SPEC.md principle 5).
- **Alternatives considered:**
  - **One generic monster.** Rejected — Phase 3 acceptance criterion
    asks for "death and boss-kill state transitions reachable via
    the test harness," which needs at least one monster the player
    can kill on floor 1 plus a boss on floor 10. Six is the smallest
    set that gives meaningful test coverage of the eligibility-by-floor
    logic.
  - **Twelve monsters now.** Out of scope — Phase 3 deliverable line
    in `docs/PHASES.md` doesn't specify a count; the SPEC's "~12-15"
    target is for v1. Phase 6 / 7 grow the registry.
- **Why this option:** smallest registry that exercises every code
  path in the spawn-eligibility logic, the AI FSM, and the
  death/boss-kill transitions. Easily extensible.
- **If wrong:** content is registry data, append-only by convention.

### 13. Item registry (data only, no inventory mechanics): `src/registries/items.ts`

- **Chosen.** Phase 3 ships ~5 items as **registry data only** — no
  inventory mechanics, no `use` action, no equip slot. The registry
  is exported for Phase 6 to consume:

  ```ts
  type ItemKindId =
    | "item.cred-chip"          // currency placeholder
    | "item.stim-patch"         // healing
    | "item.trauma-pack"        // bigger healing
    | "item.cyberdeck-mod-1"    // equipment placeholder
    | "item.weapon.knife";      // equipment placeholder
  ```

  Each entry has: `id`, `kind` (`"currency" | "consumable" | "equipment"`),
  `tier` integer (Phase 6 will use for shop pricing). No `use` semantics
  in Phase 3 — `tick` does not understand items.
- **Why this option:** stable IDs from day one (principle 5); Phase 6
  adds inventory mechanics without revisiting registry shape; floor-loot
  encounters can record an item id at spawn time even if there's no
  pickup/drop logic yet.
- **If wrong:** registry data only; revisable.

### 14. Phase split: **3.0 (planning), 3.A (sandbox), 3.B (live verification)**

- **Chosen.** Phase 3 ships in three commits, mirroring Phase 1.A/1.B
  and Phase 2.0/2.A/2.B:
  - **Phase 3.0 — planning gate.** This memo plus the
    `architecture-red-team` review at `artifacts/red-team-phase-3.md`
    plus an addendum that supersedes the original prose where blocking
    issues required revision. Carry-forward Phase 2.A follow-ups
    (decision 16) land in this commit only as planning entries — their
    code lands in 3.A.
  - **Phase 3.A — sandbox-verifiable.** All sim code, registries, the
    `streams.simFloor` extension, lint extensions, runtime guards,
    diagnostic-page extension, scripted-playthrough harness, golden
    `SIM_DIGEST` self-test, Playwright assertion. `npm ci && npm run
    lint && npm run test && npm run build && npm run test:e2e` all
    green inside the sandbox. Plus the three Phase 2.A carry-forward
    follow-ups (decision 16). Phase 2.A code-review nits N3, N7
    are addressed; N6 (door coverage) remains deferred.
  - **Phase 3.B — live verification.** Push 3.A to master, observe the
    deploy workflow run green, observe the live URL serves the new
    diagnostic page with the scripted-playthrough button rendering,
    observe the cross-runtime Playwright job (extended with two new
    sim assertions) runs green on chromium / firefox / webkit. No new
    code expected.
- **Why this option:** the Phase 1 / Phase 2 split worked. Repeating
  it preserves the audit trail, keeps each commit's review surface
  small, and matches the operating rule "next smallest verified step."
- **If wrong:** 3.B reveals a regression → that's a 3.B blocker fixed
  before approval. We do not approve 3.A on the basis of "it'll
  probably work in CI."

### 15. Determinism guard: **two new self-tests + golden SIM digest**

- **Chosen.** Add to `src/core/self-test.ts`:
  - `sim-cross-runtime-digest`: run `runScripted({inputs: SELF_TEST_INPUTS,
    actions: SELF_TEST_LOG_100})`, where `SELF_TEST_LOG_100` is a fixed
    100-action log pinned in `src/sim/self-test-log.ts`. Hex-encode the
    final `stateHash`, assert against a hardcoded `SIM_DIGEST` constant.
    Same rationale as Phase 1's `RANDOM_WALK_DIGEST` and Phase 2's
    `MAPGEN_DIGEST`: any silent cross-runtime drift in turn-loop
    ordering, AI FSM, combat formula, or roll derivation surfaces
    here in any runtime (Node, Chromium, Firefox, WebKit).
  - `sim-stream-isolation`: allocate a fresh `streamsForRun(...)`,
    construct a `RunState` for floor 1 (which calls
    `spawnFloorEntities` and consumes `streams.simFloor(1)`), assert
    `[...streams.__consumed]` includes `"sim:1"` and contains no
    `"mapgen:*"` or `"ui"` entry. Then run `tick(state, action)` for
    a single player action and assert the consumed-set is unchanged
    (per-tick zero-PRNG-consumption invariant from decision 8).
- **Why this option:** keeps the same "the diagnostic page is the
  proof" posture established in Phase 1 and Phase 2. The
  `SIM_DIGEST` will live next to its peers forever and is a few
  lines of maintenance.
- **If wrong:** removing the golden digest is a `rulesetVersion`
  bump and reviewed by `architecture-red-team`. Adding more digest
  probes is additive.

### 16. Phase 2.A carry-forward follow-ups land in Phase 3.A

- **Chosen.** Per `artifacts/phase-approval.json`'s
  `follow_ups_carried_forward_from_phase_2A`, three items are
  recorded as Phase 3.A scope:
  - **Code-review #N3.** Add a focused unit test for
    `tools/gen-fixtures.ts` — covering `slug` rejection on
    non-alphanumeric input, `generatePair` happy path, and
    `readManifest` malformed input. Approximate size: 30–50 lines
    of test. Lands as the first commit in Phase 3.A's drift-detection
    sweep.
  - **Code-review #N7.** Relocate `decodeBase64Url` from
    `src/mapgen/serialize.ts` to `src/core/hash.ts`, alongside the
    existing `base64url` encoder. Pure organizational cleanup;
    round-trip correctness is already verified. Lands as a small
    refactor commit before any sim/ code is written. **Note:** the
    Phase 2.A serializer expects `decodeBase64Url` to throw on
    malformed input; the relocation must preserve this behavior
    byte-for-byte. The fixture-pack round-trip tests will catch
    a regression.
  - **Code-review #N6 (door coverage).** **Stays deferred** to a
    future phase. The door logic is locked by the fixture pack; any
    fix is a `rulesetVersion` bump. The earliest fit is Phase 7
    (boss arena door semantics); revisit then.
- **Why this option:** drift-detection per QUALITY_GATES — Phase 3
  builds on Phase 2's mapgen output, so honoring the open follow-ups
  before adding sim/ scope keeps the foundation clean.
- **If wrong:** N3 and N7 are tiny patches; if either reveals
  unexpected complexity, fall back to a `phase-update.json` and
  re-plan. N6 stays deferred either way.

## Frozen contracts established by this phase

These join the Phase 1 + Phase 2 frozen contracts in
`docs/ARCHITECTURE.md`. Changing any of them is a `rulesetVersion`
bump and breaks every fingerprint shared before the change.

1. **Action type vocabulary.** `wait`, `move`, `attack`, `descend` —
   string values for `Action.type`. Per-`type` field-presence rules
   per decision 3. Adding a `type` is additive; removing/renaming is a
   bump.
2. **Roll derivation function.** `rollBytes(state, action, domain, index)
   = sha256(state ‖ encodeAction(action) ‖ lp_utf8(domain) ‖ u32_le(index))`.
   Frozen.
3. **Roll domain registry.** `combat:atk-bonus`, `combat:counter-bonus`,
   `ai:tiebreak`, `spawn:monster-pick`, `spawn:monster-pos`. Domains
   are bare ASCII, ≤ 31 bytes. Adding additive; removing/renaming a
   bump.
4. **Combat damage formula.** `dmg = max(1, atk - def + bonus)` where
   `bonus = rollU32(state, action, "combat:atk-bonus", 0) & 0x03`.
5. **Player entity id pinned to 0.** Monster ids `1..N` assigned in
   floor-entry spawn order.
6. **Turn order.** Player tick → resolve → monsters tick in ascending
   `id` order. Per-tick state-chain advance is one per *player action*,
   not per monster decision.
7. **Monster AI is zero-PRNG inside a tick.** AI consults only the
   integer grid + integer attributes; ties are broken by direction
   list `N, E, S, W, NE, SE, SW, NW`.
8. **`streams.simFloor(floorN)` accessor** added to `RunStreams`.
   Records `"sim:" + floorN` into `__consumed`. Salt encoding
   `(name="sim", salts=[floorN])` matches the Phase 1
   `streamSeed` rules unchanged.
9. **Per-tick `__consumed` delta is empty.** A single `tick(state,
   action)` advances the chain via the per-roll subhash; it does
   not consume PRNG cursors. Asserted by the `sim-stream-isolation`
   self-test.
10. **`RunState.outcome` ∈ {`running`, `dead`, `won`}.** Adding a
    fourth outcome is additive iff existing transition rules are
    preserved.
11. **`MAX_LOS_RADIUS = 8`.** Pinned in `src/sim/params.ts`. Bumping
    is a `rulesetVersion` bump.
12. **`SIM_DIGEST` golden constant.** SHA-256 of the final state hash
    after running `SELF_TEST_LOG_100` against `SELF_TEST_INPUTS`.
    Pinned in self-test; any silent change is a bump.

## Out of scope for Phase 3 (deferred)

- **Inventory mechanics** (pickup, drop, equip, unequip, use). Phase 6.
- **Ranged attacks / `target` field semantics.** Phase 6 (item-bound)
  or Phase 7 (boss multi-phase). Phase 1's `target?: int32` field
  remains reserved.
- **Item-use action descriptors** (`type: "use", item: ItemKindId`).
  Phase 6.
- **Multi-phase boss FSM.** Phase 7. Phase 3's boss is a single-state
  high-HP monster; the win-state transition fires when its HP ≤ 0.
- **Renderer reading sim state.** Phase 5. Phase 3 keeps `RunState`
  as an in-memory contract only; the diagnostic-page scripted-playthrough
  button reads only the final state hash and outcome.
- **Atlas integration.** Phase 4. Monster registry has no atlas-id
  field yet; Phase 4's atlas recipes will associate sprites at that
  layer.
- **Save / resume** (action-log persistence to localStorage). Phase 8.
- **Verifier API + `RunStateSnapshot` JSON.** Phase 8.
- **Field-of-view / fog-of-war.** Phase 5+ (renderer concern).

## Phase 3 acceptance criteria — restated, with this memo's decisions

- A 100-action scripted run on a fixed `FingerprintInputs` produces the
  same final state hash on every machine and across both Node and
  browser builds. **(decisions 9, 15)**
- Combat outcomes are computed solely from `H(stateHash ‖ encodeAction(action))`
  — no other entropy enters the per-action sim path (audited via the
  `sim-stream-isolation` self-test which asserts per-tick `__consumed`
  delta is empty). **(decisions 4, 8, 15)**
- Death and boss-kill state transitions are reachable via the test
  harness. **(decisions 9, 11, 12)**
- Replay invariant: any prefix of an action log replays to the same
  intermediate state. **(decisions 5, 9)**
- Diagnostic page extended with a scripted-playthrough button working
  on the live URL. **(decision 10; observed in Phase 3.B)**
- Phase 2.A carry-forward follow-ups landed (N3 unit test, N7
  decoder relocation). **(decision 16)**

## Risks (Phase 3 specific)

- **Roll derivation is the new hot frozen contract.** Any change to
  `rollBytes` invalidates every fingerprint shared after Phase 3 ships.
  Mitigated by: pinning the formula in `src/sim/combat.ts`, the
  `SIM_DIGEST` self-test in every runtime, and the
  `architecture-red-team` review trigger on any
  `src/sim/combat.ts` change.
- **AI FSM tiebreak ordering is silent if not pinned.** Two implementers
  could diverge on diagonal tiebreak order. Mitigated by frozen-contract
  item 7 and a unit test asserting a specific monster's path against
  a hardcoded sequence on a fixed seed.
- **Per-floor `streams.simFloor` extension is a Phase 1 contract
  addition.** Same class of change as Phase 2's `__consumed` extension
  was. Mitigated by classifying it explicitly as a Phase 1 contract
  addendum (decision 6), updating `docs/ARCHITECTURE.md`'s
  "Stream derivation" section, and re-running the
  Phase 1 + Phase 2 self-tests to confirm no regression.
- **Object iteration order leaking nondeterminism.** Already addressed
  by the Phase 1 lint rule (`no for..in / Object.entries / Object.keys
  / Object.values without sortedEntries`) but particularly load-bearing
  in Phase 3 because `tick` iterates monsters. Mitigated by sorting
  `monsters` by `id` at every read site and by the existing lint scope
  expansion to `src/sim/**`.
- **Action descriptor schema changes mid-project.** `docs/PHASES.md`
  Phase 3 risks call this out; the only schema change Phase 3 makes is
  *adding string values* for `type`, which the wire format treats as
  opaque. Mitigated by frozen-contract item 1.
- **Trailing-action-after-dead semantics surprise.** A scripted log
  that kills the player at action 47 then has 53 more actions; the
  state hash stops advancing at action 47. If a future phase adds a
  "post-mortem actions" feature (e.g., death cam), the contract
  changes. Documented in decision 11; not a current bug.
- **Carry-forward N7 (decoder relocation) introduces import cycle
  risk.** `src/core/hash.ts` would now host both `base64url` encoder
  and `decodeBase64Url` decoder; `src/mapgen/serialize.ts` imports
  the decoder. The existing `base64url` encoder import in
  `src/mapgen/serialize.ts` already establishes the
  `mapgen → core/hash` direction; adding the decoder import does not
  create a cycle. Verified by reading the import graph; documented
  here as a check item for the code-reviewer.

## Open questions deferred from this memo

- **Whether `streams.sim()` (no-arg) ever gets a Phase 3 caller.**
  Currently it is reserved but unused. Could be deleted (frozen-contract
  bump) or kept for run-global entropy in Phase 6 (e.g., starting
  inventory roll). Deferred — the no-arg accessor is part of the Phase 1
  frozen contract; deleting it is a bump regardless.
- **Whether monster spawn density should scale with floor number.**
  Phase 3 spawns one monster per `encounter.combat.basic` slot whose
  `allowedFloors` includes the current floor. Future tuning may want
  multiple monsters per slot, or empty slots. Deferred to Phase 6
  when item-content density also gets tuned.
- **Whether the AI should remember "last seen player position"**
  (a pursuit-investigation FSM transition). Phase 3 ships a 2-state
  FSM; a 3-state FSM (`idle | chasing | investigating`) is a
  candidate for Phase 7's boss AI. Deferred.
- **Whether the diagnostic page should expose the per-step state
  hashes** (in addition to the final hash). Useful for debugging
  but clutters the page; deferred. The CLI / harness exposes them.

## Phase 2.A code-review nits revisited

For audit clarity, the disposition of all seven Phase 2.A code-review
nits at the start of Phase 3 is recorded here:

| Nit | Disposition |
|---|---|
| N1 — `bundle-report` artifact deviates from addendum N5 | Closed in Phase 2.A — `docs/ARCHITECTURE.md:362-367` was rewritten to reflect the actual artifact (build output, not visualizer treemap). |
| N2 — `parseFloor` exported from `src/mapgen/index.ts` | Closed in Phase 2.A — `src/mapgen/index.ts:14-17` removes the export with a comment citing addendum N6. |
| N3 — `tools/gen-fixtures.ts` lacks a unit test | **Open.** Phase 3.A scope (decision 16). |
| N4 — `--floor 1.5` silently truncates | Closed in Phase 2.A — `tools/gen-floor.ts` validates against `/^-?\d+$/`. |
| N5 — `seed.test.ts` golden digest tautology | Closed in Phase 2.A — replaced with hardcoded hex. |
| N6 — door-placement coverage sparse | **Deferred.** Frozen by fixture pack; revisit in Phase 7 (decision 16). |
| N7 — `decodeBase64Url` location | **Open.** Phase 3.A scope (decision 16). |

The "Open" rows are the carry-forwards explicitly listed in
`artifacts/phase-approval.json:47-51`.

---

## Addendum — architecture-red-team review response

`architecture-red-team` reviewed this memo (see
`artifacts/red-team-phase-3.md`) and returned verdict **REVISE BEFORE
IMPLEMENTATION** with three blocking issues and several non-blocking
concerns. Each is addressed below; the original decision text above is
left intact for audit-trail clarity, and this addendum overrides any
conflicting prose. Once the addendum lands, the verdict reverts to
**APPROVE** and Phase 3.A code may be written.

*(Addendum text appended after red-team review; see below.)*
