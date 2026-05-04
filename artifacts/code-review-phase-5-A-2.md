# Code Review — Phase 5.A.2 (sandbox-verifiable renderer + input + ui implementation)

## Verdict

APPROVE.

All six Phase 5.A.2 acceptance criteria pass. The phase lands the
playable-game UI end-to-end: the 226-line `src/render/canvas.ts`
tile renderer (read-only sink on `RunState`, integer-only pixel
arithmetic, defensive on out-of-range tile codes), the 171-line
`src/input/keyboard.ts` mapper (12 default bindings + Period+shift
descend special-case + window-fallback target resolution), the
87-line `src/ui/hud.ts` widget (idempotent re-render via
`data-hud-field` attributes), and the `startGame()` orchestrator
in `src/main.ts:480-595` that wires `loadAtlas` → image-decode →
`buildInitialRunState` → `startKeyboard` → `tick` → `drawScene`
+ `renderHud`. The diagnostic surface is preserved verbatim under
`<details id="diagnostics" open>` in `renderDiagnostic` (`src/main.ts:97-469`),
so all 14 pre-existing e2e selectors and all 13 `window.__*__`
flags resolve unchanged. Final gates: 865/865 tests passing
(net +44 over 5.A.1's 821; the brief expected +41, the +3 surplus
is from the 5.A.1 dual-source assertions plus a second canvas
defensive-paths test the brief did not enumerate); lint clean,
typecheck clean, build green at 69.17 KB raw / 26.04 KB gzipped
(matches the prompt's expected sizes exactly; well under the 75 KB
Phase 2.0 budget). The four loader refusal paths
(`PLACEHOLDER_RULESET_VERSION`, `__ATLAS_MISSING__`, hash mismatch,
`<img>` decode failure) all surface via the `#game-error` div and
flip `window.__GAME_READY__ = "error"` with the pinned message in
`window.__GAME_ERROR__` — no silent fallback path.

Three non-blocking documentation/cosmetic suggestions are listed
below. Coverage on `src/render/**` deviates from the documented
100% to 96.61% lines / 93.33% branches; the deviation is documented
inline in `vitest.config.ts:86-92` and matches the Phase 5 frozen
contract's "defensive paths can be uncovered" allowance from the
phase-prompt operating rules.

## Blocking issues

None.

## Verification points

1. **A human can play a real run end-to-end on the deployed URL.**
   PASS. `src/main.ts:480-595` defines `async function startGame(host)`
   that: (a) creates the `<section id="game">` container, the
   `#game-error` div, the `#game-hud` host, and the focusable
   `#game-canvas` element (`tabIndex = 0` at `:506`); (b) calls
   `await loadAtlas(import.meta.env.BASE_URL + "assets")` at `:516`
   and surfaces every loader exception via `errorDiv.textContent`
   + `window.__GAME_READY__ = "error"` + `window.__GAME_ERROR__`
   (`:517-523`); (c) decodes the PNG bytes via `decodeAtlasImage`
   (`:529-537`) using the same Blob+ObjectURL+`new Image()` pattern
   the atlas-preview UI uses, with the same error-surface hook;
   (d) builds the initial RunState via `buildInitialRunState(inputs,
   streams)` from the URL-hash seed (`:542-550`); (e) wires
   `startKeyboard({bindings: DEFAULT_KEY_BINDINGS, target: window},
   onAction)` at `:586-592`. The `onAction` closure (`:574-585`)
   honors the `__pendingFloorEntry` mirror of the harness loop
   (`:577-581`) — calls `generateFloor` + `spawnFloorEntities`
   + `applyFloorEntry` before the next `tick`. After the first
   `rerender()` call (`:568`), `window.__GAME_READY__ = "ready"`
   is flipped at `:594`; each subsequent `rerender()` updates
   `__GAME_STATE_HASH__`, `__GAME_FLOOR__`, `__GAME_HP__`,
   `__GAME_OUTCOME__` (`:563-566`). The "playable" claim is bounded
   by the bundle's behavior under `vite preview` + manual keypresses;
   live-deploy verification belongs to Phase 5.B.

