# Decision Memo — Phase 4 (Procedural Atlas Generator)

**Status.** Drafted before any Phase 4 code is written, per the planning gate
in `docs/PHASES.md`. Architecture-red-team review is required before
implementation. Phase 3 (Entity Model, Turn Loop, Combat) is approved on
master at commit 6f6a322 (Phase 3.B; see `artifacts/phase-approval.json`).

## Decision summary

Phase 4 builds the deterministic art pipeline. A standalone Node tool
(`tools/gen-atlas.ts`) consumes an atlas seed plus a recipe registry and
emits two file-system artifacts:

- `assets/atlas.png` — a single indexed-PNG tile sheet, byte-identical
  across Linux / macOS / Windows.
- `assets/atlas.json` — a canonical-JSON manifest mapping logical sprite
  IDs to atlas coordinates, mirroring the Phase 2 floor-JSON discipline.

The atlas binary's SHA-256 is folded into the build's `rulesetVersion` —
`rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)` — so visuals and
rules share a single version axis. The Phase 1 placeholder sentinel
(`phase1-placeholder-do-not-share`) is retired. Fingerprints with the
`DEV-` prefix are refused at runtime by the Phase 4 atlas-loader.

The interesting decisions in this phase are not the algorithms — recipe
primitives (palette ops, ordered dither, value noise, glitch ops) are
short integer-arithmetic functions with well-understood pixel-art
output — but the **wire contracts** that flow into Phase 5 (renderer
reads `assets/atlas.png` + `assets/atlas.json` at startup), Phase 6 (item
recipes extend the registry), Phase 7 (NPC + boss recipes extend the
registry), Phase 8 (atlas binary is part of the pinned release artifact),
and Phase 9 (final atlas-seed selection bumps `rulesetVersion`). Once
mods care about the recipe surface, every primitive signature becomes an
ABI commitment. Locking these now is cheaper than versioning them later.

The Phase 1 + 2 + 3 frozen contracts (state-chain encoding, stream
derivation, salt encoding, action descriptor encoding, roll derivation,
floor JSON canonical schema, `streams.simFloor`, `RunState`,
`SIM_DIGEST`) are honored unchanged. Phase 4 adds new file artifacts
(`assets/atlas.png`, `assets/atlas.json`), a new build-time tool
(`tools/gen-atlas.ts`), a new top-level layer (`src/atlas/**`), a new
registry (`src/registries/atlas-recipes.ts`), a new build-time computed
constant (`atlasBinaryHash`), and a new derived ruleset string format —
none of which alter Phase 1–3 frozen bytes.

Like Phases 1, 2, and 3, Phase 4 is split into a planning gate (4.0), a
drift-detection sweep (4.A.1), a sandbox-verifiable implementation
(4.A.2), and a live-deploy + cross-OS byte-equality verification (4.B).
Cross-OS byte-equality cannot be observed inside the sandbox (one host
OS) and requires the GitHub Actions matrix runners. See decision 13.

## Decisions

### 1. Recipe primitive set: **ten orthogonal pure functions, integer-arithmetic, no Math.random / Date / float**

- **Chosen.** `src/atlas/primitives/` exposes exactly **ten** pure
  functions to recipes. Each takes integer-only inputs (plus a seeded
  PRNG in some cases) and returns integer-only outputs (palette indices,
  threshold values, mask bits). No floats, no `Math.random`, no `Date`,
  no DOM APIs — the same `eslint.config.js` scope rules that apply to
  `src/sim/**` and `src/mapgen/**` apply to `src/atlas/**` (see decision
  11).

  | # | Function | Signature | Purpose |
  |---|---|---|---|
  | 1 | `paletteIndex` | `(palette: Palette, name: PaletteColorName) => u8` | Look up a named palette index (e.g. `"neon-cyan"`). |
  | 2 | `paletteSwap` | `(buf: Uint8Array, from: u8, to: u8) => Uint8Array` | Replace every `from` index with `to`; pure, returns a new buffer. |
  | 3 | `paletteGradient` | `(palette: Palette, fromName: PaletteColorName, toName: PaletteColorName, steps: u8) => Uint8Array` | Linear-in-palette-index gradient between two named colors; output length = `steps`. Uses **integer interpolation** (`(from * (steps - 1 - i) + to * i) / (steps - 1)` with integer division and Bresenham-style remainder distribution; no floats). |
  | 4 | `bayerThreshold` | `(size: 2 \| 4 \| 8, x: u8, y: u8) => u8` | Returns the Bayer-matrix threshold value at `(x, y)` for a 2×2, 4×4, or 8×8 ordered-dither matrix. Matrices are hardcoded `Uint8Array` constants; output range is `[0, size² - 1]`. |
  | 5 | `valueNoise2D` | `(prng: PRNG, x: i32, y: i32) => u8` | Integer hash-based 2D value noise, output `[0, 255]`. Uses `prng.next() ^ hash2D(x, y)` where `hash2D` is the Wang-hash variant pinned in decision 1a. **Deterministic given the same `prng` state and `(x, y)`.** |
  | 6 | `rectMask` | `(width: u8, height: u8, x0: u8, y0: u8, x1: u8, y1: u8) => Uint8Array` | Returns a `width × height` 0/1 mask with rectangle `[x0..x1] × [y0..y1]` set to 1. |
  | 7 | `circleMask` | `(width: u8, height: u8, cx: u8, cy: u8, r: u8) => Uint8Array` | Returns a `width × height` 0/1 mask of a midpoint-circle (Bresenham). All integer ops. |
  | 8 | `lineMask` | `(width: u8, height: u8, x0: u8, y0: u8, x1: u8, y1: u8) => Uint8Array` | Returns a `width × height` 0/1 mask of a Bresenham line segment. |
  | 9 | `columnShift` | `(buf: Uint8Array, width: u8, height: u8, prng: PRNG, maxShift: u8) => Uint8Array` | For each column, draws a per-column shift in `[0, maxShift]` from `prng` (rejection-sampled per `uniformIndex` in decision 1a) and rotates that column vertically. Glitch effect. |
  | 10 | `scanlineResidue` | `(buf: Uint8Array, width: u8, height: u8, palette: Palette, residueColorName: PaletteColorName, period: u8) => Uint8Array` | Replaces every `period`-th row's nonzero pixels with the residue color. Pure CRT-scanline glitch. |

- **Explicitly rejected primitives — and why each must wait:**
  - **Floyd–Steinberg error-diffusion dither.** Rejected for v1.
    Floyd–Steinberg requires accumulating fractional error across pixels;
    in a true float implementation it is deterministic but uses floats,
    which are banned in `src/atlas/**`. A fixed-point integer variant is
    *possible* (scale errors by 256 and round) but is non-trivial to
    audit and produces visually similar output to ordered dither for the
    cyberpunk-neon-on-dark aesthetic. Phase 9 may revisit; if added it
    must be pinned (multiplier, error-distribution coefficients, bit
    width) at point of introduction. **Recipes must use `bayerThreshold`
    only.**
  - **Perlin noise.** Rejected for v1. Reference Perlin uses
    floating-point gradient vectors and a smoothstep curve (a polynomial
    in floats). Integer-Perlin variants exist but are less common and
    each implementation drifts subtly. `valueNoise2D` covers the
    procedural-texture use case for Phase 4–7 recipes; if Phase 9
    visual tuning needs Perlin, the integer variant is pinned at point
    of introduction.
  - **Polygon fill / paint-bucket.** Rejected for v1. Polygon fill
    requires a scanline-rasterizer with edge tables; paint-bucket
    requires a flood-fill with a recursion or queue depth. Both are
    implementable but expand the recipe surface significantly.
    Recipes can compose `rectMask`, `circleMask`, and `lineMask` (and
    bitwise-OR them via `paletteSwap`-style buffer ops) for v1's needs.
  - **Channel split (RGB→R/G/B offset).** Rejected for v1. Indexed-PNG
    output (decision 5) does not have RGB channels at the pixel level —
    each pixel is one palette index. The cyberpunk "chromatic
    aberration" effect is faked by `columnShift` plus `paletteSwap` on
    a near-color pair; explicit channel split would require RGBA32
    output.
  - **Row shift / glitch sweep.** Folded into `columnShift` — recipes
    that want a row-shift compose `columnShift` after a transpose
    (recipes implement transpose internally as a pure helper; not a
    primitive).

- **Alternatives considered for the primitive set as a whole:**
  - **Larger primitive set (~25 functions, including all variants).**
    Rejected — every primitive is a frozen contract once mods care
    about it (SPEC.md principle 5: "designed for mods, even before
    mods exist"). Ten orthogonal primitives is the smallest set that
    covers Phase 4–7's recipe needs. Phase 9 may add tuned primitives
    via the registry-extension pattern (additive to the registry; each
    new primitive's signature is pinned at addition time).
  - **No primitive layer; recipes write raw pixel buffers directly.**
    Rejected — each recipe would re-implement Bresenham and dither
    matrices, and the modding surface would be "bring your own pixel
    pusher" rather than "compose primitives." The primitive layer is
    the modding ABI; recipes are the modding *content*.
  - **Recipes return RGBA32 buffers; primitives operate on RGBA32.**
    Rejected — see decision 5; indexed PNG is the smaller binary and
    palette-swap mods (a Phase 9+ feature) are trivial against
    palette-index buffers and impossible against pre-flattened RGBA.

- **Why this option:** every primitive is a one-screen pure function
  with integer-only arithmetic. No primitive consumes the per-call
  subhash from sim's roll derivation (decision 1a explains the recipe
  PRNG plumbing); no primitive touches the floor-JSON or RunState
  shapes. The primitive layer is testable in isolation — each primitive
  has a small handful of unit tests with hardcoded input/output byte
  arrays as goldens. The set is small enough that a code-reviewer can
  hold all ten in their head while reviewing a recipe.

- **If wrong:** the primitive set lives in `src/atlas/primitives/` as
  ten files. Adding an eleventh primitive is additive (registry-style;
  pin its signature at addition time). Removing or renaming a
  primitive is a `rulesetVersion` bump (it changes the bytes a recipe
  emits, and therefore the bytes of `assets/atlas.png`, and therefore
  `atlasBinaryHash`).

### 1a. Recipe PRNG plumbing: **per-recipe seeded PRNG derived via `streams.atlas(recipeId)`**

- **Chosen.** Recipes do **not** share a global PRNG. Each recipe call
  receives a freshly-allocated `PRNG` instance derived from a new
  `RunStreams` accessor:

  ```ts
  // ADDED in Phase 4:
  atlas(recipeId: string): PRNG
  // derives streamPrng(rootSeed, "atlas", recipeId)
  // records `"atlas:" + recipeId` into __consumed
  ```

  At atlas-generation time, `tools/gen-atlas.ts` constructs
  `streamsForRun(seedToBytes(atlasSeed))` *once* and calls
  `streams.atlas(recipeId)` once per recipe slot. The recipe receives
  this PRNG, the active palette, and an ambient `RecipeContext`
  describing its target slot (decision 2); it returns a `Uint8Array` of
  palette indices (length = `tileSize × tileSize`).

  `recipeId` is the registry's stable ID for the recipe (e.g.
  `atlas-recipe.cyberpunk.tile.floor`). Validation rules mirror Phase
  1 + Phase 3: well-formed UTF-16, `1 ≤ utf8(recipeId).length ≤ 64`,
  7-bit ASCII (recipe IDs are programmer-authored, not user input).
  Violations throw `atlas: recipeId must be 7-bit ASCII, 1..64 utf8
  bytes (got <length>: <repr>)`.

  `valueNoise2D(prng, x, y)` consumes one `prng()` call per `(x, y)`
  pair. The hash is:

  ```
  hash2D(x, y) = uint32(
    ((x * 0x1f1f1f1f) ^ rotateLeft(y * 0x9e3779b1, 13)) * 0x45d9f3b
  ) >>> 0
  // multiplications are modulo 2^32 via Math.imul; rotateLeft(n, k) =
  // ((n << k) | (n >>> (32 - k))) >>> 0
  ```

  This is the standard Wang-hash 32-bit integer mixer. The constants
  `0x1f1f1f1f`, `0x9e3779b1`, `0x45d9f3b`, and the rotation amount `13`
  are pinned. `Math.imul` is the JavaScript 32-bit signed multiply
  primitive — it's the only way to get deterministic 32-bit truncated
  multiplies in JS without floats; it's available in every supported
  runtime; it is **not** floating-point arithmetic and is permitted
  under the `no-float-arithmetic.cjs` lint rule (which targets the `+`
  / `-` / `*` / `/` operators, not built-in functions).

  `valueNoise2D` returns `((prng.next() ^ hash2D(x, y)) & 0xff)`.

  `uniformIndex(prng, n)` is the rejection-sampling helper from Phase 3
  decision 6a (`src/sim/run.ts`), relocated to `src/core/prng.ts` in
  the Phase 4.A.1 drift-detection sweep (decision 13) so both `src/sim/**`
  and `src/atlas/**` can consume it without cross-layer imports.

- **Why this option:** `streams.atlas(recipeId)` mirrors the
  `streams.simFloor(floorN)` pattern (Phase 3 frozen contract 8). The
  per-recipe accessor isolates each recipe's PRNG cursor from every
  other recipe's, so a recipe added in Phase 6 cannot perturb a Phase
  4 recipe's output. The salt encoding `(name="atlas", salts=[recipeId])`
  uses Phase 1's `encodeSalt` for strings (`[0x02][len:1][b...]`); the
  pre-image is distinct from `streams.sim()`, `streams.simFloor(N)`,
  `streams.mapgen(N)`, and `streams.ui()` by construction (different
  salts, different total length, different tail bytes — the same
  non-collision proof Phase 3 addendum B4 exhibited).

- **If wrong:** the accessor is one method on `RunStreams`. Removing
  it (going back to inline `streamPrng` calls from atlas) is a
  `rulesetVersion` bump because the salt encoding `(name="atlas",
  salts=[recipeId])` is what produces the pre-image; the bytes
  consumed don't change.

- **Test that would catch a violation:** `tests/core/streams.test.ts`
  asserts `streams.atlas("atlas-recipe.foo")` and
  `streams.atlas("atlas-recipe.bar")` produce distinct first-PRNG
  outputs given the same root seed; `tests/atlas/recipes/*.test.ts`
  asserts each recipe's first 64 bytes equal a hardcoded golden when
  invoked via `streams.atlas(recipeId)`.

### 2. Recipe registration contract: **`(prng, palette, ctx) → Uint8Array` signature; stable `atlas-recipe.<theme>.<category>.<name>` IDs**

- **Chosen.** A recipe is a single pure function:

  ```ts
  type RecipeContext = {
    readonly tileSize: 16;                       // pinned (decision 3)
    readonly slotName: string;                   // logical sprite ID, e.g. "tile.floor.cyberfloor_03"
    readonly atlasSeed: string;                  // user-facing atlas-seed string
  };

  type Palette = {
    readonly id: string;                         // "cyberpunk-neon-v1"
    readonly colors: readonly RgbaColor[];       // length ≤ 16; entry 0 is transparent
    readonly names: ReadonlyMap<string, u8>;     // name → palette index
  };

  type RgbaColor = {
    readonly r: u8;
    readonly g: u8;
    readonly b: u8;
    readonly a: u8;                              // 0 (transparent) or 255 (opaque); no partial alpha
  };

  type Recipe = (
    prng: PRNG,
    palette: Palette,
    ctx: RecipeContext,
  ) => Uint8Array;                                // length = tileSize * tileSize (= 256 for 16×16)
  ```

  The recipe returns a **flat palette-index buffer** in row-major
  `pixels[y * tileSize + x]` order, exactly mirroring the Phase 2
  `Floor.tiles` addressing convention. Pixel value `0` is reserved as
  the transparent index (matches the PNG `tRNS` chunk in decision 5).

  Recipes do **not** emit PNG bytes directly — that work is owned by
  the atlas packer (decision 3) and the encoder (decision 4). A recipe
  is allowed to read ambient palette colors via `palette.names.get(...)`
  but must **not** mutate the palette, must **not** read `ctx.atlasSeed`
  for any purpose other than passing it back to a logging primitive
  (none currently exist), and must **not** import from `src/sim/**`,
  `src/mapgen/**`, `src/render/**`, `src/input/**`, or `src/main.ts`.
  Lint rule pins this (decision 11).

  **Stable-ID format** for recipes:

  ```
  atlas-recipe.<theme>.<category>.<name>
  ```

  - `<theme>` is `cyberpunk` for v1. A future `fantasy` theme is a
    different string and triggers a different registry slice.
  - `<category>` is one of `tile`, `monster`, `item`, `npc`, `ui`,
    `boss`. Adding a category is additive.
  - `<name>` is a `[a-z0-9_-]+` slug. The slug is a programmer
    convention; the validator pins
    `^[a-z][a-z0-9_-]*$` (1..32 chars per segment).
  - Total `recipeId.length` is `≤ 64` UTF-8 bytes (decision 1a's
    validation cap).

  Examples:

  - `atlas-recipe.cyberpunk.tile.floor` — first floor-tile recipe.
  - `atlas-recipe.cyberpunk.monster.ice-daemon` — sprite for
    `monster.ice.daemon` (decision 2a wires the mapping).
  - `atlas-recipe.cyberpunk.boss.black-ice-v0` — boss sprite for
    `monster.boss.black-ice-v0`.

- **Alternatives considered:**
  - **Recipe returns RGBA32 pixel buffer.** Rejected — see decision 5;
    indexed-palette buffers are smaller and palette-swap-friendly.
  - **Recipe returns a PNG byte stream.** Rejected — atlas packing
    (placing tiles in the sheet) is a separate concern from pixel
    generation; mixing them would force every recipe to re-encode and
    would multiply the deterministic-encoder surface (decision 4) by
    the recipe count.
  - **Recipe is a class with `paint(prng, palette, ctx)` method.**
    Rejected — pure function is testable, mockable, and trivially
    serialized for parallel generation if Phase 9 ever needs it.
  - **Recipe declares its own tile size (variable per recipe).**
    Rejected — fixed grid (decision 3) requires uniform tile sizes;
    multi-tile sprites (a 2×2 boss sprite, e.g.) compose multiple
    16×16 tiles by occupying multiple grid cells. Their recipe still
    returns one 16×16 buffer per occupied cell, declared via the
    registry's `tilesWide`/`tilesHigh` fields.
  - **Recipes self-register via decorators or side-effecting imports.**
    Rejected — explicit registry (`src/registries/atlas-recipes.ts`)
    avoids import-order dependencies and side-effecting modules
    (Phase 1 decision 9 idiom: data-only registries).

- **Why this option:** the signature is the smallest contract that
  separates pixel generation (recipe authors' work) from atlas
  packing + PNG encoding (toolchain's work). Pure functions match the
  Phase 1–3 determinism discipline. The stable-ID format is parallel
  to Phase 2's room/encounter IDs (`room.entrance`, `encounter.combat.basic`)
  and Phase 3's monster/item IDs (`monster.ice.daemon`,
  `item.cred-chip`).

- **If wrong:** the signature is one type alias. Extending the
  `RecipeContext` (e.g. adding a `tier: int` field for Phase 6 item
  rarity tinting) is additive provided the existing fields are
  preserved.

- **Test that would catch a violation:** `tests/atlas/registry.test.ts`
  asserts every registered recipe's ID matches the regex
  `^atlas-recipe\.(cyberpunk)\.(tile|monster|item|npc|ui|boss)\.[a-z][a-z0-9_-]{0,31}$`,
  asserts each recipe is a function, asserts each recipe's output
  buffer length equals `TILE_SIZE * TILE_SIZE`.

### 2a. Recipe registry: **`src/registries/atlas-recipes.ts` mirrors Phase 2 + 3 registry pattern**

- **Chosen.**

  ```ts
  type AtlasRecipeEntry = {
    readonly id: string;                        // "atlas-recipe.cyberpunk.tile.floor"
    readonly recipe: Recipe;                    // the pure function from decision 2
    readonly tilesWide: 1 | 2 | 4;              // multi-tile sprites occupy multiple grid cells
    readonly tilesHigh: 1 | 2 | 4;
    readonly slot: AtlasSlotId;                 // logical sprite ID this recipe paints
  };

  // Stable IDs that point into the recipe registry. Phase 4 ships:
  type AtlasSlotId =
    | "tile.floor.cyberfloor_01"
    | "tile.wall.cyberfloor_01"
    | "tile.door.cyberdoor"
    | "monster.ice.daemon"
    | "item.cred-chip"
    | "npc.ripperdoc"
    | "player";
  ```

  The mapping from `monster.ice.daemon` (Phase 3 monster registry) to
  `atlas-recipe.cyberpunk.monster.ice-daemon` (Phase 4 atlas registry)
  is via the `slot` field on the recipe entry. The Phase 3 monster
  registry is **not** modified; the Phase 4 registry references its
  IDs read-only.

  Phase 4 ships **seven** recipe entries (the count required by
  `docs/PHASES.md:209`): floor tile, wall tile, door, one monster
  (`monster.ice.daemon`), one item (`item.cred-chip`), one NPC
  (`npc.ripperdoc`), and the player sprite. Boss sprites
  (`monster.boss.black-ice-v0`) and the remaining ~14 monsters /
  ~19 items / ~2 NPCs land in Phases 6/7 as additive entries.

- **Why this option:** the registry shape mirrors `monsters.ts`
  (Phase 3 decision 12) and `encounters.ts` (Phase 2 decision 6),
  giving a third example of the same pattern. Append-only by
  convention (Phase 2 decision 6); the registry-immutability
  enforcement test stays deferred per Phase 2 to Phase 6.

- **If wrong:** the registry is data; revisions are append-only and
  do not change Phase 4's existing recipe outputs (a new recipe entry
  changes the atlas binary hash, so any addition is a `rulesetVersion`
  bump — see decision 7 for the rule that bumping is allowed in Phase
  4 but pinned at Phase 9).

