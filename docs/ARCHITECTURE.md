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
| `src/core/` | `@noble/hashes/sha256` only | anything browser-specific (`window`, `document`, `crypto.subtle`), anything async, anything in `src/sim/`, `src/render/`, `src/input/` |
| `src/sim/` | `src/core/`, `src/registries/` | `Math.random`, `Date.now()`, `performance.now()`, `new Date()`, floating-point arithmetic, iteration over un-ordered collections without `sortedEntries()`, `src/render/`, `src/input/` |
| `src/mapgen/` | `src/core/`, `src/registries/` | same as `sim/` |
| `src/render/` | `src/core/` (read-only types only), `src/sim/` (read-only state), atlas assets | writing to `src/sim/` state, importing `src/core/streams` or `src/sim/combat` |
| `src/input/` | none from core/sim/render | writing to `src/sim/` state directly |
| `tools/` | Node-only modules | the running game's bundle |

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
| no `Math.random` | `src/core/**`, `src/sim/**`, `src/mapgen/**` | `no-restricted-syntax` selector |
| no `Date.now`, `performance.now`, `new Date()` | `src/core/**`, `src/sim/**`, `src/mapgen/**` | `no-restricted-syntax` selectors and `no-restricted-globals` |
| no `for..in`, no iteration over `Map`/`Set`/`Object.entries`/`Object.keys`/`Object.values` without `sortedEntries(...)` | `src/sim/**`, `src/mapgen/**` | `no-restricted-syntax` selectors |
| no float arithmetic | `src/sim/**`, `src/mapgen/**` | custom rule `eslint-rules/no-float-arithmetic.cjs` (see decision memo addendum B6 for full contract) |
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
  diagnostic page, including `@noble/hashes/sha256`. Tracked via
  `vite build --report` output.
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