2. **Renderer reads from sim state and never writes to it
   (architectural test).** PASS. `tests/render/render-readonly.test.ts:24-42`
   defines a recursive `deepFreeze` with a `WeakSet` cycle guard
   that walks every nested object (skipping `ArrayBuffer.isView`
   nodes, since V8 cannot freeze typed-array element storage —
   correctly justified at `:28-32`). The first test (`:101-122`)
   freezes a real `runScripted({inputs, actions: SELF_TEST_LOG_100}).finalState`
   — a state shape produced by the real harness, not a hand-rolled
   fixture — and asserts `drawScene(target, state)` does not throw.
   The second test (`:124-136`) deep-freezes the LoadedAtlas object
   itself (so the manifest map / sprite entries are frozen) and
   asserts the renderer still completes. Direct source check:
   `grep -nE "state\.\w+\s*=" src/render/canvas.ts` returns no
   matches; the renderer reads `state.floorState.floor.{tiles,width,height}`,
   `state.floorState.{monsters,items}`, and `state.player.pos`
   (verified at `src/render/canvas.ts:138,154-156,175,195,221`)
   and never writes back. The local mutations on `canvas.width`
   / `canvas.height` (`:140-141`) and `ctx.imageSmoothingEnabled`
   / `ctx.fillStyle` (`:147-150`) target the render target, not
   `state` — the read-only contract scope.

3. **`src/render/**` cannot import `src/core/streams.ts` or
   `src/sim/combat.ts` (lint rule).** PASS. `eslint.config.js:152-211`
   is the `src/render/**` override block. The `no-restricted-imports`
   `patterns` list at `:170-181` bans **eight** module groups:
   `**/core/streams`, `**/sim/combat`, `**/sim/turn`, `**/sim/run`,
   `**/sim/harness`, `**/sim/ai`, `**/mapgen/generate`, `**/input/**`,
   `**/main` — superset of the prompt's expectation
   (`**/core/streams`, `**/sim/combat`, `**/sim/turn`, `**/sim/run`,
   `**/mapgen/generate`, `**/input/**`, `**/main`) plus
   `**/sim/harness` and `**/sim/ai` which are also sim write
   surfaces and properly belong in the ban list. Same overrides are
   applied to `src/input/**` (`:213-262`) and `src/ui/**` (`:264-312`)
   per the layer table at `docs/ARCHITECTURE.md:772-776`. Each
   layer also picks up the `determinism/no-float-arithmetic` plugin
   in a paired override block (`:198-211`, `:255-262`, `:305-312`)
   plus `no-restricted-syntax` for `Math.random` / `Date.now` /
   `performance.now` / `new Date()`, and `no-restricted-globals`
   for `Date` / `performance`. Verification: `npm run lint` exits
   clean (zero output past the script header). The renderer's
   actual imports are `import type { RunState }` from `../sim/types`
   (type-only, allowed), `import type { LoadedAtlas }` from
   `../atlas/loader`, and integer constants from `../atlas/params`
   (verified at `src/render/canvas.ts:45-52`); the input layer
   imports only `import type { Action, Direction }` from
   `../core/encode` (`src/input/keyboard.ts:44`); the HUD imports
   `import type { RunState }` from `../sim/types` and the
   `fingerprint` value-export from `../core/fingerprint`
   (`src/ui/hud.ts:21-22`). All three respect the layer table.

