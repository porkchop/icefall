# Code review — Phase 8.A.2a (sandbox-verifiable JS implementation, foundation half)

Scope: the foundation half of the parent agent's internal split of
Phase 8.A.2 (mirroring the Phase 7.A.2a / 7.A.2b precedent). This
iteration ships `decodeAction`, the action-log codec
(`src/share/encode.ts` + `src/share/decode.ts`), the verifier
(`src/verifier/verify.ts`), the Node CLI (`tools/verify.ts`), and
the `REPLAY_DIGEST` self-test entry. The router / save layer /
diagnostic UI / deploy.yml budget bump are deferred to 8.A.2b.

Reviewed against the nine acceptance criteria in the brief and
addendum B1, B2, B8 + advisory A4 of
`artifacts/decision-memo-phase-8.md`.

## Verification gates (re-run locally)

| Gate | Result |
|---|---|
| `npm run lint` | green (0 errors) |
| `npm run typecheck` | green (`tsc -b --noEmit`) |
| `npm run test` | 1049 tests passed across 75 files (was 979/70 in 8.A.1; +70 / +5) |
| `npm run build` | green; 124.04 KB raw / 36.46 KB gzipped (was 116.98 / 33.69 in 8.A.1; +7.06 / +2.77 from share + verifier + fflate-in-prod-bundle). Under the existing 75 KB CI gate; 110 KB bump deferred to 8.A.2b per addendum B9 |
| Reachability walker | 36 reachable files (count pinned), zero `src/router|verifier|share|save/**` leaks |
| `src/verifier/**` coverage | 100/100/100/100 |
| `src/share/**` coverage | 100/100/100/100 (encode + decode) |
| `src/core/encode.ts` coverage | 100/100/100/100 (decodeAction joins encodeAction's existing pin) |

Cross-runtime golden chain preserved unchanged: RANDOM_WALK_DIGEST,
MAPGEN_DIGEST, SIM_DIGEST, ATLAS_DIGEST, ATLAS_ENCODER_SINGLE_COLOR_TILE_HASH,
INVENTORY_DIGEST, WIN_DIGEST. REPLAY_DIGEST joins the chain (=
WIN_DIGEST by construction; the codec is identity on action sequences).

## Blocking issues

**None of the four blocking rejection criteria from QUALITY_GATES.md
are violated.**

- Every new module has accompanying tests (`decodeAction` →
  `tests/core/decode-action.test.ts` 25 tests; share codec →
  `tests/share/action-log.test.ts` 20 tests; verifier →
  `tests/verifier/verify.test.ts` 16 tests; CLI → `tools/verify.test.ts`
  3 smoke tests).
- No bug fix in this iteration; not applicable.
- No business-logic duplication — verifier delegates to `runScripted`
  for the simulation path and to `decodeActionLog` for the codec path
  (the verifier doesn't re-implement either).
- Implementation matches the memo's frozen contracts (decision 2 +
  decision 10 + addendum B1/B2 + advisory A4); see review-focus
  items 1–9 below.
- No hidden constants — `ACTION_LOG_MAGIC`, `ACTION_LOG_VERSION`,
  `HEADER_BYTES`, `ACTION_VERSION`, `TAG_TARGET/ITEM/DIR`, `TYPE_BYTE_MAX`,
  `ITEM_BYTE_MAX`, `FINGERPRINT_SHORT_LEN` are all named.
- Test suite ran clean (1049/1049).

The only items below are non-blocking nits / deviations.

## Review focus — verdict per item

### 1. Test sufficiency

PASS.

**`tests/core/decode-action.test.ts` (25 tests).** The 10 addendum-B2
prescribed fixtures are all present and byte-pinned:

| Addendum-B2 fixture | Implementation line |
|---|---|
| positive: no optional fields (`wait`) | 26 |
| positive: TAG_DIR only (`move dir=3`) | 33 |
| positive: TAG_TARGET + TAG_ITEM + TAG_DIR | 57 |
| positive: round-trip property | 86 |
| REJECT type_len = 0 | 145 |
| REJECT type_len = 65 | 151 |
| REJECT tag 0x40 | 167 |
| REJECT TAG_DIR before TAG_ITEM | 176 |
| REJECT TAG_DIR appearing twice | 197 |
| REJECT item_len past buffer end | 227 |

Plus 15 more tests (positive boundary cases for ±2³¹ targets, single
TAG_TARGET / TAG_ITEM, all-three combination, non-zero offset cross-
action decode, unsupported version, truncated type, truncated
TAG_TARGET payload, truncated TAG_DIR no payload, truncated TAG_ITEM
no item_len, dir>7, empty buffer, version-only buffer, invalid UTF-8
in item, invalid UTF-8 in type).

**Em-dash check on the `decodeAction: unknown tag …` pinned message.**
The addendum text at `decision-memo-phase-8.md:3036-3038` reads:

> `"decodeAction: unknown tag 0x<hh> at offset <i> (this build supports v1 tags 0x10, 0x20, 0x30 only — load 'releases/<commit>/' for the build that produced this log)"`

Production code at `src/core/encode.ts:181` and the test regex at
`tests/core/decode-action.test.ts:172` both contain U+2014 (em-dash)
verified byte-exact via Python codepoint scan. Test passes; the
implementation reproduces the addendum text.

**Round-trip property.** Iterates 6 type strings × 2³ optional-field
permutations = 48 fixtures (`tests/core/decode-action.test.ts:92-109`),
asserting `encodeAction → decodeAction` is identity on each. Covers
every tag combination. The mid-stream `decodeAction(concat, offset)`
case is exercised at line 119-135. PASS.

**`tests/share/action-log.test.ts` (20 tests).** The wire-form shape
test pins the 8-byte header layout (49 43 45 01 + count u32 LE) at
`:50` and the post-header action bytes at `:54`. The CMF=0x78 zlib-
header byte assertion at `:79-91` proves `zlibSync` is in use (raw
`deflateSync` would emit no header at all); the FCHECK divisibility
check at `:90` defends against an fflate version that emits a
non-conforming zlib stream.

The byte-exact pinned action-log error messages are reproduced
verbatim — em-dash present at `:174` (`bad magic — expected 'ICE'`)
and `:190` (`unsupported version 2 (this build supports version 1) —
load a newer release`). The implementation strings at
`src/share/decode.ts:67` and `:74` use the same em-dash byte
sequence.

**SELF_TEST_WIN_LOG round-trip pin** (`:132-137`). Encodes 1217
actions, base64url-decompresses, and asserts the resulting array
equals SELF_TEST_WIN_LOG byte-identically. The wire form length is
sandwiched between 1000 and 20000 chars at `:139-147`, well under the
URL_FULL_LENGTH_HARD_CAP = 32000 budget.

**Determinism pin** at `:149-153`: two `encodeActionLog` calls produce
byte-identical output. Catches non-deterministic compression (e.g., a
future fflate change introducing a randomized strategy) at sandbox
time.

**`tests/verifier/verify.test.ts` (16 tests).** Every `VerifyResult`
kind from decision 10 is exercised:

| Kind | Test line |
|---|---|
| `valid` (43-char fp, 22-char fp, empty log, with expectedOutcome, with expectedRulesetVersion) | 53-98 |
| `fingerprint-mismatch` (wrong 22-char, wrong 43-char, seed differs, modIds differ) | 100-135 |
| `atlas-mismatch` | 137-149 |
| `ruleset-mismatch` | 151-165 |
| `state-hash-mismatch` | 167-181 |
| `outcome-mismatch` | 183-193 |
| `log-rejected` (base64url failure, bad-magic envelope) | 195-216 |
| Discriminated-union exhaustiveness | 218-238 |

The 22-char vs 43-char fingerprint paths are tested independently
(`:58-64` and `:111-119`), pinning the `result.computed` field's
length matches the claim's length. PASS.

**`tools/verify.test.ts` (3 smoke tests).** Spawns `npx tsx
tools/verify.ts` via `execSync`, pipes JSON args, and asserts exit code
+ stdout JSON. Covers exit 0 (valid), 1 (fingerprint-mismatch), 2
(stdin-not-JSON). The test correctly uses the CLI's fallback build
context (`commitHash="dev000000000"`, rulesetVersion=PLACEHOLDER,
atlasBinaryHash=EMPTY_SHA256) so the CLI's recomputed fingerprint
matches the claim. Marked `60_000ms` timeout for the `npx tsx` cold
start. PASS.

**Nit S1.** No verifier test exercises the case where the action log
itself is altered to produce a different end state (e.g., 4 waits
instead of 3) — the `state-hash-mismatch` test at `:167` tampers with
`claimedFinalStateHash` while keeping the action log intact. While
functionally equivalent for branch coverage (the verifier compares
`actualHash !== args.claimedFinalStateHash` symmetrically), an
"action-log-altered → produces different sim output → state-hash-
mismatch" test would more accurately model the attack vector the
verifier defends against (replay-with-tampered-log forgery). Filed
non-blocking; coverage on this branch is already 100%.

### 2. decodeAction correctness

PASS with two semantic notes.

**Stop condition (rule 5 of addendum B2).** Lines 174-177:

```ts
while (cursor < bytes.length) {
  const tag = bytes[cursor]!;
  if (tag === ACTION_VERSION) break;
  ...
}
```

Correctly stops at end-of-buffer AND at the next ACTION_VERSION byte.
The decoder relies on `ACTION_VERSION = 0x01` being byte-distinct
from `{TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30}` per addendum
B2 rule 5 — pinned by the structural tag-value choice.

**Ambiguity check.** Could a TAG_TARGET payload's first byte
accidentally be `0x01` and trigger the boundary break early? No —
the TAG_TARGET branch reads 4 bytes via DataView at lines 197-203
and advances `cursor` by 4 BEFORE the next loop iteration's
boundary check. The break only fires at the START of the loop, not
mid-payload. Robust.

**Strictly-increasing tag ordering (rule 4).** Lines 184-188:
`if (tag <= previousTag)` — strictly less-than-or-equal rejects
both reordering AND duplication. The two test cases at `:176`
(0x30 before 0x20) and `:197` (0x30 twice) confirm both rejection
modes.

**Unknown-tag error message** (rule 4). Line 181 reproduces the
addendum text byte-exact, including the em-dash. The hex padding
uses `padStart(2, "0")` so `0x40` renders as `0x40` (not `0x4`).
Verified at `tests/core/decode-action.test.ts:172`.

**Note S2 (semantic, non-blocking).** The `dir > 7` rejection at
`src/core/encode.ts:234-238` reuses the `truncated tag 0x30
payload at offset N` message even though the payload byte IS
present (just out-of-range). The literal English word "truncated"
implies the buffer ran out; here the buffer has the byte, it's
just an invalid value. **However, this matches the addendum
verbatim** — addendum B2 rule 4 at `decision-memo-phase-8.md:3047`
says *"insufficient bytes or out-of-range payload throws
'decodeAction: truncated tag 0x<hh> payload at offset <i>'"*. The
implementation correctly collapses both cases under one pinned
message per the memo's deliberate choice. Acceptable as written;
worth a future readability nit if a reviewer prefers
`payload-out-of-range` vs `truncated`.

**Note S3 (semantic, non-blocking).** `decodeAction` allows
`item: ""` (empty string) since `encodeUtf8Field` doesn't enforce a
minimum length on item, only on type. `encodeAction({type: "x",
item: ""})` produces 5 bytes [v, 1, x, TAG_ITEM, 0] which round-trip
back to `{type: "x", item: ""}`. Defensible (the wire shape is
unambiguous), but a future tightening could reject empty-string item
at encode time.

### 3. Verifier API contract correctness

PASS with one deviation noted.

**`fingerprint-mismatch` fires before `state-hash-mismatch`**
(prompt-asked invariant). Lines 109-120 fire before the sim runs at
line 149, so a URL with both wrong fingerprint AND wrong claimed
state hash returns `fingerprint-mismatch` (the cheaper, earlier
check). Verified by `tests/verifier/verify.test.ts:101-108`: a
tampered fingerprint with otherwise-valid args returns
`fingerprint-mismatch`. PASS.

**Optional `expectedRulesetVersion` / `expectedOutcome` semantics**
(prompt-asked). Both gated by `!== undefined` checks (lines 132,
152). Tests at `:92-97` and `:85-90` confirm the no-op path when
provided AND matching; tests at `:151-165` and `:183-193` confirm
the firing path when mismatched. Tests at `:53-83` confirm the
skipped path when absent. PASS.

**Advisory-A4 enforcement** (prompt-asked). The TypeScript signature
marks `expectedAtlasBinaryHash` as required (`readonly
expectedAtlasBinaryHash: string`), so a TypeScript caller cannot
omit it. A JS caller passing `undefined` would short-circuit to
`atlas-mismatch` because `undefined !== atlasBinaryHash` (line 123).
The test at `:138-148` confirms a `wrong = "deadbeef".repeat(8)` 64-
char value triggers `atlas-mismatch` with `expected: wrong, actual:
atlasBinaryHash`. **No test explicitly passes `undefined` as
`expectedAtlasBinaryHash`** to confirm the JS-runtime defense-in-
depth, but the type-level guarantee plus the inequality check make
the runtime path equivalent. Acceptable.

**Deviation N1 (non-blocking).** Memo decision 10's pseudocode at
`decision-memo-phase-8.md:1789-1803` orders the checks
**fingerprint → ruleset → atlas → log → outcome → state-hash**.
The implementation orders them
**fingerprint → atlas → ruleset → log → outcome → state-hash**
(atlas and ruleset swapped). The order matters when both are wrong:
the memo would return `ruleset-mismatch`, the implementation returns
`atlas-mismatch`. The test suite does NOT pin the joint order
(each kind is tested independently via single-field tampering), so
the deviation is invisible at the test surface. Defensible: with
advisory A4 making `expectedAtlasBinaryHash` required, atlas-first
fires the cheaper structural check (string equality on a 64-char
hex) before the more semantically-loaded ruleset check, but it does
deviate from the memo's pseudocode prescription. Filed non-blocking
because both orderings preserve the seven-kind contract; flag for
the 8.A.2b author to consider matching the memo prose, OR to
explicitly call out the swap in a comment with rationale.

**Dead-code S4 (non-blocking).** `normalizeFingerprint` at lines 83-
88 is the identity function — `return fp`. A future hook for
trim/lowercase, presumably. Inlining or removing it would clean
without changing behavior. The unused `claimedShort` variable at
line 121 (`void claimedShort;`) is similarly dead — set in both
branches of the if/else but never read. Minor; the `void` discard
silences the lint warning but signals incomplete refactor.

### 4. CLI hygiene

PASS.

**stdin handling.** `readStdin()` at lines 24-30 collects chunks via
`for await ... of process.stdin` and concatenates; correct for
`execSync(..., { input: ... })` streaming.

**Exit-code convention.**
- `0` on `kind === "valid"` (line 53)
- `1` on any other `kind` (line 53)
- `2` on stdin-read failure (line 41) or stdin-not-JSON (line 49)
- `3` on unhandled async error (line 58, the `main().catch`)

The 0 / 1 / 2 paths are tested; the 3 path is unreachable under
the current `verify(...)` implementation (which is pure and never
throws), but the catch handler is appropriate defense-in-depth for
future verifier additions that may throw on an unanticipated input.

**Stderr discipline.** All non-success paths write to stderr
(`process.stderr.write`); stdout is reserved for the JSON result.
`stdio: ["pipe", "pipe", "pipe"]` in the test ensures stderr does
not contaminate stdout. The test's `JSON.parse(stdout.trim())`
(line 80, 88) would fail if stdout contained any extraneous text;
clean separation.

**Minor S5.** No test for exit code 3 (the `main().catch` path).
The unreachable-under-current-code argument is reasonable, but a
single test that mocks `verify` to throw would lock the contract.
Non-blocking; the path is structurally simple.

### 5. REPLAY_DIGEST self-test

PASS with one note.

**Constant declaration** (`src/core/self-test.ts:155`):

```ts
export const REPLAY_DIGEST = WIN_DIGEST;
```

By-construction equality: the codec is identity on action sequences,
so `runScripted(decodeActionLog(encodeActionLog(SELF_TEST_WIN_LOG)))`
final state hash MUST equal `runScripted(SELF_TEST_WIN_LOG)`'s final
state hash, which is `WIN_DIGEST`.

**Test entry** (`src/core/self-test.ts:434-463`). The check actually
exercises both codec halves:

```ts
const wire = encodeActionLog(SELF_TEST_WIN_LOG);
const decoded = decodeActionLog(wire);
const result = runScripted({ inputs: SELF_TEST_WIN_INPUTS, actions: decoded });
assert(result.outcome === "won", ...);
assert(sha256Hex(result.finalState.stateHash) === REPLAY_DIGEST, ...);
```

The check would NOT pass if `decodeActionLog` returned the input
unchanged (since `wire` is a base64url string, not an `Action[]` —
the type would mismatch, the sim would refuse). It would also fail
if `encodeActionLog` corrupted the sequence (the resulting `decoded`
array would differ from SELF_TEST_WIN_LOG, producing a different
state hash). So the check is NOT tautological: it surfaces silent
codec drift in either direction.

**Cross-runtime guarantee** rests on `zlibSync(level: 1)` byte-
identity, which is already pinned by Phase 4's atlas-PNG encoder
(`ATLAS_DIGEST` cross-OS matrix). Phase 4.B's
`cross-os-atlas-equality` matrix already validates this fflate
property. The REPLAY_DIGEST entry inherits the same property.

**Note S6 (non-blocking).** The check name uses a hyphen
(`replay-cross-runtime-digest`) consistent with the existing
`{sim,inventory,win,atlas,mapgen}-cross-runtime-digest` naming
pattern. No drift.

### 6. Coverage drift

PASS.

`parseActionLogEnvelope` (the lower-level entry point) is tested
directly at `tests/share/action-log.test.ts:260-275`:

```ts
parseActionLogEnvelope(buildActionLogEnvelope([{type:"x"},{type:"y"}]))
parseActionLogEnvelope(<bad-magic envelope>) // pinned error
```

Both fingerprint-claim paths are tested:
- 22-char short form: `verify.test.ts:58-64`, `:101-108`
- 43-char full form: `verify.test.ts:55`, `:111-119`

`100/100/100/100` coverage on `src/share/encode.ts`,
`src/share/decode.ts`, `src/verifier/verify.ts`, AND the
`decodeAction` half of `src/core/encode.ts` (joining the existing
`encodeAction` pin — `src/core/**` is at 100/100/100/100). Coverage
thresholds (`vitest.config.ts`'s 100/100/100/90 for the new scopes)
are met.

### 7. Reachability impact (memo addendum B8)

PASS. The reachability test passes (7/7) on current HEAD and the
pinned count of 36 reachable files is preserved. Verified that:

- `src/core/self-test.ts` imports `src/share/encode` and
  `src/share/decode` (lines 30-31), but `self-test.ts` is NOT
  reachable from `src/sim/harness.ts` (it sits on the OTHER side
  of the diagnostic-harness boundary — `src/main.ts` and the test
  file `src/core/self-test.test.ts` import self-test, not
  harness). The walker correctly finds 36 files; share/verifier do
  not appear.
- `src/verifier/verify.ts` imports `src/sim/harness` (line 13) and
  `src/share/decode` (line 12). This is the load-bearing one-way
  edge per memo decision 10 + addendum B8: verifier → harness is
  allowed; harness → verifier is forbidden. The reverse direction
  is structurally enforced by the `src/sim/**` lint scope's
  cross-layer ban list (eslint.config.js:511-560 includes a `.ui`
  ban, etc.) plus the explicit `src/verifier/**` listing in the
  reachability test's anti-cycle defense (`tests/build/rules-files-
  reachability.test.ts:200`).
- `src/share/**` lint-scope cross-layer ban
  (eslint.config.js:751-791) DOES include `**/sim/**` in the
  forbidden group list, so `src/share/decode.ts`'s import of
  `src/core/encode.ts` (which is allowed) is the only edge into
  the share layer. The verifier's import of share is allowed by
  the verifier scope's group list (which omits `**/share/**`).

The Phase 8.A.1 N1 fix (mis-scoped advisory-A1 exception) is not
tested here because no router file exists yet; deferred to 8.A.2b.

### 8. Hidden coupling / overlap

PASS with one observation.

**`parseActionLogEnvelope` vs `decodeActionLog` boundary.** Both
are exported from `src/share/decode.ts`. The boundary is clean:
- `decodeActionLog(wire: string)` is the wire-format entry point
  (base64url + zlib + envelope parse).
- `parseActionLogEnvelope(envelope: Uint8Array)` is the pre-
  decompressed entry point (envelope parse only).

The verifier calls `decodeActionLog` (line 144 in `verify.ts`),
not `parseActionLogEnvelope` — correct. A reviewer worried about
the verifier accidentally bypassing base64url + zlib checks would
look here; the import surface (`import { decodeActionLog } from
"../share/decode"`) lints clean.

**`actionLogError` flag observation N2 (non-blocking).** The
decoder sets `actionLogError: true` on every thrown error (lines
44-49 of `src/share/decode.ts`), but no downstream code reads this
flag in 8.A.2a. The verifier just catches `(e as Error).message`
(line 145 of `verify.ts`), which works whether or not the flag is
set. The flag is presumably intended for the 8.A.2b router / UI to
distinguish envelope errors from generic JS errors (e.g., for
classifying `kind: "log-rejected"` vs unknown errors). For 8.A.2a
the flag is dead weight. Acceptable as scaffolding for the next
iteration; should either be consumed in 8.A.2b OR documented as
"reserved for 8.A.2b" with a TODO.

**Verifier delegates correctly.** No business-logic duplication
across layers:
- Sim execution → delegated to `runScripted` (sim/harness)
- Action-log decoding → delegated to `decodeActionLog` (share)
- Fingerprint computation → delegated to `fingerprintFull` (core)
- State-hash hashing → delegated to `sha256Hex` (core)

The verifier is a 175-line orchestrator that strings these
together; no layer's responsibilities are duplicated.

### 9. Lint-scope correctness

PASS.

**`src/share/**` `deflateSync`/`inflateSync` ban.**
`eslint.config.js:771-778` declares:

```js
paths: [{
  name: "fflate",
  importNames: ["deflateSync", "inflateSync"],
  message: "src/share/** must use `zlibSync`/`unzlibSync` ..."
}]
```

The Phase 8.A.1 review verified this works live (probe-tested at
that phase's gates). Re-confirmed: the actual production import at
`src/share/encode.ts:1` is `import { zlibSync } from "fflate"` —
allowed. The decoder at `src/share/decode.ts:1` is `import
{ unzlibSync } from "fflate"` — also allowed. Lint passes (0
errors).

**`src/verifier/**` cross-layer scope.**
`eslint.config.js:704-735` declares the verifier may import only
core, share, sim/harness, sim/types, build-info — i.e., the group
list at lines 712-720 forbids render/input/atlas/router/save/main,
but NOT sim. The actual production imports at
`src/verifier/verify.ts:1-14` — `core/hash`, `core/fingerprint`,
`build-info`, `share/decode`, `sim/harness`, `sim/types` — all
allowed. The deliberate carve-out for `sim/harness` is the load-
bearing memo decision 10 invariant; it is structurally preserved.

**Determinism plugin (8.A.1 N3 fix).** `eslint.config.js:844-860`
applies `determinism/no-float-arithmetic` to all four new layers
including `src/share/**` and `src/verifier/**`. No float arithmetic
in the new production code (the codec is byte-deterministic; the
verifier hashes integers); lint passes.

**The advisory-A1 exception scope** (carry-forward from 8.A.1 N1).
`eslint.config.js:625-692` re-applies the bans for non-A1 router
files via a tighter scope and lifts only Date for
`release-index-parse.ts`. The pattern is correct, but no router
file exists yet to exercise it; deferred validation to 8.A.2b.

## Non-blocking suggestions

**N1 (architecture — order of checks).** `verify(args)` swaps the
order of `atlas-mismatch` and `ruleset-mismatch` relative to memo
decision 10's pseudocode at `decision-memo-phase-8.md:1789-1803`.
The memo orders ruleset → atlas; the implementation orders atlas →
ruleset. Either consume this swap in a code comment with rationale
(e.g., "atlas-first per advisory A4: required field, cheaper
structural check"), or restore the memo's order in 8.A.2b. The
seven-kind contract is preserved either way; only the joint-failure
disambiguation differs. Test suite does not pin the joint order.

**N2 (dead weight).** The `actionLogError: true` flag set on every
thrown error in `src/share/decode.ts` is not consumed by any
downstream code in 8.A.2a. Either consume it in the 8.A.2b router
/ UI to distinguish envelope errors from generic JS errors, or
remove it. Currently it is documented at the type level
(`DecodeActionLogError = Error & { readonly actionLogError: true }`)
but no caller narrows on this brand.

**N3 (dead weight, follow-up to N2).** `normalizeFingerprint` at
`src/verifier/verify.ts:83-88` is the identity function. The
trailing `void claimedShort;` at line 121 silences a compiler
warning about an assigned-but-not-used local. Both signal
incomplete refactor — clean these in 8.A.2b OR document them as
"reserved for case-insensitive comparison" / "reserved for
short-fingerprint return surface."

**S1 (test depth).** No verifier test exercises the case where the
action log is altered (rather than the claimed state hash) to
produce a `state-hash-mismatch`. Functionally equivalent for branch
coverage (the comparison is symmetric), but a "log-tampered →
different sim output → state-hash-mismatch" test more accurately
models the attack-vector the verifier defends against.

**S2 (semantic readability).** The `dir > 7` rejection in
`decodeAction` reuses the `truncated tag 0x30 payload` message even
though the byte IS present. **This matches the addendum verbatim**
(addendum B2 rule 4 collapses both cases under one message), so
the code is correct as pinned. Future readability improvement
could split `truncated` (insufficient bytes) from `payload-out-of-
range` (byte present but invalid value), but that would require an
addendum amendment.

**S3 (semantic).** `decodeAction` accepts `item: ""` (empty-string
item) on the round-trip, since `encodeUtf8Field` does not enforce a
non-zero minimum on the item field (only on type). Wire shape is
unambiguous (`[TAG_ITEM][item_len=0]`). Defensible; a future
tightening could reject empty-string item at encode time, but
nothing in the addendum requires this.

**S4 (test depth).** No test for `tools/verify.ts` exit code 3 (the
`main().catch` unhandled-error path). Currently unreachable since
`verify(...)` is pure and never throws; a single test that mocks
the import to throw would lock the contract. Non-blocking; the
path is structurally simple.

**S5 (test extension).** The verifier's `state-hash-mismatch` test
re-asserts the `expected` field equals the wrong claim and
`actual` equals the truthful sim hash. This is correct, but the
field naming in the result type (`expected` = the claim, `actual` =
the sim) is the OPPOSITE of the convention used in
`fingerprint-mismatch` (where `computed` = the truthful recomputed
fingerprint, no `expected` field). A reviewer scanning the result
types may be confused; the discriminator's per-kind shape is
intentional but the naming asymmetry is noticeable. Filed for
documentation in `docs/ARCHITECTURE.md`'s frozen-contracts
section, not as a code change.

## Test adequacy assessment

The testing gate from `docs/QUALITY_GATES.md` is satisfied:

- **New module / public behavior** — every new module has an
  accompanying test file. `decodeAction` (25 tests), action-log
  codec (20 tests), verifier (16 tests), CLI (3 smoke tests),
  REPLAY_DIGEST self-test (1 cross-runtime entry). Total +70 tests
  / +5 files since 8.A.1 baseline.
- **Test names describe behavior** — confirmed by reading: "decodes
  an action with TAG_DIR only", "rejects bad magic", "returns kind:
  'fingerprint-mismatch' when the claimed fp doesn't decode to the
  inputs", "exits 0 with kind: 'valid' when args are correct".
- **Edge cases** — every addendum-B2 rejection branch tested;
  every VerifyResult kind tested; both fingerprint-length forms
  tested; SELF_TEST_WIN_LOG (1217 actions, the realistic upper-end
  of an action log) round-trips; URL_FULL_LENGTH_HARD_CAP budget
  asserted.
- **Bug fix** — not applicable; this iteration adds new code.
- **Coverage thresholds** — `src/share/**` 100/100/100/100;
  `src/verifier/**` 100/100/100/100; `src/core/encode.ts` (incl.
  decodeAction) 100/100/100/100. Above the 100/100/100/90 gate
  set in `vitest.config.ts`.

The cross-runtime golden chain extension via REPLAY_DIGEST is the
8.A.2a delivery for memo decision 13: any silent drift in the
codec contract surfaces here in any runtime.

## Approval verdict

**APPROVE-WITH-NITS.**

All nine review-focus items pass cleanly. The two notable deviations
are non-blocking:

1. **N1.** The implementation swaps the order of `atlas-mismatch`
   and `ruleset-mismatch` checks relative to memo decision 10's
   pseudocode. The seven-kind discriminated-union contract is
   preserved; only the joint-failure disambiguation differs. Test
   suite does not pin the joint order. Defensible per advisory A4
   making `expectedAtlasBinaryHash` required, but should be either
   commented in code OR matched to the memo prose in 8.A.2b.

2. **N2 / N3.** Three small dead-code residues (`actionLogError`
   flag set but never read; `normalizeFingerprint` is identity;
   `claimedShort` set then discarded). Either consume them in
   8.A.2b OR clean them. Each is structurally minor but signals
   incomplete refactoring and should be addressed before 8.A.2b
   ships (where the router / UI either consumes the flag and
   normalizes the fingerprint, OR neither — the current
   "scaffolding for next iteration" framing is acceptable for
   8.A.2a but should not persist past 8.A.2b).

All gates green: 1049 tests / 75 files / 0 lint / 0 typecheck /
124.04 KB raw / 36.46 KB gzipped (under the 75 KB CI gate; 110 KB
budget bump deferred to 8.A.2b per addendum B9). Cross-runtime
golden chain preserved unchanged + REPLAY_DIGEST joins it.
Reachability walker holds at 36 files; the Phase 8 anti-cycle
defense (no `src/{router,verifier,share,save}/` reachable from
harness) is structurally enforced.

The 10 addendum-B2 prescribed `decodeAction` fixtures are all
present and pinned byte-exact (em-dash + hex padding + offset
formatting verified). All 7 `VerifyResult` kinds are reachable by
tests. The advisory-A4 `expectedAtlasBinaryHash`-required
invariant is enforced at TypeScript-type level AND at runtime
(via the inequality short-circuit). The codec uses `zlibSync`
not `deflateSync` (CMF=0x78 + FCHECK divisibility checked). The
REPLAY_DIGEST self-test exercises both codec halves (not
tautological).

Phase 8.A.2b (router + save layer + diagnostic UI wiring +
deploy.yml budget bump) is unblocked.

## Files relevant to this review

Source (in scope):

- `/workspace/src/core/encode.ts` (decodeAction added; encodeAction unchanged)
- `/workspace/src/share/encode.ts` (new)
- `/workspace/src/share/decode.ts` (new)
- `/workspace/src/verifier/verify.ts` (new)
- `/workspace/tools/verify.ts` (new CLI)
- `/workspace/src/core/self-test.ts` (REPLAY_DIGEST + replay-cross-runtime-digest entry)

Tests (in scope):

- `/workspace/tests/core/decode-action.test.ts` (new, 25 tests)
- `/workspace/tests/share/action-log.test.ts` (new, 20 tests)
- `/workspace/tests/verifier/verify.test.ts` (new, 16 tests)
- `/workspace/tools/verify.test.ts` (new, 3 smoke tests)

Configuration / build (in scope):

- `/workspace/vitest.config.ts` (tools/**.test.ts in test discovery; src/share + src/verifier coverage scopes)
- `/workspace/eslint.config.js` (Phase 8.A.1's lint scopes — the share + verifier lint scopes activated by the new code)

Phase context:

- `/workspace/artifacts/decision-memo-phase-8.md` (decision 2, 10, 13 + addendum B1, B2, B8 + advisory A4)
- `/workspace/artifacts/red-team-phase-8.md`
- `/workspace/artifacts/code-review-phase-8-A-1.md` (Phase 8.A.1 code review — drift sweep + scaffolding)
- `/workspace/artifacts/phase-approval.json` (Phase 8.A.1 approved on master at 47f8a1c)
- `/workspace/docs/PHASES.md` (Phase 8 spec at lines 534-567)
- `/workspace/docs/QUALITY_GATES.md` (testing gate, DRY gate, drift detection gate)

Reachability invariant (verified by re-running the walker):

- `/workspace/tests/build/rules-files-reachability.test.ts` (7/7 pass; 36 reachable files; share + verifier NOT reachable from harness — the Phase 8 anti-cycle defense holds)
