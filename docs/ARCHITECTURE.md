# ICEFALL architecture

This document is the steady-state architecture reference. It captures the
boundaries, contracts, and binary encodings that are load-bearing for the
project's "deterministic from seed all the way down to the pixel" promise.

The byte-level encodings here are **frozen contracts**. Changing any of
them is a `rulesetVersion` bump and breaks every fingerprint shared
before the change. Treat them as carefully as a wire protocol — because
that is what they are.

## System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser process                                                     │
│                                                                     │
│  ┌──────────┐    ┌─────────┐    ┌─────────────┐    ┌──────────────┐ │
│  │  input/  │───▶│  sim/   │───▶│   render/   │───▶│  HTML canvas │ │
│  │ keyboard │    │ (turn,  │    │ (atlas blit)│    └──────────────┘ │
│  └──────────┘    │ combat) │    └─────────────┘                     │
│                  └────┬────┘                                        │
│                       │                                             │
│              ┌────────┴────────┐                                    │
│              ▼                 ▼                                    │
│        ┌──────────┐      ┌──────────┐                               │
│        │ mapgen/  │      │  core/   │                               │
│        │ (floors) │      │ (PRNG,   │                               │
│        └────┬─────┘      │  hash,   │                               │
│             └────────────┤ streams, │                               │
│                          │ state-   │                               │
│                          │ chain,   │                               │
│                          │ finger-  │                               │
│                          │ print)   │                               │
│                          └──────────┘                               │
│                                                                     │
│  Build-time only: tools/gen-atlas.ts → assets/atlas.{png,json}      │
└─────────────────────────────────────────────────────────────────────┘
```

Phase 1 builds `core/` only. The remaining boxes are stubbed; they slot
in as their phases land.

## Layer boundaries

| Layer | Imports allowed | Imports forbidden |
|---|---|---|
| `src/core/` | `@noble/hashes/sha256` only | anything browser-specific (`window`, `document`, `crypto.subtle`), anything async, anything in `src/sim/`, `src/render/`, `src/input/`, `src/atlas/` |
| `src/sim/` | `src/core/`, `src/registries/` | `Math.random`, `Date.now()`, `performance.now()`, `new Date()`, floating-point arithmetic, iteration over un-ordered collections without `sortedEntries()`, `src/render/`, `src/input/`, `src/atlas/` |
| `src/mapgen/` | `src/core/`, `src/registries/` | same as `sim/`, plus member-access of `.sim` or `.ui` on any object (stream-isolation lint rule, memo decision 7) |
| `src/atlas/` | `src/core/`, `src/registries/` | `src/sim/`, `src/mapgen/`, `src/render/`, `src/input/`, `src/main`; `node:buffer`, `crypto`, `node:crypto`; `Buffer` global; `crypto.subtle` member access (Phase 4 addendum B4) |
| `src/registries/` | none (pure data + types) | anything from `src/sim/`, `src/mapgen/`, `src/render/`, `src/input/`, `src/atlas/` |
| `src/render/` | `src/core/` (read-only types only), `src/sim/` (read-only state), atlas assets | writing to `src/sim/` state, importing `src/core/streams` or `src/sim/combat` |
| `src/input/` | none from core/sim/render | writing to `src/sim/` state directly |
| `tools/` | `src/core/`, `src/mapgen/`, `src/registries/`, `src/atlas/` (build-time only), Node-only modules with the `node:` prefix | the running game's `src/main.ts`, `src/render/`, `src/input/`, browser-only paths; bare `fs`/`path`/`url` (Phase 4 addendum N10) |

These rules are enforced primarily by ESLint configuration scoped via
`overrides` plus a custom `no-float-arithmetic.cjs` rule under
`src/sim/**`. The full rule set is documented in
`artifacts/decision-memo-phase-1.md` decision 6 and addendum B6.

## Data model — frozen contracts

### Stream derivation

Every PRNG stream is derived deterministically from the run's root seed:

```
streamSeed(rootSeed, name, ...salts) =
  sha256( rootSeed
       || utf8("icefall:v1:")
       || lp_utf8(name)
       || encodeSalt(salts[0])
       || encodeSalt(salts[1])
       || ... )

PRNG_state ← first 16 bytes of streamSeed, loaded as four little-endian u32s
PRNG       ← sfc32(state[0], state[1], state[2], state[3])
```

Where:
- `rootSeed` is a `Uint8Array` of any length (typically a hash digest).
- `lp_utf8(s)` is `[byte_length:1][utf8_bytes...]`. `s` is rejected if it
  is not well-formed UTF-16 (no lone surrogates) or if its UTF-8 byte
  length exceeds 255.
- `"icefall:v1:"` is the domain tag. Bumping it invalidates every
  fingerprint and is reserved for breaking encoding changes.
- `encodeSalt` is closed over three input types:

```
encodeSalt(value):
  if value is a number:
    require Number.isInteger(value) and INT32_MIN ≤ value ≤ INT32_MAX
    emit [0x01][int32 LE]                              // 5 bytes
  if value is a string:
    require well-formed UTF-16; let b = TextEncoder.encode(value)
    require b.length ≤ 255
    emit [0x02][len:1][b...]                           // 2 + len bytes
  if value is a Uint8Array:
    require value.length ≤ 65535
    emit [0x03][len:2 LE][bytes...]                    // 3 + len bytes
  otherwise: throw — programmer error
```

`encodeSalt` is independent of the action encoder. Bumping
`ACTION_VERSION` does not affect stream derivation.

Named streams in Phase 1:
- `streams.mapgen(floorN: int32)` — `name = "mapgen"`, `salts = [floorN]`.
- `streams.sim()` — `name = "sim"`, `salts = []`.
- `streams.ui()` — `name = "ui"`, `salts = []`.

### `RunStreams.__consumed` (Phase 2 addition)

The `RunStreams` object returned by `streamsForRun(rootSeed)` carries an
opaque `__consumed: ReadonlySet<string>` view that records every stream
key that has been requested through this instance. Each accessor records
its key on first call:

- `streams.mapgen(floorN)` → records `"mapgen:" + floorN`
- `streams.sim()`          → records `"sim"`
- `streams.ui()`           → records `"ui"`

The set is per-`RunStreams` instance (no global state). It is the
substrate for the mapgen runtime guard: `generateFloor(floorN, streams)`
snapshots `__consumed` at entry, runs, and asserts at exit that the
delta is exactly `{"mapgen:" + floorN}` — the per-call invariant pinned
by the Phase 2 decision memo's addendum (B4).

### Floor data model (Phase 2)

A generated floor is a frozen-shape object:

```ts
type Floor = {
  floor: int;            // 1..10
  width: int;            // 60 for floors 1..9, 40 for floor 10
  height: int;           // 24 for floors 1..9, 28 for floor 10
  tiles: Uint8Array;     // length width*height, row-major (tiles[y*w + x])
  rooms: Room[];         // sorted by id
  doors: Door[];         // sorted by (y, x)
  encounters: Encounter[]; // sorted by (kind, y, x)
  entrance: Point;
  exit: Point | null;       // null on floor 10
  bossArena: Rect | null;   // non-null on floor 10
};
```

with frozen tile codes:

```
TILE_VOID  = 0    TILE_WALL  = 2
TILE_FLOOR = 1    TILE_DOOR  = 3
```

Codes 4–255 reserved for additive expansion in later phases. Floor 10
is structurally distinguished: `bossArena !== null` and `exit === null`,
with the arena occupying a ~20×20 rectangle and one
`encounter.boss-arena.entry` slot just outside its north door.

### Floor JSON canonical schema (Phase 2)

Top-level keys are emitted in alphabetical order: `bossArena, doors,
encounters, entrance, exit, floor, height, rooms, schemaVersion,
tilesB64, tilesShape, width`. **Every key is always present** —
`bossArena` is JSON `null` for floors 1–9, never omitted; `exit` is JSON
`null` for floor 10, never omitted. `tilesB64` is RFC 4648 §5 base64url
(URL-safe alphabet), unpadded — encoded via the existing
`src/core/hash.ts:base64url`. `parseFloor` is **strict**: unknown
top-level keys cause it to throw; missing required keys cause it to
throw; the `bossArena !== null` xor `exit !== null` invariant is
enforced. Adding a field is a `schemaVersion` bump and a
`architecture-red-team` review event.

`parseFloor` is invoked only on the output of `serializeFloor`. Phase 8
will introduce a separate `parseExternalFloor` for hostile-input
validation when URL-routed floors land.

### Stable-ID registries (Phase 2)

Two registries land in `src/registries/`:

- `rooms.ts` exports `ROOM_KINDS` covering: `room.entrance`, `room.exit`,
  `room.regular`, `room.boss-arena`, `room.boss-antechamber`. Each entry
  has placement metadata (size limits, allowed floors).
- `encounters.ts` exports `ENCOUNTER_KINDS` covering:
  `encounter.combat.basic`, `encounter.combat.elite`,
  `encounter.loot.basic`, `encounter.boss-arena.entry`. Each entry has
  slot-placement metadata (allowed floors, in-room vs corridor vs
  door-adjacent).

Phase 2 places only the slots; content (which monster spawns at
`encounter.combat.basic` on floor 4) is Phase 6/7 work. Registries are
**append-only by convention**; the registry-immutability enforcement
test is deferred to Phase 6, when a second writer of the registry
exists.

### `seedToBytes` (Phase 2)

```
seedToBytes(seed: string) = sha256(utf8(seed))
```

Maps a user-facing seed string to a 32-byte root seed. Used by mapgen,
the diagnostic page, and the `tools/gen-floor.ts` CLI before passing
entropy into `streamsForRun`. Frozen contract — see
`artifacts/decision-memo-phase-2.md` addendum N2.

### State-hash chain

```
genesis() = sha256( utf8("icefall:state:v1:genesis") )    // 32 bytes
advance(state, action) = sha256( state || encodeAction(action) )
```

`state` is always 32 raw bytes — never hex, never base64. The hex/base64
forms are presentation-only.

### Action descriptor encoding

The action descriptor is the serialized form of one player input. It is
the only thing that advances the state chain. Monster behavior is drawn
from `streams.sim()` cursor advancement keyed on the post-action state
hash; monster decisions do not appear on the chain themselves.

Phase 1 schema (extension in later phases is additive — new optional
fields receive new strictly-greater tags):

```
type Action = {
  type: string;       // 1..64 bytes UTF-8, well-formed
  target?: number;    // signed int32
  item?: string;      // 0..255 bytes UTF-8, well-formed
  dir?: 0|1|2|3|4|5|6|7;
};

ACTION_VERSION = 0x01

Wire format (one action):
  [0x01]                       version, 1 byte (matches ACTION_VERSION)
  [type_len:1][type_bytes...]  1 ≤ type_len ≤ 64
  for each present optional field, in strictly increasing tag order:
    [tag][payload]
      TAG_TARGET (0x10): payload is 4 bytes int32 LE, two's complement
      TAG_ITEM   (0x20): payload is [item_len:1][item_bytes:0..255]
      TAG_DIR    (0x30): payload is 1 byte in {0..7}
  end-of-action: implicit (no terminator)

Field tags 0x00 and 0xFF are reserved. New optional fields must use a
strictly greater tag than any existing one and must be strictly increasing
on the wire.
```

UTF-8 byte length is `TextEncoder.encode(s).length`. Strings are
**rejected** at encode time if their UTF-16 form contains an unpaired
surrogate. Integers are encoded via `DataView.setInt32(_, _, true)`.

Bumping `ACTION_VERSION` is the only allowed way to change this format,
and bumping it bumps `rulesetVersion`.

### Run fingerprint

```
fingerprintBytes = sha256(
   utf8(commitHash)
|| 0x00
|| utf8(rulesetVersion)
|| 0x00
|| utf8(seed)
|| 0x00
|| utf8(sortedModIds.join(","))
)
```

Where `sortedModIds` is the input `modIds` array sorted by JavaScript
string `<` comparison (UTF-16 code-unit order). Empty array encodes as
the empty string. Mod IDs themselves must not contain `,` or NUL.

```
fingerprint(...)        = base64url(fingerprintBytes).slice(0, 22)
fingerprintFull(...)    = base64url(fingerprintBytes)            // 43 chars
```

`base64url` is RFC 4648 §5 alphabet, unpadded.

**Placeholder ruleset.** During Phase 1 the build-time `rulesetVersion`
is the literal string `"phase1-placeholder-do-not-share"`. When that
exact value is passed to `fingerprint(...)`, the result is prefixed with
`DEV-`. Phase 4 wires the real ruleset (`sha256(rulesText ‖
atlasBinaryHash)`) and refuses to load any fingerprint that decodes to a
`DEV-` prefix.

### Phase 3 frozen contracts (entity model, turn loop, combat)

These are the contract additions Phase 3.0's planning gate locks in;
the canonical reference is `artifacts/decision-memo-phase-3.md` (with
the addendum at the bottom resolving B1–B6 from the architecture
red-team review). Implementation of these contracts lands in Phase
3.A.2; the relocations they require for the foundation
(`decodeBase64Url` co-located with `base64url`, focused unit-test
coverage on `src/core/hash.ts`) land in Phase 3.A.1's drift-detection
sweep.

**Action type vocabulary (Phase 3 strings).** Phase 1's `Action`
encoding is unchanged. Phase 3 adds these strings as legal values for
`Action.type`:

| `type`     | required fields | optional fields | purpose                            |
|------------|------------------|------------------|------------------------------------|
| `wait`     | (none)           | (none)           | pass turn; monsters still tick     |
| `move`     | `dir`            | (none)           | step one cell in direction         |
| `attack`   | `dir`            | (none)           | melee attack adjacent cell         |
| `descend`  | (none)           | (none)           | descend stairs at floor exit       |

Adding a `type` value is additive; removing or renaming one is a
`rulesetVersion` bump.

**Roll-derivation function.** Per-action combat entropy is derived as:

```
ROLL_DOMAIN_ANCHOR = utf8("icefall:roll:v1:")  // 16 bytes, fixed ASCII

rollPreimage(stateHashPre, action, domain, index) =
  stateHashPre                                 // 32 bytes
  ‖ encodeAction(action)                       // Phase 1 wire format
  ‖ ROLL_DOMAIN_ANCHOR                         // 16 bytes
  ‖ [utf8(domain).length:1]                    // 1 byte
  ‖ utf8(domain)                               // 1..31 bytes
  ‖ DataView.setUint32(_, index, true)         // 4 bytes, LE u32

rollBytes(...) = sha256(rollPreimage(...))     // 32 bytes
rollU32(...)   = (b[0] | (b[1]<<8) | (b[2]<<16) | (b[3]<<24)) >>> 0
                 where b = rollBytes(...)[0..4]
```

`domain` must be well-formed UTF-16, `1 ≤ utf8(domain).length ≤ 31`,
and Phase 3's frozen domains are additionally 7-bit ASCII. `index` is
`Number.isInteger && 0 ≤ index ≤ 2^32 - 1`. Sub-ranges of `rollU32` are
extracted by **bitwise AND with a low-bit mask** (`& 0x03`, `& 0x0f`,
…); high-bit shifts are not used. Future helpers (`rollU64`, etc.)
consume non-overlapping byte ranges of the same per-call subhash and
are pinned at point of introduction.

**Roll-domain registry (Phase 3).** Frozen domain set:

| domain                  | purpose                                           |
|-------------------------|---------------------------------------------------|
| `combat:atk-bonus`      | damage roll bonus on player-initiated attack     |
| `combat:counter-bonus`  | damage roll bonus on monster counterattack       |

Adding a domain is additive; removing or renaming a bump.

**Combat damage formula.** `bonus = rollU32(stateHashPre, action,
"combat:atk-bonus", 0) & 0x03 ∈ [0..3]`; `dmg = max(1, atk - def +
bonus)`. Damage application clamps `target.hp = max(0, target.hp -
dmg)`; on `target.hp === 0` the resolver short-circuits — no further
rolls in the same action are computed, no entropy is consumed.

**Player entity id pinned to 0.** Monster ids `1..N` are assigned in
floor-entry spawn order and persist for the entity's life. `RunState`
collections are sorted: `monsters` by `id`, `items` by `(y, x, kind)`.

**Turn order.** One player action → resolve → monsters tick in
ascending `id` order. The state hash advances exactly once per *player
action*; monster decisions do not appear on the chain.

**Monster AI is zero-PRNG and zero-roll inside a tick.** AI consults
only the integer grid + integer attributes. BFS distance map is
computed *from the player's position* with 8-connected adjacency; the
monster picks the single adjacent walkable cell whose distance is one
less than its own distance, breaking ties by the direction list **N,
E, S, W, NE, SE, SW, NW** with `(dy, dx)` deltas where y increases
southward (matching `tiles[y * width + x]` row-major addressing). The
pinned `MAX_LOS_RADIUS = 8` BFS steps is the maximum at which a
monster transitions to `chasing`. `bfsDistance(...)` returns the
integer step count if reachable in `[0, MAX_LOS_RADIUS]`, else returns
the integer sentinel `MAX_LOS_RADIUS + 1` — never `Infinity`, never
`-1`, never a float.

**`streams.simFloor(floorN)` accessor.** Added to `RunStreams`.
`floorN` must satisfy `Number.isInteger(floorN) && 1 ≤ floorN ≤ 10`;
violations throw `simFloor: floorN must be 1..10 (got N)`. Returns
`streamPrng(rootSeed, "sim", floorN)` and records `"sim:" + floorN`
into `__consumed`. The salt encoding `(name="sim", salts=[floorN])` is
distinct from `streams.sim()`'s zero-salt pre-image — collision-free
by construction (different total length, different tail bytes).

**Per-tick `__consumed` delta is empty; floor-entry delta is exactly
`{"mapgen:<floorN>", "sim:<floorN>"}`.** `tick(state, action): RunState`
is a pure function of `RunState` and `Action`; it does not access
`RunStreams`. Floor-entry spawn (`generateFloor` + `spawnFloorEntities`)
happens in the run loop (`runScripted` and Phase 5+'s input-driven
equivalent) outside `tick`. `src/sim/harness.ts` is the only file in
`src/sim/**` permitted to import `generateFloor` from
`src/mapgen/index.ts`; this exception is recorded in
`eslint.config.js` and is expected to migrate to a dedicated
`src/run/` layer in Phase 5+.

**`RunState.outcome` ∈ {`running`, `dead`, `won`}.** Death detection
is per-damage-application; once `outcome === "dead"`, subsequent
actions in the harness's input log do not advance the chain and are
discarded by `runScripted`'s `logLength` field. Adding a fourth
outcome is additive iff existing transition rules are preserved.

**`SIM_DIGEST` golden constant.** SHA-256 of the final state hash
after running `SELF_TEST_LOG_100` against `SELF_TEST_INPUTS`. Pinned
in `src/core/self-test.ts` next to `RANDOM_WALK_DIGEST` (Phase 1) and
`MAPGEN_DIGEST` (Phase 2). The corresponding `sim-cross-runtime-digest`
and `sim-stream-isolation` self-tests run in every runtime (Node,
Chromium, Firefox, WebKit) and surface any silent cross-runtime drift
as a single hex mismatch.

**Deferred sim contracts.** Phase 3 ships **one-way descent** —
the `wait | move | attack | descend` action vocabulary deliberately
omits `ascend`. A future `ascend` is an additive vocabulary entry;
whether re-entering a floor regenerates monsters or restores a
preserved snapshot is a Phase 6+ decision. Phase 3 also defers the
**verifier's trailing-after-terminal canonicalization** to Phase 8 —
two action logs that differ only in trailing actions after a terminal
outcome share the same fingerprint and the same `(finalState,
finalStateHash, outcome)`; whether the verifier truncates or annotates
trailing input is Phase 8's choice.

### Phase 4 frozen contracts (atlas pipeline)

These are the contract additions Phase 4.0's planning gate locks in;
the canonical reference is `artifacts/decision-memo-phase-4.md` (with
the addendum at the bottom resolving B1–B8 from the architecture
red-team review). Implementation of the recipe primitives, the PNG
encoder, and the JSON manifest lands in Phase 4.A.2; the foundation
they rest on (the `RULES_FILES` canonicalization, the
`atlasBinaryHash` plugin scaffolding, `src/atlas/seed.ts`, the
`deriveRulesetVersion` helper, the Phase 4 lint scope additions) lands
in Phase 4.A.1's drift-detection sweep.

**Recipe primitive set.** Ten functions with pinned signatures and
integer constants (memo decision 1, 1a). `paletteGradient(n, a, b,
steps)` requires `steps >= 2` and throws on `0` / `1` with the
message `paletteGradient: steps must be >= 2 (got <n>); use
paletteIndex directly for a single-color result` (addendum N4).
`valueNoise2D(prng, x, y)` consumes **exactly one** `prng.next()`
call per invocation (addendum N3). The full set, matching the memo's
decision 1 table and `src/atlas/primitives.ts`: `paletteIndex`,
`paletteSwap`, `paletteGradient`, `bayerThreshold`, `valueNoise2D`,
`rectMask`, `circleMask`, `lineMask`, `columnShift`,
`scanlineResidue` (plus the public `hash2D` mixer used by
`valueNoise2D`). Bumping any signature is a `rulesetVersion` bump.

**Recipe signature.**

```ts
type Recipe = (
  prng: PRNG,
  ctx: RecipeContext,                 // tile dimensions, palette, etc.
) => Uint8Array;                      // length = TILE_SIZE * TILE_SIZE
```

A recipe is a pure function of its `prng` cursor and its `ctx`.
Recipes may not import from `sim/`, `mapgen/`, `render/`, `input/`, or
`main/` (lint-enforced; see below). Coordinate stability holds across
runs: same `(recipeId, atlasSeed)` → same byte output.

**Recipe ID format.** Regex anchored to `cyberpunk` for v1, with
seven `<category>` values (`tile`, `monster`, `item`, `player`,
`npc`, `ui`, `boss`):

```
^atlas-recipe\.(cyberpunk)\.(tile|monster|item|player|npc|ui|boss)\.[a-z][a-z0-9-]*$
```

Pinned in `src/registries/atlas-recipes.ts:RECIPE_ID_REGEX`. Adding
a `<theme>` or `<category>` value is a `rulesetVersion` bump
(addendum N11; the addition lands as an additive registry change).
In practice every category/theme addition is already a bump because
the recipes themselves are.

**`streams.atlas(recipeId)` accessor.** A new `RunStreams` accessor
(Phase 4.A.2 addition). Per-call invariant: a single
`streams.atlas(recipeId)` call advances `streams.__consumed.size` by
**exactly 1**, recording exactly the key `"atlas:" + recipeId`. No
other key is touched (addendum B8). The size-delta is the per-call
invariant; *first calls* to a fresh key advance by 1, repeat calls to
the same key are Set-deduplicated and advance by 0 (red-team
follow-up N20). Phase 6/7 fixtures should assert
`streams.__consumed.has(expectedKey)` and the count of distinct keys,
not a naive per-call delta.

The root seed for the atlas pipeline is derived via
`atlasSeedToBytes(...)`, **not** `seedToBytes(...)` — the two are
byte-distinct domains (B7).

**Atlas layout constants.** `TILE_SIZE = 16`, `TILE_PADDING = 1`,
`ATLAS_TILES_WIDE = 16`, `ATLAS_TILES_HIGH = 8`. Bumping
`ATLAS_TILES_HIGH` or `ATLAS_TILES_WIDE` is **coordinate-stable**
(existing `(atlasX, atlasY)` are preserved) but **binary-unstable**
(the IHDR dimensions change → `atlasBinaryHash` bumps →
`rulesetVersion` bumps → every shared fingerprint breaks). Therefore
tile-grid resizing is allowed only at a `rulesetVersion` boundary,
requires `architecture-red-team` review, and is a *pure increase*
(never a decrease). The cell budget at v1 (`8 × 16 = 128`) is well
above the Phase 7 ceiling of ~34 effective cells; no bump is
anticipated through v1 (addendum B6).

**Atlas-grid placement function.** `(atlasX, atlasY, tilesWide,
tilesHigh)` is allocated by walking `ATLAS_RECIPES` in declaration
order and packing into the tile grid with `TILE_PADDING` separation.
Coordinate stability holds under additive recipe growth (decision 3a).
The wrap-with-skip edge case (a multi-tile sprite that doesn't fit on
the current row but fits after wrapping) has a fixture test in 4.A.2
per addendum N9.

**`src/atlas/seed.ts` and `atlasSeedToBytes`.**

```
ATLAS_SEED_DOMAIN = utf8("icefall:atlas-seed:v1:")    // 22 bytes ASCII
atlasSeedToBytes(seed: string): Uint8Array =
  sha256( ATLAS_SEED_DOMAIN ‖ utf8(seed) )            // 32 bytes
```

The 22-byte fixed prefix byte-distinguishes atlas seeds from run
seeds (`seedToBytes` has no prefix). Mirrors Phase 1's
`STREAM_DOMAIN = "icefall:v1:"` discipline. `validateSeedString` is a
*Phase 4 addition* (red-team follow-up N19): atlas-seed strings must
be well-formed UTF-16 with UTF-8 byte length in `[1, 255]`. The
existing `seedToBytes` precondition surface is intentionally
**unchanged** — the asymmetry is by design (run seeds were already in
use before the validation discipline was considered, and tightening
them silently would bump every existing fingerprint with no current
defect to fix).

**PNG encoder format.** Indexed PNG, color type 3, bit depth 8;
chunks `IHDR, PLTE, tRNS, IDAT, IEND`; filter byte 0 on every
scanline; `fflate`-level-1 fixed-output deflate (the addendum named this
`fdeflate`, which does not exist on npm; `fflate` is the canonical
substitute and was the encoder discipline being specified); **no ancillary
chunks** (no `tEXt`, no `tIME`, no `pHYs`). The `tRNS` chunk length
is **exactly 16 bytes** for `paletteCount = 16`: entries 1..15 are
`0xFF` (fully opaque) and entry 0 is `0x00` (transparent). The
spec-allowed truncation is forbidden — it removes byte-stability
surface against decoders that behave differently on truncated
`tRNS` (addendum N6).

The encoder asserts `pixels[i] < palette.colors.length` for every
pixel before emitting IDAT. Violation throws:

```
pngEncode: pixel <i> has palette index <v> but palette has <N> entries
```

(addendum N5 — exact error format).

**Color palette.** 16-entry indexed palette; every recipe paints in
palette indices, never in RGB. Entry 0 is the transparent slot.

**Atlas JSON manifest schema.** `assets/atlas.json` is the manifest
emitted alongside `assets/atlas.png`. Top-level `schemaVersion = 1`;
keys emitted in alphabetical order; the v1 reader rejects
`schemaVersion = 2` (forward-compat constraint per addendum N16).
The manifest's `atlasBinaryHash` field MUST equal the actual SHA-256
of `assets/atlas.png` (asserted by the loader at startup and by the
build's drift gate).

**`rulesetVersion` derivation.**

```
rulesetTextHash = sha256(
  for each (path, content) in RULES_FILES.sort_by_path_alphabetical():
    utf8(path) ‖ 0x00 ‖ sha256(normalizeForHash(content)) ‖ 0x00
)

normalizeForHash(content) = utf8( stripBom(content).replace(/\r\n/g, "\n") )

rulesetVersion = sha256( utf8(rulesetTextHashHex) ‖ utf8("|") ‖ utf8(atlasBinaryHash) )
```

The pre-image is the alphabetically-sorted concatenation of
`(utf8(path), 0x00, sha256(normalizeForHash(content)), 0x00)` tuples
(addendum B2). Properties that hold *by construction*:
1. **Renaming a file is a `rulesetVersion` bump** — path bytes feed
   the pre-image directly.
2. **Splitting a file is a `rulesetVersion` bump** — the new
   `(path, hash)` tuple appears.
3. **Reordering `RULES_FILES` does not change the hash** — the sort is
   canonical alphabetical (and reordering the array literal is itself
   a *test failure*, not a `rulesetVersion` bump).
4. **CRLF→LF is applied at hash time** — defense-in-depth above
   `.gitattributes`.
5. **Leading UTF-8 BOM is stripped** — defends against the
   VSCode-Windows-edits-with-BOM trap.

`atlasBinaryHash` is computed by the Vite plugin
(`scripts/vite-plugin-atlas-binary-hash.mjs`, addendum B5):
`config` runs `recompute()` eagerly (vitest's `define` substitution
requires the values be resolved before `configResolved` per the
discovered timing constraint surfaced during 4.A.2; `configResolved`
re-runs as defense-in-depth) — it reads `assets/atlas.png` and
computes `sha256(bytes)`. `config` exposes `__ATLAS_BINARY_HASH__`,
`__ATLAS_MISSING__`, and `__RULESET_VERSION__` to the `define` block
(each wrapped in `JSON.stringify` per addendum N17);
`handleHotUpdate` triggers a `full-reload` on regen in dev mode;
`closeBundle` copies `assets/atlas.png` and `assets/atlas.json`
into `dist/assets/` so the production preview/deploy serves them at
`/icefall/assets/atlas.{png,json}` (the URL the preview UI and the
Phase 5+ atlas-loader fetch). The empty-atlas fallback (4.A.1) is
`__ATLAS_BINARY_HASH__ =
"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
(SHA-256 of the empty byte string), `__ATLAS_MISSING__ = true`, and
`__RULESET_VERSION__ = PLACEHOLDER_RULESET_VERSION`.

The `deriveRulesetVersion(rulesText, atlasBinaryHash)` helper is
**defined but not yet called** at the `define`-block site in Phase
4.A.1 (addendum B1). 4.A.2 lands `assets/atlas.png` AND flips the
call sites from `PLACEHOLDER_RULESET_VERSION` to the derived value
**in the same commit**. There is no transient sentinel — on master,
exactly one of two states holds: the placeholder (pre-4.A.2) or a
64-char lowercase-hex string (4.A.2 onward). No third form is
allowed.

**Atlas-loader `DEV-` refusal and hash check.** The runtime
atlas-loader (Phase 4.A.2, `src/atlas/loader.ts`) refuses to
load any build whose `rulesetVersion === PLACEHOLDER_RULESET_VERSION`
with the exact message:

```
atlas-loader: refusing to load build with placeholder ruleset (DEV- fingerprint) — re-build with 'npm run build' to inject the real rulesetVersion
```

(addendum N7 — em-dash is U+2014, exact-character-match.) When
`__ATLAS_MISSING__` is true at load time, the loader throws:

```
atlas-loader: assets/atlas.png is missing from this build — ruleset derivation cannot complete
```

The hash check uses `@noble/hashes/sha256` — never `crypto.subtle`,
never `node:crypto` (addendum B4).

**`ATLAS_DIGEST` golden constant.** SHA-256 of the canonical
recipe-output sequence under `ATLAS_SEED_DEFAULT`. Pinned in
`src/core/self-test.ts` next to `RANDOM_WALK_DIGEST`,
`MAPGEN_DIGEST`, and `SIM_DIGEST`. Three new self-tests gate the
atlas pipeline:
- `atlas-cross-runtime-digest` — `ATLAS_DIGEST` matches in Node and
  in `vite preview`-served browsers.
- `atlas-stream-isolation` — fresh streams + one
  `streams.atlas("atlas-recipe.cyberpunk.tile.floor")` call →
  `__consumed.size === 1` and the key is `"atlas:" + recipeId`
  (addendum B8).
- `atlas-encoder-cross-runtime` — a hardcoded 16×16 single-color
  tile, encoded via `src/atlas/png.ts`, hashes to a pinned golden
  hex across all runtimes (addendum B4).

**`src/atlas/**` layer-table entry.** New peer of `src/sim/` and
`src/mapgen/` (no float, no time, no async). Layer constraints:

| Layer | Imports allowed | Imports forbidden |
|---|---|---|
| `src/atlas/` | `src/core/`, `src/registries/` | `src/sim/`, `src/mapgen/`, `src/render/`, `src/input/`, `src/main`; `node:buffer`, `crypto`, `node:crypto` (use `@noble/hashes/sha256` via `src/core/hash`); `Buffer` global; `crypto.subtle` member access |

`src/atlas/seed.ts` exports `atlasSeedToBytes`; consumed by
`tools/gen-atlas.ts`, `src/atlas/generate.ts`, and `src/main.ts`
(preview UI). It imports `sha256`, `utf8`, `concat`,
`isWellFormedUtf16` from `src/core/hash`. The `Uint8Array`-only
discipline (no `Buffer`, no `Buffer.concat`) and the
`@noble/hashes/sha256`-only SHA-256 path are both lint-enforced; see
the lint-rule inventory below.

**`tools/**` `node:` prefix on Node built-ins.** `tools/gen-atlas.ts`
(and any future `tools/**` script that imports a Node built-in) MUST
use the `node:` prefix — `node:fs`, `node:path`, `node:url` — never
the bare `fs`/`path`/`url` form (which resolves through Vite's
resolver and can collide with a mod's local module). The lint message
is pinned: `node-builtin: use 'node:fs' (or 'node:path', etc.); the
bare form resolves through Vite's resolver and can collide with a
mod's local module.` (addendum N10).

**Deferred Phase 4 contracts.**
- The four preset-seed `expectedHash` golden constants
  (`placeholder`, `variant-A`, `variant-B`, `variant-C`) are computed
  during 4.A.2 on the `ubuntu-latest` shard and pasted into
  `src/atlas/preset-seeds.ts` literally before the live deploy is
  approved (addendum N12).
- The cross-OS byte-equality CI matrix (`ubuntu-latest`,
  `macos-latest`, `windows-latest`; `node-version: '20.x'`;
  `fail-fast: false`) lands in Phase 4.B (addendum N14).
- Animation-frame manifest (`schemaVersion = 2`) is deferred to
  Phase 9; the v1 reader must reject `schemaVersion = 2` per addendum
  N16.
- Atlas-recipe mod loader runtime semantics: a future mod-supported
  release runs `npm run gen-atlas` at mod-install time and produces a
  *new* `assets/atlas.png` with a *new* `atlasBinaryHash` folded into
  a *new* `rulesetVersion` (addendum N13).

### Phase 5 frozen contracts (renderer + input + ui)

These are the contract additions Phase 5 locks in; the canonical
reference is the Phase 5 callout block in `docs/PHASES.md`. Phase 5
is **not** a planning-gate phase per the policy at the top of
`docs/PHASES.md`, so there is no `decision-memo-phase-5.md`; the
architectural seams are pinned here and refined as 5.A.2's
implementation lands. Phase 5.A.1 (drift-detection sweep) ships
this section ahead of 5.A.2's implementation so the lint scopes,
the read-only contracts, and the layer-import boundaries are
locked before code is written.

**Renderer is a read-only sink on sim state.** `src/render/canvas.ts`
takes a `RunState` (Phase 3 frozen contract) and produces canvas
draw calls; it MUST NOT mutate the state, MUST NOT advance the
state-hash chain, MUST NOT consume any `RunStreams` cursor, MUST
NOT call `tick()` or any `src/sim/**` write path. The only legal
imports from `src/sim/**` are read-only **type** imports
(`import type { RunState, ... } from "../sim/types"`) and the
read-only **values** that were exported as `Readonly<...>` in
Phase 3 (none currently exist as values; types only). A runtime
architectural test in `tests/render/render-readonly.test.ts` calls
the renderer with a deeply-frozen `RunState` and confirms no
mutation throws.

**Renderer cannot import `src/core/streams.ts` or `src/sim/combat.ts`.**
Pinned by `eslint.config.js` `no-restricted-imports` patterns (added
in Phase 5.A.2). `src/core/streams.ts` is the PRNG-cursor surface;
allowing the renderer to import it would let a render-time bug
silently advance a stream. `src/sim/combat.ts` is the
roll-derivation surface; render code has no business consuming
roll bytes.

**Atlas loader is called once at run start.** `src/main.ts`'s
startup path calls `await loadAtlas()` (from `src/atlas/loader.ts`
— defined in Phase 4.A.2, exported but uncalled until Phase 5.A.2)
before any sim tick is exercised. Failure paths: the
`PLACEHOLDER_RULESET_VERSION` refusal (pinned message per addendum
N7), the `__ATLAS_MISSING__` refusal (pinned message), the
`atlas.png` SHA-256 mismatch refusal. The loader's `JSON.parse`
call is the data-ingestion boundary and is annotated with an
`eslint-disable-next-line determinism/no-float-arithmetic` comment;
the deterministic interior receives the parsed object as `unknown`
and validates structurally via `parseAtlasJson`.

**Input descriptor maps to Phase 1 `Action` schema.**
`src/input/keyboard.ts` produces `Action` descriptors per
`docs/ARCHITECTURE.md` "Action descriptor encoding". Keypress →
`Action` is a pure mapping; no Phase 1 `ACTION_VERSION` bump is
required. Phase 5's keybindings (arrow keys / WASD → `move dir`,
space → `wait`, single key → `attack dir`, `>` → `descend`) are
*configuration* rather than schema additions; rebinding is allowed
without a `rulesetVersion` bump because the produced `Action`
bytes are unchanged.

**HUD is a read-only sink on `RunState`.** `src/ui/hud.ts`
displays `state.player.hp`, `state.player.hpMax`, `state.floorN`,
`state.outcome`, and the `fingerprint(state.fingerprintInputs)`
short string. Same read-only discipline as the renderer: no
mutation, no PRNG consumption, no `tick()` calls. The fingerprint
widget is recomputed on each frame from the deterministic inputs;
it does not cache.

**Diagnostic surface preserved.** Phase 5 does not remove the
existing diagnostic page sections (self-test banner, build-info,
floor-preview, scripted-playthrough, atlas-preview). The
playable-game UI is added as a peer; the diagnostic sections may
be moved into a collapsible `<details>` element but their DOM ids
and `window.__*__` flags are preserved so the cross-runtime
Playwright assertions established in Phases 1.B / 2.B / 3.B / 4.B
keep passing alongside the new keypress / HUD assertions.

**`src/render/**`, `src/input/**`, `src/ui/**` layer-table entries.**
New peers of `src/sim/`, `src/mapgen/`, and `src/atlas/` (no float,
no time except for input-event timestamps which are untrusted by
the sim, no async except for the atlas-loader's startup `await`).
Layer constraints:

| Layer | Imports allowed | Imports forbidden |
|---|---|---|
| `src/render/` | `src/core/` (read-only types), `src/sim/types`, `src/atlas/loader.ts`, `src/atlas/manifest` (types), `assets/atlas.{png,json}` (via fetch) | `src/core/streams.ts`, `src/core/state-chain.ts` write paths, `src/sim/combat.ts`, `src/sim/turn.ts`, `src/sim/run.ts` write paths, `src/mapgen/generate.ts` write paths, `src/input/`, `src/main.ts`; mutation of any imported state |
| `src/input/` | `src/core/` (read-only types), `src/sim/types` | `src/core/streams.ts`, `src/sim/combat.ts`, `src/sim/turn.ts`, `src/sim/run.ts` write paths, `src/render/`, `src/mapgen/`, `src/main.ts`; mutation of any state |
| `src/ui/` | `src/core/` (read-only types + `fingerprint`), `src/sim/types`, `src/build-info.ts` (commitHash, rulesetVersion read-only) | `src/core/streams.ts`, `src/sim/` write paths, `src/render/`, `src/input/`, `src/mapgen/`, `src/main.ts`; mutation of any state |

`src/main.ts` is the **single** orchestrator: it reads input via
`src/input/`, drives the sim via `src/sim/harness` or its Phase 5+
input-driven equivalent, passes the `RunState` to `src/render/`
and `src/ui/`, and is the only module allowed to wire the four
together. The lint rule pin (added in Phase 5.A.2's
`eslint.config.js` extension) enforces this.

**Deferred Phase 5 contracts.**
- The harness's single sim→mapgen import edge (Phase 3.A.2
  `src/sim/harness.ts` exception) is expected to migrate to a
  dedicated `src/run/` orchestration layer in Phase 5.A.2 alongside
  the input-driven loop, removing the eslint single-file exception.
- Per-frame timing budgets (target 60 FPS at the diagnostic page's
  rendering rate) are deferred to Phase 9 polish; Phase 5 ships
  whatever frame rate the canvas tile-blit pipeline produces with
  no animation system.
- Accessibility pass (keyboard-only nav, prefers-reduced-motion,
  contrast) is deferred to Phase 9.

### Phase 6 frozen contracts (items + currency + equipment)

These are the contract additions Phase 6 locks in; the canonical
reference is the Phase 6 callout block in `docs/PHASES.md`. Phase 6
is **not** a planning-gate phase per the policy at the top of
`docs/PHASES.md`, so there is no `decision-memo-phase-6.md`; the
architectural seams are pinned here and refined as 6.A.2's
implementation lands. Phase 6.A.1 (drift-detection sweep) ships
this section ahead of 6.A.2's implementation so the action
vocabulary additions, the inventory data shape, the equipment slot
enumeration, and the item-effect resolution path are locked before
code is written. Material design choices that surface during 6.A.1
that need a strategy-planner pass land back into this section as
amendments rather than a separate decision memo.

**Inventory data shape — deterministic ordering.** `Player` (Phase
3 frozen-contract item 5) gains a new readonly field:

```ts
type Player = {
  // ...existing readonly fields from Phase 3...
  readonly inventory: readonly InventoryEntry[];   // sorted by (kind, count)
  readonly equipment: Equipment;                   // fixed-slot record
};

type InventoryEntry = {
  readonly kind: ItemKindId;     // e.g. "item.cred-chip", "item.stim-patch"
  readonly count: number;        // positive integer; consumables stack
};
```

Iteration order is **sorted by `kind` ascending (UTF-16 code-unit
order on the `ItemKindId` string), tie-break by `count` descending**.
Same discipline as Phase 3's `monsters` (sorted by `id`) and
`items` (sorted by `(y, x, kind)`): no iteration over un-ordered
collections inside `tick()` per the existing `SIM_UNORDERED` lint
rule. Each `InventoryEntry.count` is a positive integer; an entry
with `count === 0` is removed (not retained as a zero-count slot).
Capacity is **unbounded in Phase 6** (the action log enforces
practical bounds; bounded inventories may land in Phase 9 polish).

**Equipment slot enumeration.** A fixed-slot record of named slots,
each holding either a single `ItemKindId` or `null`:

```ts
type Equipment = {
  readonly weapon: ItemKindId | null;
  readonly cyberware: ItemKindId | null;
};
```

Slot list is **frozen** in Phase 6: bumping is a `rulesetVersion`
bump and requires architecture-red-team review (Phase 9 polish may
add `armor`, `accessory`, etc., as additive `rulesetVersion`-bumping
changes). Each slot accepts only items whose registry entry has the
matching category — enforced by `tick()` at equip time, with the
exact rejection error string pinned in 6.A.2.

**Action vocabulary additions (additive Phase 1 frozen contract).**
Five new `Action.type` strings join Phase 3's `wait | move | attack |
descend`:

| `type`     | required fields | optional fields | purpose                               |
|------------|------------------|------------------|---------------------------------------|
| `pickup`   | (none)           | (none)           | pick up the FloorItem at player pos   |
| `drop`     | `item`           | (none)           | drop one of the kind-id from inventory|
| `equip`    | `item`           | (none)           | move kind-id from inventory to slot   |
| `unequip`  | `item`           | (none)           | move kind-id from slot to inventory   |
| `use`      | `item`           | (none)           | consume a consumable (heals, etc.)    |

`item` here uses the **existing Phase 1 `TAG_ITEM = 0x20`** wire tag
(0..255 UTF-8 bytes); no new tag is introduced. This is per the
Phase 1 frozen "additive vocabulary" rule: new optional fields use
strictly-greater tags, but reusing an existing tag for a new
`type` value does NOT bump `ACTION_VERSION`. Adding new types is
additive; removing or renaming a type is a `rulesetVersion` bump.

**Item-effect resolution path through the per-action roll subhash.**
Item effects that touch combat outcomes (a stim-patch heal that
must roll for variance; a weapon's atk-bonus modifier; a trauma-pack
def-bonus) consume the **same `rollBytes` subhash** the per-action
combat path uses, with new domain anchors added to the roll-domain
registry. Phase 6 adds:

| domain                   | purpose                                           |
|--------------------------|---------------------------------------------------|
| `item:effect:heal`       | stim-patch / trauma-pack heal-amount roll         |
| `item:effect:atk-bonus`  | weapon-modifier roll on player attack             |
| `item:effect:def-bonus`  | cyberware-modifier roll on monster counter-attack |

Domains are 7-bit ASCII, length 1..31 bytes (existing `rollBytes`
contract). The `index` field for stacked effect rolls increments
deterministically from 0 within a single action's resolution.
**No item bypasses the sim stream** — every item-effect computation
is a `rollU32(stateHashPre, action, domain, index) & mask`
combination. `Math.random` and floats remain forbidden.

**Equipment-modifier injection at combat time.** Player attack rolls
already use `combat:atk-bonus` (Phase 3 frozen contract); when a
weapon is equipped, the bonus from `item:effect:atk-bonus` is
**added** (integer arithmetic) to the existing combat roll's bonus.
The combat damage formula `dmg = max(1, atk - def + bonus)` is
unchanged; the change is in how `bonus` is summed. Same for the
monster counter-attack path with cyberware.

**Registry append-only invariant for items.** Phase 6 expands
`src/registries/items.ts` from the Phase 3 baseline of 5 entries
(`item.cred-chip`, `item.cyberdeck-mod-1`, `item.stim-patch`,
`item.trauma-pack`, `item.weapon.knife`) to ~20 starter items across
categories: weapons, cyberware, consumables, currency. The registry
is **append-only by construction**: entries are listed in
alphabetical order by `id`, and the long-deferred Phase 2
decision-memo "registry-immutability enforcement test" (decision 6,
which Phase 2 deferred to "Phase 6, when a second writer of the
registry exists") lands in 6.A.2 as the second writer adds the new
entries — the test asserts the existing 5 ids remain at their
existing positions and bytes after the expansion. Removing or
renaming an entry is a `rulesetVersion` bump; reordering is a test
failure (not a `rulesetVersion` bump because the alphabetical-sort
contract makes it normalizable, but reordering MUST not change the
bytes that feed the SIM_DIGEST or the atlas binary).

**Atlas extension — coordinate-stable for Phase 4 sprites.** Phase 6
adds ~13 new atlas recipes (Phase 4 shipped 7; Phase 6 brings the
count to ~20 items). Per addendum 3a's coordinate-stability
invariant, **existing Phase 4 sprite coordinates remain unchanged**;
new recipes append to the registry-declaration order. Atlas grid is
still 16 wide × 8 high (128 cells); ~20 sprites + the existing 7 =
~27 cells used, well under the budget.

**`ATLAS_DIGEST` golden + 4 preset-seed `expectedHash` values bump.**
The new atlas recipes mean `assets/atlas.png` regenerates with
different bytes; `ATLAS_DIGEST` and the four
`ATLAS_PRESET_SEEDS.expectedHash` values are bumped during 6.A.2
on the sandbox host (ubuntu-equivalent) and pasted literally per
the Phase 4 addendum N12 pattern. The Phase 4.B
`cross-os-atlas-equality` matrix re-asserts pairwise byte-equality
against the new binary in 6.B.

**Inventory-from-log reconstruction invariant.** SPEC.md principle
2 says "action log is the save." Phase 6 makes this load-bearing
for inventory: a new test asserts that `replay(actions)` produces
a `RunState` whose inventory + equipment are byte-identical to the
state captured at the end of the same action sequence. No inventory
state is persisted separately from the action log. Phase 8 will
exercise this further when fingerprint-based replay lands.

**Deferred Phase 6 contracts.**
- Inventory capacity bound (currently unbounded; Phase 9 may add a
  bound for UI screen ergonomics, with a cap that's a
  `rulesetVersion` bump because it changes drop-on-overfull
  behavior).
- Stack/unstack action types for splitting consumable stacks (Phase
  9 polish if needed).
- Item rarity / tier modifiers as multi-roll combinations (Phase 7+
  if NPC shops stock by rarity).
- Item descriptions / flavor text in a `theme` registry (Phase 9
  polish).

### Build-time constants

`commitHash` and `rulesetVersion` are injected via Vite `define`. They
are exposed by `src/build-info.ts`:

```ts
export const commitHash: string;       // 7-char hex when built; "dev" in tests
export const rulesetVersion: string;   // sentinel string in Phase 1
```

`vite.config.ts` reads `git rev-parse --short HEAD` at build time;
`src/build-info.ts` falls back to `"dev"` when not built (Vitest
unit tests).

## Lint rule inventory

| Rule | Scope | Implementation |
|---|---|---|
| no `Math.random` | `src/core/**`, `src/sim/**`, `src/mapgen/**`, `src/atlas/**` | `no-restricted-syntax` selector |
| no `Date.now`, `performance.now`, `new Date()` | `src/core/**`, `src/sim/**`, `src/mapgen/**`, `src/atlas/**` | `no-restricted-syntax` selectors and `no-restricted-globals` |
| no `for..in`, no iteration over `Map`/`Set`/`Object.entries`/`Object.keys`/`Object.values` without `sortedEntries(...)` | `src/sim/**`, `src/mapgen/**` | `no-restricted-syntax` selectors |
| no float arithmetic | `src/sim/**`, `src/mapgen/**` | custom rule `eslint-rules/no-float-arithmetic.cjs` (see decision memo addendum B6 for full contract) |
| no `JSON.parse` | `src/sim/**`, `src/mapgen/**` | custom rule `eslint-rules/no-float-arithmetic.cjs` (data ingestion at boundaries only) |
| no member-access on `.sim` or `.ui` | `src/mapgen/**` | `no-restricted-syntax` selector — stream-isolation contract (memo decision 7); enforces that mapgen consumes only `streams.mapgen(floorN)` |
| no `Buffer`, `node:buffer`, `crypto`, `node:crypto`, `crypto.subtle` | `src/atlas/**` | `no-restricted-imports` paths + `no-restricted-globals` + `no-restricted-syntax` member-access selector — Phase 4 addendum B4; encoder uses `Uint8Array` and `@noble/hashes/sha256` only |
| no bare `fs`/`path`/`url` (must use `node:` prefix) | `tools/**` | `no-restricted-imports` paths — Phase 4 addendum N10; bare form resolves through Vite's resolver and can collide with a mod's local module |
| `tools/**` boundary | `tools/**` | `no-restricted-imports` forbids `**/render/**`, `**/input/**`, `**/main` — Node-only build-time code |
| no import of `core/streams.ts` or `sim/combat.ts` | `src/render/**` | Phase 5.A.2 `no-restricted-imports` — render is a read-only sink on sim state; PRNG consumption and roll-derivation are sim-internal concerns. Pinned in the Phase 5 frozen contracts above; rule body lands with the first `src/render/**` file in 5.A.2 |
| no import of sim write paths | `src/render/**`, `src/input/**`, `src/ui/**` | Phase 5.A.2 `no-restricted-imports` — only `src/main.ts` orchestrates writes to `RunState`; render/input/ui are read-only consumers. Rule body lands in 5.A.2 |
| import boundaries | per layer table above | `no-restricted-imports` patterns scoped via `overrides` |

## Runtime dependencies

| Dep | Pin | Why |
|---|---|---|
| `typescript` | exact | type stability |
| `vite` | exact | build & dev server; deploy artifact shape |
| `vitest` + `@vitest/coverage-v8` | exact | unit tests + coverage gate |
| `@noble/hashes` | exact | sync SHA-256, audited, ESM, ~3 KB tree-shaken |
| `@playwright/test` | exact | cross-runtime determinism test (chromium, firefox, webkit) |
| `eslint` + `typescript-eslint` | exact | enforce determinism rules |

No runtime dependency may bring `Math.random`, `Date`, `performance`, or
floating-point arithmetic into `src/core/**` or `src/sim/**` paths.

## Testing strategy

Three test surfaces:

1. **Vitest in Node (`npm run test`).** Unit tests for every module in
   `src/core/*`. 100% line coverage threshold enforced via
   `vitest.config.ts` (build fails on under-coverage). Includes the
   golden-digest random-walk test that cross-checks against the browser
   suite.
2. **Playwright cross-runtime (`npm run test:e2e`).** Loads the
   diagnostic page (served by `vite preview` against the GH-Pages-shaped
   `base: '/icefall/'`) in `chromium`, `firefox`, `webkit`. Reads
   `window.__SELF_TEST_RESULT__` and asserts `"green"`. Asserts the
   1,000-step random-walk digest matches the same constant the Node
   suite asserts.
3. **ESLint (`npm run lint`).** Enforces all import boundaries and
   determinism rules. Custom `no-float-arithmetic.cjs` has its own
   fixture tests under `eslint-rules/__tests__/`.

A live-URL Playwright smoke (Phase 1.B) is run manually after the host
pushes; it is not part of the CI gate for 1.A.

## Operational concerns

- **Bundle size.** Phase 1 budget: ≤ 50 KB minified gzipped for the
  diagnostic page, including `@noble/hashes/sha256`. Phase 2 raises
  the budget to ≤ 75 KB to accommodate the BSP generator, the
  registries, the ASCII renderer, and the URL-hash plumbing. CI fails
  if `dist/`-gzipped JS exceeds 75 KB and uploads the contents of
  `dist/` (JS, CSS, HTML) as the `bundle-report` workflow artifact —
  future phases proposing a budget bump can decompress and inspect.
  A future enhancement may add `rollup-plugin-visualizer` to emit a
  treemap (memo addendum N5 originally named the treemap; the artifact
  shipped today is the build output itself, which is the lower-friction
  starting point).
- **Browser support.** Latest two stable Chromium, Firefox, WebKit. No
  IE/legacy.
- **Deploy pipeline.** Single workflow, `main` only, GH Pages.
  Concurrency group `pages` so overlapping pushes do not race. Pinned
  Action versions. Phase 8 layers content-addressed `releases/<commit>/`
  on top of this same pipeline.
- **Determinism guard tests.** The 1,000-step random-walk golden digest
  is the canary for any silent break in any encoding contract on this
  page. If it ever needs to change, the change is a `rulesetVersion`
  bump and is reviewed by `architecture-red-team`.