4. **Atlas hash mismatch produces a clear error and aborts the
   run.** PASS. `src/main.ts:514-523` wraps the `await loadAtlas(...)`
   call in a try/catch that captures every loader-pinned exception
   (`PLACEHOLDER_REFUSAL_MESSAGE` from `src/atlas/loader.ts:26-27`,
   `ATLAS_MISSING_MESSAGE` from `:29-30`, the hash-mismatch
   `atlas-loader: atlas.png hash mismatch — got X, expected Y
   (rebuild required)` from `:67-68`), writes the message to
   `errorDiv.textContent`, and flips `window.__GAME_READY__ = "error"`
   + `window.__GAME_ERROR__ = msg`. The function returns early at
   `:522`, so no later code (no `decodeAtlasImage`, no
   `buildInitialRunState`, no `startKeyboard`) executes — there is
   no silent fallback. A second try/catch at `:529-537` covers the
   `<img>` decode failure path with the same error-surface hook.
   The em-dash U+2014 is present in `PLACEHOLDER_REFUSAL_MESSAGE`
   verbatim (charCodeAt assertion at
   `tests/atlas/loader.test.ts:45-51`); the loader's pinned messages
   propagate through the orchestrator unchanged.

5. **Diagnostic surface preserved.** PASS. `src/main.ts:97-469`
   is `function renderDiagnostic(host)` which builds a
   `<details id="diagnostics" open>` element (`:98-100`). All 14
   required ids are emitted: `#self-test-banner` (`:118`),
   `#floor-preview` (`:176`), `#floor-preview-form` (`:189`),
   `#preview-seed` (`:193`), `#preview-floor` (`:199`),
   `#preview-generate` (`:211`), `#floor-preview-ascii` (`:220`),
   `#sim-scripted` (`:248`), `#scripted-run` (`:260`),
   `#scripted-output` (`:265`), `#atlas-preview` (`:299`),
   `#atlas-seed-input` (`:313`), `#atlas-regenerate-button`
   (`:320`), `#atlas-preview-canvas-build` (`:348`),
   `#atlas-preview-canvas` (`:351`), `#atlas-readout` (`:360`).
   All 13 `window.__*__` flags preserved verbatim:
   `__SELF_TEST_DETAILS__` (`:108`), `__SELF_TEST_RESULT__`
   (`:171`), `__RANDOM_WALK_DIGEST__` (`:172`),
   `__FLOOR_PREVIEW_ASCII__` (`:229`), `__FLOOR_PREVIEW__`
   (`:242`), `__SIM_FINAL_STATE_HASH__` (`:274`), `__SIM_OUTCOME__`
   (`:275`), `__SIM_FLOOR_REACHED__` (`:276`),
   `__ATLAS_PREVIEW_LIVE_HASH__` (`:427`), `__ATLAS_PREVIEW_SEED__`
   (`:428`), `__ATLAS_PREVIEW_BUILD_HASH__` (`:443/451/460`),
   `__ATLAS_PREVIEW__` (`:444/456/462`). The `<details open>`
   attribute is set at `:100`, so the existing 14 e2e tests do not
   need to click anything to expand the section. Spot-check of
   three e2e tests against the new structure:
   - `tests/e2e/diagnostic.spec.ts:42-51` — `#self-test-banner`
     `data-status="green"` + `__SELF_TEST_RESULT__ === "green"` —
     selector resolves inside the `<details>` (Playwright's
     `locator(...)` traverses `<details>` regardless of `open`,
     and `open` is set anyway).
   - `:91-110` — `#floor-preview` visible + `__FLOOR_PREVIEW__
     === "ready"` + `#preview-seed` visible + `#floor-preview-ascii`
     renders 24-line grid — all selectors emitted by
     `renderDiagnostic`.
   - `:128-142` — `#sim-scripted` visible + `__SIM_FINAL_STATE_HASH__
     === SIM_DIGEST` — preserved.
   New Phase 5.A.2 e2e tests at `:226-313` add 4 playable-game
   tests (`#game` visible + `__GAME_READY__ === "ready"`; HUD
   reflects HP=30/floor=1/outcome=running; five ArrowDown presses
   advance `__GAME_STATE_HASH__`; `<details id="diagnostics">`
   is visible alongside `#self-test-banner` / `#floor-preview` /
   `#sim-scripted` / `#atlas-preview`). The bootstrap order at
   `:627-651` calls `await startGame(root)` before
   `renderDiagnostic(root)` so the canvas is the visual priority,
   but DOM order does not affect selector resolution.