### 3. Atlas layout strategy: **fixed 16×16 grid; 16-tile-wide sheet; 1-pixel transparent padding**

- **Chosen.**

  - **Tile size.** `TILE_SIZE = 16` pixels. Pinned constant in
    `src/atlas/params.ts`. Bumping is a `rulesetVersion` bump.
    Justification: 16×16 is the canonical roguelike sprite size;
    matches the Akira/Snatcher pixel-art density referenced in
    SPEC.md; small enough that recipes are auditable as 256-byte
    buffers in unit tests; large enough to express recognizable
    silhouettes for monsters and items.
  - **Padding.** `TILE_PADDING = 1` pixel of palette-index `0`
    (transparent) on the **right and bottom** of every tile cell. A
    16×16 tile sprite occupies a 17×17 cell in the atlas grid. The
    extra row/column prevents bilinear-filter bleed if a future
    renderer ever turns on filtering (Phase 5 ships nearest-neighbor;
    this is defense-in-depth at zero cost). Pinned constant.
  - **Sheet width.** `ATLAS_TILES_WIDE = 16` cells per row. With
    `1` padding pixel, the atlas pixel width is
    `16 * (16 + 1) = 272` pixels.
  - **Sheet height.** Computed from the recipe count plus headroom:
    `ceil(slotCount / 16) * (16 + 1)` pixels, clamped to the next
    multiple of `16 + 1`. For Phase 4's seven recipes, height is
    `1 * 17 = 17`. For Phase 7 (Phase 4's seven + Phase 6's ~20
    items + Phase 7's ~3 NPCs + boss = ~31 entries; including
    multi-tile boss sprites that may consume 4 cells = ~34 effective
    cells = 3 rows): `3 * 17 = 51`. We allocate **128 effective
    cells** in v1 (8 rows × 16 cells = `8 * 17 = 136` pixels tall),
    leaving Phase 6/7 ~94 cells of headroom for additive recipes
    without forcing a layout reshuffle.
  - **Layout strategy.** **Fixed grid**, not bin-packing. Recipes
    are placed in **registry-declaration order**, with multi-tile
    sprites (`tilesWide × tilesHigh > 1`) reserving contiguous cells
    by skipping cells that would split the multi-tile rectangle
    across rows (the placer advances to the next row if the current
    row has insufficient remaining cells; skipped cells are left
    empty / fully-transparent). Frozen contract: the placement
    function is pinned so adding a recipe in Phase 6/7 does not
    reshuffle existing recipes' coordinates.
  - **Atlas pixel dimensions.** `width = 272`, `height = 136`. Total
    pixels: `36 992`. Indexed PNG (decision 5) at one byte per pixel
    plus PNG framing: estimated **~4–8 KB** binary, well under the
    256 KB budget per `docs/PHASES.md:216`. Even Phase 9 polish
    (additional decorative tiles, animated sprites) has multiple
    orders of magnitude headroom.

- **Alternatives considered:**
  - **Bin-packing (e.g. MaxRects, guillotine).** Rejected — packing
    is order-sensitive and a Phase 6 PR adding one item could shift
    every other sprite's coordinates, breaking pinned coordinate
    references in the renderer's atlas-loader. Fixed grid trades
    ~10% wasted pixels for layout stability.
  - **32×32 tile size.** Rejected — quadruples the per-tile pixel
    count, makes 256-byte unit-test goldens 1024 bytes, and is
    larger than the cyberpunk top-down aesthetic calls for. Phase 9
    can revisit if HiDPI becomes a concern.
  - **8×8 tile size.** Rejected — too coarse for recognizable
    monster silhouettes; the 12×12-ish silhouette area inside a
    16×16 tile is the standard roguelike sweet spot.
  - **Variable tile sizes (e.g. 16×16 for tiles, 32×32 for boss).**
    Rejected — the renderer's UV computation gets a per-sprite
    branch, and the atlas JSON manifest grows a `tileSize` field per
    sprite. Multi-tile sprites (e.g. a 32×32 boss as a 2×2 grid of
    16×16 tiles, decision 2a) cover the boss-size case without the
    branch.
  - **0-pixel padding.** Rejected — gives bleed on bilinear
    filtering and on subpixel-positioned blits. The 1-pixel cost is
    free in the binary budget.

- **Why this option:** fixed-grid layout means the atlas JSON
  manifest's per-sprite coordinates are deterministic from the
  registry order alone — no packing algorithm to pin. Adding a
  recipe in Phase 6 lands in a new cell at the end of the grid;
  every Phase 4 sprite's coordinates remain unchanged (they do
  shift when a multi-tile sprite is added that bumps the row; the
  placement algorithm is pinned in decision 3a so the shift is
  predictable). 16×16 tiles match the sim layer's integer-grid
  movement (one tile = one move-action) without rendering surprises.

- **If wrong:** layout constants live in `src/atlas/params.ts`.
  Bumping the tile size is a `rulesetVersion` bump. Switching to
  bin-packing requires a packing algorithm decision memo of its
  own.

### 3a. Atlas-grid placement function: **registry-declaration-order, row-major, multi-tile rectangles never split**

- **Chosen.** The placement algorithm:

  ```
  cursorRow = 0; cursorCol = 0;
  for entry in registryOrder:
    w = entry.tilesWide; h = entry.tilesHigh
    if cursorCol + w > ATLAS_TILES_WIDE:
      cursorRow += 1; cursorCol = 0
    if cursorRow + h > ATLAS_TILES_HIGH:
      throw new Error("atlas: registry exceeds atlas grid (got <count>, max <ATLAS_CELLS>)")
    place entry at (cursorCol, cursorRow), occupying cols [cursorCol..cursorCol+w-1] × rows [cursorRow..cursorRow+h-1]
    cursorCol += w
  ```

  No backfilling, no compaction. Skipped cells (where the cursor
  jumped a row to fit a multi-tile sprite) remain empty
  (fully-transparent palette index 0). This is intentional: it pins
  coordinates strictly to the prefix of the registry order, so
  inserting a single-tile recipe at the *end* never moves any
  earlier recipe's `(x, y)`.

- **Frozen invariant.** For every recipe in `atlas-recipes.ts` at
  registry index `i`, the recipe's `(atlasX, atlasY)` is a pure
  function of the prefix `[0..i]`'s `(tilesWide, tilesHigh)` values.
  Adding a recipe at index `i+1` does not move recipe `i`. **This
  is the load-bearing invariant for Phase 5+ atlas-coordinate
  stability under additive Phase 6/7 recipe growth.**

- **Test that would catch a violation:**
  `tests/atlas/layout.test.ts` asserts the placement function on a
  hardcoded 12-entry registry (a mix of 1×1, 2×1, 1×2, 2×2 entries)
  produces a hardcoded coordinate map. A second test removes the
  last entry and asserts the remaining coordinates are unchanged.

### 4. Deterministic PNG encoding: **custom minimal indexed-PNG writer in `src/atlas/png.ts`; `fdeflate` for IDAT compression**

- **Chosen.** Phase 4 ships a **purpose-built minimal PNG encoder** in
  `src/atlas/png.ts` (~150 lines), targeting only the indexed-color
  PNG variant we use (color type 3). It does **not** depend on
  `pngjs`, `upng-js`, or any general-purpose PNG library. It depends
  on **`fdeflate`** (one new exact-pinned devDependency) for the
  DEFLATE step inside the IDAT chunk.

  - **`fdeflate` (≈ 8 KB minified, MIT-licensed, audited, no native
    code, no Node-vs-browser branch).** `fdeflate` is a pure-JS
    DEFLATE implementation that produces **byte-identical output**
    for the same input + compression level on Node, Chromium,
    Firefox, and WebKit. It is used by `vite`, `vitest`, and several
    audited tooling packages. It is **not** the same as `pako` (which
    has been observed to produce different byte outputs across
    versions when compression heuristics are tuned).
  - **Compression level.** `level: 1` (fastest deflate; minimal Huffman
    optimization). Level 1 is chosen specifically because it has the
    least implementation freedom — higher levels (4, 6, 9) leave
    deflate-implementations free to choose between equally-valid
    Huffman encodings, which can drift across versions of the same
    library. Level 1's output is a near-deterministic function of the
    input bytes.
  - **`fdeflate` API call:** `deflateSync(idatBytes, { level: 1 })`.
    The output is the raw DEFLATE stream (no zlib framing); we wrap
    it in a zlib wrapper inside the IDAT chunk per the PNG spec.

  **PNG byte layout (frozen):**

  ```
  PNG signature: 0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a       (8 bytes)
  IHDR chunk:    [length:4 BE = 13]
                 [type:4 = "IHDR"]
                 [width:4 BE]
                 [height:4 BE]
                 [bitDepth:1 = 8]
                 [colorType:1 = 3]                              // indexed
                 [compressionMethod:1 = 0]
                 [filterMethod:1 = 0]
                 [interlaceMethod:1 = 0]                        // no interlace
                 [crc:4 BE]
  PLTE chunk:    [length:4 BE = 3 * paletteCount]
                 [type:4 = "PLTE"]
                 [r,g,b for each palette entry]                 // paletteCount ≤ 16
                 [crc:4 BE]
  tRNS chunk:    [length:4 BE = paletteCount]                   // entry-by-entry alpha
                 [type:4 = "tRNS"]
                 [a for each palette entry]                     // 0 (transparent) or 255
                 [crc:4 BE]
  IDAT chunk:    [length:4 BE]
                 [type:4 = "IDAT"]
                 [zlib-wrapped DEFLATE of filtered scanlines]
                 [crc:4 BE]
  IEND chunk:    [0x00 0x00 0x00 0x00]
                 [type:4 = "IEND"]
                 [crc:4 BE = 0xae 0x42 0x60 0x82]
  ```

  **Chunk ordering:** **fixed, canonical, in this order**:
  `IHDR, PLTE, tRNS, IDAT, IEND`. The PNG spec requires `IHDR` first
  and `IEND` last, requires `PLTE` before `IDAT` for color type 3,
  and requires `tRNS` (if present) after `PLTE` and before `IDAT`.
  The order above is the unique satisfying ordering for our chunk
  set; no choice exists. **No ancillary chunks are emitted** —
  no `gAMA`, no `sRGB`, no `cHRM`, no `pHYs`, no `tEXt`, no `tIME`
  (the last would inject wall-clock nondeterminism).

  **Filter selection:** **filter type 0 (None)** for every scanline.
  A "None" filter means each scanline is a literal copy of pixel
  bytes. PNG allows per-scanline filter choice (None, Sub, Up,
  Average, Paeth), but **filter heuristics differ across encoders**
  and are the single largest source of cross-encoder byte drift.
  Pinning filter 0 universally eliminates the drift surface.
  Compression cost vs. filter 0 is small for the small palette and
  high local correlation of pixel-art data; the 256 KB budget has
  multiple orders of magnitude of headroom.

  **CRC calculation:** standard CRC-32 (IEEE 802.3 polynomial
  `0xedb88320`), little-endian-poly, big-endian-emitted-on-wire per
  the PNG spec. Hardcoded 256-entry CRC table generated lazily on
  first use. Implementation in `src/atlas/png-crc.ts`.

  **Integer-overflow guards.** PNG `length` fields are 32-bit
  unsigned; `width × height × bytesPerPixel` for our atlas
  (`272 × 136 × 1 = ~37 KB` raw) is well under any limit, but the
  encoder asserts `width ≤ 2^15` and `height ≤ 2^15` (16-bit cap)
  to refuse pathological input early. Violations throw
  `pngEncode: width <N> or height <M> exceeds 32768`.

- **Alternatives considered:**
  - **`pngjs` (Node-only, MIT, ~50 KB).** Rejected — Node-only,
    requires a different code path for browser previews (Phase 4's
    dev-mode preview UI runs in the browser; decision 9). The custom
    encoder works in both.
  - **`upng-js` (browser + Node, MIT, ~30 KB).** Rejected — recently
    deprecated upstream (last commit > 4 years ago), bundles a
    full DEFLATE implementation in pure JS that has been observed
    to produce different output across `upng` versions. Pinning a
    specific version mitigates today; we'd inherit the abandonment
    risk for Phase 8+.
  - **Node `zlib.deflateSync` (built-in).** Rejected — Node's `zlib`
    is a binding to system zlib (libzlib1g on Linux, Apple's libz on
    macOS, msys's zlib on Windows). System zlib **versions differ
    across the GitHub Actions runner images**, and minor zlib version
    differences can produce different byte output at the same
    compression level for non-trivial inputs. This is the canonical
    cross-platform PNG-determinism foot-gun. Pure-JS `fdeflate`
    side-steps it.
  - **`pako` (pure-JS zlib port, ~45 KB).** Rejected — `pako` has had
    multiple compression-output-changing patch releases over the
    years (its heuristic tuning evolves). The risk profile is real
    even with version pinning, because a future security patch
    could change byte output. `fdeflate` is smaller, simpler, and
    its output is more byte-stable over time.
  - **No compression (DEFLATE store-mode only, level 0).** Defensible
    — store-mode DEFLATE is fully deterministic by definition. But
    raw atlas size at 36 992 pixels = 36 992 bytes uncompressed +
    PNG framing = ~37 KB, well under budget; level 1 buys ~50%
    further compression for free determinism. Either choice would
    work; level 1 is the cleaner fit for the budget headroom.

- **Why this option:** the encoder is small enough to audit
  end-to-end (~150 lines including the zlib wrapper); the
  compression library (`fdeflate`) has the strongest byte-stability
  track record of the pure-JS DEFLATE options; the PNG byte layout
  is unique-by-construction (no chunk-ordering choice, no filter
  choice); the encoder has no ambient state (no `Date`, no `Math.random`);
  and the cross-OS verification matrix in Phase 4.B is the final
  insurance.

- **Cross-OS verification.** The Phase 4.B GitHub Actions matrix
  (decision 13) runs `npm run gen-atlas` on `ubuntu-latest`,
  `macos-latest`, and `windows-latest`. Each OS uploads the
  generated `assets/atlas.png` as an artifact; a final aggregator
  job downloads all three and asserts SHA-256 equality. Any drift
  surfaces here as a single-line diff.

- **If wrong:** the encoder lives in two files (`src/atlas/png.ts`,
  `src/atlas/png-crc.ts`). Replacing `fdeflate` with another
  pure-JS deflate is a `rulesetVersion` bump (the IDAT bytes
  change). Switching to a non-indexed PNG variant is a separate
  decision memo.

- **Test that would catch a violation:**
  `tests/atlas/png.test.ts` asserts encoding a hardcoded
  16×16 single-color tile produces a hardcoded byte sequence
  (golden bytes). A second test asserts encoding a 16×16
  all-zeros tile produces a different hardcoded byte sequence.
  The cross-OS matrix in Phase 4.B is the ultimate guarantee.

### 5. Color-palette format: **indexed PNG (color type 3) + tRNS; 16-color cyberpunk-neon-v1 palette; no gAMA / sRGB chunks**

- **Chosen.**

  - **PNG color type:** **3 (indexed-color)**. Pinned. Each pixel is
    a single byte (palette index, `[0..15]` for our 16-color
    palette). Decoder reads the color from the `PLTE` and `tRNS`
    chunks.
  - **Bit depth:** 8 bits per pixel (one byte per pixel, simplest to
    encode, smallest filter-0 IDAT).
  - **Palette size:** **exactly 16 entries** (indices 0–15). Bumping
    is a `rulesetVersion` bump.
  - **Palette entry 0:** **fully transparent** (`r=0, g=0, b=0, a=0`).
    Pinned. Recipe pixels equal to `0` are transparent in the
    rendered tile.
  - **Palette entries 1–15:** the **cyberpunk-neon-v1 palette**, a
    handpicked dark-base-with-neon-accents palette tuned to
    SPEC.md's "neon palette over dark backgrounds" theme (see
    `docs/ATLAS_GENERATOR.md` after this memo lands for the full
    table; the byte-exact RGB values are pinned in
    `src/atlas/palette.ts`). All entries 1–15 are fully opaque
    (`a = 255`).
  - **No partial alpha.** Every palette entry is either `a=0`
    (entry 0 only) or `a=255` (entries 1–15). This keeps the `tRNS`
    chunk minimal and avoids per-pixel alpha blending in the
    renderer (Phase 5 ships nearest-neighbor; partial alpha would
    force a sort or a multi-pass blend).
  - **No `gAMA` chunk, no `sRGB` chunk, no `cHRM` chunk.** PNG
    permits these to declare the color-space interpretation; our
    target (browser canvas drawing) treats indexed PNG output as
    sRGB by default, and emitting gAMA chunks adds bytes without
    behavior change while introducing a per-implementation decision
    surface. Frozen: **only the four chunks listed in decision 4
    are ever emitted.**
  - **Implicit color space.** The atlas is sRGB by browser default;
    we do **not** declare it. Phase 5+ renderer reads pixels as
    sRGB-passthrough (no gamma correction in the canvas drawing
    path).

- **Alternatives considered:**
  - **RGBA32 PNG (color type 6).** Rejected — 4× larger binary, no
    palette-swap path. Even at our small atlas size, RGBA32 +
    DEFLATE would balloon the atlas to ~30+ KB and forfeit the
    palette-swap-mod future.
  - **Indexed PNG with 256 colors (8-bit palette fully utilized).**
    Defensible — gives more headroom for Phase 9 palette tuning.
    Rejected for v1 because 16 colors is the canonical "neo-retro
    pixel art" palette size (matches the Pico-8, NES, Game Boy
    Color tradition); a tighter palette enforces visual cohesion.
    Phase 9 may bump this with a `rulesetVersion` bump; the
    encoder supports up to 256 entries without code change.
  - **Indexed PNG, 4-bit (`bitDepth=4`).** Rejected — packs 2
    pixels per byte (max 16 colors); saves a few KB but makes the
    encoder's filter+pack logic more error-prone. The 8-bit choice
    is straightforward to audit.
  - **Including `gAMA` chunk with `gamma=1/2.2`.** Rejected — adds
    bytes; sRGB-default browser interpretation is correct for our
    use case; explicit declaration adds a per-renderer decision
    surface that we don't need.
  - **Including `tIME` chunk (last-modified time).** Rejected with
    extreme prejudice — this would inject wall-clock
    nondeterminism into the binary every build. Frozen "no `tIME`."

- **Why this option:** indexed-PNG output is the smallest binary
  for our pixel count, the most palette-swap-mod-friendly, and the
  most byte-stable across encoders (no per-channel filter choice).
  The 16-color cyberpunk-neon-v1 palette gives recipe authors a
  fixed palette to compose against, matching the SPEC.md aesthetic.

- **If wrong:** the palette lives in `src/atlas/palette.ts` as a
  hardcoded `RgbaColor[16]`. Tweaking individual colors during
  Phase 9 polish is a `rulesetVersion` bump (every recipe's pixel
  output references palette indices, but the rendered RGB
  changes — the atlas binary hash changes). The Phase 9 polish
  pass will exercise this path.

- **Test that would catch a violation:**
  `tests/atlas/palette.test.ts` asserts `palette.colors.length === 16`,
  asserts `palette.colors[0]` is fully transparent, asserts
  `palette.colors[1..15]` are all fully opaque, asserts the
  `palette.names` map contains the expected named lookups
  (`"transparent" → 0`, `"neon-cyan" → 1`, etc.).

