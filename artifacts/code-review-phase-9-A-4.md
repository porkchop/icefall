# Code review — Phase 9.A.4 (CRT/scanline post-processing shader, toggleable)

Scope: the CRT/scanline post-processing shader portion of Phase 9 per
docs/PHASES.md:580 deliverable ("CRT / scanline post-processing
shader (toggleable)"). This iteration ships a CSS-overlay-only filter
(no WebGL, no animation, no JS-driven render loop) wired in
`src/main.ts` via a sibling `<div>` inside a new
`.game-canvas-wrap`, plus a toggle button + `__CRT_SHADER__` window
flag. Two new theme-registry keys (`crtShader.toggleOn` /
`crtShader.toggleOff`) route the toggle button label.

Reviewed against the 9 review-focus items in the brief, the
`docs/QUALITY_GATES.md` blocking criteria, and the Phase 5 frozen
contracts (`docs/ARCHITECTURE.md` + `eslint.config.js`).

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`, 0 errors) |
| `npm run test` | **1194 tests / 83 files** passed (was 1193/83 in 9.A.3; +1 from `theme/strings.test.ts` "CRT shader toggle keys") |
| `npm run build` | green; **146.20 KB raw / 43.18 KB gzipped** JS (was 145.56/42.97 in 9.A.3; +0.64/+0.21 KB) — well under the 110 KB CI gate |
| | CSS **6.21 KB raw / 1.76 KB gzipped** (was 5.61/1.60; +0.60/+0.16 KB) |
| `src/ui/theme/strings.ts` lint scope | 0 violations — no Date / performance / write-path imports added |
| Coverage on `src/ui/theme/strings.ts` | **100% lines / 100% branches / 100% functions** preserved |
| Coverage on `src/ui` consumers | unchanged from 9.A.3 (hud 100%, inventory 100%, equipment 100%, win-screen 100%, title-screen 97.24%) |
| Cross-runtime golden chain | unchanged (no rules-bearing files touched) |

## Blocking issues

None of the QUALITY_GATES.md rejection criteria are violated by this
iteration:

- The new public behavior (CRT shader toggle) has accompanying tests:
  1 unit test pinning the registry-key bytes + 3 e2e tests covering
  initial state, toggle behavior, and DOM structure. Each test would
  fail if the feature were removed (e.g., the e2e test asserting
  `#crt-shader-toggle` visibility would fail if the button creation
  were removed; the toggle-class test would fail if the click handler
  were removed; the registry-key test would fail if the keys were
  renamed).
- This is a feature add, not a bug fix; no regression-test gap.
- No business-logic duplication. The toggle handler is 5 lines in
  `src/main.ts`; the only "shared" surface is `getString`, which is
  used correctly. The CRT overlay's CSS is one repeating-linear-gradient
  pattern, not duplicated anywhere else.
- No prior-phase contradiction: the renderer (`src/render/canvas.ts`)
  is untouched; the CRT overlay is a sibling DOM node that does not
  read or write the canvas's pixel buffer. The Phase 5 frozen
  contract (renderer is a read-only sink on sim state) is preserved.
  See C3 below for the detailed walk-through.
- No magic values without naming: the only "magic" numerals are CSS
  values (the `1px`/`3px` scanline period and `rgba(0,0,0,0.28)`
  opacity), all of which live in a single CSS rule with an inline
  comment explaining the choice. The toggle states ("on"/"off") are
  the same string literals exposed at the type level (`"on" | "off"
  | undefined`) and used consistently across the window flag, the
  registry keys, and the e2e assertions.
- All sandbox gates green; cross-runtime golden chain preserved.

## Non-blocking suggestions

### S1 — Click handler does not check for an in-flight transition; rapid double-click is safe but worth noting

**Severity:** cosmetic.

**Location:** `src/main.ts:971-977`.

