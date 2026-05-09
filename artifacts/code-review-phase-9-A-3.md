# Code review — Phase 9.A.3 (theme registry refactor)

Scope: the theme-registry refactor portion of Phase 9 per
docs/PHASES.md:591 acceptance criterion 3 ("All text rendered through
the theme registry (so a future theme mod can replace it)"). This
iteration ships a single `src/ui/theme/strings.ts` registry and routes
every UI-text constant in the five UI consumers (`title-screen`,
`hud`, `inventory`, `equipment`, `win-screen`) through
`getString(typedKey, params?)`. New tests live in
`tests/ui/theme/strings.test.ts`. No existing UI tests changed.

Reviewed against the 9 review-focus items in the brief, the
`docs/QUALITY_GATES.md` blocking criteria, and the Phase 5 frozen
contracts (`docs/ARCHITECTURE.md` + `eslint.config.js:266-315`).

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`, 0 errors) |
| `npm run test` | **1191 tests / 83 files** passed (was 1170/82 in 9.A.2; +21 / +1 from `theme/strings.test.ts`) |
| `npm run build` | green; **145.56 KB raw / 42.97 KB gzipped** (was 143.85/42.49 in 9.A.2; +1.71/+0.48 KB) — well under the 110 KB CI gate |
| `src/ui/theme/strings.ts` lint scope (`eslint.config.js:266-315`) | 0 violations — no Date / performance / write-path imports |
| Coverage on `src/ui/theme/strings.ts` | **100% lines / 100% branches / 100% functions** |
| Coverage on refactored consumers | unchanged from 9.A.2 (hud 100%, inventory 100%, equipment 100%, win-screen 100%, title-screen 97.24%) |
| Cross-runtime golden chain | unchanged (no rules-bearing files touched) |

## Blocking issues

None of the QUALITY_GATES.md rejection criteria are violated by this
iteration:

- New module + 21 net-new tests covering every public surface of the
  module (formatString, getString, STRING_KEYS) plus a per-consumer
  call-site contract test. Coverage 100/100/100.
- No bug-fix regression-test gap (this is a refactor, not a fix).
- No business-logic duplication: the substitution helper is
  intentionally NOT shared with `src/router/messages.ts:fillTemplate`
  (different syntax, `{token}` vs `<token>`, byte-distinguishable for
  the documented reason). See B1 below for one duplication concern.
- No prior-phase contradiction: the registry sits in `src/ui/theme/`
  inheriting the `src/ui/**` lint scope; the Phase 5 frozen contract
  is preserved (no Date / performance / float arithmetic).
- No magic values: all 29 keys are named string constants in a
  single typed `as const` record.
- All sandbox gates green; cross-runtime golden chain preserved.

## Non-blocking suggestions

### S1 — `formatString` has an iteration-order injection vector that becomes load-bearing the moment a mod-overlay is added

**Severity:** medium (latent — not currently reachable from any
in-tree call site, but the brief's mod-overlay seam exposes it).

**Location:** `src/ui/theme/strings.ts:99-108`.

```ts
export function formatString(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  let out = template;
  for (const key in params) {
    out = out.split(`{${key}}`).join(String(params[key]));
  }
  return out;
}
```

**Reproduction.** A param value containing a `{token}` substring that
matches a *later*-iterated param key gets re-substituted:

```ts
formatString("{itemNoun}", {
  itemNoun: "items {stackCount}",  // first in insertion order
  stackCount: 5,                   // later — substitutes the smuggled {stackCount}
});
// → "items 5"   (the smuggled token was expanded by the second iteration)
```

JS object iteration order is insertion order for string keys, so the
order in the call site determines whether the leak fires. With
`getString("inventory.countTemplate", { stackCount: 5, stackNoun:
"stacks", itemCount: 99, itemNoun: "items {stackCount}" })` the
result is `"5 stacks · 99 items {stackCount}"` (safe, because
stackCount runs first). With insertion order reversed it becomes
`"5 stacks · 99 items 5"` (unsafe — the embedded token gets expanded).

**Why this matters now.** No current caller passes a value containing
`{...}`. The consumer-side params are: (a) `{date}` from `main.ts`
(YYYY-MM-DD, no `{`); (b) `{stackCount, stackNoun, itemCount,
itemNoun}` from `inventory.ts`, where the noun forms come from the
registry itself and are simple words. So this is dormant.

**Why this matters for the documented mod-overlay seam.** The brief
says "future Phase 9 mod-loader work can replace the default by
binding a different theme at runtime." The moment a mod can override
`inventory.itemNounPlural` to `"items {stackCount}"` (or any value
that contains a future placeholder), the bug becomes live. Mods are
the explicit forward extension point of this whole phase — defending
the substitution helper against mod-supplied bytes is on the critical
path for 9.A.+ mod-loader work.

**Fix.** Single-pass substitution using a regex:

```ts
export function formatString(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => {
    return Object.prototype.hasOwnProperty.call(params, k)
      ? String(params[k as keyof typeof params])
      : m;
  });
}
```

A single pass over the template — each `{token}` is resolved once
against the original params; values can contain `{...}` substrings
without re-substitution. Preserves the "leave unfilled placeholders
intact" diagnostic property.

This is the same fix shape `src/router/messages.ts:fillTemplate`
should also receive (it has the identical bug, see B1 below).

### S2 — `STRING_KEYS` is **29** entries, not 28 (brief miscount)

**Location:** brief vs `src/ui/theme/strings.ts:30-76`.

The brief states "28 string keys" repeatedly. Actual count: 29
(title=11, hud=4, inventory=6, equipment=2, winScreen=6 — sum 29).
The discrepancy is in the brief, not the code; the registry is
internally consistent and the `STRING_KEYS.length` test
(`strings.test.ts:83-85`) only asserts `> 0`, not the exact count.

**Suggest** pinning `STRING_KEYS.length` to `29` in the test as a
shape-drift smoke detector — adding a key without the corresponding
test update would fail loudly. Two-line change.

### S3 — `getString` short-circuits when params is `{}` but `formatString` does not — minor inconsistency

**Location:** `src/ui/theme/strings.ts:119-128`.

```ts
export function getString(
  key: StringKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = DEFAULT_THEME[key];
  if (params === undefined || Object.keys(params).length === 0) {
    return template;
  }
  return formatString(template, params);
}
```

`getString` checks `Object.keys(params).length === 0` and avoids
calling `formatString` when there are no params. `formatString` itself
also handles the empty-params case correctly (the `for...in` loop
runs zero times). The short-circuit is a micro-optimization that
saves a single function call, but is asymmetric — `formatString` is
exposed publicly (it's exported and tested) and works fine on
empty-params, so the guard in `getString` is defensive rather than
load-bearing.

Cosmetic. Either remove the short-circuit (one less branch to test)
or document why it exists.

### S4 — Per-consumer call-site contract test only asserts `toBeTruthy()`, not byte-exactness

**Location:** `tests/ui/theme/strings.test.ts:118-174`.

The "call-site contract for each consumer module" tests assert
`expect(getString("title.heading")).toBeTruthy()` for each of the 29
keys. This pins that the key *exists* but not that its *value* is
the documented byte string. A future maintainer could change
`title.heading` from `"ICEFALL"` to `"Icefall"` and these tests
would still pass.

The byte-exactness pin is partially carried by the existing UI tests
(`tests/ui/win-screen.test.ts`, `tests/ui/inventory.test.ts`, etc.)
which assert literal `"ICEFALL"` / `"Run Complete"` / `"Inventory"`.
These hold as long as no one updates the existing tests in the same
PR as a registry change. The "byte-exact pin" tests at
`strings.test.ts:48-80` cover only 4 keys (`title.heading`,
`hud.hpLabel`, `winScreen.heading`, `title.footer`) — the other 25
are not byte-pinned at the registry layer.

**Suggest** either:
1. Replace each `toBeTruthy()` in the per-consumer block with a
   `toBe("<expected>")` assertion (29 lines of byte pins);
2. Or document the deliberate split — registry tests verify *shape*,
   consumer tests verify *bytes*. (Documenting works; if
   intentional, a one-paragraph comment at line 119 would clarify.)

This relates directly to the brief's question 9 — the "is the
double-pinning defense in depth or unnecessary brittleness?" tradeoff.
With the current split, the registry tests give you "this key exists"
and the consumer tests give you "this exact byte sequence renders" —
which is actually a clean separation of responsibility, NOT
unnecessary duplication. See C9 below.

### S5 — Mod-overlay future-readiness: current shape forces a wider refactor than the brief suggests

**Location:** `src/ui/theme/strings.ts:30-83`.

The brief asks: would a future `bindTheme(overrides: Partial<typeof
DEFAULT_THEME>)` work without breaking the typed `StringKey` union?

Walk-through:

- `DEFAULT_THEME` is declared `as const` with a module-private `const`
  binding. To add a runtime overlay, you would need either:
  - A mutable `let activeTheme = { ...DEFAULT_THEME }` that
    `bindTheme` reassigns — viable; the typed union derives from
    `keyof typeof DEFAULT_THEME` which is a *type-level* operation,
    so the runtime mutation doesn't affect the type. PASS.
  - Or a layered lookup function: `getString` checks
    `overrides[key] ?? DEFAULT_THEME[key]`. Also viable; the type
    `Partial<typeof DEFAULT_THEME>` is well-formed.
- The `StringKey` union is `keyof typeof DEFAULT_THEME`, NOT
  `keyof typeof activeTheme`. So `bindTheme` cannot *add* new keys
  beyond the default registry — only override existing ones. This is
  the correct seam for v1 (mods extend by overriding; new strings
  require a registry update).
- `STRING_KEYS` is frozen at module load (`Object.freeze(Object.keys(DEFAULT_THEME))`).
  Tests iterating `STRING_KEYS` would see the default-theme shape
  even after a mod runtime overlay — which is correct (the type
  contract is the default theme; the runtime mutable layer is just
  values).

Conclusion: the current shape is mod-overlay-ready. The 9.A.+
mod-loader work would add a `bindTheme` function and a layered
lookup, both 5-10 line additions; no consumer-side refactoring
required. PASS for the future-readiness gate.

**Caveat (S1 again):** mod-supplied template values are the threat
surface for the iteration-order injection. The mod-overlay design
should validate or sanitize incoming templates at the bind point.

### S6 — `src/main.ts` UI strings (Diagnostics page section headings + button labels) are NOT routed through the registry

**Location:** `src/main.ts:162` + `:272` + `:321` + `:377` + `:436` +
`:483` + `:636` + `:805` + `:817` (and likely more).

Spot-check found 9 hardcoded UI strings in `src/main.ts`:

```
162: summary.textContent = "Diagnostics (self-test, build info, floor preview, scripted playthrough, atlas preview)";
272: button.textContent = "Generate floor";
321: simButton.textContent = "Run scripted playthrough";
377: winButton.textContent = "Run winning replay";
436: atlasRegenButton.textContent = "Regenerate atlas";
483: atlasErrorDiv.textContent = "";
636: verifyButton.textContent = "Verify";
805: link.textContent = "[Open in pinned release]";
817: saveRefreshButton.textContent = "Refresh";
```

Per Phase 9.A.3 acceptance criterion "All text rendered through the
theme registry," the strict reading would flag these as a gap.

**Pragmatic interpretation (defensible).** `src/main.ts` is the
orchestrator that wires the four layers; the diagnostic page is
internal dev-tooling, not user-facing v1 polish. The registry's
section prefixes (`title.*`, `hud.*`, `inventory.*`, `equipment.*`,
`winScreen.*`) explicitly cover the user-facing surfaces. A future
phase that promotes the diagnostics page to a user-facing surface
(or that opens `main.ts`'s wiring strings to mod overrides) would
add `diagnostics.*` keys then.

**Suggest** documenting this pragmatic boundary explicitly — either
in the registry header comment ("v1 scope: title/hud/inventory/equipment/winScreen
surfaces; diagnostic page strings are dev-tooling and intentionally
out of scope") or in a Phase 9.A.3 decision memo. This forecloses
the "you said ALL text" critique on a future audit.

The acceptance criterion as worded does NOT distinguish user-facing
text from dev-tooling text; the pragmatic call is reasonable but
should be explicit. Non-blocking — a documentation polish, not a
code change.

### S7 — `formatString`'s "{a-zA-Z}" implicit token alphabet is not validated

**Location:** `src/ui/theme/strings.ts:99-108`.

The current `out.split(\`{${key}}\`).join(...)` accepts any string as
a key. So `formatString("{x.y}", { "x.y": "ok" })` works, as does
`formatString("{}", { "": "ok" })` or `formatString("{ }", { " ":
"ok" })`. The fix at S1 (regex `\{([a-zA-Z_][a-zA-Z0-9_]*)\}`)
implicitly restricts the token alphabet to identifier-shaped tokens —
which is what every current caller uses (`{date}`, `{stackCount}`,
etc.). Adopting the S1 fix tightens this implicitly.

Cosmetic — no current caller exercises the looseness.

### S8 — Idempotent re-render path of `renderTitleScreen` only updates `randomSeedButton.textContent`; other date-derived strings would be missed

**Location:** `src/ui/title-screen.ts:251-256`.

```ts
} else {
  randomSeedButton.textContent = randomSeedLabel;
}
```

Only the random-seed button label updates on subsequent calls. Today
this is correct (only `title.randomSeedButton` has a `{date}` param).
But if a future registry change adds `{date}` to another key (e.g.,
`title.subtitle`), the idempotent path would silently fail to
update it.

The right architecture would be to derive the set of date-dependent
keys from the registry (or to have `getString` return a
`re-evaluate-on-date-change` token) — but that's overengineering for
v1. A test that pins the current invariant ("only
randomSeedButton has a date param") would catch the drift cheaply;
or a comment at `:252` noting the assumption.

Cosmetic — defensive against a future invariant drift.

### S9 — `formatString` numeric-coercion path uses `String(params[key])` — defined but worth a unit test for `Infinity`/`NaN`/`-0`

**Location:** `src/ui/theme/strings.ts:106` + tests.

`String(Infinity)` → `"Infinity"`. `String(NaN)` → `"NaN"`. `String(-0)`
→ `"0"`. None of these match a current caller's expectation but the
type allows them (`number`). One test pins the integer happy path
(`{ n: 42 }`); no edge-case tests exist.

If a future caller passes a computed numeric (e.g., `getString("foo",
{ n: 1/0 })`), the result includes `"Infinity"` in the rendered text
— probably not what the caller wanted. Worth either:
- Tightening the param type to `string | number & integer` (TS
  doesn't have this; would need a brand or runtime check); or
- Documenting the coercion contract; or
- Adding a unit test that pins the coercion behavior so a future
  maintainer sees what happens.

Cosmetic.

### S10 — Bundle delta (+1.71 KB raw / +0.48 KB gzipped) is reasonable

The 137-line `strings.ts` module + 23 `getString(...)` indirections
across 5 consumers → +1.71 KB raw / +0.48 KB gzipped. Consistent
with the Phase 9.A.2 budget (+4.48 KB raw / +1.12 KB gzipped for the
title-screen + CSS). The 110 KB CI gate has ~67 KB headroom; Phase
9 still has the CRT shader (9.A.4) and ARCHITECTURE polish (9.A.7)
ahead. PASS.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is **satisfied**:

- **`src/ui/theme/strings.ts` unit coverage**: 21 tests covering
  formatString (6), getString (5), STRING_KEYS shape (5), per-consumer
  key sets (5). Coverage 100% lines / 100% branches / 100% functions
  — the highest of any module in the tree.
- **Refactored consumer modules**: existing UI tests
  (`hud.test.ts`, `inventory.test.ts`, `equipment.test.ts`,
  `win-screen.test.ts`, `title-screen.test.ts`) still pass byte-for-byte.
  None were modified — confirming the refactor is a pure indirection.
  Coverage on each consumer is preserved (100/100/100 except
  title-screen at 97.24% — unchanged from 9.A.2).
- **Per-consumer key-set pinning** (`strings.test.ts:118-174`): pins
  the documented contract that each consumer uses a specific set of
  keys. A registry rename surfaces as a test failure. **However, the
  per-consumer block uses `toBeTruthy()` rather than `toBe(<expected
  bytes>)` — see S4. The byte-exactness contract is partially
  enforced by the existing consumer tests (which assert literals like
  `"Inventory"`); the registry-layer tests pin only 4 of 29 keys
  byte-exactly.**
- **Cross-runtime golden chain** preserved verbatim — the registry
  refactor touches no rules-bearing files (sim, mapgen, atlas, share,
  verifier are all untouched).
- **Reachability + lint scope**: PASS. The new `src/ui/theme/strings.ts`
  is in scope of the `src/ui/**` lint rules; verified by `npm run
  lint` 0 errors. No Date / performance / write-path imports.

**Coverage gap call-outs** (not blocking but worth noting):

- No test for `getString(key, { extraneousParam: "x" })` (the brief
  asks if this returns the un-substituted template — verified by
  spot-check: it does, because `formatString` only replaces tokens
  that appear in BOTH the template and the params map). Adding an
  explicit test pin would close this.
- No test for the iteration-order injection (S1). With S1's fix
  applied, a regression test would be a 3-line addition.
- No test for `formatString("{x}", { x: "{y}", y: "Z" })` (the
  smoking-gun reproduction for S1).

## Compliance check (review-focus items 1-9)

### C1 — Registry shape correctness (focus item 1)

29 keys total (brief said 28 — see S2). All 5 documented section
prefixes present (`title.*`=11, `hud.*`=4, `inventory.*`=6,
`equipment.*`=2, `winScreen.*`=6). The typed `StringKey = keyof
typeof DEFAULT_THEME` correctly covers every key (a typo at a call
site like `getString("title.heding")` is a TS compile error). The
`STRING_KEYS` frozen array is consistent with `Object.keys(DEFAULT_THEME)`
since it's derived directly from it. PASS.

### C2 — Substitution syntax correctness (focus item 2)

- **Attack vector — value containing `{token}` substring re-substituted
  by a later iteration**: REPRODUCIBLE. See S1. Not currently
  reachable from any in-tree caller, but the mod-overlay seam will
  expose it.
- **Unfilled placeholders preserved intact**: PASS — the loop only
  substitutes keys that appear in `params`; missing tokens stay as
  `{tokenName}` for diagnostic visibility.
- **`{}` vs `<>` syntax choice (intentionally byte-distinguishable
  from `src/router/messages.ts:fillTemplate`)**: defensible. The
  router error templates contain literal `<token>` strings as part of
  pinned error messages (e.g., `"url: ?run= must be 22 base64url
  characters (got <N>: <repr>)"` is a frozen byte sequence per
  decision memo phase-8 + Phase 4-style pin). Sharing a syntax
  between the two helpers would force every router-error pin test
  to dodge accidental substitution; the syntax split is correct.
  See B1 for the related DRY concern.

### C3 — Consumer-refactor correctness (focus item 3)

Walked each consumer:

| Consumer | Keys | Verdict |
|---|---|---|
| `title-screen.ts` | `title.heading`, `title.subtitle`, `title.seedLabel`, `title.seedPlaceholder`, `title.newRunButton`, `title.randomSeedButton{date}`, `title.pasteFpButton`, `title.pasteLabel`, `title.pastePlaceholder`, `title.pasteSubmit`, `title.footer` (11) | every literal replaced; `{date}` correctly passed from `options.todayDate`; idempotent re-render preserves the only date-derived key (S8) |
| `hud.ts` | `hud.hpLabel`, `hud.floorLabel`, `hud.outcomeLabel`, `hud.fingerprintLabel` (4) | every label replaced; HP/floor/outcome/fingerprint *values* are still computed inline (correct — they're state-derived, not theme constants) |
| `inventory.ts` | `inventory.heading`, `inventory.stackNounSingular`, `inventory.stackNounPlural`, `inventory.itemNounSingular`, `inventory.itemNounPlural`, `inventory.countTemplate{stackCount,stackNoun,itemCount,itemNoun}` (6) | pluralization matrix verified by spot check below |
| `equipment.ts` | `equipment.heading`, `equipment.emptySlot` (2) | every literal replaced |
| `win-screen.ts` | `winScreen.heading`, `winScreen.fingerprintLabel`, `winScreen.floorLabel`, `winScreen.hpLabel`, `winScreen.wonMessage`, `winScreen.notWonMessage` (6) | every literal replaced; outcome-conditional message uses correct keys |

**Inventory pluralization matrix verification** (the brief's specific
ask):

| (stacks, items) | Result |
|---|---|
| (0, 0) | `"0 stacks · 0 items"` (plural for both — correct for zero) |
| (1, 1) | `"1 stack · 1 item"` (singular for both) |
| (1, 4) | `"1 stack · 4 items"` (singular stack + plural items) |
| (2, 1) | `"2 stacks · 1 item"` (plural stack + singular item) |
| (3, 7) | `"3 stacks · 7 items"` |

The (0, 0) case uses plural for both — defensible (English uses
plural for zero, e.g., "0 items"); some style guides use singular,
which would require a 3-form noun-bag (zero/one/many) instead of the
current 2-form. This is consistent with the existing pre-9.A.3
behavior so no regression. PASS.

### C4 — Phase 5 frozen contract compliance (focus item 4)

`src/ui/theme/strings.ts` contains:
- 0 references to `Date`, `Math.random`, `performance.now`, or any
  time/PRNG global. Verified by spot-check + lint pass.
- 0 float arithmetic — the only arithmetic-adjacent operation is
  `Object.keys(params).length === 0`, which is integer comparison.
- 0 banned imports — file has zero `import` statements (only the
  `as const` literal + 2 functions + 1 frozen array).

The `src/ui/**` lint scope at `eslint.config.js:266-315` enforces
this; the file passes lint. PASS.

### C5 — Mod-overlay future-readiness (focus item 5)

See S5. Conclusion: current shape is mod-overlay-ready; future
`bindTheme(overrides: Partial<typeof DEFAULT_THEME>)` is a 5-10 line
addition without consumer-side refactoring. The typed `StringKey`
union is type-level so it survives any runtime mutation. PASS, with
the S1 caveat about untrusted-template threat surface.

### C6 — Test sufficiency (focus item 6)

See "Test adequacy assessment" above. The 21 tests give 100/100/100
coverage on the registry. Three small gaps:
- Per-consumer pins use `toBeTruthy()` instead of byte-exact pins
  (S4) — partially compensated by the existing consumer tests
  asserting literal strings.
- No iteration-order injection regression test (S1).
- No `STRING_KEYS.length === 29` shape pin (S2).

Each is a one-line test addition.

### C7 — Breaking-change surface (focus item 7)

See S6. 9 hardcoded UI strings remain in `src/main.ts` (Diagnostics
page section headings, button labels, the "Open in pinned release"
link text). The strict reading of acceptance criterion 3 ("All text
rendered through the theme registry") would flag these as a gap; the
pragmatic interpretation (Diagnostics page is dev-tooling, not v1
user surface; the registry covers the `title/hud/inventory/equipment/winScreen`
v1 user surfaces) is defensible but should be documented explicitly.

No consumer outside `src/ui/` uses any of the 29 registry keys, so
the refactor's blast radius is correctly contained to the UI layer.
The 5 consumer files modified + 1 new module + 1 new test file → 7
files touched total. None of the existing tests broke. PASS for
breaking-change containment; APPROVE-WITH-NITS for the documentation
gap on `src/main.ts` strings.

### C8 — Bundle size (focus item 8)

+1.71 KB raw / +0.48 KB gzipped (see S10). The registry is already
import-once-and-tree-shake; no easy wins. The 23 `getString(...)`
indirections add a small per-call-site overhead but the function
itself is tiny. PASS.

### C9 — Existing-test brittleness (focus item 9)

The existing UI tests assert hardcoded literals (`"Inventory"`,
`"Equipment"`, `"Run Complete"`, etc.). The registry preserves these
byte-exactly. If a future maintainer changed `inventory.heading` from
`"Inventory"` to `"Stash"`, BOTH the registry and the existing
inventory test would break.

This is **defense in depth, not unnecessary brittleness**. Rationale:

- The existing UI tests verify the *user-facing render contract*
  (the DOM contains the literal text users will see). This is the
  load-bearing assertion.
- The registry-layer tests verify the *internal shape contract*
  (the registry has the right keys for each consumer to reference).

These are different contracts. Sharing the byte-pin between them
would couple them; the current split correctly separates "what the
user sees" from "what the registry exposes." A theme-mod overlay
that swaps `"Inventory"` for `"Stash"` would correctly break the
existing UI test (the user-facing string changed!), prompting the
mod author to update the test. This is the right behavior.

**One edge case:** if a maintainer wants to *internationalize* the
registry (overlay French strings without breaking English tests),
the existing UI tests would need to gain a "render in default
theme" guard. But that's a concern for the i18n phase, not 9.A.3.

PASS — the test split is intentional and correctly designed.

## Files relevant to this review

Source (in scope):

- `/workspace/src/ui/theme/strings.ts` (137 lines, new — `DEFAULT_THEME` + `StringKey` + `formatString` + `getString` + `STRING_KEYS`)
- `/workspace/src/ui/title-screen.ts` (modified — 11 `getString` calls)
- `/workspace/src/ui/hud.ts` (modified — 4 `getString` calls)
- `/workspace/src/ui/inventory.ts` (modified — 6 `getString` calls)
- `/workspace/src/ui/equipment.ts` (modified — 2 `getString` calls)
- `/workspace/src/ui/win-screen.ts` (modified — 6 `getString` calls)

Tests (in scope):

- `/workspace/tests/ui/theme/strings.test.ts` (175 lines, 21 tests — new)

Pre-existing files inspected for context (NOT changed by this PR):

- `/workspace/src/router/messages.ts:104-120` (`fillTemplate` — same iteration-order bug; B1)
- `/workspace/src/main.ts:162,272,321,377,436,483,636,805,817` (hardcoded UI strings remaining outside the registry — see S6)
- `/workspace/eslint.config.js:266-315` (`src/ui/**` lint scope — confirms the new file inherits the Phase 5 bans)
- `/workspace/docs/PHASES.md:582-592` (Phase 9 acceptance criteria)
- `/workspace/docs/ARCHITECTURE.md` (Phase 5 frozen contracts)

Phase context:

- `/workspace/artifacts/phase-approval.json` (Phase 9.A.2 approved on master at 88241a8; next_phase field documents 9.A.3 scope)
- `/workspace/artifacts/code-review-phase-9-A-2.md` (prior code-review format reference)

## Approval verdict

**APPROVE-WITH-NITS.**

No blocking quality-gate violations. All sandbox gates green: 1191
tests / 83 files / 0 lint / 0 typecheck / 145.56 KB raw / 42.97 KB
gzipped (well under the 110 KB CI gate). Cross-runtime golden chain
preserved unchanged. The `src/ui/**` layer-scope lint rules pass.
Coverage on the new module is 100/100/100. Existing UI tests pass
byte-for-byte without modification, confirming the refactor is a
pure indirection. The typed `StringKey` union correctly enforces
compile-time correctness at every call site.

The non-blocking suggestions:

- **S1** (iteration-order injection in `formatString`) is the only
  finding with concrete forward risk. It is dormant in the current
  call sites (no caller passes values containing `{...}`), but the
  documented mod-overlay seam exposes it the moment a mod can supply
  a template value. The fix is a 5-line single-pass regex
  substitution; this is the same fix `src/router/messages.ts:fillTemplate`
  also needs (B1). **Recommend addressing in 9.A.+ mod-loader work
  alongside the `bindTheme` design**, with explicit memo
  acknowledgment if deferred past 9.A.3.
- **S2** (brief miscount: 29 keys not 28) is documentation; a one-line
  test addition pinning `STRING_KEYS.length === 29` would catch
  future shape drift.
- **S3** (asymmetric empty-params short-circuit) is cosmetic.
- **S4** (per-consumer pins use `toBeTruthy()` not byte-exact) is the
  test-sufficiency finding — partially compensated by the existing
  consumer tests asserting literals. See C9 for why the split is
  intentional and correct.
- **S5** (mod-overlay future-readiness) confirms the current shape
  is ready; no refactor needed before `bindTheme`.
- **S6** (Diagnostics page strings in `src/main.ts` remain
  hardcoded) is the strictest reading of acceptance criterion 3.
  The pragmatic interpretation (dev-tooling, not user surface) is
  defensible but should be documented explicitly.
- **S7-S10** are documentation / cosmetic / passing observations.

The cross-runtime golden chain preserved unchanged is the load-bearing
invariant; the registry refactor touches no rules-bearing files. The
Phase 5 frozen contract is preserved (no Date / performance / float
imports). The deliverable correctly maps to docs/PHASES.md:591
acceptance criterion 3, with the qualification on `src/main.ts`
strings (S6). The mod-overlay seam (the explicit forward extension
point of this phase) is correctly designed and ready for Phase 9.A.+
mod-loader work, modulo the S1 fix.

Phase 9.A.3 is structurally sound. The phase is ready to land as-is,
with S1 + S2 + S6 carried forward to a Phase 9.A.+ polish iteration
(S1 is the load-bearing one; S2 + S6 are documentation).

## Bonus — duplication concern (B1)

### B1 — `formatString` and `fillTemplate` are near-identical implementations with identical bugs

**Location:** `src/ui/theme/strings.ts:99-108` + `src/router/messages.ts:111-120`.

```ts
// strings.ts
export function formatString(template: string, params: ...): string {
  let out = template;
  for (const key in params) {
    out = out.split(`{${key}}`).join(String(params[key]));
  }
  return out;
}

// messages.ts
export function fillTemplate(template: string, replacements: ...): string {
  let out = template;
  for (const key in replacements) {
    out = out.split(key).join(replacements[key]!);
  }
  return out;
}
```

The structure is identical. The differences:
1. `formatString` wraps the key as `{${key}}`; `fillTemplate` uses
   the key verbatim (so the caller passes `<N>` etc.).
2. `formatString` coerces numeric values to string; `fillTemplate`
   takes string values only.

Both share the iteration-order injection bug (S1).

**Why duplication is justified.** The brief explicitly calls out the
intentional syntax split (`{token}` for theme strings;
`<token>` for router-error pins). Sharing a lower-level helper would
require either:
- A regex parameter (each call site passes its placeholder pattern);
  or
- A wrapper at each call site that pre-formats the key.

Both add complexity that buys nothing — the two helpers serve
different layers (UI v. router) with different threat models (theme
overlays v. URL-error templates).

**However**, the iteration-order bug fix at S1 should be applied to
*both* helpers. The right move is to fix each helper independently
in the next polish pass, not to consolidate them.

This is **explicit justified duplication** per QUALITY_GATES.md (the
DRY gate allows duplication when a refactor would coupled
unrelated concerns). PASS for the DRY gate; no blocking issue.

VERDICT: APPROVE-WITH-NITS