### 6. Atlas JSON manifest schema: **canonical-JSON, sorted top-level keys, strict-parse, schemaVersion=1**

- **Chosen.** `assets/atlas.json` is canonical-JSON-shaped, mirroring
  the Phase 2 floor-JSON discipline (decision 5 of `decision-memo-phase-2.md`):

  ```json
  {
    "atlasBinaryHash": "<64-hex-chars sha256 of assets/atlas.png>",
    "atlasSeed": "<atlas-seed string used to generate this manifest>",
    "generator": {
      "primitiveSetVersion": 1,
      "tileSize": 16,
      "tilePadding": 1,
      "tilesWide": 16,
      "tilesHigh": 8
    },
    "palette": {
      "id": "cyberpunk-neon-v1",
      "size": 16
    },
    "schemaVersion": 1,
    "sprites": {
      "<atlasSlotId 1>": {
        "atlasX": <int>,
        "atlasY": <int>,
        "recipeId": "<atlas-recipe.cyberpunk.<category>.<name>>",
        "tilesHigh": <1 | 2 | 4>,
        "tilesWide": <1 | 2 | 4>
      },
      "<atlasSlotId 2>": { … },
      …
    }
  }
  ```

  - **Top-level key ordering: alphabetical.** Pinned. Same rule as
    Phase 2 floor JSON. Top-level keys in this exact order:
    `atlasBinaryHash, atlasSeed, generator, palette, schemaVersion, sprites`.
  - **Per-sprite key ordering: alphabetical.** Pinned:
    `atlasX, atlasY, recipeId, tilesHigh, tilesWide`.
  - **`generator` and `palette` sub-object key ordering: alphabetical.**
  - **`sprites` map key ordering: alphabetical by `AtlasSlotId`.**
    JSON spec does not guarantee object-key iteration order, so the
    serializer explicitly emits keys sorted ASCII-ascending. The
    parser is order-tolerant on input but the *serializer*
    guarantees the canonical order.
  - **Coordinates are tile-grid coordinates**, not pixel coordinates.
    `atlasX = 3` means "the 4th tile column from the left" (zero-indexed).
    Pixel-space coordinates are computed by the renderer as
    `pixelX = atlasX * (TILE_SIZE + TILE_PADDING)` (= `atlasX * 17`).
    This pin'd convention matches the Phase 5 renderer's expected
    UV computation and avoids hardcoding the padding constant in two
    places.
  - **`schemaVersion: 1`.** Bumping requires an `architecture-red-team`
    review event (same precedent as Phase 2 floor JSON).
  - **`atlasBinaryHash`** is the SHA-256 of `assets/atlas.png`,
    lowercase hex, 64 chars. The same value Vite injects as
    `atlasBinaryHash` (decision 7); duplication is intentional —
    the manifest is self-describing without consulting the build
    bundle.
  - **`atlasSeed`** is the user-facing seed string (e.g.
    `"phase4-placeholder-atlas-seed"`); it is **not** hashed in
    the manifest, but is recorded for audit reproducibility. A
    Phase 6 mod loader inspecting `assets/atlas.json` can confirm
    which seed produced the file.

  **Strict-parse rule.** `parseAtlasJson(text: string): AtlasManifest`
  is **strict**, mirroring `parseFloor` (Phase 2 frozen contract):

  - Unknown top-level keys cause it to throw
    `parseAtlasJson: unknown key '<key>'`.
  - Missing required keys cause it to throw
    `parseAtlasJson: missing required key '<key>'`.
  - `schemaVersion !== 1` causes it to throw
    `parseAtlasJson: unsupported schemaVersion (got <N>, expected 1)`.
  - Invalid `recipeId` (regex mismatch from decision 2) causes it
    to throw `parseAtlasJson: invalid recipeId '<id>'`.
  - Invalid `atlasX` / `atlasY` (out of `[0, ATLAS_TILES_WIDE - 1]`
    or `[0, ATLAS_TILES_HIGH - 1]`) causes it to throw.
  - The check `sprites[k].recipeId` references an ID present in
    `atlas-recipes.ts` is **not** performed by `parseAtlasJson` —
    that is a runtime registry check at atlas-load time
    (`src/atlas/manifest-loader.ts`), not a parse-time concern. The
    parser is purely structural; the loader is semantic. Same
    separation as Phase 2's `parseFloor` vs runtime registry checks.

  **Where `parseAtlasJson` is invoked.** Only on the output of
  `serializeAtlasManifest`. Phase 8 will introduce a separate
  `parseExternalAtlasJson` for hostile-input validation when
  URL-routed atlases land. Same pattern as Phase 2's
  `parseFloor` / future `parseExternalFloor` split.

- **Why this option:** mirrors Phase 2 verbatim, so reviewers'
  intuition transfers. Top-level alphabetical sort + per-collection
  explicit comparator is the same byte-stability discipline. The
  manifest schema captures everything Phase 5's renderer needs (a
  sprite's `(atlasX, atlasY, tilesWide, tilesHigh)` to compute UVs)
  and everything Phase 8's verifier needs (the manifest itself
  describes the atlas it was generated against).

- **If wrong:** schema lives behind one (de)serialize pair in
  `src/atlas/manifest.ts`. Bumping `schemaVersion` and writing a
  v1→v2 migrator is the cost; existing fingerprints replay against
  pinned releases that still know v1 manifests.

- **Test that would catch a violation:**
  `tests/atlas/manifest.test.ts` asserts a hardcoded
  `AtlasManifest` round-trips through `serializeAtlasManifest →
  parseAtlasJson` byte-identically; asserts `parseAtlasJson` throws
  on unknown keys, missing keys, and `schemaVersion=2`; asserts
  the serializer's output has top-level keys in the pinned
  alphabetical order.

### 7. `rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)` wiring: **`rulesText` is the build-time-frozen content of `src/registries/**` + `src/sim/params.ts` + `src/sim/combat.ts`; `atlasBinaryHash` is computed at Vite-config-load time from `assets/atlas.png`**