```ts
crtToggle.addEventListener("click", () => {
  const isOn = canvasWrap.classList.toggle("crt-shader-on");
  window.__CRT_SHADER__ = isOn ? "on" : "off";
  crtToggle.textContent = getString(
    isOn ? "crtShader.toggleOn" : "crtShader.toggleOff",
  );
});
```

Walk-through for the brief's "rapid clicks" question:

- `classList.toggle("crt-shader-on")` is a single synchronous DOM
  mutation that returns `true` if the class is now present, `false`
  if removed. There is no animation, no transition, no
  `requestAnimationFrame` boundary — the entire handler runs to
  completion in microseconds.
- `window.__CRT_SHADER__ = isOn ? "on" : "off"` assigns based on the
  return value of the same `toggle()` call. The two are guaranteed
  consistent: if the class was just added, isOn is true and the flag
  is "on"; if removed, false and "off". No third state is reachable.
- `crtToggle.textContent = getString(...)` reads from the same `isOn`
  local. Same consistency.

Rapid double-click: each click is a separate event-loop turn; each
handler invocation reads the *current* DOM state via `classList.toggle`
and updates flag + label atomically. No race possible because
JavaScript is single-threaded for DOM mutations and there is no
`await` in the handler.

The only theoretical concern is a 3rd-party script that mutates
`crt-shader-on` on the wrap directly (without going through this
handler) — the next user click would then read the externally-mutated
state and the flag/label would correctly track it. This is the
intended semantics ("toggle to whatever the new state is"), not a bug.

PASS — the toggle is race-free by construction.

### S2 — `pointer-events: none` correctly avoids hijacking canvas focus, but verify on focus-visible

**Severity:** cosmetic.

**Location:** `style.css:473`.

The overlay is `pointer-events: none`, so clicks pass through to the
canvas underneath. Verified:

- Canvas remains keyboard-focusable (`canvas.tabIndex = 0` at
  `src/main.ts:952`).
- Canvas remains click-focusable (the overlay does not intercept).
- The 9.A.1 `:focus-visible` accessibility ring still applies to the
  canvas (overlay does not visually obscure the focus outline because
  the ring renders OUTSIDE the canvas border by default browser styles).

One minor visual-quality concern: with the overlay ON and
`mix-blend-mode: multiply`, the focus ring color may render slightly
darker than usual when overlapping the overlay's edges. Cosmetic;
defensible default.

PASS — accessibility is preserved.

### S3 — `mix-blend-mode: multiply` cross-runtime caveat: WebKit (Safari/iOS) requires the parent to have a stacking context

