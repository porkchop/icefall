# Decision Memo — Phase 1 (Deterministic Core + Public Deploy)

**Status.** Drafted before any Phase 1 code is written, per the planning gate in
`docs/PHASES.md`. Architecture-red-team review is required before implementation.

## Decision summary

Phase 1 builds the load-bearing determinism substrate plus a working GitHub
Pages deploy. Every choice below is biased toward (a) bit-identical behavior
across Chrome/Firefox/WebKit/Node, (b) small bundle size, and (c) cheap
reversal — Phase 1 is the foundation, and we only get one chance to set the
encoding contracts before Phase 8 enshrines them in shared URLs. Where two
options were genuinely close, the tiebreaker was "what does Phase 8 force us
to commit to anyway?"

Local lint/build/test go green inside the sandbox; live-deploy verification is
deferred to a follow-up commit (decision 11).

## Decisions

### 1. PRNG: **sfc32**

- **Chosen:** `sfc32` — 128-bit state, period ≈ 2^128, four 32-bit words,
  passes PractRand to multi-TB.
- **Alternative:** `mulberry32` — 32-bit state, period 2^32, one word. Smaller
  and simpler, but the period is uncomfortably close to a long run's RNG
  draw count (10-floor crawl with combat will easily pull 10^5–10^6 numbers,
  and `mulberry32`'s state is 32 bits with known low-bit weaknesses). With
  three independent streams (`mapgen`, `sim`, `ui`) the period concern
  compounds.
- **Why this option:** sfc32 is the standard "good small JS PRNG", is
  integer-only (lint-rule friendly), and is trivially seedable from a 128-bit
  hash digest — which gives us decision 3 for free.
- **If wrong:** swappable behind a `PRNG` interface (`next(): u32`); changing
  implementations bumps `rulesetVersion`. Cost is a ruleset bump, no API
  churn.

### 2. Sync SHA-256: **`@noble/hashes/sha256`**

- **Chosen:** `@noble/hashes` (sync `sha256`, Uint8Array → Uint8Array). ~3 KB
  minified+gzipped; audited; no deps; works in Node and browser identically;
  ESM-first so Vite tree-shakes cleanly.
- **Alternatives considered:**
  - `js-sha256` — ubiquitous but ~6 KB and a CommonJS-default that bloats
    Vite output.
  - In-house port — high audit burden, zero benefit over noble.
  - `SubtleCrypto` — async, unusable on the sim hot path. Reserved for
    fingerprint computation only, where async would be acceptable; for
    consistency we use sync everywhere.
- **Why this option:** smallest sync SHA-256 with active maintenance and
  known-good cross-runtime behavior; the rest of `@noble/hashes` (HMAC, HKDF)
  becomes available cheaply if Phase 8 ever wants it.
- **If wrong:** abstract behind `core/hash.ts`. Switching libraries leaves
  callers untouched; SHA-256 output is fixed.

### 3. RNG stream derivation: **hash-based subkeys**

- **Chosen:**
  ```
  streamSeed(stream, ...salts) =
    sha256(rootSeedBytes ‖ utf8("icefall:v1:") ‖ utf8(stream) ‖ encodeSalts(salts))
  ```
  Take the first 16 bytes of the digest, load as four little-endian `u32`s,
  feed straight into `sfc32(a,b,c,d)`. `streams.mapgen(floorN)`,
  `streams.sim()`, `streams.ui()` are thin wrappers fixing `stream` and
  `salts`.
- **Alternative:** PRNG-of-PRNG (advance the root PRNG once per stream and
  seed children from those outputs). Rejected — derivations become
  positional; adding a fourth stream later silently shifts every existing
  stream's seed and invalidates fingerprints.
- **Why this option:** SPEC.md already specifies
  `H(seed ‖ "mapgen" ‖ floorN)` — this generalizes the same pattern. Adding
  a stream cannot perturb existing ones. The `"icefall:v1:"` domain tag means
  a future encoding change can coexist with v1 by bumping the tag and
  `rulesetVersion`.
- **If wrong:** the derivation is a single function; replacing it bumps
  `rulesetVersion`. That is precisely what `rulesetVersion` is for.

### 4. State-hash chain & canonical action descriptor: **custom binary encoding**

- **Chosen.** Action descriptor is a fixed shape:
  `{ type: string, target?: int32, item?: string, dir?: 0|1|2|3|4|5|6|7 }`
  (Phase 3 may extend). Encoding is deterministic binary:
  - 1 byte version tag (`0x01`)
  - `type`: 1-byte length-prefixed UTF-8 (max 64 bytes)
  - sorted optional fields by stable numeric tag (`0x10` target, `0x20` item,
    `0x30` dir, …); each field is `[tag][len][bytes]` with integers in
    fixed-width little-endian
  - integers are `int32` (sim is integer-only by lint rule)
- State chain step: `nextState = sha256(prevState ‖ encode(action))`.
  `prevState` is 32 raw bytes, never hex.
- **Alternatives considered:**
  - `JSON.stringify` with sorted keys — float coercion risk, NaN/Infinity
    quirks, fragile escaping rules across engines.
  - msgpack — too much surface for a 5-field schema; canonical-form rules
    leave ambiguity (integer compaction).
  - canonical CBOR (CTAP2) — defensible but requires a library; custom
    binary is ~30 lines and we own the spec.
- **Why this option:** small, self-describing (version tag),
  forward-compatible (new field tags are additive when un-set), and there is
  no path that lets a `Date` or float silently enter the state chain.
- **If wrong:** version tag exists exactly so we can ship `0x02` later. Old
  runs continue to verify under `0x01`. Cost is a `rulesetVersion` bump and
  a small encoder branch.

### 5. Fingerprint encoding: **URL-safe base64 (RFC 4648 §5), unpadded, 22 chars**

- **Chosen:** take the 32-byte SHA-256, base64url-encode, drop padding, take
  the first 22 characters (≈132 bits of entropy). Full 43-char form
  available via `fingerprintFull(...)` for verifier paths.
- **Alternatives:** Crockford base32 — case-insensitive, friendlier to
  speak aloud, but ~26 chars for the same entropy. Custom alphabets — Phase
  8 will put this in URLs; any custom alphabet means writing our own decoder
  for every consumer.
- **Why this option:** 22 chars fits in a tweet trivially, base64url has zero
  URL-encoding hazards, native `atob`/`btoa` available everywhere, collision
  space (2^132) is far beyond any realistic run population.
- **If wrong:** the truncation length is the only knob. Lengthening is a
  `rulesetVersion` bump and is forward-compatible (longer prefixes are still
  valid SHA-256 prefixes). Lock at 22 for v1.

### 6. Custom ESLint determinism rules: **`no-restricted-*` patterns + 1 custom rule**

- **Chosen.** Three of the four bans fit cleanly into stock rules:
  - `Math.random` / `Date.now` / `performance.now` / `new Date()` —
    `no-restricted-globals` and `no-restricted-syntax` (selectors like
    `MemberExpression[object.name='Math'][property.name='random']`). Scoped
    via `overrides` to `src/core/**` and `src/sim/**`.
  - Iteration over un-ordered collections in `sim/` — `no-restricted-syntax`
    selectors banning `ForOfStatement` over bare `Map`/`Set`/`Object` and
    `ForInStatement`. Iteration must go through a `sortedEntries(...)`
    helper.
  - Float arithmetic in `sim/` — needs a custom rule. Detect `Literal` with
    a decimal point, `/` operators on numbers, and `Math.{floor, ceil,
    round, sqrt, ...}` calls inside `src/sim/**`. ~80 lines of custom rule.
    Allow integer division through an `idiv(a,b)` helper.
- **Why this option:** smallest surface, leverages stock ESLint where it
  works, isolates novelty (the float rule) to one file with its own tests.
- **If wrong:** custom rule lives in `eslint-rules/no-float-arithmetic.cjs`.
  Rewriting it doesn't touch any production code.

### 7. Build-time injection: **Vite `define` with a typed `src/build-info.ts` shim**

- **Chosen.** `vite.config.ts` reads `git rev-parse --short HEAD` and a
  placeholder ruleset version (Phase 4 replaces with
  `sha256(rulesText ‖ atlasBinaryHash)`), and exposes them via
  `define: { __COMMIT_HASH__: JSON.stringify(...), __RULESET_VERSION__:
  JSON.stringify(...) }`. `src/build-info.ts` re-exports these as typed
  constants and provides Node-side fallbacks.
- **Alternatives:** generated `.ts` written to disk pre-build — adds churn
  and another gitignore line; `import.meta.env` — leaks values into env
  namespace.
- **Why this option:** standard Vite, one shim file, Node and browser both
  work, no generated files, easy to override in tests.
- **If wrong:** swap to a generated file; the rest of the codebase imports
  from `@/build-info` regardless.

### 8. Self-tests at startup: **the minimum convincing set**

The diagnostic page runs these in order and turns green only if all pass:

1. **PRNG repeatability.** `sfc32` from a hardcoded seed produces a hardcoded
   golden 8-value sequence.
2. **PRNG cross-runtime.** Same seed, 1,000 draws, hashed → matches a
   hardcoded golden hex digest.
3. **SHA-256 known-answer.** `sha256("abc")` matches the NIST FIPS 180-4
   vector.
4. **Stream independence.** `streams.mapgen(0)` and `streams.sim()` from the
   same root seed produce different first-100 sequences (digest differs);
   identical across calls with the same root.
5. **State-chain advances.** Three distinct actions yield three distinct
   state hashes; the same action twice from the same state yields the same
   successor.
6. **State-chain order-sensitive.** `apply(A) then apply(B) ≠ apply(B) then
   apply(A)`.
7. **Fingerprint round-trip.** Stable across calls; permuting `mods` array
   yields identical fingerprint (sort is stable).
8. **Build-info present.** `commitHash` is non-empty; `rulesetVersion` is
   non-empty.

Everything is also a Vitest test. The browser self-test is the same suite
re-run via dynamic imports.

### 9. Coverage tool: **Vitest's built-in v8 coverage**

- **Chosen:** `@vitest/coverage-v8`. Zero extra config beyond enabling it;
  uses Node's built-in coverage; runs the same tests once.
- **Alternative:** `@vitest/coverage-istanbul` — more accurate branch
  coverage but slower and instruments source. v8 line coverage is reliable
  for the 100%-line gate.
- **If wrong:** swap the coverage provider in `vitest.config.ts`. One-line
  change.

### 10. Cross-runtime test strategy: **Vitest in Node + Playwright project**

- **Chosen.** Two test runs in CI:
  1. `vitest run` — Node V8.
  2. A Playwright project (`@playwright/test`) that loads the diagnostic
     page from `vite preview` and asserts `window.__SELF_TEST_RESULT__` is
     `"green"` across `chromium`, `firefox`, and `webkit`. The diagnostic
     page runs a hashed 1,000-step random walk and asserts a hardcoded
     golden digest; same digest in Node and three browsers ⇒ determinism
     proven.
- **Why this option:** Playwright is needed for Phase 5+ anyway; using it
  here is the lowest-novelty way to get all three engines. `@vitest/browser`
  was an alternative but its provider matrix is younger.
- **If wrong:** swap to `@vitest/browser` later. Same test files, different
  driver.

### 11. Live-deploy verification: **complete Phase 1 here; live verification is a follow-up**

- **Recommendation.** Ship Phase 1 with the workflow file written,
  lint/build/test green locally, the diagnostic page rendering self-tests
  in `npm run dev` and `npm run preview`, and the cross-runtime test green
  in three browser engines + Node. **Do not block Phase 1 on
  live-URL verification.**
- **Reasoning.** This sandbox cannot push to GitHub. The only thing the
  live URL adds beyond local verification is "confirm the GH Pages workflow
  actually runs and the subpath routing works." That is a config risk, not
  a code risk — and gating Phase 1 on a deploy we cannot execute is a
  deadlock. The phasekit model handles this: write `phase-approval.json`
  for in-sandbox deliverables; the host wrapper commits and pushes; the
  deploy runs externally; if it fails, that becomes a Phase 1.5 follow-up
  commit.
- **Mitigations to make the deploy actually go green on first push:**
  - Pre-bake the Vite config: `base: '/icefall/'`, hardcoded.
  - Pin Actions to specific versions in `deploy.yml`.
  - Build output verified locally with `vite build && vite preview` and a
    Playwright smoke that mirrors the GH Pages subpath.
  - Workflow-status badge in README points at the workflow file; a red
    badge after the host pushes is itself the signal.
- **Mark this in the approval artifact.** Add a
  `pending_external_verification: ["github-pages-deploy",
  "live-url-self-test"]` field. Phase 2 cannot start until the host
  confirms the deploy is green. If the live deploy fails, that is a Phase
  1.5 PR.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| sfc32 implementation drift | Golden-vector test against published reference, locked with a digest. |
| `@noble/hashes` major version bump changes API | Pin exact version in `package.json`. |
| Action encoding ambiguity post-Phase-1 | Version tag (`0x01`) reserves the upgrade path; documented in `docs/ARCHITECTURE.md`. |
| Vite `base` foot-gun | Local `vite preview` Playwright smoke; deploy badge in README is visible signal. |
| Custom float-arithmetic lint rule false positives | Rule scoped to `src/sim/**` only; allow-list via inline disable when justified. |
| `commitHash` injection ambiguity in Vitest (no git) | `build-info.ts` falls back to `"dev"`; tests stub it. |
| 100% line coverage gate becomes a treadmill | Keep `src/core/*` deliberately small (~500 LOC budget for Phase 1). |

## Concrete acceptance criteria for Phase 1

These map onto `docs/PHASES.md` Phase 1 acceptance criteria, made specific
enough that an implementer cannot interpret them three ways.

1. `src/core/prng.ts` exports `sfc32(a,b,c,d): () => u32` and
   `sfc32FromBytes(bytes: Uint8Array): () => u32`. Golden-vector tests for
   both. 100% line coverage.
2. `src/core/hash.ts` exports `sha256(b: Uint8Array): Uint8Array`,
   `sha256Hex`, `sha256B64Url`. NIST KAT in tests. 100% line coverage.
3. `src/core/streams.ts` exports `streamsForRun(rootSeed: Uint8Array)`
   returning `{ mapgen(floor): PRNG, sim(): PRNG, ui(): PRNG }`.
   Independence test. 100% line coverage.
4. `src/core/state-chain.ts` exports `genesis(): Uint8Array`,
   `advance(state, action): Uint8Array`, `encodeAction(action): Uint8Array`
   with `0x01` version tag. Round-trip, ordering, idempotence tests. 100%
   line coverage.
5. `src/core/fingerprint.ts` exports `fingerprint({commitHash,
   rulesetVersion, seed, modIds}): string` (22-char base64url) and
   `fingerprintFull(...)` (43 chars). Mod-sort stability test. 100% line
   coverage.
6. `src/build-info.ts` exposes `commitHash` and `rulesetVersion`;
   `vite.config.ts` injects via `define`; Node fallback in tests.
7. `eslint.config.js` configures the determinism rules from decision 6.
   Each rule has a fixture test that fails an intentionally-bad file and
   passes a good one.
8. `index.html` + entry runs the eight self-tests from decision 8 and
   renders red/green; final result also written to
   `window.__SELF_TEST_RESULT__` for Playwright.
9. `vitest.config.ts` enables v8 coverage with a 100% line threshold for
   `src/core/*`. Cross-runtime golden-digest test in `tests/`.
10. `.github/workflows/deploy.yml` exists with pinned Actions versions, the
    required permissions block, the concurrency group, and runs
    `npm ci && npm run lint && npm run test && npm run build` before
    deploying.
11. `README.md` has the "▶ Play live" link, workflow status badge,
    one-paragraph description, and a link to `docs/SPEC.md`.
12. `docs/ARCHITECTURE.md` populated (no longer a stub) with the action
    encoding spec, stream-derivation formula, fingerprint format, and lint
    inventory.
13. `artifacts/decision-memo-phase-1.md` (this memo) committed.
14. `artifacts/phase-approval.json` written with `approved: true`,
    `decision_memo: "artifacts/decision-memo-phase-1.md"`, and
    `pending_external_verification: ["github-pages-deploy",
    "live-url-self-test"]`.

---

## Addendum — fixes from architecture-red-team review

The red-team identified six blocking issues. Resolutions:

### B1 — Action descriptor encoding, fully nailed down

The action encoder is the canonical statement; English-prose summary follows.

```ts
// src/core/encode.ts (Phase 1 contract; bumping the version tag is the only
// way to change this and it bumps rulesetVersion).
export type Action = {
  type: string;          // 1..64 bytes UTF-8, well-formed (no lone surrogates)
  target?: number;       // int32, signed, two's complement, little-endian
  item?: string;         // 0..255 bytes UTF-8 (Phase 1); revisit at Phase 8 mods
  dir?: 0|1|2|3|4|5|6|7;
};

export const ACTION_VERSION = 0x01;

// Field tags (u8). 0x00 and 0xFF are reserved; tags must be unique and
// strictly increasing on the wire. New tags are additive; never re-use.
const TAG_TARGET = 0x10;
const TAG_ITEM   = 0x20;
const TAG_DIR    = 0x30;
```

Wire format for one action:

```
[0x01]                                  version, 1 byte
[type_len][type_bytes...]               type_len = byte length of TextEncoder.encode(type), 1..64
                                        encoder MUST reject strings whose UTF-16 form contains
                                        unpaired surrogates (well-formedness check).
For each present optional field, in strictly increasing tag order:
  [tag][...payload]
    TAG_TARGET (0x10): payload is 4 bytes int32 little-endian (DataView.setInt32(_, _, true))
    TAG_ITEM   (0x20): payload is [item_len:1][item_bytes:0..255]
    TAG_DIR    (0x30): payload is 1 byte, value in {0..7}
End of action: no terminator — the action's byte length is the sum of fields.
The state-chain step concatenates state || action_bytes; the SHA-256 framing
makes lengths irrelevant.
```

`int32` everywhere is **signed two's complement**, encoded via
`DataView.setInt32(off, val, /*littleEndian=*/true)`. Range
`[-2_147_483_648, 2_147_483_647]`. A `target` of `-1` is the canonical "no
target / self".

`type_len` and `item_len` are **byte counts of the UTF-8 encoding**, not
codepoint counts and not UTF-16 code-unit counts. `type` is capped at 64
bytes (lint enforces); `item` is capped at 255 bytes (the 1-byte length
prefix is the hard cap). Phase 6 item IDs comfortably fit; Phase 8 mod-ID
namespacing will need to verify it stays under 255 and otherwise bump to a
2-byte length.

Strings MUST be checked for well-formedness before encoding. Implementation:

```ts
// Reject any string whose UTF-16 form contains a code unit in
// 0xD800..0xDFFF that is not part of a surrogate pair. Equivalent to
// "the string would not survive a TextEncoder/TextDecoder round-trip
// without replacement".
```

### B2 — Stream salt encoding, independent of action encoder

Stream derivation has its own encoder so that bumping the action version tag
does not silently reroll every map.

```ts
// src/core/streams.ts
export const STREAM_DOMAIN = "icefall:v1:";

// streamSeed(rootSeed, name, ...salts) is:
//   sha256( rootSeed
//         || utf8(STREAM_DOMAIN)
//         || lp_utf8(name)              // 1-byte length-prefixed UTF-8 name, well-formed
//         || encodeSalt(salts[0])
//         || encodeSalt(salts[1])
//         || ... )
// Take bytes 0..15 as the four little-endian u32s feeding sfc32.
//
// encodeSalt:
//   number (must be int32-safe) →
//     [0x01][int32 LE]            // 5 bytes
//   string (well-formed, byte-len ≤ 255) →
//     [0x02][len:1][utf8...]      // 2 + len bytes
//   Uint8Array (len ≤ 65535) →
//     [0x03][len:2 LE][bytes...]  // 3 + len bytes
```

The encoder is closed: any value not in those three forms is a programmer
error and throws. There is no shared version tag between action encoding
and salt encoding.

### B3 — Phase 1 split into 1.A (in-sandbox) and 1.B (live verification)

Per `docs/QUALITY_GATES.md` "Discovered work and phase expansion", the
honest path is to *update the phase plan* and approve 1.A in this session,
then approve 1.B once the host pushes and the GH Pages workflow proves
green externally.

Concretely:
- `docs/PHASES.md` updated to add **Phase 1.A** (everything except live
  deploy verification) and **Phase 1.B** (live deploy verification).
  Phase 1's deliverable list is split between them; the planning gate
  applies to 1.A.
- `artifacts/phase-approval.json` for this session approves only 1.A.
- Phase 1.B's acceptance criteria: workflow run on `main` is green within 5
  minutes of merge; deployed URL serves the diagnostic page; the page's
  in-browser self-test reports green; the README's "Play live" link
  resolves. No code change is required for 1.B if the workflow file written
  in 1.A works as designed. If it doesn't, 1.B becomes a corrective PR.
- Phase 2 cannot start until 1.B is approved.

### B4 — Coverage gate vs cross-runtime gate

Two independent CI gates, each fail-loud:
- `npm run test` (Vitest in Node) enforces 100% line coverage on
  `src/core/*` via `vitest.config.ts` thresholds.
- `npm run test:e2e` (Playwright) loads the diagnostic page in
  `chromium`, `firefox`, `webkit` and asserts a hardcoded golden digest of
  a 1,000-step random walk. **Skipped engines are failures**, not
  no-ops — Playwright config has `forbidOnly: true` and the test file
  iterates `for (const browser of REQUIRED_BROWSERS)` so a missing browser
  binary surfaces as a hard failure.
- The same golden-digest test runs in Node from the Vitest suite, so the
  Node value is locked too.

### B5 — `rulesetVersion` placeholder is a sentinel

The Phase 1 placeholder is the literal string
`"phase1-placeholder-do-not-share"`. `fingerprint(...)` accepts it, but
`fingerprint(...).startsWith("xx")` — actually we go further:

```ts
// src/core/fingerprint.ts
export function fingerprint({ commitHash, rulesetVersion, seed, modIds }) {
  if (rulesetVersion === PLACEHOLDER_RULESET_VERSION) {
    // Tag dev fingerprints visibly so a screenshot taken in Phase 1 isn't
    // mistakenly shared as "my real run". Phase 4 will refuse to load any
    // fingerprint whose decoded prefix matches the dev tag.
    return "DEV-" + base64url22(sha256(...));
  }
  return base64url22(sha256(...));
}
```

The diagnostic page additionally renders the dev fingerprint inside a
"NOT SHAREABLE — placeholder ruleset" badge. Phase 4 wires the real
ruleset version and the `DEV-` branch becomes dead code, removed in that
phase.

### B6 — Float-arithmetic ESLint rule, contract spec

The rule lives at `eslint-rules/no-float-arithmetic.cjs` and is applied
under `src/sim/**` (and only there). Its contract:

**Reports:**
1. Numeric literal with a decimal point: `0.5`, `1.0`, `-0.5`.
2. Numeric literal in exponent form: `1e10`, `1e-1`, `5e-1`. (Detected via
   `Literal` node's `raw` property containing `e` or `E`.)
3. Binary `/` operator on any operand. Integer division must use the
   `idiv(a, b)` helper from `src/sim/math.ts`.
4. Calls to `Math.PI`, `Math.E`, `Math.LN2`, `Math.LN10`, `Math.LOG2E`,
   `Math.LOG10E`, `Math.SQRT2`, `Math.SQRT1_2`, `Math.floor`, `Math.ceil`,
   `Math.round`, `Math.sqrt`, `Math.cbrt`, `Math.pow`, `Math.exp`,
   `Math.log`, `Math.log2`, `Math.log10`, `Math.sin`, `Math.cos`,
   `Math.tan`, `Math.asin`, `Math.acos`, `Math.atan`, `Math.atan2`,
   `Math.hypot`, `Math.sign`, `Math.trunc`, `Math.fround`, `Math.random`.
5. `Number.parseFloat(...)`, `parseFloat(...)`, `Number.EPSILON`,
   `Number.MAX_VALUE`, `Number.MIN_VALUE`.
6. `JSON.parse(...)` calls (broad ban inside sim — sim should not be
   parsing JSON; data ingest happens at boundaries).

**Allows:**
- Integer literals (no decimal, no `e`).
- `*`, `+`, `-`, `%`, `**` between integer expressions.
- `idiv(a, b)`, `imod(a, b)`, `iabs(a)`, `imin`, `imax` from `src/sim/math.ts`.
- Bitwise operators (`|`, `&`, `^`, `~`, `<<`, `>>`, `>>>`).
- `array.length` (the *value* is integer, but the rule still bans `/` so
  `array.length / 2` would catch on operand 3, not on `length`).

**Test fixtures.** `eslint-rules/no-float-arithmetic.test.cjs` has at least
20 negative cases (each must report) covering: every `Math` constant in the
list, every literal form, `1/2`, `1.0+1`, `5e-1`, `parseFloat("0.5")`,
`Number.EPSILON`, `Math.PI * 2`, `Math.floor(x)`, `Math.sqrt(4)`,
`a / b`, `array.length / 2`, `(a / b) | 0`, `JSON.parse('{"x":0.5}')`,
`new Array(0.5)`, `0.5 ?? 1`. Plus 5 positive cases that must pass:
integer arithmetic, `idiv`, bitwise tricks, integer modulo, integer
exponentiation.

This rule is *not* a substitute for runtime determinism; it is a
guardrail. The cross-runtime golden-digest test is the actual enforcement.

### N4 — State-chain actor scope (clarification)

The action descriptor is **player-action only** for Phase 1. Monster
behavior in Phase 3 is computed by drawing from `streams.sim()` — those
draws advance an internal sim-stream cursor but do **not** advance the
state chain by themselves. The state chain is advanced only by player
actions; monster behavior between two consecutive player actions is a
function of `(stateHash_after_player_action, sim_stream_cursor)`. This
keeps the action log = player input log, which preserves the SPEC's
"action log is the save" principle. Phase 3's planning gate will firm up
the cursor advancement rule.

### N5 — `docs/ARCHITECTURE.md` populated BEFORE encoder

The order inside this session is:
1. Populate `docs/ARCHITECTURE.md` with the byte-layout contracts (this
   memo's bytes, but in the project's permanent doc).
2. Then write `src/core/encode.ts`, `src/core/streams.ts`,
   `src/core/state-chain.ts`, etc.
3. Code-reviewer must verify the implementation matches the doc, not
   the other way around.

### N7 — Self-test 4 strengthened

Replace the original "different first-100 sequences (digest differs)"
with three assertions:

- `streams.mapgen(0, rootA)` first-8 values match a hardcoded golden
  vector.
- `streams.mapgen(0, rootA)` first-8 values ≠ `streams.mapgen(1, rootA)`
  first-8 values.
- `streams.mapgen(0, rootA)` first-8 values ≠ `streams.mapgen(0, rootB)`
  first-8 values, where `rootB` differs by one byte.
- `streams.sim(rootA)` first-8 values ≠ `streams.mapgen(0, rootA)`.