- **Chosen.**

  - **`rulesText`** is the **byte-concatenation of the file contents
    of**, in this exact order:
    - `src/sim/params.ts`
    - `src/sim/combat.ts`
    - `src/sim/turn.ts`
    - `src/sim/ai.ts`
    - `src/sim/run.ts`
    - `src/registries/monsters.ts`
    - `src/registries/items.ts`
    - `src/registries/rooms.ts`
    - `src/registries/encounters.ts`
    - `src/registries/atlas-recipes.ts`
    - `src/atlas/palette.ts`
    - `src/atlas/params.ts`

    Files are read as **UTF-8 bytes** with **LF line endings**
    (the CI workflow asserts `git config core.autocrlf input` on
    Windows runners; see decision 13). A SHA-256 separator
    (`utf8("\n----icefall-ruleset-file-boundary-v1----\n")`,
    44 bytes) is inserted between each file's contents to prevent
    boundary-confusion (two short files concatenated cannot collide
    with one long file).
  - **`rulesetText`** is encoded as
    `sha256(rulesetTextPreimage)` first, lowercase hex, 64 chars.
    This is the "rules hash" half of the ruleset version. Pinning
    the file list (rather than "all of `src/sim/**`") gives a
    stable, append-only rule for what counts as a rule change. New
    sim files added in Phase 6/7 are appended to the list; the
    addition is itself a rule change (the file's contents enter the
    pre-image), and Phase 6/7's planning gates approve the
    extension.
  - **`atlasBinaryHash`** is `sha256(<assets/atlas.png bytes>)`,
    lowercase hex, 64 chars. Computed at Vite-config-load time
    by `vite.config.ts`'s `define` block, which reads
    `assets/atlas.png` synchronously via `fs.readFileSync`.
  - **`rulesetVersion`** is then
    `sha256(utf8(rulesetTextHash) ‖ utf8("|") ‖ utf8(atlasBinaryHash))`,
    lowercase hex, 64 chars. The `|` separator is a literal pipe
    character; both inputs are 64-char hex (no NUL-separator risk).
    Vite injects this as `__RULESET_VERSION__` via `define`, replacing
    the Phase 1 placeholder string.

  **Build-step ordering.** `vite.config.ts`:

  ```
  1. read assets/atlas.png → atlasBinaryHash (or throw if missing)
  2. read 12 listed files → rulesetText preimage → rulesetTextHash
  3. compose rulesetVersion = sha256(rulesetTextHash ‖ "|" ‖ atlasBinaryHash)
  4. inject __COMMIT_HASH__, __RULESET_VERSION__, __ATLAS_BINARY_HASH__
  5. build proceeds normally
  ```

  Vite reads `assets/atlas.png` from the file system. If the file
  is missing (e.g. a fresh clone that hasn't run `npm run gen-atlas`),
  `vite.config.ts` throws
  `vite-config: assets/atlas.png missing — run 'npm run gen-atlas' first`.

  **Build fails if `assets/atlas.png` is stale.** A separate CI step
  (`npm run gen-atlas`) regenerates the atlas; `git diff --exit-code
  assets/` then asserts no change. If the script changes the file,
  the diff fails and the build is rejected. See decision 10. (Vite
  itself does not regenerate the atlas during build — that is the
  CI gate's responsibility.)

  **Retiring the Phase 1 placeholder sentinel.** The constant
  `PLACEHOLDER_RULESET_VERSION = "phase1-placeholder-do-not-share"`
  remains exported from `src/build-info.ts` for backward-compatibility
  with the Phase 1 self-test that asserts the `DEV-` prefix
  fingerprint behavior. Phase 4's `vite.config.ts` and
  `vitest.config.ts` no longer inject this string as the value of
  `__RULESET_VERSION__`; instead, they inject the new
  `sha256(rulesText ‖ atlasBinaryHash)` value. The fingerprint
  function (`src/core/fingerprint.ts:74-77`) continues to emit a
  `DEV-` prefix when `inputs.rulesetVersion ===
  PLACEHOLDER_RULESET_VERSION`; in practice no production runtime
  invocation will pass that string anymore (it's only used in
  test fixtures).

  **`DEV-` fingerprint refusal — exact loader behavior.** The
  Phase 4 atlas-loader (`src/atlas/manifest-loader.ts`) is invoked
  at run start (Phase 5+ caller). If the build-time `rulesetVersion`
  decodes to a `DEV-`-prefixed fingerprint for any
  `(commitHash, rulesetVersion, seed, modIds)` produced from this
  build, the loader throws
  `atlas-loader: refusing to load build with placeholder ruleset
  (DEV- fingerprint) — re-build with 'npm run build' to inject the
  real rulesetVersion`. The check is: if `rulesetVersion ===
  PLACEHOLDER_RULESET_VERSION`, refuse. The check is **not** "if
  the runtime fingerprint string starts with DEV-" because that
  would require a sample fingerprint computation; the simpler
  string comparison suffices. The error message points at the build
  step.

  In Phase 4.A.2 the runtime check is added to
  `src/atlas/manifest-loader.ts`'s `loadAtlas()`. Phase 4 self-tests
  exercise both the success path (real rulesetVersion → load OK)
  and the failure path (placeholder rulesetVersion → throw with
  the pinned message).

  **`atlasBinaryHash` is exposed at runtime** as a separate
  `__ATLAS_BINARY_HASH__` Vite-injected constant in
  `src/build-info.ts`:

  ```ts
  export const atlasBinaryHash: string =
    typeof __ATLAS_BINARY_HASH__ !== "undefined"
      ? __ATLAS_BINARY_HASH__
      : "0".repeat(64);
  ```

  At atlas load time, the loader hashes the actual fetched
  `assets/atlas.png` bytes and asserts equality with
  `atlasBinaryHash`. Mismatch throws
  `atlas-loader: atlas.png hash mismatch — got <actual>, expected
  <build-time> (rebuild required)`. This gives Phase 5+'s
  "loaded atlas does not match build-time hash" acceptance
  criterion a concrete error path.

- **Alternatives considered:**
  - **`rulesText = sha256(every file under src/**)`.** Rejected —
    every formatting-only refactor would bump `rulesetVersion`,
    making the contract noisy. The pinned 12-file list captures
    actual behavioral surface.
  - **`atlasBinaryHash` computed at ESM import time of
    `src/build-info.ts`.** Rejected — would require reading
    `assets/atlas.png` from the runtime bundle, which doesn't
    exist at runtime (the file is loaded as an asset, not bundled).
    Vite-config-time computation is the only place where Node's
    `fs.readFileSync` is available.
  - **`rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)` with
    raw byte concatenation.** Rejected — produces no boundary
    between the two halves, so a clever adversary could construct
    an `assets/atlas.png` whose tail bytes equal a target
    `rulesText`. The literal `|` separator costs nothing and
    eliminates the boundary-confusion risk.
  - **Use git commit hash as a substitute for `rulesetVersion`.**
    Rejected — bumps every commit, including no-op formatting
    commits. The whole point of `rulesetVersion` is that it bumps
    *only* when behavior changes.

- **Why this option:** the file list captures the behaviorally-load-bearing
  source. The build-step ordering — atlas hash → rules hash → ruleset
  version — is unique-by-data-flow (each step depends on the prior).
  The placeholder retirement preserves the Phase 1 `DEV-` sentinel
  semantics for backward-compatibility while moving production builds
  to the real ruleset.

- **If wrong:** `rulesText`'s file list is a constant in
  `vite.config.ts`. Adding or removing a file is a `rulesetVersion`
  bump (it changes the bytes of `rulesText`); reordering a file is
  also a bump. Phase 6/7's planning gates approve any addition.

- **Test that would catch a violation:** `tests/atlas/build-info.test.ts`
  asserts that the runtime `rulesetVersion` (read from
  `src/build-info.ts`) is **not** equal to `PLACEHOLDER_RULESET_VERSION`
  in production builds (when `__RULESET_VERSION__` is defined to a
  non-placeholder value); asserts the loader refuses with the pinned
  error message when `rulesetVersion === PLACEHOLDER_RULESET_VERSION`.
  A separate test asserts the cross-OS byte equality of
  `assets/atlas.png` (the Phase 4.B matrix; decision 13).

### 8. Atlas-seed selection for Phase 4: **`"icefall-phase4-placeholder-atlas-seed"`; bumping freely allowed until Phase 9**

- **Chosen.** Phase 4 ships with the placeholder atlas seed string:

  ```
  "icefall-phase4-placeholder-atlas-seed"
  ```

  Pinned in `src/atlas/params.ts:ATLAS_SEED_DEFAULT`. The seed is a
  user-facing string passed to `seedToBytes(...)` (Phase 2 frozen
  contract) before being fed into `streamsForRun(...)`.

  **Bumping the seed before Phase 9.** Allowed without
  `architecture-red-team` review. The seed change cascades:
  `atlasSeed` → `assets/atlas.png` bytes change → `atlasBinaryHash`
  changes → `rulesetVersion` changes (decision 7). All Phase 4–8
  fingerprints generated under the prior seed are invalidated, but
  no Phase 4–8 build is yet shipped to production with player-shared
  fingerprints (Phase 8 introduces the fingerprint-share UX). The
  Phase 4–8 dev cycle treats `rulesetVersion` as expected-to-bump.

  **Bumping the seed after Phase 9.** A `rulesetVersion` change
  that breaks all old fingerprints. Phase 9 (release hardening)
  selects the v1 release atlas seed via the dev-mode preview UI
  (decision 9). Once Phase 9 ships, the seed is **frozen** until a
  major content release; bumping it requires:
  1. An `architecture-red-team` review event.
  2. A new `releases/<commit>/` directory (Phase 8's content-addressed
     release layout) so old fingerprints continue to load their
     pinned atlas binary.
  3. A `phase-update.json` artifact recording the bump.

  **Frozen rule (joins Phase 1+2+3 frozen contracts).**
  `ATLAS_SEED_DEFAULT` is a placeholder string in Phase 4. Phase 9
  selects the final v1 string. Once Phase 9 ships, bumping
  `ATLAS_SEED_DEFAULT` is a `rulesetVersion` bump and requires
  `architecture-red-team` review.

- **Why this option:** `rulesetVersion` is bound to `atlasBinaryHash`
  (decision 7), so bumping the atlas seed naturally bumps
  `rulesetVersion` without extra coordination. Phase 4–8's
  placeholder-then-frozen seed lifecycle mirrors Phase 1's
  placeholder-then-real ruleset lifecycle.

- **If wrong:** the seed is one constant. Bumping it before Phase 9
  is allowed by this decision; bumping after Phase 9 is the
  pinned-rule case.

- **Test that would catch a violation:** none — this is a process
  rule, not a runtime invariant. Phase 9's planning gate will
  re-verify the rule is honored. The runtime
  `rulesetVersion`-derived fingerprint check (decision 7) catches
  any *unexpected* atlas regeneration in CI via the
  `git diff --exit-code assets/` gate.

### 9. Dev-mode preview UI: **side-by-side render of all sprites at the current atlas-seed; free-form seed text input; 4 hardcoded preset seeds; deployed at all phases ≥ 4**

- **Chosen.** `src/main.ts` gains a new `<section id="atlas-preview">`
  *below* the Phase 3 scripted-playthrough section:

  - **Atlas-seed input.** A `<input type="text" id="atlas-seed-input">`
    free-form string, defaults to `ATLAS_SEED_DEFAULT`. Validated
    against the seedToBytes contract (must be valid UTF-16, length
    `1..255`).
  - **Preset-seed buttons.** Four buttons:
    `"placeholder"`, `"variant-A"`, `"variant-B"`, `"variant-C"`.
    Clicking sets the input to a pinned string (e.g.
    `"icefall-atlas-variant-A"`) and re-renders. The variant
    strings are pinned in `src/atlas/preset-seeds.ts` so Phase 9
    tuning has a stable comparison set.
  - **Render area.** A `<canvas id="atlas-preview-canvas">` showing
    the **current atlas** (loaded from `assets/atlas.png` for the
    pinned seed) **and** a **freshly-regenerated atlas** for the
    user-typed seed. The fresh atlas is generated **in the
    browser** by importing `src/atlas/generate.ts` and running it
    against the user's seed. Side-by-side comparison: the canvas
    is divided into two panels; the build-time atlas on the left,
    the live regenerated atlas on the right.
  - **DOM ids and `window` flags** (mirroring Phase 2.A
    `__FLOOR_PREVIEW__` and Phase 3.A.2 `__SIM_FINAL_STATE_HASH__`
    conventions for cross-runtime Playwright assertions):
    - `id="atlas-preview"` — the section container.
    - `id="atlas-seed-input"` — the seed text input.
    - `id="atlas-preview-canvas"` — the comparison canvas.
    - `id="atlas-regenerate-button"` — button to trigger regen
      after typing.
    - `window.__ATLAS_PREVIEW__: "ready" | undefined` — set to
      `"ready"` after first paint completes successfully.
    - `window.__ATLAS_PREVIEW_BUILD_HASH__: string | undefined` —
      lowercase hex SHA-256 of the build-time atlas binary
      (matches `__ATLAS_BINARY_HASH__`).
    - `window.__ATLAS_PREVIEW_LIVE_HASH__: string | undefined` —
      lowercase hex SHA-256 of the freshly-regenerated atlas for
      the currently-displayed seed.
    - `window.__ATLAS_PREVIEW_SEED__: string | undefined` — the
      atlas-seed string the live atlas was generated for.
  - **Phase 4 acceptance assertion (Playwright, Phase 4.B):**
    1. Load the live URL.
    2. Wait for `window.__ATLAS_PREVIEW__ === "ready"`.
    3. Assert `window.__ATLAS_PREVIEW_BUILD_HASH__ ===
       window.__ATLAS_PREVIEW_LIVE_HASH__` when seed is
       `ATLAS_SEED_DEFAULT` (proves the in-browser regen matches
       the build-time atlas byte-for-byte — cross-runtime
       determinism).
    4. Set the seed to `"variant-A"`, click regenerate, wait for
       `__ATLAS_PREVIEW_LIVE_HASH__` to change, assert the new
       value matches a hardcoded golden hex string (proves variant
       reproducibility).

  - **Live-deploy at all phases ≥ 4.** Per `docs/PHASES.md:208`,
    the preview page is **deployed live**. Phase 5 may keep the
    preview as a sub-section while introducing the playable game;
    Phase 9 may collapse it into a dev-only dropdown. For Phase 4,
    it is the diagnostic page's prominent feature.

- **Alternatives considered:**
  - **Stepped numeric seed slider** (e.g. `<input type="range">`).
    Rejected — atlas seeds are user-facing strings (`seedToBytes`
    accepts arbitrary strings); restricting to numeric seeds would
    confuse the URL-fingerprint UX in Phase 8. Free-form text
    matches the Phase 2 floor-preview seed input.
  - **Multi-atlas comparison (N seeds at once).** Defensible for
    Phase 9 tuning, but the side-by-side build-vs-live view is
    the load-bearing comparison. N-atlas comparison is a Phase 9
    polish addition.
  - **Server-side preview rendering** (e.g. SSR). Rejected — no
    backend in v1 (SPEC.md principle 6).
  - **Preview only in dev builds** (gated by `import.meta.env.DEV`).
    Rejected — `docs/PHASES.md:208` requires the preview live at
    all phases ≥ 4. The preview is the dev-mode tuning tool and
    must run in production builds, too.

- **Why this option:** the side-by-side build-vs-live view is the
  smallest UI satisfying the live-deploy acceptance criterion **and**
  proves cross-runtime determinism in one test. The preset seeds
  give Phase 9 polish a stable comparison set. The DOM ids and
  `window` flags follow the established cross-runtime Playwright
  pattern (Phase 2.A `__FLOOR_PREVIEW__`, Phase 3.A.2 `__SIM_*`).

- **If wrong:** the section is throw-away by design. Phase 5's
  playable-game UI replaces or repositions it; Phase 9 may
  collapse it.

- **Test that would catch a violation:** the Phase 4.B Playwright
  assertion above. A regression that breaks in-browser
  determinism (e.g. a new primitive that uses `Math.random`
  inadvertently) is caught when
  `__ATLAS_PREVIEW_LIVE_HASH__ !== __ATLAS_PREVIEW_BUILD_HASH__`
  on the placeholder seed.

### 10. Build script wiring: **`npm run gen-atlas` regenerates atlas via `tools/gen-atlas.ts`; CI gate fails if `git diff --exit-code assets/` is non-empty after run**

- **Chosen.**

  - **`tools/gen-atlas.ts`** — Node-runnable, ESM, deterministic
    atlas generator. Entry point: `npm run gen-atlas`. Implementation:
    ```ts
    // pseudocode
    const seed = ATLAS_SEED_DEFAULT;
    const rootSeed = seedToBytes(seed);
    const streams = streamsForRun(rootSeed);
    const palette = CYBERPUNK_NEON_V1;
    const tiles: { slot: AtlasSlotId; pixels: Uint8Array }[] = [];
    for (const entry of ATLAS_RECIPES) {
      const prng = streams.atlas(entry.id);
      const pixels = entry.recipe(prng, palette, {
        tileSize: TILE_SIZE,
        slotName: entry.slot,
        atlasSeed: seed,
      });
      tiles.push({ slot: entry.slot, pixels });
    }
    const atlasPng = packAtlas(tiles, palette);  // returns Uint8Array
    const manifest = serializeAtlasManifest({
      atlasBinaryHash: sha256Hex(atlasPng),
      atlasSeed: seed,
      generator: { primitiveSetVersion: 1, tileSize: 16, tilePadding: 1, tilesWide: 16, tilesHigh: 8 },
      palette: { id: palette.id, size: 16 },
      schemaVersion: 1,
      sprites: computeSpriteCoords(tiles),
    });
    fs.writeFileSync("assets/atlas.png", atlasPng);
    fs.writeFileSync("assets/atlas.json", manifest);
    ```

    Run as: `vite-node tools/gen-atlas.ts` (mirrors the Phase 2
    `gen-floor` and `gen-fixtures` patterns in `package.json`).

  - **`package.json` script entry:**
    ```json
    "gen-atlas": "vite-node tools/gen-atlas.ts"
    ```
    (To be added by Phase 4.A.2; this memo does not modify
    `package.json` — it specifies the change.)

  - **CI gate.** A new step in `.github/workflows/deploy.yml`,
    immediately after `npm run lint`:
    ```yaml
    - name: regenerate atlas + assert no drift
      run: |
        npm run gen-atlas
        if ! git diff --exit-code assets/; then
          echo "::error::assets/atlas.png or assets/atlas.json is stale — run 'npm run gen-atlas' and commit"
          exit 1
        fi
    ```
    This step runs on **every** OS in the matrix (decision 13), so
    a Windows-specific encoder drift surfaces here before reaching
    the cross-OS aggregator.

  - **`tools/gen-atlas.ts` ESLint scope.** Must comply with the
    existing `tools/**` scope (`eslint.config.js:182-207`):
    no `**/render/**`, no `**/input/**`, no `**/main`. Phase 4
    extends this scope's allowed imports to include `src/atlas/**`
    and `src/registries/atlas-recipes.ts`. The new `tools/**`
    allowed-imports list:
    - `src/core/**` — already allowed.
    - `src/mapgen/**` — already allowed (Phase 2).
    - `src/registries/**` — already allowed.
    - `src/sim/**` — newly allowed for `tools/gen-atlas.ts` if it
      ever needs to read `MONSTER_REGISTRY` for slot validation.
      Tightened to `tools/gen-atlas.ts` only via a one-file
      override if any other tool tries to import sim.
    - `src/atlas/**` — newly allowed (Phase 4).
    - Node built-ins (`node:fs`, `node:path`) — already allowed.
    - Forbidden: `src/render/**`, `src/input/**`, `src/main.ts`,
      browser-only paths.

- **Why this option:** `npm run gen-atlas` + `git diff` is the
  same pattern Phase 2 uses for `gen-fixtures` (the fixture-pack
  is committed, regeneration is reproducible, CI asserts no
  drift). The `tools/**` ESLint boundary is already established;
  extending it for `src/atlas/**` is one allow-list entry.

- **If wrong:** the script and the CI gate are independent
  files; either is revisable. The `tools/**` boundary is
  ESLint-enforced and tested by attempting a forbidden import in
  a fixture file.

- **Test that would catch a violation:** the CI gate itself.
  A unit test in `tests/tools/gen-atlas.test.ts` exercises the
  generator with a hardcoded seed and asserts the resulting
  PNG bytes' SHA-256 equals a hardcoded golden hex (the
  `ATLAS_DIGEST` of decision 12). A second test asserts the
  manifest output matches a hardcoded golden JSON.

### 11. Layer-import additions to `docs/ARCHITECTURE.md`: **`src/atlas/**` is a peer of `src/mapgen/**` and `src/sim/**`; deferred to Phase 4.A.1's drift-detection sweep**

- **Chosen.** The Phase 4 layer-table additions are:

  | Layer | Imports allowed | Imports forbidden |
  |---|---|---|
  | `src/atlas/` | `src/core/**`, `src/registries/atlas-recipes.ts`, `src/registries/items.ts` (read-only, for slot ID validation), `fdeflate` (the new pinned devDependency) | anything browser-specific (`window`, `document`, `crypto.subtle`), anything async, `src/sim/**`, `src/mapgen/**`, `src/render/**`, `src/input/**`, `src/main.ts`, `Math.random`, `Date.now()`, `performance.now()`, `new Date()`, floating-point arithmetic |
  | `src/registries/atlas-recipes.ts` | `src/atlas/primitives/**` (the recipes import primitives), `src/atlas/palette.ts`, `src/registries/items.ts` (read-only, for slot ID type-checking) | anything from `src/sim/**`, `src/mapgen/**`, `src/render/**`, `src/input/**` |

  **`src/render/**` cannot import `src/atlas/**`.** The renderer
  reads the atlas binary (`assets/atlas.png`) at runtime via a
  `fetch` (browser) or `fs.readFile` (Node, dev tools), and the
  manifest (`assets/atlas.json`) via a similar mechanism. The
  renderer parses the manifest with `parseAtlasJson` from
  `src/atlas/manifest.ts` (read-only utility); the parser is
  the only `src/atlas/**` symbol the renderer touches. The
  recipe code is **build-time only**.

  **Phase 4 ESLint additions (planned for Phase 4.A.2):**

  ```js
  {
    files: ["src/atlas/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sim/**", "**/mapgen/**", "**/render/**", "**/input/**", "**/main"],
              message: "atlas may not depend on sim/mapgen/render/input/main — atlas is a build-time-only layer.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...FORBIDDEN_TIME,
        ...SIM_UNORDERED,
      ],
    },
  },
  {
    files: ["src/atlas/**/*.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
    },
  },
  {
    // Render may parse the manifest but not import recipe code.
    files: ["src/render/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/atlas/recipes/**", "**/atlas/primitives/**", "**/atlas/png", "**/atlas/generate"],
              message: "render may import only the manifest parser from src/atlas/**; recipe and encoder code is build-time-only.",
            },
            { group: ["**/core/streams", "**/sim/combat"], /* existing */ },
          ],
        },
      ],
    },
  },
  ```

- **`docs/ARCHITECTURE.md` update is deferred to Phase 4.A.1's
  drift-detection sweep** (mirroring Phase 3.A.1's pattern for
  Phase 3 frozen contracts). The reasoning: locking the
  ARCHITECTURE.md table requires the actual atlas code to exist
  to verify the import boundaries hold. Updating ARCHITECTURE.md
  before code lands risks inconsistency (the doc would describe
  a layer that doesn't yet exist). Phase 3.A.1 hit exactly this
  pattern. Phase 4.A.1's drift-detection sweep updates ARCHITECTURE.md
  with the new layer table entries, the new lint scope additions,
  and the deferred rule reminders, in the same commit as the
  carry-forward work.

- **Why this option:** `src/atlas/**` is a build-time-only layer, so
  it sits as a peer of `src/sim/**` and `src/mapgen/**` rather than
  layered above them. The recipe registry pattern matches
  `src/registries/monsters.ts` (Phase 3) — data-only, importable by
  multiple consumers. Deferring the ARCHITECTURE.md update to 4.A.1
  matches the Phase 3 precedent.

- **If wrong:** the import boundaries are ESLint-enforced and
  tested by attempting a forbidden import in a fixture file. Any
  loosening requires this memo's amendment.

- **Test that would catch a violation:**
  `eslint-rules/__tests__/atlas-imports.test.ts` (extending the
  existing fixture-test pattern) tries to import `src/sim/run.ts`
  from a fixture file under `src/atlas/`, asserts ESLint reports
  the no-restricted-imports error.

### 12. Test surfaces: **primitive unit tests; per-recipe golden hashes; full atlas `ATLAS_DIGEST`; cross-OS byte-equality matrix; `parseAtlasJson` cross-runtime self-test**

- **Chosen.**

  - **Primitive unit tests** (`tests/atlas/primitives/*.test.ts`).
    Each of the ten primitives has a focused unit test asserting
    deterministic output for a fixed seed. For example:
    `tests/atlas/primitives/value-noise.test.ts` asserts
    `valueNoise2D(prng, 5, 7)` returns a hardcoded byte after a
    pinned PRNG state initialization.
  - **Per-recipe golden hashes** (`tests/atlas/recipes/*.test.ts`).
    Each of the seven Phase 4 recipes has a unit test that runs
    the recipe with a hardcoded `(seed, palette, ctx)` and
    asserts the SHA-256 of the resulting `Uint8Array` matches a
    hardcoded golden hex string. This is the per-recipe analogue
    of `RANDOM_WALK_DIGEST` / `MAPGEN_DIGEST` / `SIM_DIGEST`.
  - **Full atlas `ATLAS_DIGEST` golden** (`src/core/self-test.ts`).
    A new constant joining `RANDOM_WALK_DIGEST`, `MAPGEN_DIGEST`,
    `SIM_DIGEST`:
    ```ts
    /**
     * Hardcoded golden digest of assets/atlas.png generated under
     * ATLAS_SEED_DEFAULT. Changing this constant is a
     * `rulesetVersion` bump and requires architecture-red-team
     * review.
     */
    export const ATLAS_DIGEST =
      "<computed during Phase 4.A.2; pinned at point of first green CI run>";
    ```
    A new self-test `atlas-cross-runtime-digest` runs in every
    runtime (Node, Chromium, Firefox, WebKit). In Node, it
    regenerates the atlas in-process and asserts the SHA-256
    matches `ATLAS_DIGEST`. In browsers, it fetches
    `assets/atlas.png` and asserts the SHA-256 matches
    `ATLAS_DIGEST`.
  - **Cross-OS byte-equality matrix** (Phase 4.B). The
    `.github/workflows/deploy.yml` build job is duplicated to a
    new `cross-os-atlas-equality` job that runs on
    `ubuntu-latest`, `macos-latest`, and `windows-latest`. Each
    job runs `npm ci && npm run gen-atlas`, uploads
    `assets/atlas.png` as an artifact named
    `atlas-png-<os>`. A final `aggregate` job downloads all three
    artifacts, computes SHA-256 of each, and asserts pairwise
    equality. Mismatch fails the workflow with the per-OS hashes
    in the error message. Run on every push to `main` and on
    pull requests.
  - **`parseAtlasJson` cross-runtime self-test**
    (`src/core/self-test.ts`). New self-test
    `atlas-manifest-parse` allocates fresh data, serializes a
    hardcoded `AtlasManifest`, parses it back, asserts byte
    round-trip equality. Runs in every runtime; mirrors the
    `parseFloor` self-test pattern from Phase 2.
  - **`atlas-stream-isolation` self-test**. Allocates a fresh
    `streamsForRun(seedToBytes(ATLAS_SEED_DEFAULT))`, calls
    `streams.atlas("atlas-recipe.cyberpunk.tile.floor")`, asserts
    `[...streams.__consumed]` includes
    `"atlas:atlas-recipe.cyberpunk.tile.floor"` and contains no
    `"sim:*"`, `"mapgen:*"`, or `"ui"` entries.

  **Coverage targets** (added to `vitest.config.ts` thresholds):
  ```
  "src/atlas/**": {
    lines: 95, statements: 95, functions: 100, branches: 85,
  },
  ```
  The 95 (not 100) lines/statements threshold matches the
  Phase 3 sim coverage pattern (`vitest.config.ts:60-65`):
  defensive paths (rejection-sample re-draws in `uniformIndex`,
  the boundary-pixel masks in `circleMask` / `lineMask`) are
  load-bearing-but-rare. The full atlas digest plus per-recipe
  goldens are the operative correctness assertions.

- **Why this option:** mirrors the Phase 1+2+3 self-test pattern
  exactly. Each layer (core, mapgen, sim, atlas) gets a
  cross-runtime golden digest. Each registry (rooms, encounters,
  monsters, items, atlas-recipes) gets a stable-ID and
  shape-validation test. The cross-OS matrix is the load-bearing
  byte-equality assertion that single-OS sandbox CI cannot
  provide.

- **If wrong:** `ATLAS_DIGEST` is one constant; bumping it is a
  `rulesetVersion` bump. Per-recipe goldens are independent;
  bumping one requires only that recipe's regen.

- **Test that would catch a violation:** the tests *are* the
  catch-violation surface. The cross-OS aggregator asserts
  pairwise byte equality; the `atlas-cross-runtime-digest`
  self-test asserts cross-browser byte equality; the
  per-primitive and per-recipe unit tests catch local regressions.

### 13. Phase split: **4.0 (planning), 4.A.1 (drift-detection sweep), 4.A.2 (sandbox-verifiable implementation), 4.B (live-deploy + cross-OS PNG byte-equality matrix)**

- **Chosen.** Phase 4 ships in four commits, mirroring the Phase 3
  split:

  - **Phase 4.0 — planning gate.** This memo plus the
    `architecture-red-team` review at
    `artifacts/red-team-phase-4.md` plus an addendum (if the
    review identifies blocking issues) that supersedes the
    original prose where revision is required. Phase 4.0 introduces
    no acceptance criteria of its own beyond planning-gate
    compliance.
  - **Phase 4.A.1 — drift-detection sweep.** Pre-implementation
    cleanups that block clean Phase 4.A.2 work:
    1. **Phase 3.A.2 carry-forwards.** Inspect
       `artifacts/phase-approval.json` for any open follow-ups from
       Phase 3.A.2 code review (`code-review-phase-3-A-2.md`); land
       any blocking carry-forwards in this commit. If none are
       blocking, this is a no-op step.
    2. **`uniformIndex` relocation.** Move the
       rejection-sampling helper from `src/sim/run.ts` (Phase 3
       decision 6a / addendum N6) to `src/core/prng.ts`, alongside
       the `sfc32` PRNG type. Update `src/sim/run.ts` to import
       from `src/core/prng`. This makes the helper available to
       `src/atlas/**` without forcing a cross-layer import. Add
       focused unit tests covering the rejection-sample loop's
       termination (no infinite loop on small `n`), the unbiased
       distribution claim (chi-squared test on a 10000-draw
       sample with `n=7` should pass at p > 0.99), and the
       boundary at `n = 1` (always returns 0).
    3. **`docs/ARCHITECTURE.md` update.** Add the
       `src/atlas/**` layer to the layer table; add the
       `src/registries/atlas-recipes.ts` entry; add the
       `src/render/**` parser-only carve-out; add the new
       `streams.atlas(recipeId)` accessor; add the new lint scope
       additions (`src/atlas/**` no-float-arithmetic,
       no-restricted-imports). Reference Phase 4 frozen contracts
       (decision-list summary + cite this memo). Add the
       `ATLAS_DIGEST` peer to the self-test golden-constant list.
       Add the deferred contracts (cross-OS byte equality is the
       Phase 4.B operative assertion; the build-time placeholder
       seed is bump-allowed pre-Phase-9).
    4. **`fdeflate` dependency added** to `package.json`
       devDependencies, exact-pinned. Bundle-budget guard verified
       still green (`fdeflate` is dev-only; no runtime bundle
       impact).
    5. **Phase 1 placeholder retirement plumbing** in
       `vite.config.ts` and `vitest.config.ts`: replace the
       hardcoded `PLACEHOLDER_RULESET` constant with the
       `__RULESET_VERSION__` derivation function described in
       decision 7. The function is a no-op stub in 4.A.1 (returns
       a placeholder string different from
       `phase1-placeholder-do-not-share` so the test suite picks
       up the change); the real `sha256(rulesText ‖
       atlasBinaryHash)` derivation lands in 4.A.2 once the atlas
       file exists. Phase 4.A.1's runtime fingerprints emit a new
       `4.A.1-pre-atlas-` sentinel prefix so Phase 4.A.2 can
       distinguish the two.

       (This sentinel is a one-commit transient; Phase 4.A.2
       removes it. It must not be present on master.)
  - **Phase 4.A.2 — sandbox-verifiable atlas implementation.**
    All net-new atlas code, in any reviewer-preferred order:
    - `src/atlas/primitives/*.ts` — ten primitives (decision 1).
    - `src/atlas/palette.ts` — cyberpunk-neon-v1 palette (decision 5).
    - `src/atlas/png.ts`, `src/atlas/png-crc.ts` — encoder
      (decision 4).
    - `src/atlas/recipes/*.ts` — seven recipes (decision 2a).
    - `src/atlas/manifest.ts` — `serializeAtlasManifest` +
      `parseAtlasJson` (decision 6).
    - `src/atlas/manifest-loader.ts` — runtime loader with
      `DEV-` refusal + hash check (decision 7).
    - `src/atlas/generate.ts` — orchestration (used by
      `tools/gen-atlas.ts` and the dev preview).
    - `src/atlas/params.ts` — pinned constants
      (`TILE_SIZE`, `TILE_PADDING`, `ATLAS_TILES_WIDE`,
      `ATLAS_TILES_HIGH`, `ATLAS_SEED_DEFAULT`).
    - `src/registries/atlas-recipes.ts` — recipe registry
      (decision 2a).
    - `tools/gen-atlas.ts` — generator entry point (decision 10).
    - `assets/atlas.png`, `assets/atlas.json` — committed
      (decision 10).
    - `vite.config.ts` updated per decision 7 (real ruleset
      derivation; `__ATLAS_BINARY_HASH__` injection).
    - `vitest.config.ts` updated per decision 7 (test ruleset
      stub; `__ATLAS_BINARY_HASH__` defaults).
    - `package.json` `gen-atlas` script (decision 10).
    - `eslint.config.js` `src/atlas/**` scope additions
      (decision 11).
    - `src/main.ts` extended with the atlas-preview section
      (decision 9).
    - `src/core/self-test.ts` extended with `ATLAS_DIGEST`,
      `atlas-cross-runtime-digest`, `atlas-manifest-parse`,
      `atlas-stream-isolation` (decision 12).
    - `tests/atlas/**` — primitive, recipe, layout, manifest,
      png, palette tests (decision 12).
    - `tests/tools/gen-atlas.test.ts` — generator entry-point
      test (decision 10).
    - `.github/workflows/deploy.yml` extended with the
      `regenerate-atlas-assert-no-drift` step (decision 10).
    - `npm ci && npm run lint && npm run test && npm run build &&
      npm run test:e2e` all green inside the sandbox.
  - **Phase 4.B — live-deploy + cross-OS PNG byte-equality matrix.**
    Push 4.A.2 to master, observe the deploy workflow run green,
    observe the live URL serves the new diagnostic page with the
    atlas-preview section rendering, observe the cross-runtime
    Playwright job (extended with the `__ATLAS_PREVIEW_BUILD_HASH__
    === __ATLAS_PREVIEW_LIVE_HASH__` assertion on
    `ATLAS_SEED_DEFAULT`) runs green on chromium / firefox /
    webkit. **Plus** the new `cross-os-atlas-equality` job
    (decision 12) runs green on ubuntu-latest, macos-latest,
    windows-latest. The aggregator step asserts SHA-256 equality
    of `assets/atlas.png` across all three OS runners. No new
    code expected.

- **Why this option:** the four-step split mirrors Phase 3 exactly
  (`3.0 → 3.A.1 → 3.A.2 → 3.B`). The 4.A.1 sweep handles the
  carry-forward + relocation work that would otherwise drift the
  4.A.2 review. Cross-OS PNG byte equality is the load-bearing
  Phase 4 assertion that requires real GitHub Actions runners on
  three OSes — exactly the kind of "cannot observe in sandbox"
  signal the Phase 1.B/2.B/3.B step exists for.

- **`docs/PHASES.md:191-222` callout block.** Phase 4 needs a
  callout block mirroring the Phase 3 block at lines 131-148. The
  callout block (to be added by this memo to `docs/PHASES.md`):

  ```markdown
  > **Phase 4 split.** Per `artifacts/decision-memo-phase-4.md`
  > decision 13 and the attached `architecture-red-team` review
  > (see `artifacts/red-team-phase-4.md`), Phase 4 is split into
  > **Phase 4.0** (planning gate — decision memo + red-team review
  > + addendum if blockers identified), **Phase 4.A.1**
  > (drift-detection sweep — Phase 3.A.2 code-review carry-forwards
  > + `uniformIndex` relocation to `src/core/prng.ts` + `fdeflate`
  > devDependency + ARCHITECTURE.md update referencing Phase 4
  > frozen contracts + Phase 1 placeholder retirement plumbing),
  > **Phase 4.A.2** (sandbox-verifiable atlas implementation:
  > primitives, recipes, registry, encoder, manifest, generator,
  > preview UI, ATLAS_DIGEST self-test, build wiring), and
  > **Phase 4.B** (live-deploy verification + cross-OS PNG
  > byte-equality matrix on the GitHub Actions ubuntu/macos/windows
  > runners). Phase 5 cannot begin until all four are approved.
  > Phase 4.0 introduces no new acceptance criteria of its own
  > beyond planning-gate compliance; Phase 4.A.1 is the
  > no-net-new-atlas drift sweep that this memo requires before
  > atlas implementation begins; Phase 4.A.2 implements the atlas
  > pipeline per the decision memo's frozen contracts; Phase 4.B
  > re-verifies the diagnostic-page atlas-preview section on the
  > live deployed URL and asserts cross-OS PNG byte equality.
  ```

  This memo updates `docs/PHASES.md` to insert the callout block
  immediately above line 192 ("**Goal.** Build the deterministic
  art pipeline.") and to partition the existing Phase 4
  acceptance criteria across 4.A.2 and 4.B. The original Phase 4
  goal/lead-agent/reviewer text remains unchanged.

- **If wrong:** 4.B reveals a regression → that's a 4.B blocker
  fixed before approval. We do not approve 4.A.2 on the basis of
  "it'll probably work in CI" or "it'll probably work cross-OS."

### 14. Deferred work (out of Phase 4 scope)

The following are mentioned in `docs/SPEC.md` or `docs/PHASES.md`
as Phase-4-adjacent but are punted to later phases. Each carries
a constraint that Phase 4's deliverables must respect.

- **The full ~12–15 monster sprite recipes.** Phase 4 ships one
  monster recipe (`monster.ice.daemon`); Phase 7 fills in the
  rest. Constraint: the recipe ID format
  (`atlas-recipe.cyberpunk.monster.<name>`) and the
  `tilesWide`/`tilesHigh` cell-grid placement must remain
  additive (decision 3a invariant).

- **The full ~20 item sprite recipes.** Phase 4 ships one item
  (`item.cred-chip`); Phase 6 fills in the rest. Same constraint
  as above.

- **The remaining ~2 NPC recipes.** Phase 4 ships
  `npc.ripperdoc`; Phase 7 ships `npc.fixer` and
  `npc.info-broker`. Same constraint.

- **The boss recipe.** Phase 4 ships **no** boss recipe.
  `monster.boss.black-ice-v0` is in the Phase 3 monster registry
  but its atlas slot is **not** in Phase 4's `AtlasSlotId` union.
  Phase 7 adds the boss recipe; Phase 5's renderer must handle a
  missing-recipe slot gracefully (e.g. fall back to a magenta
  "missing" tile) — this is a Phase 5 concern, not a Phase 4
  one. Constraint: Phase 4's `parseAtlasJson` does not require
  the manifest to cover every `AtlasSlotId` — `sprites` is a
  partial mapping.

- **CRT / scanline post-processing shader.** Phase 9 polish, not
  Phase 4. The `scanlineResidue` primitive (decision 1) is the
  *recipe-time* CRT effect baked into the atlas; the runtime
  shader is a separate Phase 9 concern.

- **Theme-switching at runtime.** Deferred past v1 (SPEC.md
  "Out of v1"). The recipe ID format includes `<theme>` so a
  future `fantasy` theme is a different registry slice; no Phase
  4 work needed for this.

- **Atlas-recipe mods.** Deferred past v1 (SPEC.md "Out of v1").
  The recipe-registration contract (decision 2) is the future
  modding ABI; the registry is data-only, the primitive set is
  small and frozen, and the recipe signature is pure-function.
  No Phase 4 mod loader.

- **Floyd–Steinberg dither, Perlin noise, polygon fill, paint
  bucket.** Out of Phase 4 primitive set (decision 1). Each is
  individually justified above; if Phase 9 polish needs one, the
  primitive is added (additive registry growth) with byte-level
  pinning at point of introduction.

- **Animated sprites.** Phase 9 polish, if at all. The atlas
  format trivially supports animation by reserving multiple
  cells for animation frames; no Phase 4 plumbing required.

- **Sprite atlas LOD / mipmaps.** Out of v1. The renderer ships
  nearest-neighbor at 1× zoom; no LOD chain.

- **Audio atlas.** Mentioned in SPEC.md "Out of v1" — audio is
  canned for v1. No Phase 4 work.

- **Phase 2.A code-review nit N6 (door-placement coverage).**
  Remains deferred per Phase 3.A.1's decision; revisit in Phase
  7 (boss-arena door semantics). Not a Phase 4 concern.

## Frozen contracts established by this phase

These join the Phase 1 + Phase 2 + Phase 3 frozen contracts in
`docs/ARCHITECTURE.md`. Changing any of them is a
`rulesetVersion` bump and breaks every fingerprint shared before
the change.

1. **Recipe primitive set.** Ten functions: `paletteIndex`,
   `paletteSwap`, `paletteGradient`, `bayerThreshold`,
   `valueNoise2D`, `rectMask`, `circleMask`, `lineMask`,
   `columnShift`, `scanlineResidue`. Signatures pinned (decision 1).
   Adding a primitive is additive (registry-style); removing or
   renaming is a bump. `valueNoise2D`'s integer hash constants
   (`0x1f1f1f1f`, `0x9e3779b1`, `0x45d9f3b`, rotation `13`) are
   pinned (decision 1a). `paletteGradient`'s integer interpolation
   formula is pinned.
2. **Recipe signature.** `(prng: PRNG, palette: Palette, ctx:
   RecipeContext) => Uint8Array`. Recipe output is a flat
   palette-index buffer of length `tileSize * tileSize` in
   row-major addressing. Decision 2.
3. **Recipe ID format.**
   `^atlas-recipe\.(cyberpunk)\.(tile|monster|item|npc|ui|boss)\.[a-z][a-z0-9_-]{0,31}$`,
   total ≤ 64 UTF-8 bytes, 7-bit ASCII. Decision 2.
4. **`streams.atlas(recipeId)` accessor.** Added to `RunStreams`.
   `recipeId` must satisfy the recipe-ID format from item 3.
   Records `"atlas:" + recipeId` into `__consumed`. Salt encoding
   `(name="atlas", salts=[recipeId])`. Decision 1a.
5. **Atlas layout constants.** `TILE_SIZE = 16`, `TILE_PADDING = 1`,
   `ATLAS_TILES_WIDE = 16`, `ATLAS_TILES_HIGH = 8` (Phase 4
   provisional; Phase 6/7 may bump `ATLAS_TILES_HIGH` additively
   without moving existing sprites — decision 3a invariant).
   Decision 3.
6. **Atlas-grid placement function.** Registry-declaration order,
   row-major, multi-tile rectangles never split, no backfill, no
   compaction. Decision 3a.
7. **PNG encoder format.** Indexed PNG (color type 3), bit depth 8,
   `PLTE` + `tRNS` chunks present, **no ancillary chunks**
   (`gAMA`, `sRGB`, `cHRM`, `pHYs`, `tEXt`, `tIME` all absent),
   filter type 0 ("None") for every scanline, `fdeflate` level 1
   for the IDAT DEFLATE stream, chunk order
   `IHDR, PLTE, tRNS, IDAT, IEND`. Decision 4.
8. **Color palette.** 16 entries, indexed `[0..15]`. Entry 0 is
   transparent (`r=g=b=a=0`). Entries 1–15 are fully opaque
   (`a=255`). Palette ID `cyberpunk-neon-v1`. Per-entry RGB values
   are pinned in `src/atlas/palette.ts`. Decision 5.
9. **Atlas JSON manifest schema.** Top-level keys
   alphabetical-sorted (`atlasBinaryHash, atlasSeed, generator,
   palette, schemaVersion, sprites`); per-sprite keys
   alphabetical-sorted (`atlasX, atlasY, recipeId, tilesHigh,
   tilesWide`); `sprites` map keys alphabetical-sorted by
   `AtlasSlotId`; `schemaVersion = 1`; **strict-parse**
   (unknown / missing keys throw); coordinates are in tile-grid
   units, not pixels. Decision 6.
10. **`rulesetVersion` derivation.**
    `rulesetText` = byte-concatenation (with the literal
    `"\n----icefall-ruleset-file-boundary-v1----\n"` separator) of
    the 12 listed source files in the pinned order;
    `rulesetTextHash = sha256(rulesetText)`;
    `rulesetVersion = sha256(utf8(rulesetTextHash) ‖ utf8("|") ‖
    utf8(atlasBinaryHash))`, lowercase hex, 64 chars. Decision 7.
11. **Atlas-loader `DEV-` refusal and hash check.** Loader throws
    pinned messages when (a) the runtime `rulesetVersion ===
    PLACEHOLDER_RULESET_VERSION` and (b) the loaded
    `assets/atlas.png` SHA-256 mismatches the build-time
    `__ATLAS_BINARY_HASH__`. Decision 7.
12. **`ATLAS_DIGEST` golden constant.** SHA-256 of
    `assets/atlas.png` generated under `ATLAS_SEED_DEFAULT`.
    Pinned in `src/core/self-test.ts` next to `RANDOM_WALK_DIGEST`,
    `MAPGEN_DIGEST`, `SIM_DIGEST`. Decision 12.
13. **Atlas-loader hash check.** The runtime atlas loader, on
    fetching `assets/atlas.png`, computes its SHA-256 and asserts
    equality with `__ATLAS_BINARY_HASH__`. Mismatch throws the
    pinned error. Decision 7.

## Out of scope for Phase 4 (deferred)

See decision 14. Summary: full sprite content (boss, remaining
~14 monsters, ~19 items, ~2 NPCs); Floyd–Steinberg / Perlin /
polygon-fill / paint-bucket primitives; CRT shader; theme
switching; mod loader; animated sprites; LOD; audio.

## Phase 4 acceptance criteria — restated, with this memo's decisions

These restate `docs/PHASES.md:212-217` partitioned across the
new phase split (decision 13).

**Phase 4.0 (planning gate).** No new acceptance criteria beyond
planning-gate compliance.
- `artifacts/decision-memo-phase-4.md` exists and was reviewed by
  `architecture-red-team` before any Phase 4 implementation code
  is written.
- The red-team review at `artifacts/red-team-phase-4.md` exists;
  any blocking issues it raised are addressed via an in-memo
  addendum that supersedes the original prose.
- A follow-up `architecture-red-team` review of the addendum
  confirms blocker resolution (verdict APPROVE or APPROVE WITH
  NITS).

**Phase 4.A.1 (drift-detection sweep).**
- Phase 3.A.2 code-review carry-forwards (if any) landed.
- `uniformIndex` relocated from `src/sim/run.ts` to
  `src/core/prng.ts`; focused unit tests cover termination,
  unbiased distribution, and `n=1` boundary; 100% line/branch/function
  coverage on `src/core/prng.ts` preserved.
- `docs/ARCHITECTURE.md` updated to reference Phase 4 frozen
  contracts (items 1–13 above), the new `streams.atlas(recipeId)`
  accessor, the new `src/atlas/**` layer-table entry, the new
  ESLint scope additions, the deferred contracts (one-way
  Phase 9 atlas-seed freeze).
- `fdeflate` devDependency added to `package.json` (exact-pinned).
- Phase 1 placeholder ruleset retirement plumbing in
  `vite.config.ts` and `vitest.config.ts`.
- `npm ci && npm run lint && npm run test && npm run build` all
  green inside the sandbox, with no net-new `src/atlas/**` code.

**Phase 4.A.2 (sandbox-verifiable atlas implementation).**
- `npm run gen-atlas` produces a byte-identical PNG on the
  sandbox's host OS (cross-OS verification deferred to 4.B).
  **(decisions 4, 10)**
- `assets/atlas.json` schema validates and references only IDs
  registered in `atlas-recipes.ts`; the manifest's
  `atlasBinaryHash` matches the actual `assets/atlas.png` SHA-256.
  **(decisions 6, 12)**
- `rulesetVersion` is derived from `sha256(rulesText ‖
  atlasBinaryHash)` (no longer the Phase 1 placeholder); the
  atlas loader refuses any build whose
  `rulesetVersion === PLACEHOLDER_RULESET_VERSION`.
  **(decision 7)**
- The seven initial recipes render at the target tile size with no
  transparency or palette bleed bugs.
  **(decisions 1, 2a, 3, 5)**
- Atlas binary size budget: under 256 KB (Phase 4 actual: ~4–8 KB).
  **(decision 3)**
- `ATLAS_DIGEST` self-test passes in Node and in
  `vite preview`-served browsers; `atlas-stream-isolation` and
  `atlas-manifest-parse` self-tests pass.
  **(decision 12)**
- All Phase 4 frozen contracts (items 1–13 above) implemented and
  have at least one regression-failing test.
- Layer-import lint rules (decision 11) added to
  `eslint.config.js`; fixture tests confirm the no-restricted-imports
  surface.
- `npm ci && npm run lint && npm run test && npm run build &&
  npm run test:e2e` all green inside the sandbox.

**Phase 4.B (live-deploy + cross-OS verification).**
- The live GitHub Pages URL serves the updated diagnostic page
  with the in-browser atlas-preview section working.
- The Phase 4.B Playwright job exercises the atlas-preview section
  on chromium, firefox, webkit:
  - Asserts `window.__ATLAS_PREVIEW__ === "ready"` after first
    paint.
  - Asserts `window.__ATLAS_PREVIEW_BUILD_HASH__ ===
    window.__ATLAS_PREVIEW_LIVE_HASH__` on `ATLAS_SEED_DEFAULT`
    (proves cross-runtime in-browser determinism matches the
    build-time atlas).
  - Sets seed to `"variant-A"`, clicks regenerate, asserts the
    new `__ATLAS_PREVIEW_LIVE_HASH__` equals a hardcoded golden
    hex.
- The Phase 4.B `cross-os-atlas-equality` GitHub Actions job runs
  `npm run gen-atlas` on `ubuntu-latest`, `macos-latest`, and
  `windows-latest`; the aggregator step asserts pairwise SHA-256
  equality of the generated `assets/atlas.png`. Mismatch fails
  the workflow.
- The atlas preview page is live at the deployed URL
  (`docs/PHASES.md:217`).

## Risks (Phase 4 specific)

- **PNG encoder is the new hot frozen contract.** Any change to
  the encoder bytes — `fdeflate` version, level, filter choice,
  chunk order, palette layout — invalidates every atlas hash and
  therefore every fingerprint shared after Phase 4 ships.
  Mitigated by: pinning `fdeflate` exact version, pinning level 1,
  pinning filter 0 globally, hardcoding chunk order, the
  `ATLAS_DIGEST` self-test in every runtime, the cross-OS
  byte-equality matrix in 4.B, and the `architecture-red-team`
  review trigger on any `src/atlas/png.ts` change.
- **Cross-OS DEFLATE drift.** The largest historical risk for
  cross-platform PNG is system-zlib version differences. Mitigated
  by using pure-JS `fdeflate` (no native code path) and by the
  4.B cross-OS matrix asserting byte equality.
- **Windows line-ending drift in `rulesText`.** If a contributor
  on Windows commits sim files with CRLF endings, `rulesetText`'s
  pre-image differs from the LF version computed on Linux/macOS
  CI. Mitigated by `.gitattributes` rule (`* text=auto eol=lf`)
  and a CI step that verifies sim/registry files have LF endings
  before computing `rulesetText`. The CI step throws
  `rulesText: file <path> has CRLF; convert to LF and recommit`.
- **Recipe API shape locked once mods care about it.** Addressed
  by the planning gate (this memo) and the small primitive
  surface (decision 1).
- **Programmer-art recipes will look bad in Phase 4.** SPEC.md
  acknowledges this. Phase 9 polish will tune the recipes; Phase
  4–8 ships "ugly but reproducible" output.
- **Atlas-grid placement function shifts coordinates when a
  multi-tile sprite is added.** The `(atlasX, atlasY)` of an
  earlier sprite *can* shift if a new entry inserted *before* it
  bumps the cursor row. Mitigated by frozen-contract item 6's
  invariant: **inserting at the end never moves earlier
  sprites**; only mid-registry insertions can shift coordinates,
  and mid-registry insertion is a process taboo (the registry is
  append-only by convention; Phase 6 enforcement test deferred,
  same as Phase 2 / Phase 3).
- **`atlasBinaryHash` computed at Vite-config-load time has a
  build-vs-runtime ordering trap.** If a developer manually edits
  `assets/atlas.png` between `vite build` and `vite preview`, the
  injected `__ATLAS_BINARY_HASH__` would not match the served file.
  Mitigated by the runtime hash check in
  `src/atlas/manifest-loader.ts` (decision 7) — the loader
  hashes the actual served bytes and compares to the build-time
  injection.
- **`vite-node tools/gen-atlas.ts` import-graph hazard.**
  `vite-node` resolves bare module imports through Vite's resolver,
  which can differ from Node's. Mitigated by writing
  `tools/gen-atlas.ts` to use only relative imports for `src/**`
  paths and bare imports for the small set of pinned dependencies
  (`@noble/hashes`, `fdeflate`, Node built-ins).
- **`uniformIndex` relocation (Phase 4.A.1) creates a test-coverage
  re-attribution.** Same risk class as Phase 3.A.1's
  `decodeBase64Url` relocation (Phase 3 addendum B6). Mitigated by:
  the focused unit-test suite added in Phase 4.A.1 covers all
  branches under `src/core/prng.ts`'s 100% coverage gate; existing
  `src/sim/**` tests continue to exercise the function via
  `src/sim/run.ts`'s import; coverage report confirms no
  attribution drift.
- **`fdeflate` upstream patch could change byte output.** Mitigated
  by exact-pinning the version in `package.json` (no caret, no
  tilde — just the version number). Future upgrades require
  `architecture-red-team` review and a fresh cross-OS byte-equality
  CI run; if bytes change, `ATLAS_DIGEST` bumps and so does
  `rulesetVersion`.
- **DEV- prefix refusal could brick local dev.** Mitigated by the
  loader's pinned error message pointing at `npm run build` (which
  injects the real ruleset). The dev server (`vite dev`) bypasses
  the loader by serving the dev mode directly without atlas
  loading on the diagnostic page; the preview UI consumes the
  build-time atlas the same way the renderer will.

## Open questions deferred from this memo

- **Whether `streams.ui()` (Phase 1 frozen, no consumer) ever gets a
  Phase 4 caller.** The atlas preview UI's seed input is a UI
  concern, but its randomness (preset seed selection) is
  hardcoded, not PRNG-driven; `streams.ui()` remains reserved-but-
  unused. Same question Phase 3 deferred for `streams.sim()`
  (no-arg).
- **Whether Phase 5's renderer's `atlas-loader` should fall back
  to a magenta "missing tile" sprite for slots without a
  registered recipe.** Phase 4 pre-commits to allowing a partial
  manifest; the fallback semantics are a Phase 5 concern.
- **Whether the atlas-preview UI should expose a per-recipe
  hash readout** (in addition to the whole-atlas hash). Useful
  for recipe-author debugging but clutters the page; deferred to
  Phase 9.
- **Whether `atlasBinaryHash` should be SHA-256 truncated** (e.g.
  to 16 chars) for shorter `rulesetVersion` strings. Deferred —
  64 chars is the current Phase 1+2+3 hex convention; truncation
  is a separate decision memo if Phase 8's URL budget calls for
  it.
- **Whether a mid-Phase-4 recipe-author preview (sub-cell
  selection in the atlas grid)** should ship in 4.A.2 or wait
  for Phase 9 polish. Deferred — Phase 4 ships the whole-atlas
  comparison view; Phase 9 can add per-sprite drill-down.

## Phase 3.A.2 code-review nits revisited

For audit clarity, the disposition of any open Phase 3.A.2
code-review nits at the start of Phase 4 is recorded here. Phase
4.0's planner inspects `artifacts/code-review-phase-3-A-2.md` and
the latest `phase-approval.json` for open follow-ups; any
blocking carry-forwards are scheduled for Phase 4.A.1 (decision
13). Phase 3.A.2 deferred items (e.g. Phase 2.A nit N6 door-coverage)
remain deferred per their original schedule.

---

## Pre-emptive notes for the architecture-red-team review

The following are the points the Phase 2 + Phase 3 red-team
reviews focused on; Phase 4's memo addresses each pre-emptively.

1. **Empty / overlong / non-ASCII validation on every new
   user-facing string.** `recipeId` (decision 2: format regex,
   ≤ 64 UTF-8 bytes, 7-bit ASCII), `atlasSeed` (decision 8:
   passes through `seedToBytes` validated by Phase 2), palette
   color names (decision 5: pinned in `src/atlas/palette.ts`).
2. **UTF-8 byte length vs UTF-16 code-unit length.** `recipeId`
   length is **UTF-8 byte length** (`utf8(recipeId).length`),
   matching Phase 3 addendum B1's discipline.
3. **Domain-anchor reuse.** `streams.atlas(recipeId)` reuses Phase
   1's `streamSeed(rootSeed, "atlas", recipeId)` exactly — same
   `STREAM_DOMAIN = "icefall:v1:"` constant, same `encodeSalt`
   string encoding, same length-prefix rules. No new pre-image
   format introduced.
4. **Endianness and bit-extraction recipe.** `valueNoise2D`'s
   integer-hash output is a 32-bit unsigned (consumed via `& 0xff`
   to truncate to 8 bits — a low-bit mask, never a high-bit
   shift, matching Phase 3 addendum B2).
5. **Float arithmetic.** Every primitive is integer-only;
   `Math.imul` is permitted (it's a built-in 32-bit signed
   multiply, not a float op). `paletteGradient` uses
   integer-division Bresenham-style remainder distribution, not
   floating-point linear interpolation.
6. **Cross-OS byte equality.** Decision 4 + decision 13 + risk
   "Cross-OS DEFLATE drift" address this with `fdeflate` (no
   native code), filter 0 (no per-encoder filter heuristics),
   level 1 (least Huffman freedom), and the explicit cross-OS
   matrix in 4.B.
7. **Build-step ordering.** Decision 7 spells the strict order:
   atlas hash → rules hash → ruleset version → Vite injection.
   No circular dependency.
8. **Per-tick / per-floor / per-recipe `__consumed` invariants.**
   Decision 1a + decision 12 add `atlas-stream-isolation` self-test
   asserting `streams.atlas(recipeId)` records the expected key
   and no others.
9. **Stream non-collision.** `streams.atlas(recipeId)` and
   `streams.sim()` and `streams.simFloor(N)` and `streams.mapgen(N)`
   and `streams.ui()` produce distinct PRNG states by construction
   (different `(name, salts)` tuples → different `streamSeed`
   pre-image lengths and tail bytes → different SHA-256 outputs).
   Same non-collision proof Phase 3 addendum B4 exhibited.
10. **Lint scope plumbing.** Decision 11 spells the
    `eslint.config.js` additions: `src/atlas/**` scope with
    `no-float-arithmetic`, `FORBIDDEN_TIME`, `SIM_UNORDERED`,
    no-restricted-imports for `sim/mapgen/render/input/main`;
    `src/render/**` scope tightened to forbid recipe/encoder
    imports while permitting `src/atlas/manifest.ts`.
11. **Test-coverage and lint-scope drift on `uniformIndex`
    relocation.** Decision 13 requires focused unit tests under
    `src/core/prng.ts`'s 100% coverage gate, mirroring Phase
    3.A.1's `decodeBase64Url` discipline.
12. **Trailing-after-terminal canonicalization.** Not a Phase 4
    concern — Phase 4 has no action log. Phase 8 owns the
    verifier-side decision.
13. **`@typescript-eslint/no-unused-vars`.** Each new file in
    `src/atlas/**` is exported via `src/atlas/index.ts` and
    consumed by at least one of:
    `tools/gen-atlas.ts`, `src/atlas/generate.ts`,
    `tests/atlas/**`, or `src/main.ts` (preview UI).

If the red-team review identifies issues not pre-empted above,
they will be addressed in an addendum below this section,
following the Phase 3 memo's pattern (the addendum overrides
the original prose; the original prose is left intact for audit).

---

## Addendum (post-red-team review): resolutions for B1–B8 and disposition of N1–N17

> The architecture-red-team review at `artifacts/red-team-phase-4.md`
> raised **8 blocking issues (B1–B8)** and **17 non-blocking nits
> (N1–N17)**. This addendum supersedes the original prose where they
> conflict. The numbered decisions above remain canonical; this
> addendum pins the additional details and fixes the contracts the
> red-team flagged. Once the addendum lands, a follow-up
> architecture-red-team review confirms blocker resolution and Phase
> 4.0 approval is unblocked.
>
> The addendum is structured to mirror Phase 3's: each blocker has a
> focused resolution under a numbered heading naming the byte-level
> fix, the test that would catch a regression, and any decisions
> amended above; each nit has a single-row disposition.

### B1: Phase split is internally contradictory — placeholder retirement folded into Phase 4.A.2

**Resolution.** Adopt the red-team's **option (a)**: keep the Phase 1
placeholder ruleset retirement *out* of Phase 4.A.1. The
`__RULESET_VERSION__` derivation function is **defined** in 4.A.1
(as an exported helper in `src/build-info.ts` plus the
`__ATLAS_BINARY_HASH__` Vite-config plumbing) but **not called** at
the `define`-block injection site. 4.A.1's `vite.config.ts` and
`vitest.config.ts` continue to inject the Phase 1 placeholder
constant `PLACEHOLDER_RULESET_VERSION` exactly as today; nothing on
master between 4.A.1 and 4.A.2 ships with a new sentinel. The
loader's existing `=== PLACEHOLDER_RULESET_VERSION` refusal continues
to cover the in-between state for free.

4.A.2 lands `assets/atlas.png`, the `atlasBinaryHash` Vite-plugin
(see B5), the call-site flip from `PLACEHOLDER_RULESET_VERSION` to
the derived `sha256(rulesetTextHash ‖ "|" ‖ atlasBinaryHash)`, and
the loader's `DEV-` refusal — **all in the same commit**. There is
no `4.A.1-pre-atlas-` sentinel; the prose in decision 13 step 5
that introduced one is **deleted**. The "4.A.1-pre-atlas-" string
must not appear in any Phase 4 commit.

**Why option (a) over option (b).** Option (b) (load a `DEV-` refusal
in 4.A.1 that activates when 4.A.2 lands) would require 4.A.1 to
ship code with no callable trigger — exactly the "unenforced rule"
defect class the red-team flagged in Phase 3 B5. Option (a) keeps
4.A.1 a no-net-new-atlas drift sweep (matching Phase 3.A.1's
"no net-new sim code" discipline) and leaves the chicken-and-egg
problem unaddressed-by-design rather than papered-over.

**`docs/PHASES.md` callout block updated below** to reflect the
revised 4.A.1 scope (uniformIndex relocation, `fdeflate` add,
`.gitattributes` add per B3, ARCHITECTURE.md update, **derivation
helper defined-but-unused**) and 4.A.2 scope (placeholder retirement
+ atlas binary + ruleset derivation flip, all together).

**Test that would catch a regression.** A new test
`tests/build/no-transient-sentinel.test.ts` greps the built `dist/`
bundle for the string `"4.A.1-pre-atlas-"` and fails if found. A
second test asserts that on master, exactly one of two states holds:
(a) `__RULESET_VERSION__` decodes to `PLACEHOLDER_RULESET_VERSION`
(pre-4.A.2 commit), or (b) `__RULESET_VERSION__` is a 64-char
lowercase-hex string. No third "transient sentinel" form is allowed.

**Decisions amended above:** Decision 13 step 5 — the
"4.A.1-pre-atlas-" sentinel paragraph is **deleted**. 4.A.1's step 5
becomes: "Define (do not call) the `deriveRulesetVersion(rulesText,
atlasBinaryHash): string` helper in `src/build-info.ts`; add the
`__ATLAS_BINARY_HASH__` Vite-plugin scaffolding from B5 with
deterministic-zero fallback; add `.gitattributes` per B3.
`vite.config.ts` and `vitest.config.ts` continue to inject
`PLACEHOLDER_RULESET_VERSION` for `__RULESET_VERSION__`."
4.A.2's deliverable list (decision 13) gains the explicit step
"flip the `vite.config.ts` and `vitest.config.ts` `define`-block
call sites from `PLACEHOLDER_RULESET_VERSION` to
`deriveRulesetVersion(rulesText, atlasBinaryHash)`, in the same
commit that lands `assets/atlas.png`."

### B2: `rulesText` file-list now part of the hash; canonical sort + LF + BOM strip pinned

**Resolution.** The `rulesetTextHash` pre-image is replaced. The
original concatenation-with-separator scheme is **superseded**;
instead the hash is over a per-file (path, content-hash) tuple list,
sorted alphabetically by path:

```
RULES_FILES = [                                      // 12 paths, alphabetical:
  "src/atlas/palette.ts",
  "src/atlas/params.ts",
  "src/registries/atlas-recipes.ts",
  "src/registries/encounters.ts",
  "src/registries/items.ts",
  "src/registries/monsters.ts",
  "src/registries/rooms.ts",
  "src/sim/ai.ts",
  "src/sim/combat.ts",
  "src/sim/params.ts",
  "src/sim/run.ts",
  "src/sim/turn.ts",
]                                                    // sorted alphabetically;
                                                     // sort is part of the contract