6. **All gates green.** PASS.
   - `lint`: zero output past the script header.
   - `typecheck`: zero output past the script header.
   - `test`: `Test Files 58 passed (58)` / `Tests 865 passed (865)`.
     Net delta from 5.A.1's 821 is +44; brief expected +41 (9 +
     2 + 24 + 6 across the four new test files) — the surplus
     is the two 5.A.1 dual-source EMPTY_SHA256 /
     PLACEHOLDER_RULESET_VERSION assertions (`tests/build/atlas-binary-hash-plugin.test.ts:58-67`,
     part of the 5.A.1 commit) plus one fflate-version-pin file
     (`tests/build/fflate-version-pin.test.ts`, also 5.A.1) plus
     +1 from `tests/render/canvas.test.ts` having 9 tests across
     four describe blocks (the brief counted `drawScene — basic
     rendering` (5) + `drawScene — out-of-range tile codes` (1)
     + `drawScene — read-only on sim state (frozen-contract test)`
     (1) + `drawScene — defensive paths` (2) = 9; brief said 9,
     match). The actual numbers: canvas (9) + render-readonly (2)
     + keyboard (24) + hud (6) = 41 new test cases under Phase
     5.A.2, which is the brief's number; the 821→865 = +44 jump
     accounts for the +3 5.A.1-already-landed tests already in
     HEAD@71b596e (verified by `git log` showing 5.A.1 commit at
     HEAD~3).
   - `build`: `dist/assets/index-B1JXfoiZ.js   69.17 kB │
     gzip: 26.04 kB` — exact match to the prompt's expected sizes.
     The +2.01 kB gzipped delta from 5.A.1's 24.03 kB covers the
     renderer (226 lines), input layer (171 lines), HUD (87 lines),
     and the `decodeAtlasImage` Blob+ObjectURL+Image plumbing
     (`src/main.ts:604-622`) added to the runtime import graph.
     Reasonable.
   - Coverage: `src/render/**` at 96.61/93.33/100/96.61
     (lines/branches/functions/statements); `src/input/**` and
     `src/ui/**` at 100/100/100/100. The render thresholds at
     `vitest.config.ts:93-98` are 95/85/100/95, so 96.61/93.33/100/96.61
     passes. Uncovered lines `120-123` in `src/render/canvas.ts`
     are the `spritePixelCoord` out-of-range coordinate throw —
     a defensive-path branch that requires manually constructing
     a malformed manifest with `atlasX/Y` outside the grid; the
     renderer's frozen contract on `LoadedAtlas` precludes the
     loader from ever producing one. Documented in
     `vitest.config.ts:86-92` as the Phase 5 deviation per the
     prompt's operating rules. Acceptable.
   - `test:e2e`: not exercised in-sandbox (Playwright browser
     binaries absent). The new tests are visible in
     `tests/e2e/diagnostic.spec.ts:226-313`; spec file structure
     is well-formed. Phase 5.B will execute on the live deploy.

## Test adequacy

Satisfies the QUALITY_GATES.md testing gate. Every new public
function and frozen-contract pin has at least one
regression-failing test:

- **`drawScene` regression coverage** (`tests/render/canvas.test.ts:186-325`):
  - `does not throw on a valid RunState` (`:187-195`) — primary
    path.
  - `sets canvas dimensions to floor.width × TILE_SIZE and
    floor.height × TILE_SIZE` (`:197-208`) — pins the
    `canvas.width = floor.width * TILE_SIZE` arithmetic
    (`canvas.ts:140`); a regression to off-by-one or to
    `floor.width * (TILE_SIZE + TILE_PADDING)` (the wrong
    constant) would fail.
  - `disables image smoothing for nearest-neighbor blits`
    (`:210-219`) — pins `imageSmoothingEnabled = false` at
    `canvas.ts:147`.
  - `emits at least one drawImage call for the player` (`:221-236`)
    — pins the player blit's destination as
    `(player.x*TILE_SIZE, player.y*TILE_SIZE)` per `canvas.ts:221-224`.
  - `emits a drawImage call for every non-void tile in the floor
    grid` (`:238-254`) — pins the per-tile loop coverage at
    `canvas.ts:154-172`.
  - `does not throw on tile codes outside {0,1,2,3}` (`:258-280`)
    — pins the `tileCodeToSlot(99) === null` defensive path at
    `canvas.ts:88-95`.
  - `throws if the canvas 2d context is unavailable` (`:298-310`)
    — pins the `getContext("2d")===null` throw at `canvas.ts:144-146`.
  - `throws if the manifest is missing a required slot` (`:312-324`)
    — pins the `spritePixelCoord` "missing required slot" throw
    at `canvas.ts:108-113` with a regex on /player/.

- **Read-only contract coverage** (`tests/render/render-readonly.test.ts:100-137`):
  - Two tests against deeply-frozen real harness output — the
    load-bearing architectural pin per `docs/ARCHITECTURE.md:715-717`.
    Any future renderer mutation of `state.<...>` or
    `atlas.manifest.<...>` would throw a `TypeError` in V8 strict
    mode and fail these tests.

- **Keyboard regression coverage** (`tests/input/keyboard.test.ts:56-309`):
  - Every default binding has its own test (`:57-145`) covering
    8-direction `move dir 0..7`, `wait` for Space + Period (no
    shift), `descend` for Period+shift, and the `>`/`Greater`
    fallback. Unknown-key returns null is asserted at `:143-145`.
  - `startKeyboard` listener wiring covered: `addEventListener`
    fires on recognized events (`:172-186`), unrecognized events
    don't invoke onAction (`:188-198`), `stop()` removes the
    listener (`:200-210`), `preventDefault` is called on
    recognized events (`:212-231`).
  - Custom-bindings coverage at `:234-253` confirms the bindings
    map is plain configuration (no schema dependency).
  - Fallback-target coverage at `:255-309` includes both the
    "no window, no target → throw" and "use globalThis.window
    when no target supplied" paths, exercising
    `keyboard.ts:150-157` exhaustively.

- **HUD regression coverage** (`tests/ui/hud.test.ts:43-116`):
  - Visible-fields test (`:43-54`) checks the rendered text
    contains hp/hpMax/floorN/outcome/fingerprint values.
  - DOM-shape test (`:56-63`) confirms `data-hud-field='hp'`,
    `'floor'`, `'outcome'`, `'fingerprint'` selectors all resolve.
  - Idempotence test (`:67-84`) re-renders three times and
    asserts both the children-count is unchanged and the same
    DOM node is reused (preventing the leak-on-re-render
    regression that motivates the `data-hud-field` selector
    pattern in `hud.ts:42-52`).
  - Read-only test (`:88-104`) snapshots state before and after
    `renderHud`, asserting no mutation.
  - Outcome-change test (`:108-115`) confirms the outcome field
    updates when `state.outcome` changes from "running" to "dead".

The 41 new test cases cover every `if` branch in the three new
modules except the deliberately-uncovered defensive paths
(`spritePixelCoord` out-of-range, sufficiently documented in the
v8-coverage exclusion list).

## DRY-gate / drift-detection-gate