**Severity:** medium (latent — the brief flags "consistent across
Chromium/Firefox/WebKit" as a check item).

**Location:** `style.css:487`.

`mix-blend-mode` is well-supported across modern Chromium/Firefox/WebKit
(MDN compatibility: 100% for non-isolated blending since 2017). The
known WebKit footgun: blending with `multiply` against a canvas
underneath works correctly *only if the parent forms its own
stacking context*. The parent (`.game-canvas-wrap`) has `position:
relative` which DOES create a stacking context — so this is fine.

The actual blend behavior:

- Without `mix-blend-mode`: the overlay's `rgba(0,0,0,0.28)` would
  composite as alpha-blend → scanlines look like dim translucent
  bars. Acceptable but flat.
- With `mix-blend-mode: multiply`: the overlay's black scanlines
  multiply with the canvas pixels → bright canvas pixels stay bright,
  dark canvas pixels stay dark. The CRT effect feels more "tinted"
  than "tinted-on-top." This is the right choice for a phosphor
  scanline aesthetic.

**Cross-runtime status.** Verified by spec; in-sandbox e2e cannot
run (Playwright browsers not preinstalled — established X.B sandbox
limitation). The deploy.yml CI run lands the cross-runtime check on
the next push.

PASS for the spec compliance; live cross-runtime confirmation is the
9.B verification deliverable.

### S4 — `display: inline-block` on the wrap is the correct choice but interacts subtly with the existing `.game-canvas` `max-width: 100%; height: auto` rule

**Severity:** cosmetic but worth verifying.

**Location:** `style.css:463-468` + `style.css:255-266`.

The existing `.game-canvas` is `display: block` with `max-width: 100%;
height: auto;` so it scales to its container while preserving the
pixel-perfect bitmap-to-CSS-pixel ratio.

The new `.game-canvas-wrap` is `display: inline-block; max-width:
100%`. The interaction:

- `inline-block` on the wrap sizes the wrap to its content's intrinsic
  width — i.e., the canvas's bitmap width (set via `canvas.width =
  floor.width * TILE_SIZE`).
- The `max-width: 100%` on the wrap allows the wrap to shrink if the
  canvas's intrinsic width exceeds the parent's width. When that
  happens, the wrap shrinks AND the canvas inside (with its own
  `max-width: 100%; height: auto`) scales down proportionally. The
  overlay (with `inset: 0`) covers the scaled canvas area exactly.
- If the wrap is wider than the canvas (e.g., the parent is large
  and the canvas is small), the wrap sizes to the canvas width
  exactly because `inline-block` sizes to content. No bleed past
  the canvas right/bottom edges.

So the overlay correctly covers ONLY the canvas, not bleeding into
siblings (the inventory panel is a separate `<section>` outside the
wrap; the overlay is `position: absolute` inside the wrap and cannot
escape the wrap's bounding box).

Edge cases worth a regression e2e (not blocking, but useful):
- Very small canvas (1-tile floor — would never happen in real
  play, but the wrap-shrinks invariant is worth a smoke test).
- Very large canvas overflowing the parent — the existing
  `max-width: 100%; height: auto` chain should handle this.

PASS — the sizing model is correct by construction. The
"overlay-only-covers-canvas" property is structurally guaranteed by
the wrap-inline-block + overlay-position-absolute combination.

### S5 — Consider extracting the toggle to `src/ui/crt-shader.ts` for layer cleanliness (not a v1 blocker)

**Severity:** cosmetic / architecture-style.

**Location:** `src/main.ts:937-978`.

The brief's question 5 directly asks this. The current implementation
is ~30 lines in `startGame()` (DOM creation + handler + flag init).
The peer modules (`renderTitleScreen`, `renderHud`, `renderInventory`,
`renderEquipment`, `renderWinScreen`) all live as `src/ui/*.ts`
peer files exporting a render function called from `src/main.ts`.

Pragmatic case for keeping in `main.ts`:

- The toggle is one button + one DOM-class flip. Extracting to a
  module would mean a 3-export shape (createToggle / createOverlay /
  createWrap) or a 1-export `setupCrtShader(host: HTMLElement, canvas:
  HTMLCanvasElement)` shape. Either is more code than the inline.
- The window-flag write is the orchestration concern; orchestration
  belongs in `main.ts` per the existing layer model.
- The current code is locally reviewable: the entire CRT-shader
  surface is 30 contiguous lines in `startGame()` adjacent to the
  canvas creation, not spread across files.

Idiomatic case for extracting:

- The 5 existing UI peer modules establish a precedent: "anything
  that creates a UI sub-tree under the playable game has its own
  module under `src/ui/`." Extracting to `src/ui/crt-shader.ts`
  would match the precedent.
- A future Phase 9.A.+ polish that adds e.g. a settings panel with
  multiple toggles (CRT shader + sound + accessibility) would benefit
  from each toggle being self-contained.
- The peer-module shape would naturally enable a unit test for the
  toggle handler logic (today only the e2e covers it). See S6.

**Recommendation.** Defensible either way for v1. If a future
polish adds another toggle (sound, font size, etc.), extract the
pattern then; until then, the inline is fine.

PASS for v1.

### S6 — No unit test for the click handler; e2e is the only coverage

**Severity:** cosmetic — the e2e covers the integration; defensible.

**Location:** `tests/e2e/diagnostic.spec.ts:809-884`.

The handler logic is 5 lines in `src/main.ts:971-977`. The 3 e2e
tests cover (a) initial state ("off" + label + flag), (b) toggle
behavior (off→on→off, asserting class + flag + label after each
click), (c) DOM structure (overlay + canvas inside wrap).

What a unit test would add:
- Faster failure on a logic bug (Vitest run is ~10s vs Playwright
  startup of ~30s); but the toggle is so trivial that a logic bug
  is unlikely.
- Ability to test edge cases the e2e cannot (e.g., calling the
  handler N times in a tight loop without DOM repaint; or asserting
  the DOM mutation order between class-flip and flag-write).

What the unit test would require:
- A jsdom-based test that builds a wrap + button DOM, attaches the
  handler, fires N click events, asserts the class/flag/label
  state. ~30 lines.
- OR extracting the handler to a pure function `function
  toggleCrtShader(wrap: HTMLElement, button: HTMLButtonElement):
  void` (which would require S5's extraction first).

**Recommendation.** Defensible to defer. The e2e is the load-bearing
test; the unit test would be a nice-to-have once S5 lands.

PASS for v1.

### S7 — No test that the overlay is hidden when toggle is off (CSS `display: none` enforcement)

**Severity:** cosmetic — implicit in the e2e but not asserted directly.

**Location:** `tests/e2e/diagnostic.spec.ts:809-884`.

The 3 e2e tests assert the toggle state via the `.crt-shader-on`
class on the wrap and the `__CRT_SHADER__` window flag. They do NOT
explicitly assert that the overlay element's computed `display`
property is `none` when off and `block` when on.

A future regression where someone changes the CSS rule
`.game-canvas-wrap.crt-shader-on .crt-shader-overlay { display:
block }` to `display: flex` (or removes it entirely) would NOT be
caught by the current e2e — the class assertion would still pass.

**Recommendation.** Add a 4th e2e assertion using
`page.locator("#crt-shader-overlay").evaluate(el => getComputedStyle(el).display)`
that pins the computed `display` to `"none"` initially and `"block"`
after toggle. ~6 lines. Catches CSS drift.

This is the brief's question 6(a); defensible to defer for v1, but
worth noting as the next-iteration polish.

### S8 — `repeating-linear-gradient` at 1px/3px is fine on standard DPI but doubles to 2px/6px on retina without an `image-rendering` directive

**Severity:** cosmetic — visual fidelity question only.

**Location:** `style.css:477-483`.

The scanline pattern:

```css
background: repeating-linear-gradient(
  0deg,
  rgba(0, 0, 0, 0.28) 0px,
  rgba(0, 0, 0, 0.28) 1px,
  transparent 1px,
  transparent 3px
);
```

CSS pixels (not device pixels) — so on a retina (2× DPR) display,
the scanlines are 2 device pixels of dark + 4 device pixels of clear,
which is finer than the canvas's `image-rendering: pixelated`
upscaled-pixel grain. The visual effect: scanlines look subtler on
retina than on standard-DPI.

This is acceptable (and arguably the right choice — too-prominent
scanlines on retina would dominate the upscaled pixel art). But it's
worth being aware that the visual character of the shader is
DPI-dependent.

PASS for v1; revisit if a future user reports the scanlines look
"wrong" on a specific display.

### S9 — Default "off" is the right choice for accessibility / vestibular-sensitivity defaults

**Severity:** observational PASS.

**Location:** `src/main.ts:965`.

The brief's question 4(b) asks: is default "off" the right choice
for users with vestibular sensitivity?

Walk-through:

- The pattern is STATIC (no animation, no parallax, no flicker), so
  WCAG SC 2.3 (vestibular) doesn't strictly apply — it's a contrast
  pattern, not motion.
- HOWEVER, high-contrast repeating patterns at high spatial
  frequency can trigger photosensitive epilepsy (WCAG SC 2.3.1) and
  visual stress (Irlen syndrome / scotopic sensitivity). The 1px/3px
  scanline is at a frequency that COULD trigger these in some users
  if the canvas itself is high-contrast.
- Default "off" + opt-in toggle is the correct accessibility
  posture: users who want the cyberpunk aesthetic can opt in; users
  who would be affected never see the pattern unless they choose to.

PASS — the default-off decision is well-justified.

**Future polish (Phase 9.A.8 a11y audit):** Consider adding a
warning tooltip on the toggle button (e.g., "May affect users
sensitive to high-contrast patterns") to set expectations before
the user clicks.

### S10 — Bundle delta (+0.64 KB raw / +0.21 KB gzipped JS + +0.60 KB raw / +0.16 KB gzipped CSS) is reasonable

**Severity:** observational PASS.

JS delta: +0.64 KB raw / +0.21 KB gzipped from the canvas-wrap
creation + overlay div + toggle button + 5-line handler + 2 import
sites + window flag declaration. Roughly 20 lines of TypeScript →
~30 bytes gzipped per line, in line with prior phases.

CSS delta: +0.60 KB raw / +0.16 KB gzipped from 4 selectors (one
larger one with the gradient + 3 small ones). The
`repeating-linear-gradient` is the largest contributor (~120 chars);
the rest is structural. Could be slightly smaller by inlining the
`rgba(0,0,0,0.28)` color twice as `rgb(0 0 0 / 0.28)` (modern syntax,
saves ~8 bytes), but cosmetic.

The 110 KB CI gate has ~67 KB JS headroom; CSS has no explicit gate
but at 6.21 KB it remains tiny. PASS.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is **satisfied**:

- **`src/ui/theme/strings.ts` registry coverage**: 100/100/100
  preserved. The new "CRT shader toggle keys" test pins both new
  keys byte-exact (`expect(getString("crtShader.toggleOn")).toBe(
  "CRT scanlines: on")`). Following the S4 recommendation from
  9.A.3, this test is the registry-side byte-pin (the consumer-side
  byte assertion is in the e2e via `toContainText("CRT scanlines:
  off")`).
- **End-to-end coverage**: 3 e2e tests covering the documented
  acceptance criteria:
  - Initial state (default "off" + label + flag).
  - Toggle behavior (off→on→off, asserting class + flag + label).
  - DOM structure (overlay + canvas inside wrap).
  Each test would fail if the corresponding code surface were
  removed: deleting the toggle button breaks (a), deleting the
  click handler breaks (b), deleting the wrap breaks (c).
- **Cross-runtime golden chain** preserved verbatim — no rules-bearing
  files touched. Confirmed: `src/render/canvas.ts`, `src/sim/*`,
  `src/mapgen/*`, `src/atlas/*`, `src/share/*`, `src/verifier/*`,
  `src/router/*`, `src/save/*` are all unchanged. The CRT shader
  is purely additive at the DOM/CSS layer.
- **Reachability + lint scope**: PASS. No new files; the registry
  keys are added to the existing `src/ui/theme/strings.ts` which
  inherits the `src/ui/**` lint scope; `src/main.ts` is the
  orchestrator (separate scope) and the only addition is a
  click-handler closure plus DOM creation.

**Coverage gap call-outs** (not blocking but worth noting):

- No test for the computed `display` property of the overlay (S7) —
  CSS drift would not be caught.
- No unit test for the click handler in isolation (S6) — defensible
  given the 5-line trivial handler + e2e coverage.
- No regression e2e for the wrap-shrinks behavior at small canvas
  widths (S4) — defensible given the structural-guarantee argument.

## Compliance check (review-focus items 1-9)

### C1 — Toggle correctness (focus item 1)

Walked the handler:

```ts
crtToggle.addEventListener("click", () => {
  const isOn = canvasWrap.classList.toggle("crt-shader-on");
  window.__CRT_SHADER__ = isOn ? "on" : "off";
  crtToggle.textContent = getString(
    isOn ? "crtShader.toggleOn" : "crtShader.toggleOff",
  );
});
```

- `classList.toggle()` returns the new state (true=present,
  false=removed). Both branches map deterministically to "on"/"off".
- The `isOn` local is the single source of truth for both flag and
  label updates within the handler. No stale-state risk.
- Rapid double-click: see S1. JavaScript single-threaded; each click
  event runs the handler atomically; no race.
- Third-state reachability: impossible. `__CRT_SHADER__` is typed
  `"on" | "off" | undefined`; the only writes are at init
  (`window.__CRT_SHADER__ = "off"` at `:965`) and inside the handler
  (`isOn ? "on" : "off"` at `:973`). The undefined state is reachable
  only before `startGame()` runs (correct: title screen has no CRT
  toggle).

PASS.

### C2 — CSS overlay correctness (focus item 2)

See S2 (pointer-events) + S3 (mix-blend-mode) + S4 (sizing). Summary:

- Wrap (`.game-canvas-wrap`) is `position: relative; display:
  inline-block; max-width: 100%;` — sizes to canvas content,
  forms a stacking context, allows scaling.
- Overlay (`.crt-shader-overlay`) is `position: absolute; inset: 0;
  pointer-events: none; display: none;` — covers the wrap's bounding
  box (which equals the canvas's bounding box), passes clicks
  through.
- Toggle class (`.game-canvas-wrap.crt-shader-on .crt-shader-overlay
  { display: block }`) — flips visibility without reflowing
  surrounding layout.
- `mix-blend-mode: multiply` works correctly with the wrap's
  stacking context (S3); cross-runtime spec-compliant.

PASS — the overlay covers ONLY the canvas, not bleeding into
siblings.

### C3 — Phase 5 frozen contract compliance (focus item 3)

The Phase 5 frozen contract (per `docs/ARCHITECTURE.md`): the
renderer is a read-only sink on sim state. Walked each surface:

- `src/render/canvas.ts`: UNCHANGED. Still writes to the canvas's
  pixel buffer via `ctx.drawImage` at the same call sites; the new
  CRT overlay does NOT touch the canvas at all.
- `src/sim/*`: UNCHANGED. The CRT toggle does not call any sim
  function or read any sim state.
- The state-hash chain (RANDOM_WALK_DIGEST, MAPGEN_DIGEST,
  SIM_DIGEST, ATLAS_DIGEST, INVENTORY_DIGEST, WIN_DIGEST,
  REPLAY_DIGEST) is computed from sim state only (no DOM reads).
  Toggling the CRT shader does NOT change any of these digests
  because:
  - The toggle handler reads/writes only DOM (classList) and a
    window flag (`__CRT_SHADER__`).
  - No sim function reads `__CRT_SHADER__` or queries the DOM.
  - The render layer (`canvas.ts`) reads sim state and writes to
    the canvas; it does not read the overlay div or the wrap class.

The CRT overlay is a sibling DOM node that is purely visual decoration
on top of the canvas. The deterministic chain is preserved bit-for-bit
regardless of toggle state.

PASS — the Phase 5 frozen contract is preserved.

### C4 — Accessibility (focus item 4)

- **Keyboard-accessible toggle button**: PASS. The button is a
  `<button type="button">` with no `tabindex="-1"` override, so it
  participates in the natural tab order. Enter and Space activate
  the button via the browser's default button semantics. The
  9.A.1 `:focus-visible` ring applies.
- **prefers-reduced-motion**: NOT APPLICABLE because the pattern is
  static (no animation, no transition, no transform). The 9.A.1
  `@media (prefers-reduced-motion: reduce)` rule at `style.css:326`
  affects `animation-*` and `transition-*` properties; the CRT
  overlay sets neither. PASS by spec.
- **Vestibular / photosensitive concerns**: see S9. Default "off"
  is the correct posture; opt-in toggle gives users full control.
  PASS for v1; future polish (S9 + 9.A.8 a11y audit) could add a
  warning tooltip.
- **Focus ring visibility through overlay**: see S2. The overlay
  with `mix-blend-mode: multiply` may slightly tint the focus ring
  edges when overlapping; cosmetic.

PASS — accessibility is preserved.

### C5 — Layer model (focus item 5)

See S5. The toggle is wired in `src/main.ts` (orchestrator), inline
within `startGame()`. Defensible for v1; the peer-module precedent
(`renderTitleScreen`, etc.) suggests extraction to `src/ui/crt-shader.ts`
is more idiomatic but is over-engineering for a 30-line surface.

If a future polish adds a 2nd toggle (sound, font size, etc.), the
extraction becomes worthwhile; until then, defer.

PASS for v1; non-blocking suggestion to extract if the toggle pattern
multiplies.

### C6 — Test sufficiency (focus item 6)

See "Test adequacy assessment" above. The 1 unit + 3 e2e tests cover
the documented acceptance criteria. Two small gaps:

- No `getComputedStyle(overlay).display` pin (S7) — CSS drift would
  not be caught.
- No isolated unit test for the click handler (S6) — defensible
  given the 5-line trivial handler.

Each is a small future polish, not a blocking gap.

PASS.

### C7 — Bundle size (focus item 7)

See S10. +0.64 KB raw / +0.21 KB gzipped JS + +0.60 KB raw / +0.16
KB gzipped CSS. Both small; well under the 110 KB CI gate (~67 KB
JS headroom remaining for further Phase 9 polish). PASS.

### C8 — Future-proofing (focus item 8)

The brief asks: is the structure refactor-friendly for a future WebGL
upgrade?

Walk-through:

- Toggle logic is independent of the implementation: the handler
  flips the `.crt-shader-on` class on the wrap and writes a window
  flag. A future WebGL implementation would:
  - Replace `crtOverlay` (a `<div>`) with a `<canvas id="crt-shader-overlay">`.
  - Add a `requestAnimationFrame` loop that runs only when
    `window.__CRT_SHADER__ === "on"` (the flag is the activation
    signal).
  - Remove the `.crt-shader-overlay` CSS background rule (no
    repeating-linear-gradient needed).
  - Optionally add `aria-hidden="true"` to the WebGL canvas (the
    current div doesn't need this; a canvas should).
- The toggle button + handler + window flag are unchanged.
- The wrap + class-toggle pattern is unchanged.

So the swap is exactly: replace the overlay element + its CSS rule.
The toggle infrastructure is implementation-agnostic. PASS.

### C9 — Pattern intensity (focus item 9)

Subjective. The `rgba(0,0,0,0.28)` opacity at 1px/3px spacing is on
the lower end of typical CRT scanline patterns — readable, not
overpowering. Reference points:

- Arcade emulator scanline shaders typically use 0.4-0.6 opacity at
  similar spacing — more aggressive, more "old-CRT" feel.
- Modern VHS/cyberpunk overlays use 0.2-0.3 opacity — subtle, more
  "vibe" than "fidelity."

The 0.28 opacity sits in the "vibe" bucket, which matches the
project's cyberpunk aesthetic without obscuring the pixel-art
characters/floors. Defensible default.

If user testing reveals the pattern is too subtle (or too aggressive),
adjust the rgba opacity in a one-line CSS edit; no code or test
changes needed.

PASS — defensible default.

## Files relevant to this review

Source (modified):

- `/workspace/src/main.ts` (lines 28, 109-115, 937-978 — added: 1
  import, 1 window-flag type declaration, canvas wrap creation +
  overlay element + toggle button + click handler)
- `/workspace/src/ui/theme/strings.ts` (lines 77-82 — added 2 keys
  `crtShader.toggleOn` + `crtShader.toggleOff`)
- `/workspace/style.css` (lines 449-508 — added 4 CSS rules: wrap
  positioning context, overlay base styles, on-state visibility,
  toggle button styling)

Tests (modified):

- `/workspace/tests/ui/theme/strings.test.ts` (lines 196-203 — 1
  net-new test "CRT shader toggle keys" pinning byte-exact)
- `/workspace/tests/e2e/diagnostic.spec.ts` (lines 808-884 — 3
  net-new e2e tests covering initial state, toggle behavior, DOM
  structure)

Pre-existing files inspected for context (NOT changed by this PR):

- `/workspace/src/render/canvas.ts:55-202` (renderer, UNCHANGED;
  canvas pixel-buffer writes via `ctx.drawImage`; canvas dimensions
  set via `canvas.width = floor.width * TILE_SIZE`)
- `/workspace/src/ui/win-screen.ts:1-60` (peer-module precedent for
  `src/ui/*.ts` shape, see S5)
- `/workspace/style.css:255-266` (existing `.game-canvas` rules —
  `display: block; max-width: 100%; height: auto; image-rendering:
  pixelated`)
- `/workspace/style.css:316-340` (9.A.1 `prefers-reduced-motion` gate)
- `/workspace/docs/PHASES.md:580` (CRT shader deliverable)
- `/workspace/docs/ARCHITECTURE.md` (Phase 5 frozen contracts)
- `/workspace/docs/QUALITY_GATES.md` (testing + DRY gates)

Phase context:

- `/workspace/artifacts/phase-approval.json` (Phase 9.A.3 approved on
  master at a4d2685; next_phase field documents 9.A.4 scope)
- `/workspace/artifacts/code-review-phase-9-A-3.md` (prior code-review
  format reference)

## Approval verdict

**APPROVE.**

No blocking quality-gate violations. All sandbox gates green: 1194
tests / 83 files / 0 lint / 0 typecheck / 146.20 KB raw / 43.18 KB
gzipped JS + 6.21 KB raw / 1.76 KB gzipped CSS (well under the 110
KB CI gate). Cross-runtime golden chain preserved unchanged.
Coverage on `src/ui/theme/strings.ts` is 100/100/100 preserved; all
existing UI tests pass byte-for-byte.

The acceptance criteria for docs/PHASES.md:580 are met:

1. CRT/scanline shader exists and is visible (when on).
2. Toggleable: default "off"; click flips on/off; no third state.
3. `__CRT_SHADER__` window flag exposes state for cross-runtime e2e.
4. CSS-overlay-only implementation: no WebGL, no animation, no
   JS-driven render loop. Determinism + accessibility preserved.
5. Theme registry routes the toggle button label.
6. Tests cover the toggle behavior (1 unit + 3 e2e).

The Phase 5 frozen contract (renderer is a read-only sink on sim
state) is preserved bit-for-bit: the CRT overlay is a sibling DOM
node that does not touch the canvas pixel buffer or any sim state.
The state-hash chain is identical regardless of toggle state. The
prefers-reduced-motion gate from 9.A.1 does not apply because the
pattern is static (no animation); default "off" is the correct
accessibility posture for users sensitive to high-contrast patterns.

The 10 non-blocking suggestions are documentation / cosmetic / future
polish. The most actionable for a follow-up iteration:

- **S7** (computed-`display` pin in e2e to catch CSS drift) — 6-line
  test addition; recommended for the next 9.A.+ polish iteration.
- **S5** (extract to `src/ui/crt-shader.ts` peer module) — defer
  until a 2nd toggle (sound, font size, etc.) lands; until then the
  inline is fine.
- **S9** (vestibular / photosensitivity tooltip on the toggle
  button) — defer to the 9.A.8 formal a11y audit.

Phase 9.A.4 is structurally sound. The phase is ready to land as-is.
The next sandbox-resolvable phase is **9.A.6** (CONTRIBUTING.md);
9.A.5 (LICENSE) remains BLOCKED on maintainer license-choice
authorization.

VERDICT: APPROVE