normalizeForHash(content: string): Uint8Array =
  utf8(
    stripBom(content).replace(/\r\n/g, "\n")
  )
  // stripBom: drop a leading U+FEFF (﻿, encoded as
  //           0xEF 0xBB 0xBF in UTF-8) if present.
  // CRLF→LF: applied unconditionally (defense-in-depth on top of the
  //          .gitattributes rule from B3).

rulesetTextHash = sha256(
  for each (path, content) in RULES_FILES.sort_by_path_alphabetical():
    utf8(path) ‖ 0x00 ‖ sha256(normalizeForHash(content)) ‖ 0x00
)
```

The pre-image is the alphabetically-sorted concatenation of
`(utf8_path, NUL, sha256_of_normalized_content, NUL)` tuples. Each
tuple is `len(utf8(path)) + 1 + 32 + 1` bytes. The `0x00` separators
are pinned (NUL is unambiguous because `utf8(path)` cannot contain
`0x00` — POSIX paths reject it, and the 12 paths are all ASCII).

**Properties this gives that the original concatenation scheme did not:**

1. **Renaming a file is a `rulesetTextHash` change** because the path
   bytes feed the pre-image directly. The red-team's
   "rename `turn.ts` → `turn-loop.ts`" attack is closed.
2. **Splitting a file is a `rulesetTextHash` change** because the new
   file's `(path, hash)` tuple appears in the pre-image; the
   concatenation-equivalence trap is closed.
3. **Reordering the source list does not change the hash** (the sort
   is canonical alphabetical), removing the
   "well-meaning-reorder-silently-bumps" foot-gun. The order is a
   *property of the pre-image*, not a property of the source array.
4. **CRLF normalization is applied at hash time**, not just at
   commit time, so a Windows clone whose .gitattributes was
   missed still computes the same hash (defense-in-depth above
   the .gitattributes rule).
5. **BOM stripping** removes the VSCode-Windows-edits-with-BOM trap.
   The U+FEFF character is invisible in most editors and would
   silently drift the hash without this rule.

**Adding/removing/renaming a file is a `rulesetVersion` bump** —
this is now true *by construction* of the pre-image, not just by
convention. Phase 6/7's planning gates will append entries to
`RULES_FILES` (the array literal); the addition is itself the bump.

**Test that would catch a regression.**
`tests/atlas/build-info.test.ts` adds three assertions:

1. `RULES_FILES` array equals a hardcoded golden array literal (12
   entries, alphabetical). Reordering or renaming trips this test
   before it ships.
2. `RULES_FILES.every(p => p === p.toLowerCase())` and `every(p =>
   /^[a-z][a-z0-9/_.-]*\.ts$/.test(p))` — the canonical form is
   lowercase ASCII paths.
3. A round-trip: compute `rulesetTextHash` from `RULES_FILES`, mutate
   one byte of one file content, recompute, assert different. Mutate
   one path string (rename), recompute, assert different. Both
   cases bump.

**Decisions amended above:** Decision 7's `rulesText` definition is
**superseded**. The original 44-byte separator
(`"\n----icefall-ruleset-file-boundary-v1----\n"`) is **removed**;
it is replaced by the per-file `(path, sha256(content))` tuple
encoding above. Decision 7's "If wrong" paragraph and frozen-contract
item 10 are amended: the sort is the contract; reordering the array
literal is a *test failure*, not a `rulesetVersion` bump.

### B3: `.gitattributes` content pinned as a Phase 4.A.1 deliverable

**Resolution.** A new file `.gitattributes` is created at the repo
root in Phase 4.A.1. Its byte-exact content is pinned here:

```
# Phase 4 cross-OS byte-equality discipline. See
# artifacts/decision-memo-phase-4.md addendum B3.
* text=auto eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.mjs text eol=lf
*.cjs text eol=lf
*.json text eol=lf
*.md text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.html text eol=lf
*.css text eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.ico binary
assets/atlas.png binary
assets/atlas.json text eol=lf
```

This addendum **does not** write `.gitattributes` itself — the file
is a code change, not a planning artifact. It is created in the
4.A.1 commit alongside `uniformIndex` relocation. The byte-exact
content above is the contract; the 4.A.1 implementer may not deviate.

**Companion CI guard.** A new test
`tests/build/rules-text.test.ts` (added in 4.A.1) iterates each path
in `RULES_FILES` (B2) and asserts the on-disk bytes:

1. Do not contain `0x0D` (no CR — fails with
   `rulesText: file <path> has CRLF; convert to LF and recommit`).
2. Do not start with `0xEF 0xBB 0xBF` (no UTF-8 BOM — fails with
   `rulesText: file <path> has UTF-8 BOM at offset 0; remove the
   BOM and recommit`).

The error message format is pinned. The test runs in `npm run test`,
so a CRLF-introducing or BOM-introducing commit fails CI before the
cross-OS matrix even runs in 4.B.

**`assets/atlas.png` binary attribute is the load-bearing entry.**
Without it, `text=auto` could CRLF-corrupt a clone on Windows on
checkout, breaking the `git diff --exit-code assets/` gate
(decision 10) and the Phase 4.B cross-OS matrix. The line
`assets/atlas.png binary` after the global `*.png binary` rule is
defense-in-depth (specific overrides general in `.gitattributes`).

**Test that would catch a regression.** The
`tests/build/rules-text.test.ts` CRLF/BOM scan above. Plus a
secondary test that asserts `.gitattributes` exists and contains the
substring `assets/atlas.png binary`.

**Decisions amended above:** Decision 13's 4.A.1 deliverable list
gains a new step (between current step 4 and step 5):
"Create `.gitattributes` at the repo root with the byte-exact
content pinned in addendum B3; add `tests/build/rules-text.test.ts`
asserting LF + no-BOM on every entry of `RULES_FILES`." Decision 7's
"`git config core.autocrlf input` on Windows runners" prose is
**superseded** — the runner-side config is removed (it was the wrong
mitigation, as the red-team noted); `.gitattributes` is the actual
fix.

### B4: In-browser regen byte equality — encoder uses `Uint8Array` and `@noble/hashes/sha256` only; lone-surrogate seed validation pinned

**Resolution.** The encoder pipeline (`src/atlas/png.ts`,
`src/atlas/png-crc.ts`, `src/atlas/generate.ts`,
`tools/gen-atlas.ts`) is byte-equivalent across Node, Chromium,
Firefox, and WebKit by **construction**:

1. **`Uint8Array` only; no `Buffer`.** No `import { Buffer } from
   "node:buffer"`, no global `Buffer.alloc(...)`, no
   `Buffer.concat(...)`. Byte-array allocations use `new
   Uint8Array(n)`. Concatenation uses a hand-written helper:

   ```ts
   // src/atlas/bytes.ts (new file, Phase 4.A.2)
   export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
     let total = 0;
     for (const p of parts) total += p.length;
     const out = new Uint8Array(total);
     let off = 0;
     for (const p of parts) { out.set(p, off); off += p.length; }
     return out;
   }
   ```

   Lint enforcement: `src/atlas/**` adds `node:buffer` to the
   `no-restricted-imports` patterns list (decision 11) and
   `Buffer` to `no-restricted-globals`.

2. **`@noble/hashes/sha256` only; no `crypto.subtle`, no Node
   `crypto`.** All atlas-pipeline SHA-256 calls — at build time in
   `tools/gen-atlas.ts`, in the in-browser preview-regen path, and
   in the runtime atlas-loader hash check — go through the existing
   `sha256` re-export from `src/core/hash.ts` (which wraps
   `@noble/hashes/sha256`). `crypto.subtle.digest` is *async* and
   would force the build pipeline to be async (it currently is sync
   via `vite-node`); `node:crypto`'s `createHash` is a third
   implementation with its own `Buffer`-vs-`Uint8Array` quirks. The
   atlas pipeline picks **one** implementation across all three
   call sites.

   Lint enforcement: `src/atlas/**` adds the patterns `crypto`,
   `node:crypto`, and `crypto.subtle` to `no-restricted-imports`
   and `no-restricted-globals`. The atlas-loader's runtime hash
   check (decision 7) also imports from `src/core/hash.ts`, not
   `crypto.subtle`.

3. **Strings consumed by the hasher use the existing `utf8(...)`
   helper.** `src/core/hash.ts:utf8` already rejects lone surrogates
   per `docs/ARCHITECTURE.md` (Phase 1 frozen-contract discipline);
   the atlas pipeline reuses it verbatim. No new string→bytes path
   is introduced.

4. **Dev-mode preview-UI seed validation.** The `<input
   id="atlas-seed-input">` value is normalized via the same
   `seedToBytes`-precondition validation Phase 2 pins (well-formed
   UTF-16, length `1..255`). On invalid input the preview UI shows
   a pinned error in `<div id="atlas-preview-error">` with the
   message:

   > `atlas-preview: invalid atlas-seed (must be 1..255 well-formed
   > UTF-16 code units; got <length> with first error at index <i>)`

   The error fires *before* the seed reaches `seedToBytes` /
   `atlasSeedToBytes` (B7), so a Phase 9 atlas-tuning author sees
   a useful diagnostic rather than an obscure encoder failure. The
   `<div id="atlas-preview-error">` element is added to the DOM
   contract for the preview section (decision 9).

5. **Cross-runtime encoder self-test.** A new self-test
   `atlas-encoder-cross-runtime` in `src/core/self-test.ts`
   constructs a hardcoded 16×16 single-color tile (palette index 5),
   encodes it via `src/atlas/png.ts`'s public encode path, hashes
   the result, and asserts SHA-256 equals a hardcoded golden hex.
   Runs in Node and in all three browsers; mirrors the
   `RANDOM_WALK_DIGEST` discipline at the encoder's smallest
   meaningful unit.

**Test that would catch a regression.** The
`atlas-encoder-cross-runtime` self-test (above) detects any single
encoder-pipeline byte divergence between Node and any browser.
The `atlas-cross-runtime-digest` test (decision 12) catches the
whole-atlas case. ESLint catches a `Buffer.concat`/`crypto.subtle`
import in `src/atlas/**` before the bytes ever differ.

**Decisions amended above:** Decision 4 gains the explicit "Uint8Array
only; concatBytes helper; no Buffer; SHA-256 via @noble/hashes only"
clause. Decision 9 (preview UI) gains the
`<div id="atlas-preview-error">` DOM element and the pinned error
message. Decision 11's lint-pattern list gains `node:buffer`,
`crypto`, `node:crypto`, `crypto.subtle`, and `Buffer` (as a
restricted global). Decision 12's self-test list gains
`atlas-encoder-cross-runtime`.

### B5: `atlasBinaryHash` moves to a Vite plugin with deterministic fallback; HMR reload pinned

**Resolution.** `atlasBinaryHash` is **no longer computed at
`vite.config.ts` top level**. A new Vite plugin
`vite-plugin-atlas-binary-hash.mjs` (in `scripts/` or as an inline
plugin in `vite.config.ts`) owns the computation.

```js
// scripts/vite-plugin-atlas-binary-hash.mjs (sketch — pinned shape)
import { readFileSync, existsSync, statSync } from "node:fs";
import { sha256 } from "../src/core/hash.ts"; // via vite-node resolver

const ATLAS_PATH = "assets/atlas.png";
const ZERO_HASH = "0".repeat(64);                     // sha256(Uint8Array(0))
                                                      // computed once, pinned
                                                      // (literal hex below)
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function atlasBinaryHashPlugin() {
  let computedHash = EMPTY_SHA256;
  let atlasPresent = false;

  function recompute() {
    if (existsSync(ATLAS_PATH)) {
      const bytes = readFileSync(ATLAS_PATH);
      computedHash = bytesToHex(sha256(new Uint8Array(bytes)));
      atlasPresent = true;
    } else {
      computedHash = EMPTY_SHA256;
      atlasPresent = false;
    }
  }

  return {
    name: "icefall-atlas-binary-hash",
    configResolved() {                                // runs once per vite
      recompute();                                    // build/preview/dev/test
    },
    config() {
      return {
        define: {
          __ATLAS_BINARY_HASH__: JSON.stringify(computedHash),
          __ATLAS_MISSING__: JSON.stringify(!atlasPresent),
        },
      };
    },
    handleHotUpdate({ file, server }) {               // dev-mode HMR
      if (file.endsWith("/assets/atlas.png")) {
        recompute();
        server.ws.send({ type: "full-reload" });      // re-resolve config
      }
    },
  };
}
```

**Vite hook responsibilities (pinned):**

- **`configResolved`** — the **single hook** where `assets/atlas.png`
  is read and the hash is computed. Runs once per `vite build`,
  `vite preview`, `vite dev`, and `vitest` invocation. Replaces the
  decision-7 prose "computed at Vite-config-load time by
  `vite.config.ts`'s `define` block."
- **`config`** — exposes `__ATLAS_BINARY_HASH__` and the new
  `__ATLAS_MISSING__` boolean to the `define` block. The
  `__ATLAS_MISSING__` flag is consumed by the diagnostic page
  (decision 9) to surface "atlas not yet generated; run `npm run
  gen-atlas`" in the preview UI rather than throwing on every
  reload.
- **`handleHotUpdate`** — in dev mode only, watches
  `assets/atlas.png` and triggers a `full-reload` (re-resolves
  `define`, re-injects the new hash) on regen. Eliminates the
  "edit seed → regen → stale hash on reload" UX trap.

**Deterministic fallback when `assets/atlas.png` is missing.**

- `__ATLAS_BINARY_HASH__` =
  `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
  (the SHA-256 of the empty byte string —
  `sha256(new Uint8Array(0))`). This is pinned literally (not
  computed at startup) so the test environment and the
  fresh-clone-no-atlas environment produce a *known constant*, not
  an error.
- `__ATLAS_MISSING__` = `true`.
- The diagnostic page checks `__ATLAS_MISSING__` and, if true,
  renders "atlas-preview: assets/atlas.png is missing — run 'npm
  run gen-atlas' first" in `<div id="atlas-preview-error">`
  instead of attempting to fetch and hash it.
- The runtime atlas-loader (decision 7), if invoked while
  `__ATLAS_MISSING__` is true, throws
  `atlas-loader: assets/atlas.png is missing from this build —
  ruleset derivation cannot complete`. (4.A.2 path: this is
  unreachable in production builds because 4.A.2 lands the file in
  the same commit; 4.A.1 path: the file is genuinely missing and
  the error is informative.)

**`vitest` behavior.** `vitest.config.ts` imports the same plugin.
On 4.A.1 (no atlas yet), every `vitest` invocation injects
`__ATLAS_BINARY_HASH__ = EMPTY_SHA256` and `__ATLAS_MISSING__ =
true`. Tests that don't touch the atlas pass; tests that do
(none in 4.A.1) are skipped via `it.skipIf(__ATLAS_MISSING__)`.
On 4.A.2 (atlas exists), every `vitest` invocation injects the
real hash and `__ATLAS_MISSING__ = false`.

**`vite preview` ordering.** The `regenerate-atlas-assert-no-drift`
CI step (decision 10) runs **before** `npm run build`. The order
is: (1) `npm run gen-atlas`, (2) `git diff --exit-code assets/`,
(3) `npm run build`, (4) `npm run test:e2e` against `vite
preview`. This is pinned in the addendum (the original memo did not
say); it guarantees `vite build` sees the freshly-regenerated
binary, not a stale one.

**Test that would catch a regression.** A new
`tests/build/atlas-binary-hash-fallback.test.ts` mocks
`existsSync(ATLAS_PATH)` to return `false`, instantiates the
plugin, calls `configResolved()`, and asserts the resulting
`define` block contains `__ATLAS_BINARY_HASH__: '"' + EMPTY_SHA256
+ '"'` (note the JSON.stringify quotes — see N17). A second
fixture asserts the HMR `handleHotUpdate` triggers a `full-reload`
on `assets/atlas.png` write.

**Decisions amended above:** Decision 7's "Build-step ordering" and
"Vite reads `assets/atlas.png` from the file system" prose are
**superseded** by the plugin specification above. Decision 13 step
5 (4.A.1) lands the plugin scaffolding with the empty-atlas
fallback active; 4.A.2 only adds the file. Decision 9's preview UI
gains the `<div id="atlas-preview-error">` element (also called
out in B4) and the `__ATLAS_MISSING__` branch.

### B6: `ATLAS_TILES_HIGH` bumps are coordinate-stable but binary-unstable; tile-grid resize allowed only at `rulesetVersion` boundaries

**Resolution.** Two distinct invariants — a Phase 6/7 planner reading
the original prose could conflate them. Pinned separately:

1. **Coordinate stability under additive recipe growth.** Adding a
   recipe at the *end* of `ATLAS_RECIPES` never changes the
   `(atlasX, atlasY, tilesWide, tilesHigh)` of any earlier sprite.
   This is decision 3a's invariant; it remains intact.

2. **Binary stability is *not* preserved by `ATLAS_TILES_HIGH`
   bumps.** Bumping `ATLAS_TILES_HIGH` (or `ATLAS_TILES_WIDE`)
   changes the IHDR `height` (or `width`) field, changes the IDAT
   scanline count, and **therefore changes `atlasBinaryHash`**,
   which **bumps `rulesetVersion`**, which **breaks every
   fingerprint shared after Phase 4 ships**. Coordinate stability
   guarantees the *renderer* doesn't break; it does *not*
   guarantee the *atlas binary* doesn't bump.

**Tile-grid resize rule (new).** `ATLAS_TILES_HIGH` and
`ATLAS_TILES_WIDE` may be bumped **only at a `rulesetVersion`
boundary** — i.e., a phase that is already a `rulesetVersion` bump
(Phase 6, Phase 7, Phase 9). The bump must:

1. Be approved by an `architecture-red-team` review event explicitly
   citing this addendum's B6 entry.
2. Land in a commit that simultaneously bumps `ATLAS_DIGEST` and
   updates the cross-OS byte-equality matrix's golden hash.
3. Be a *pure increase* (never a decrease), preserving coordinate
   stability for all existing sprites.

**Cell-budget headroom.** At `8 × 16 = 128` cells, Phase 4's 7
sprites + Phase 7's ceiling estimate of ~34 effective cells = 41
total — well under 128. **No bump is anticipated through v1.** If
Phase 7 boss multi-tile cells push the count higher, the bump is
still expected to be unnecessary.

**Frozen-contract item 5 — superseded text:** The original "Phase
6/7 may bump `ATLAS_TILES_HIGH` additively without moving existing
sprites" parenthetical is **deleted**. The replacement reads:

> Atlas layout constants `TILE_SIZE = 16`, `TILE_PADDING = 1`,
> `ATLAS_TILES_WIDE = 16`, `ATLAS_TILES_HIGH = 8`. Bumping
> `ATLAS_TILES_HIGH` or `ATLAS_TILES_WIDE` is **coordinate-stable**
> (existing `(atlasX, atlasY)` are preserved) but **binary-unstable**
> (the IHDR dimensions change → `atlasBinaryHash` bumps →
> `rulesetVersion` bumps → every shared fingerprint breaks).
> Therefore tile-grid resizing is allowed only at a `rulesetVersion`
> boundary, requires `architecture-red-team` review, and is a pure
> increase. The cell budget at v1 (`8 × 16 = 128`) is well above the
> Phase 7 ceiling of ~34 effective cells; no bump is anticipated
> through v1.

**Test that would catch a regression.** A new test
`tests/atlas/layout-constants.test.ts` asserts
`ATLAS_TILES_HIGH === 8` and `ATLAS_TILES_WIDE === 16` against
hardcoded constants. Bumping either is *both* a `rulesetVersion`
bump *and* a test failure — the test failure is the trip-wire that
forces an `architecture-red-team` review.

**Decisions amended above:** Decision 3a's invariant prose is
clarified to distinguish coordinate-stability from binary-stability.
Frozen-contract item 5 is rewritten as above.

### B7: `atlasSeedToBytes` introduced as a domain-separated peer of `seedToBytes`

**Resolution.** A new helper `atlasSeedToBytes` is added,
byte-distinct from `seedToBytes`:

```ts
// src/atlas/seed.ts (new file, Phase 4.A.2)
import { sha256, utf8 } from "../core/hash";

const ATLAS_SEED_DOMAIN = utf8("icefall:atlas-seed:v1:");
                                                       // 22 bytes, fixed ASCII
                                                       // literal anchor

export function atlasSeedToBytes(seed: string): Uint8Array {
  // Validation: same well-formed-UTF-16 + length 1..255 rule as
  // seedToBytes (Phase 2 frozen contract). Identical preconditions;
  // distinct pre-image.
  validateSeedString(seed);                            // throws on lone
                                                       // surrogate or
                                                       // length out of range
  return sha256(concatBytes([ATLAS_SEED_DOMAIN, utf8(seed)]));
}
```

The pre-image is `utf8("icefall:atlas-seed:v1:") ‖ utf8(seed)`,
hashed with SHA-256 to a 32-byte output. The `ATLAS_SEED_DOMAIN`
anchor is fixed-width 22 bytes (no length prefix needed because
the anchor is constant; an attacker cannot craft a `seed` that
collides with another seed's pre-image without also matching the
22-byte prefix, which they cannot pick freely).

**Domain-separation property.** For every input string `X`:

- `seedToBytes(X) = sha256(utf8(X))`
- `atlasSeedToBytes(X) = sha256(utf8("icefall:atlas-seed:v1:") ‖ utf8(X))`

The two pre-images differ in **length** (22 bytes longer) *and* in
**leading bytes** (the anchor) for every `X`. SHA-256 is a random
oracle for the purposes of fingerprint hygiene; the two outputs
are byte-distinct with overwhelming probability for every input,
and the addendum requires a regression test asserting this for
at least one non-trivial `X`.

**Call-site rewiring.** `tools/gen-atlas.ts` and the dev-mode
preview-UI regen path call `atlasSeedToBytes(...)`, **never**
`seedToBytes(...)`. Decision 1a's `streamsForRun(seedToBytes(atlasSeed))`
becomes `streamsForRun(atlasSeedToBytes(atlasSeed))`. Decision 8's
"is a user-facing string passed to `seedToBytes(...)`" prose is
**superseded** — it is now passed to `atlasSeedToBytes(...)`.

**Layer-import table addition (deferred to 4.A.1's
`docs/ARCHITECTURE.md` update — see B4 above and decision 11):**

> `src/atlas/seed.ts` exports `atlasSeedToBytes`; consumed by
> `tools/gen-atlas.ts`, `src/atlas/generate.ts`, and `src/main.ts`
> (preview UI). It imports `sha256`, `utf8`, `concatBytes`,
> `validateSeedString` from `src/core/**`. Domain anchor
> `"icefall:atlas-seed:v1:"` is the byte-distinct prefix that
> separates atlas seeds from run seeds; mirrors Phase 1's
> `STREAM_DOMAIN = "icefall:v1:"` discipline.

**Test that would catch a regression.**
`tests/atlas/seed.test.ts` asserts:

1. `atlasSeedToBytes("ATLAS_SEED_DEFAULT") !== seedToBytes("ATLAS_SEED_DEFAULT")`
   (both encoded as hex for the comparison).
2. `atlasSeedToBytes("X")` for `X ∈ ["", a 256-char string, a string
   with a lone surrogate]` throws with the same error class as
   `seedToBytes` for the same inputs (preconditions are shared).
3. The pre-image of `atlasSeedToBytes("test")` decoded from a
   hardcoded golden hex begins with the bytes
   `0x69 0x63 0x65 0x66 0x61 0x6c 0x6c 0x3a 0x61 0x74 0x6c 0x61
   0x73 0x2d 0x73 0x65 0x65 0x64 0x3a 0x76 0x31 0x3a` (the
   `"icefall:atlas-seed:v1:"` anchor as ASCII).

**Decisions amended above:** Decision 1a's
`streamsForRun(seedToBytes(atlasSeed))` is **superseded** by
`streamsForRun(atlasSeedToBytes(atlasSeed))`. Decision 7's text
referencing `seedToBytes(atlasSeed)` is similarly amended.
Decision 8 is amended: "passed to `atlasSeedToBytes(...)`" replaces
"passed to `seedToBytes(...)`". Frozen-contract item 4
(`streams.atlas(recipeId)` accessor) gains the clause "the root
seed for the atlas pipeline is derived via `atlasSeedToBytes`, not
`seedToBytes` — the two are byte-distinct domains."

### B8: `atlas-stream-isolation` self-test rewritten as `__consumed.size === 1`; per-call delta pattern pinned for Phase 6/7

**Resolution.** Decision 12's `atlas-stream-isolation` self-test
assertion is **superseded**. The new assertion is:

```ts
// In src/core/self-test.ts, atlas-stream-isolation check:
const streams = streamsForRun(atlasSeedToBytes(ATLAS_SEED_DEFAULT));
const sizeBeforeCall = streams.__consumed.size;       // === 0 (fresh)
streams.atlas("atlas-recipe.cyberpunk.tile.floor");
const sizeAfterCall = streams.__consumed.size;        // expected delta = 1

// Pinned assertions:
assert(sizeBeforeCall === 0,
  "atlas-stream-isolation: fresh streams should have empty __consumed");
assert(sizeAfterCall === 1,
  "atlas-stream-isolation: a single streams.atlas() call should advance " +
  "__consumed.size by exactly 1");
assert(streams.__consumed.has("atlas:atlas-recipe.cyberpunk.tile.floor"),
  "atlas-stream-isolation: __consumed should contain the recipe key");
```

**Per-call expected-size delta — pinned.** A `streams.atlas(recipeId)`
call advances `streams.__consumed.size` by **exactly 1**, recording
exactly the key `"atlas:" + recipeId`. No other key is touched. This
is the per-call invariant that Phase 6/7 fixtures will assert when
exercising recipes alongside sim/mapgen calls (where `sim:*` /
`mapgen:*` keys *will* be present and *should not* trigger a
false-positive).

**Why this is correct (and the original "no `sim:*` keys"
formulation was wrong).** The original wording forbade `sim:*` keys
from `__consumed` — but `streams.simFloor(3)` *legitimately* records
`"sim:3"` and `streams.sim()` *legitimately* records `"sim"`. A
Phase 6/7 maintainer extending the test to exercise a recipe
*alongside* a sim call would have to choose between (a) deleting
the no-`sim:*` rule (silently weakening the invariant) or (b)
keeping it and breaking legitimate composite tests. The size-delta
formulation is composable: any number of `streams.atlas(...)`,
`streams.simFloor(...)`, `streams.mapgen(...)` calls can be made,
each advancing `__consumed.size` by exactly 1, and the per-call
delta invariant holds for each call independently — mirroring the
Phase 3 frozen-contract 11 per-tick `__consumed`-empty invariant.

**Pattern for Phase 6/7 fixtures.** When a future test exercises an
atlas-load inside a real run, the assertion shape is:

```ts
const sizeBefore = streams.__consumed.size;
streams.atlas(recipeId);                              // or any single accessor
assert(streams.__consumed.size === sizeBefore + 1,
  `expected __consumed.size to advance by 1; got delta ${streams.__consumed.size - sizeBefore}`);
```

**Test that would catch a regression.** The rewritten
`atlas-stream-isolation` self-test (above) catches a recipe that
accidentally calls `streams.simFloor(...)` or `streams.mapgen(...)`
or `streams.ui()` — `__consumed.size` would advance by `> 1`. A
companion test `tests/atlas/recipes/no-cross-stream.test.ts`
iterates each Phase 4 recipe, fresh-instantiates streams, calls
the recipe, asserts `__consumed.size === 1` and the lone key has
the `"atlas:"` prefix.

**Decisions amended above:** Decision 12's `atlas-stream-isolation`
self-test prose is rewritten as above. Frozen-contract item 4 gains
the clause "per-call invariant: `streams.atlas(recipeId)` advances
`__consumed.size` by exactly 1, recording exactly the key
`'atlas:' + recipeId`."

---

### Nit dispositions

| Nit | Title | Disposition | Where addressed |
|---|---|---|---|
| N1 | `fdeflate` pin/upgrade procedure | Resolved in addendum | See N1 entry below the table. |
| N2 | `fdeflate` byte-identical-across-runtimes citation | Resolved in addendum | See N2 entry below the table. |
| N3 | `valueNoise2D` PRNG-cursor advancement | Resolved in addendum | See N3 entry below the table. |
| N4 | `paletteGradient` `steps=1` div-by-zero | Resolved in addendum (runtime guard pinned) | See N4 entry below the table. |
| N5 | Color-quantization out-of-range palette index | Resolved in addendum (runtime guard pinned) | See N5 entry below the table. |
| N6 | `tRNS` chunk truncation discipline | Resolved in addendum | See N6 entry below the table. |
| N7 | `DEV-` refusal error-message regression test | Resolved in addendum (test fixture pinned) | See N7 entry below the table. |
| N8 | Bundle-size budget for atlas-preview UI | Carried to 4.A.2 implementation | Decision 13 4.A.2 acceptance criteria amended. |
| N9 | Atlas-grid wrap-with-skip edge-case fixture | Carried to 4.A.2 implementation | Decision 12 test list amended. |
| N10 | `tools/gen-atlas.ts` `node:` prefix on Node built-ins | Resolved in addendum | See N10 entry below the table. |
| N11 | `<theme>` regex anchor vs future modding seam | Resolved in addendum (option (b) — keep tight) | See N11 entry below the table. |
| N12 | Variant golden-hex pin-source rule | Resolved in addendum (per-preset pin in 4.A.2) | See N12 entry below the table. |
| N13 | Atlas-recipe mod loader runtime semantics | Carried to 4.A.2 (decision 14 prose amendment) | Decision 14 amended at implementation. |
| N14 | Cross-OS matrix `fail-fast` + Node version | Resolved in addendum (`fail-fast: false`, Node 20.x) | See N14 entry below the table. |
| N15 | `assets/atlas.json` non-canonical-input round-trip fixture | Carried to 4.A.2 implementation | Decision 12 test list amended. |
| N16 | Manifest schemaVersion=2 animation-frame forward-compat | Deferred to Phase 9 | See N16 entry below the table. |
| N17 | `define`-block `JSON.stringify` foot-gun | Resolved in addendum (canonical injection form pinned) | See N17 entry below the table. |

#### N1 — `fdeflate` upgrade discipline

`fdeflate` is **exact-pinned** in `package.json` (`"fdeflate":
"<version>"` — no caret, no tilde). The
`architecture-red-team` review checklist gains a new item:

> Any change to `fdeflate`'s version line in `package-lock.json`
> (including the `integrity` SHA hash) auto-flags an
> `architecture-red-team` review event. The review must include
> a fresh cross-OS byte-equality CI run (Phase 4.B matrix) before
> approval. Major / minor / patch all bump `atlasBinaryHash` if
> upstream tunes its compression heuristic.

Pinned in 4.A.1 alongside the `fdeflate` add. The
`package-lock.json` `integrity` hash is the load-bearing tarball
SHA recall.

#### N2 — `fdeflate` cross-runtime byte-identity citation

`fdeflate` is the DEFLATE encoder used by Vite itself for asset
compression (`vite >= 5.x` depends on `fdeflate`). It is also used
by `vitest`'s coverage tooling. Its determinism property (same
input + same compression level → byte-identical output across
JavaScript runtimes) is a **deliberate design property**, not an
incidental one — the package's README pins the level → output
mapping. The Phase 4.A.1 `fdeflate` add commit message cites the
package's README and version; the `architecture-red-team` checklist
verifies the citation is current at upgrade time. (Pinning a URL
in a planning artifact would rot; pinning the version + the rule
that any version bump regenerates the cross-OS matrix is the
durable mitigation.)

#### N3 — `valueNoise2D` consumes exactly one `prng.next()` per call

Pinned: `valueNoise2D(prng, x, y)` consumes **exactly one**
`prng.next()` call per invocation. A recipe that paints a
`16 × 16` tile via `valueNoise2D` per pixel advances the PRNG
cursor by **exactly 256**. Frozen-contract item 1 gains the clause
"`valueNoise2D` consumes exactly one `prng.next()` call per
invocation; recipe PRNG cursor advancement is deterministic from
the recipe's primitive call count and input dimensions." A
regression test under `tests/atlas/primitives/value-noise.test.ts`
asserts the cursor delta after `valueNoise2D(prng, 5, 7)` is
exactly 1 (by snapshotting `prng.__cursor` if exposed, or by
comparing two adjacent calls' outputs to a hardcoded golden).

#### N4 — `paletteGradient(steps)` runtime guard

Pinned in the primitive's signature contract: `steps >= 2` is
required. `steps === 1` throws:

> `paletteGradient: steps must be >= 2 (got 1); use paletteIndex
> directly for a single-color result`

`steps === 0` throws the same error class with `(got 0)`. The
runtime check is the first statement of `paletteGradient`'s
implementation; no recipe may pass `steps < 2`. Decision 1's
`paletteGradient` row is amended to include the precondition.
A unit test asserts the throw with the pinned message for `steps ∈
{0, 1}` and a successful return for `steps ∈ {2, 3, 16}`.

#### N5 — Palette-index bounds check

Pinned in the encoder (`src/atlas/png.ts`): before emitting IDAT,
the encoder asserts `pixels[i] < palette.colors.length` for every
pixel. Violation throws:

> `pngEncode: pixel <i> has palette index <v> but palette has <N>
> entries`

where `<i>`, `<v>`, `<N>` are the offending pixel offset, the
out-of-range palette index, and the palette length respectively.
Decision 4 is amended to include this guard. A unit test
constructs a tile buffer with one out-of-range pixel and asserts
the throw message matches the pinned format.

#### N6 — `tRNS` chunk emits all 16 entries (full length)

Pinned: the `tRNS` chunk for `paletteCount = 16` emits all 16
entries (chunk length = 16 bytes), not the spec-allowed
truncation. Entry 0's alpha is `0x00`; entries 1..15 are `0xFF`.
This removes byte-stability surface against decoders that
behave differently on truncated `tRNS`. Decision 4 (PNG encoder
format) is amended; frozen-contract item 7 gains the clause "tRNS
chunk length is exactly 16 bytes for `paletteCount = 16`; entries
1..15 are `0xFF` (fully opaque) and entry 0 is `0x00`
(transparent)." A unit test on the encoded PNG bytes asserts the
`tRNS` chunk length field reads `16`.

#### N7 — `DEV-` refusal error-message test fixture pinned

A new test `tests/atlas/manifest-loader.test.ts` (added in 4.A.2)
asserts the **exact string match** of the `DEV-` refusal error:

```
expect(() => loadAtlas({ rulesetVersion: PLACEHOLDER_RULESET_VERSION,
                          atlasPng: <fixture>,
                          atlasBinaryHash: <fixture-hash> }))
  .toThrow("atlas-loader: refusing to load build with placeholder ruleset (DEV- fingerprint) — re-build with 'npm run build' to inject the real rulesetVersion");
```

The error string is exact-character-match (including the em-dash
`—`, U+2014). A second assertion uses `.toThrow(/^atlas-loader:/)`
as a defense against accidental message rephrasing.

#### N10 — `node:` prefix on Node built-ins

Pinned: `tools/gen-atlas.ts` (and any future `tools/**` script
that imports Node built-ins) **must use the `node:` prefix** —
`node:fs`, `node:path`, `node:url`, never the bare `fs`/`path`/`url`.
Lint enforcement: the existing `tools/**` ESLint scope adds
`no-restricted-imports` patterns banning the bare forms with the
message:

> `node-builtin: use 'node:fs' (or 'node:path', etc.); the bare
> form resolves through Vite's resolver and can collide with a
> mod's local module.`

Decision 11 layer-import table is amended in the 4.A.1
`docs/ARCHITECTURE.md` update.

#### N11 — `<theme>` regex stays tight; theme-add is a `rulesetVersion` bump

Adopt **option (b)**: keep the recipe-ID regex anchored to
`(cyberpunk)` for v1. Adding a new theme (e.g. `fantasy`) is a
`rulesetVersion` bump *anyway* — every theme adds new recipes,
which add cells to the atlas, which bumps `atlasBinaryHash`.
Loosening the regex now (option (a)) would weaken a runtime
invariant for no benefit. Decision 2 prose gains the clarifying
sentence: "Adding a `<theme>` value to the regex's alternation is
a `rulesetVersion` bump; in practice every theme addition is
already a bump because the recipes themselves are."

#### N12 — Variant golden-hex pin-source rule

The four preset seeds (`placeholder`, `variant-A`, `variant-B`,
`variant-C`) each get their **own** golden hex pinned in
`src/atlas/preset-seeds.ts`:

```ts
export const PRESET_SEEDS = [
  { id: "placeholder", seed: ATLAS_SEED_DEFAULT,
    expectedHash: "<computed during 4.A.2; pinned at first green CI run>" },
  { id: "variant-A", seed: "icefall-atlas-variant-A",
    expectedHash: "<computed during 4.A.2; pinned at first green CI run>" },
  { id: "variant-B", seed: "icefall-atlas-variant-B",
    expectedHash: "<computed during 4.A.2; pinned at first green CI run>" },
  { id: "variant-C", seed: "icefall-atlas-variant-C",
    expectedHash: "<computed during 4.A.2; pinned at first green CI run>" },
] as const;
```

**Pin-source rule (pinned in addendum).** The four `expectedHash`
values are computed during Phase 4.A.2 by running `npm run
gen-atlas` four times (once per preset seed, swapping
`ATLAS_SEED_DEFAULT` against each variant) on the **CI runner
that produces the first green Phase 4.B build** (specifically the
`ubuntu-latest` shard, which is the cross-OS aggregator's primary
source of truth). The four resulting `assets/atlas.png` SHA-256s
are pasted into `PRESET_SEEDS` literally in the same commit as
the first green 4.B build, *before* the live deploy is approved.

The Phase 4.B Playwright assertion exercises **all four preset
buttons**, not just `variant-A`. Each button click sets the seed
input, triggers regen, waits for `__ATLAS_PREVIEW_LIVE_HASH__` to
update, and asserts equality with the corresponding
`expectedHash`. Three-of-four-buttons-untested is closed.

Decision 9 (preview UI) and decision 12 (test surfaces) are
amended.

#### N14 — Cross-OS matrix: `fail-fast: false`, Node 20.x pinned

Pinned `.github/workflows/deploy.yml` matrix configuration for the
new `cross-os-atlas-equality` job:

```yaml
strategy:
  fail-fast: false                                    # see addendum N14
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node-version: ['20.x']                            # pinned; bump requires
                                                      # architecture-red-team
                                                      # review event
```

`fail-fast: false` — when one OS fails, the others continue, so
the aggregator job has full diagnostic data on which OSes diverged.
`node-version: '20.x'` — pinned; a runner image bump that ships
Node 22 mid-2026 could subtly change `fdeflate`'s output (B4
mitigation requires `fdeflate` byte-identity across the supported
Node line; expanding to a new major Node version is an
`architecture-red-team` review event). Decision 12 (cross-OS
matrix) is amended.

#### N16 — Manifest `schemaVersion=2` animation-frame migrator deferred to Phase 9

Pinned: Phase 4 ships `schemaVersion = 1` with no animation
support. A future Phase 9 polish that adds animation will:

1. Bump `schemaVersion` to `2`.
2. Add fields `framesPerSprite?: number` and
   `frameDuration?: number` to per-sprite manifest entries.
3. Ship a `parseAtlasJsonV1ToV2(manifest: AtlasManifestV1):
   AtlasManifestV2` migrator so v1 (pre-migrator) atlases load
   under the v2 reader as single-frame sprites.

The constraint Phase 4 imposes: **the `schemaVersion = 1` parser
must reject `schemaVersion = 2`** (already pinned in decision 6),
so a Phase 9 v2 atlas does not silently load against a v1 reader.
Decision 14 (deferred work) is amended with the one-paragraph
forward-compat note.

#### N17 — `define`-block canonical injection form: `JSON.stringify` for every key

Pinned: every `define`-block key in `vite.config.ts` and
`vitest.config.ts` is wrapped in `JSON.stringify(...)`. Vite
substitutes the right-hand side **literally**, so a string value
must be quoted *inside* the substitution.

```js
// CORRECT:
define: {
  __ATLAS_BINARY_HASH__: JSON.stringify(computedHash),     // injects: "abc123..."
  __ATLAS_MISSING__: JSON.stringify(atlasMissing),         // injects: true / false
  __RULESET_VERSION__: JSON.stringify(rulesetVersion),     // injects: "0123..."
  __COMMIT_HASH__: JSON.stringify(commitHash),             // injects: "sha-abc"
}

// WRONG (bare identifier; fails at build time as undefined symbol):
define: {
  __ATLAS_BINARY_HASH__: computedHash,                     // injects: abc123 (bad)
}
```

**Escape rules pinned.** `JSON.stringify` handles:

- Empty strings: `JSON.stringify("") === '""'` — injects two
  quote characters as a valid empty JS string literal.
- Strings with embedded quotes / backslashes / newlines: escaped
  per JSON spec (`"\""`, `"\\"`, `"\n"`).
- `null` / `undefined`: `JSON.stringify(null) === "null"`;
  `JSON.stringify(undefined) === undefined` (the key is then
  *omitted* from the substitution, leaving the identifier
  undefined at runtime — a foot-gun the Vite plugin avoids by
  always passing concrete strings or booleans, never `undefined`).
- Booleans: `JSON.stringify(true) === "true"` — injected as a
  bare boolean literal.
- Numbers: `JSON.stringify(64) === "64"` — bare number literal.

The Vite plugin in B5 follows this discipline. The `tests/build/`
test suite asserts every `define`-block value is a string
beginning and ending with `"`, or `"true"` / `"false"`, or a
numeric literal. Bare-identifier injection (the foot-gun) trips
this test before the build fails opaquely.

---

### Frozen-contract list — final form (Phase 4) after addendum

Replacing the original list at the end of "Frozen contracts
established by this phase" where amended:

1. **Recipe primitive set.** Ten functions; signatures and integer
   constants pinned (decision 1, 1a). `paletteGradient` requires
   `steps >= 2` (N4). `valueNoise2D` consumes exactly one
   `prng.next()` per call (N3).
2. **Recipe signature.** Unchanged.
3. **Recipe ID format.** Regex anchored to `cyberpunk` for v1; new
   themes are `rulesetVersion` bumps (N11).
4. **`streams.atlas(recipeId)` accessor.** Per-call invariant:
   advances `__consumed.size` by exactly 1, recording exactly the
   key `"atlas:" + recipeId` (B8). Root seed derived via
   `atlasSeedToBytes(...)`, **not** `seedToBytes(...)` (B7).
5. **Atlas layout constants.** `TILE_SIZE = 16`, `TILE_PADDING = 1`,
   `ATLAS_TILES_WIDE = 16`, `ATLAS_TILES_HIGH = 8`. Bumping either
   tile-grid dimension is **coordinate-stable but binary-unstable**
   and requires `architecture-red-team` review at a `rulesetVersion`
   boundary (B6).
6. **Atlas-grid placement function.** Unchanged; coordinate
   stability under additive recipe growth.
7. **PNG encoder format.** Indexed PNG, color type 3, bit depth 8;
   chunks `IHDR, PLTE, tRNS, IDAT, IEND`; filter 0; `fdeflate`
   level 1; **no ancillary chunks**. `tRNS` chunk length is exactly
   16 bytes (N6). The encoder asserts `pixels[i] <
   palette.colors.length` per pixel before emitting IDAT (N5).
8. **Color palette.** Unchanged.
9. **Atlas JSON manifest schema.** Unchanged.
10. **`rulesetVersion` derivation.** `rulesetTextHash` pre-image is
    the alphabetically-sorted concatenation of `(utf8_path, NUL,
    sha256(normalizeForHash(content)), NUL)` tuples for each entry
    of `RULES_FILES`, where `normalizeForHash` strips a leading
    UTF-8 BOM and replaces all CRLF with LF (B2);
    `rulesetVersion = sha256(utf8(rulesetTextHash) ‖ utf8("|") ‖
    utf8(atlasBinaryHash))`. `atlasBinaryHash` is computed by the
    Vite plugin (B5), with `EMPTY_SHA256` fallback when the file is
    missing.
11. **Atlas-loader `DEV-` refusal and hash check.** Exact error
    strings pinned (N7). The `__ATLAS_MISSING__` define enables a
    distinct preview-UI error path (B5).
12. **`ATLAS_DIGEST` golden constant.** Unchanged. Plus three new
    self-tests: `atlas-encoder-cross-runtime` (B4),
    `atlas-stream-isolation` rewritten per B8.
13. **Atlas-loader hash check.** Implementation uses `@noble/hashes`
    only — no `crypto.subtle`, no `node:crypto` (B4).

### Phase 4.A drift-detection sweep — sequencing after addendum

Per QUALITY_GATES drift-detection gate, Phase 4.A.1's commit lands
the following, **in this order**, with **no net-new
`src/atlas/**` recipe code**:

1. **Phase 3.A.2 carry-forwards.** Per `phase-approval.json`
   inspection.
2. **`uniformIndex` relocation.** From `src/sim/run.ts` to
   `src/core/prng.ts` with focused unit tests (termination,
   distribution, `n=1` boundary). 100% coverage on
   `src/core/prng.ts` preserved.
3. **`fdeflate` dependency.** Exact-pinned in
   `package.json::devDependencies`; `package-lock.json` regenerated.
4. **`.gitattributes`** at repo root with the byte-exact content
   pinned in B3.
5. **`tests/build/rules-text.test.ts`** asserting LF + no-BOM on
   every `RULES_FILES` entry (B3).
6. **`vite-plugin-atlas-binary-hash`** scaffolding in
   `scripts/vite-plugin-atlas-binary-hash.mjs` plus inline
   reference from `vite.config.ts` and `vitest.config.ts` (B5).
   With `assets/atlas.png` absent in 4.A.1, the plugin emits
   `__ATLAS_BINARY_HASH__ = EMPTY_SHA256` and `__ATLAS_MISSING__ =
   true`; the `define`-block injection uses `JSON.stringify(...)`
   (N17).
7. **`deriveRulesetVersion`** helper exported from
   `src/build-info.ts`, **not yet called** at the `define`-block
   site (B1). The `define`-block continues to inject
   `PLACEHOLDER_RULESET_VERSION` for `__RULESET_VERSION__`.
8. **`docs/ARCHITECTURE.md` update.** Adds the `src/atlas/**`
   layer entry, `src/atlas/seed.ts` + `atlasSeedToBytes` (B7),
   the new lint scope additions including `node:buffer`, `crypto`,
   `node:crypto`, `crypto.subtle`, bare-`fs`/`path` (N10), the
   tile-grid resize rule (B6), the `RULES_FILES` canonicalization
   (B2), and the `.gitattributes` discipline (B3).

The above eight commits — drift-detection sweep — land **before**
any net-new `src/atlas/**` code. Phase 4.A.2's remaining commits
are net-new atlas implementation, in any reviewer-preferred order,
*including* the `vite.config.ts` flip from `PLACEHOLDER_RULESET_VERSION`
to the real derivation (B1) and the `assets/atlas.png` /
`assets/atlas.json` add (decision 10).

### Verdict after addendum

With the above resolutions, the architecture-red-team review's
verdict reverts to **APPROVE** (or **APPROVE WITH NITS** if the
reviewer flags additional issues in the addendum itself). Phase
4.A.1 code may be written following the contracts in this memo as
amended. The red-team is not re-invoked unless a Phase 4.A.1 or
4.A.2 commit deviates from the above; deviations require either
(a) a new addendum entry here or (b) a `phase-update.json`
artifact pausing the phase for re-review.

---

## Addendum-2 (Phase 4.A.1 implementation discovery): `fdeflate` → `fflate`

> Discovered during Phase 4.A.1 implementation (2026-05-04). The
> addendum above (B5, N1, N2) and the `decision-memo-phase-4.md`
> body (decision 4) name the deflate library as **`fdeflate`**.
> `npm view fdeflate` returns HTTP 404 — the package does not exist
> on the public npm registry. `fflate` (https://www.npmjs.com/package/fflate)
> is the canonical pure-JS, sync, deterministic deflate library that
> matches every property the addendum's encoder discipline was
> specifying: pure JS (no native code, no Node-vs-browser branch),
> exact-pinnable, sync API, deterministic level-1 output, ESM, small
> footprint (~30 KB minified — slightly larger than the addendum's
> "≈ 8 KB" estimate but the only viable substitute on the registry).
>
> **Resolution adopted in Phase 4.A.1:** `fflate@0.8.2` is added as
> the exact-pinned devDependency in place of the non-existent
> `fdeflate`. All discipline pinned in addendum-1 B5 / N1 / N2
> (level pinning, deterministic IDAT output, no native code,
> integrity-hash recall on version bumps, cross-OS-matrix-rerun on
> any version-line change in `package-lock.json`) applies unchanged
> to `fflate`.
>
> **Docs synchronized in this same Phase 4.A.1 commit:**
> `docs/PHASES.md:199,251`, `docs/ATLAS_GENERATOR.md:63,121,206`,
> `docs/ARCHITECTURE.md:528` all rewritten from `fdeflate` to
> `fflate` with an explanatory parenthetical noting the substitution.
> The decision-memo body (decision 4) and the addendum-1 (B5, N1, N2)
> are preserved as historical record of the planning-gate output;
> readers should treat any `fdeflate` reference in those sections as
> "the encoder library subsequently re-pinned to `fflate` per
> addendum-2." Addendum-1 N2's "version-bump → cross-OS-matrix-rerun"
> rule binds the version-pin discipline to whatever package name is
> live in `package.json`; the rule itself is untouched.
>
> **Phase 4.A.2 implication:** the PNG encoder in `src/atlas/png.ts`
> will import from `fflate` (specifically `fflate`'s sync deflate
> entrypoint at level 1 for deterministic output). Addendum-1 B4's
> `atlas-encoder-cross-runtime` self-test gains an `fflate` version
> assertion in `package.json` to surface any silent re-pin.
>
> **No fingerprint-bump risk** — Phase 4 has not yet shipped any
> atlas, so no `atlasBinaryHash` and no live `rulesetVersion` are
> built on `fdeflate` output. The substitution is invisible to
> external observers.