**DRY:** No new logic duplication. The `decodeAtlasImage` helper
in `src/main.ts:604-622` is structurally similar to the
atlas-preview's `drawPngToCanvas` (`:371-399`), but the differences
are load-bearing: `decodeAtlasImage` returns the `HTMLImageElement`
itself (so the renderer's `ctx.drawImage(target.atlasImage, ...)`
can re-use it across frames), while `drawPngToCanvas` paints into
a canvas and discards the image. Both use the Blob+ObjectURL
pattern but for different downstream purposes. The atlas-preview's
`drawPngToCanvas` revokes the ObjectURL eagerly (`:390/394`),
while `decodeAtlasImage` deliberately leaks the URL with an inline
comment at `:611-613` explaining the WebKit race that motivated
the leak. Different lifetime requirements; the duplication is
defensible and explained.

The `tile.floor.cyberfloor_01` / `tile.wall.cyberfloor_01` /
`tile.door.cyberdoor` / `player` / `monster.ice.daemon` / `item.cred-chip`
slot strings appear both in `src/render/canvas.ts:82-86` (as
`SLOT_*` constants) and in `src/registries/atlas-recipes.ts` (as
the recipe registry's slot ids). The names are forced equal by
the `spritePixelCoord` lookup throwing on missing slot
(`canvas.ts:108-113`) — the renderer fails fast if the registry
ever drops a slot it needs. A deliberate drift here would surface
as a unit-test failure in `tests/render/canvas.test.ts:312-324`
(`throws if the manifest is missing a required slot`). Acceptable.

**Drift:** the `__pendingFloorEntry` orchestration in
`src/main.ts:577-581` mirrors the harness loop at
`src/sim/harness.ts:80-95` (verified by inspection). The harness
is the canonical source for the floor-entry block (`generateFloor`
+ `spawnFloorEntities` + `applyFloorEntry`); duplicating that
sequence in `startGame` rather than calling into the harness is
defensible — the harness consumes a pre-baked action log, while
the playable game consumes one Action at a time. A future
refactor could extract the floor-entry block into a shared
`src/run/` orchestration module (the deferred Phase 5 contract
at `docs/ARCHITECTURE.md:786-789` flags this exact migration);
not blocking.

The recipe-ID regex drift documented as suggestion 3 of the 4.A.2
review (`docs/ARCHITECTURE.md:465` vs `decision-memo-phase-4.md:330`
vs `src/registries/atlas-recipes.ts:54-55`) is unchanged in 5.A.2
— neither the brief nor the phase implementation touched recipe
IDs. Carries forward to a future phase.

## Non-blocking suggestions

1. **`fillStyle = "#000"` in `drawScene` is a hidden constant.**
   `src/render/canvas.ts:150` sets `ctx.fillStyle = "#000"` to
   clear the canvas before drawing. This is a one-off color
   literal with no named constant or configuration. The semantic
   intent ("background void color") would be clearer as
   `const RENDER_BACKGROUND_COLOR = "#000"` at module top — same
   pattern as the existing `SLOT_TILE_FLOOR` etc. constants at
   `:82-86`. Cosmetic; would catch a future regression where
   someone changes the tile palette and forgets the canvas
   background needs the same shift.

2. **`tests/ui/fake-dom.ts` is a 151-line custom DOM stub.** The
   stub correctly handles the surface `src/ui/hud.ts` exercises
   (`createElement`, `appendChild`, `classList.add`, `dataset`,
   `textContent`, `innerHTML`, attribute-selector `querySelector`).
   The implementation is minimal and well-scoped; the comment at
   `:7-11` correctly identifies that adding `jsdom` / `happy-dom`
   as a real devDep is out of Phase 5.A.2 scope and that browser
   verification flows through Playwright on the live deploy. This
   is acceptable for one consumer; if Phase 6+ adds a second UI
   widget (inventory screen, equipment screen, etc.) that touches
   features the stub does not implement (e.g., `removeChild`,
   `replaceChild`, event dispatch, computed-style queries), the
   stub will sprawl and `happy-dom` becomes the right answer.
   Track this as a Phase-6 decision point.

3. **`Direction` cast in `DEFAULT_KEY_BINDINGS`.** `src/input/keyboard.ts:65-80`
   uses `0 as Direction`, `1 as Direction`, ..., `7 as Direction`
   for the eight movement bindings. The `Direction` type from
   `src/core/encode` is the union `0|1|2|3|4|5|6|7` (per Phase 1's
   action-encoding contract); the inline cast is required because
   `Object.freeze(...)` widens to `Record<string, ActionTemplate>`,
   which loses the literal-number type. A small helper
   `function moveAction(dir: Direction): Action { return {type:
   "move", dir}; }` would let the bindings table read as
   `ArrowUp: moveAction(0), ...` without the cast. Cosmetic; the
   current shape is type-safe (the cast widens, but the
   `keyEventToAction` path round-trips through the Phase 1
   `Action` schema).

## Atlas-loader integration soundness

Confirmed sound. The four loader refusal paths are wired into
`startGame`:
- `PLACEHOLDER_RULESET_VERSION` refusal (loader.ts:26-27,
  asserted at `:59-60` via the `PLACEHOLDER_REFUSAL_MESSAGE`
  comparison) → caught at `src/main.ts:517-523`, surfaces
  `__GAME_READY__ = "error"`.
- `__ATLAS_MISSING__` refusal (`loader.ts:29-30`, asserted at
  `:62-63`) → same error path.
- Hash-mismatch refusal (`loader.ts:67-68` with the pinned
  `atlas.png hash mismatch — got X, expected Y (rebuild required)`
  message) → same error path.
- `<img>` decode failure (no atlas-loader path; this is a
  Blob+Image-decode failure surfaced via `decodeAtlasImage`'s
  `reject` at `src/main.ts:617-619`) → caught at `:531-537`.

The `await loadAtlas(import.meta.env.BASE_URL + "assets")` call
at `:516` uses the same `BASE_URL` prefix as the atlas-preview
fetch at `:446`, so the GH-Pages-shaped `base: '/icefall/'`
deployment serves both UIs consistently. The default `env`
parameter resolves to `buildLoaderEnv()` from `src/atlas/loader.ts:81-87`,
which reads the Vite-injected `__ATLAS_BINARY_HASH__` /
`__ATLAS_MISSING__` / `__RULESET_VERSION__` per the Phase 4
atomic-flip contract. There is no silent fallback that lets the
game run with a stale atlas; the `return` at `:522` short-circuits
all subsequent setup.

## Lint rule scoping audit

Per the prompt's "extra attention" focus on the layer table:

| Layer | Bans | `eslint.config.js` lines |
|---|---|---|
| `src/render/**` | `**/core/streams`, `**/sim/combat`, `**/sim/turn`, `**/sim/run`, `**/sim/harness`, `**/sim/ai`, `**/mapgen/generate`, `**/input/**`, `**/main` | 162-211 |
| `src/input/**` | `**/core/streams`, `**/sim/combat`, `**/sim/turn`, `**/sim/run`, `**/sim/harness`, `**/sim/ai`, `**/mapgen/**`, `**/render/**`, `**/main` | 213-262 |
| `src/ui/**` | `**/core/streams`, `**/sim/combat`, `**/sim/turn`, `**/sim/run`, `**/sim/harness`, `**/sim/ai`, `**/mapgen/**`, `**/render/**`, `**/input/**`, `**/main` | 264-312 |

All three layers also pick up: `no-restricted-syntax` for the
forbidden-time selectors (`Math.random`, `Date.now`,
`performance.now`, `new Date()`); `no-restricted-globals` for
`Date` and `performance`; `determinism/no-float-arithmetic` via
the determinism plugin (paired override blocks at `:198-211`,
`:255-262`, `:305-312`). The test-scope ignore at `:571-577`
correctly disables the time/iteration bans for `**/*.test.ts` /
`tests/**/*.ts` so test fixtures can construct deliberately-bad
inputs.

The `**/sim/harness` ban for `src/render/**` is technically over-broad
relative to `docs/ARCHITECTURE.md:774` (which lists `src/sim/turn.ts,
src/sim/run.ts` as the forbidden write paths), but it is correct in
spirit — the harness is a sim-write surface and should not be a
renderer dependency. `**/sim/ai` similarly. No false-positive
surface (the renderer never had a reason to import either).

## Coverage gate audit

Per the prompt's "extra attention" on coverage thresholds:

| Layer | lines | branches | functions | statements |
|---|---|---|---|---|
| `src/atlas/**` | 100 | 100 | 100 | 100 |
| `src/core/**` | 100 | 90 | 100 | 100 |
| `src/mapgen/**` | 100 | 85 | 100 | 100 |
| `src/registries/**` | 100 | 85 | 100 | 100 |
| `src/sim/**` | 95 | 85 | 100 | 95 |
| **`src/render/**`** | **95** | **85** | **100** | **95** |
| **`src/input/**`** | **95** | **85** | **100** | **95** |
| **`src/ui/**`** | **95** | **85** | **100** | **95** |

The new render/input/ui thresholds at `vitest.config.ts:93-110`
are correctly set at 95/85/100/95 (not 100/100/100/100, which
would fail given the documented 96.61/93.33 actual on
`src/render/**`). The deviation is documented inline at
`vitest.config.ts:86-92` and explicitly cites "the documented
Phase 5 deviation: 'defensive paths can be uncovered'" from the
phase prompt. The `src/sim/**` precedent at `:80-85` already
established the 95/85 pattern in Phase 3.A.2 with the same
defensive-path rationale; render/input/ui follow the same shape.
Acceptable.

## Files reviewed

Production:
- `src/render/canvas.ts` (226 lines, new)
- `src/input/keyboard.ts` (171 lines, new)
- `src/ui/hud.ts` (87 lines, new)
- `src/main.ts` (modified — 651 lines total, +262 net; the
  diagnostic surface preserved verbatim under
  `<details id="diagnostics" open>`, and `startGame()` added
  alongside)

Tests:
- `tests/render/canvas.test.ts` (325 lines, 9 tests)
- `tests/render/render-readonly.test.ts` (137 lines, 2 tests)
- `tests/input/keyboard.test.ts` (309 lines, 24 tests)
- `tests/ui/hud.test.ts` (116 lines, 6 tests)
- `tests/ui/fake-dom.ts` (151 lines, support file — not a test)
- `tests/e2e/diagnostic.spec.ts` (modified — added 4
  playable-game tests at `:226-313`, no breaking changes to the
  existing 14 tests)

Configuration:
- `eslint.config.js` (modified — three new layer-scoped override
  blocks at `:152-312` adding bans for `src/render/**`,
  `src/input/**`, `src/ui/**` plus paired
  `determinism/no-float-arithmetic` plugin scopes)
- `vitest.config.ts` (modified — added the three new layers to
  `coverage.include` / `exclude` and to `thresholds` at 95/85/100/95)
- `style.css` (modified — added `.game`, `.game-canvas`,
  `.game-hud`, `.hud-field`, `#diagnostics` rules at `:216-314`)

Docs (read for cross-reference):
- `docs/PHASES.md:336-342` (Phase 5.A.2 acceptance criteria)
- `docs/ARCHITECTURE.md:694-796` (Phase 5 frozen contracts —
  layer table at `:772-776`, lint rule inventory at `:824-825`)
- `docs/QUALITY_GATES.md` (universal gate, testing gate, DRY
  gate, drift-detection gate)
- `artifacts/code-review-phase-4-A-2.md` (format precedent,
  zero blockers + 8 cosmetic suggestions on a comparable surface)
- `artifacts/code-review-phase-5-A-1.md` (5.A.1 carry-forwards
  and the verification-points format)

Phase 5.A.2 is ready for approval. Phase 5.B (live-deploy +
cross-runtime verification) is the next phase.
