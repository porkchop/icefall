# Architecture Red-Team Review — Phase 3 Decision Memo

Reviewer: `architecture-red-team`
Subject: `/workspace/artifacts/decision-memo-phase-3.md`
Phase 1 baseline: commit `2038fc9` on master (Phase 1.A + 1.B approved).
Phase 2 baseline: commit `0ad18da` on master (Phase 2.0 + 2.A + 2.B approved).
Phase 3 carry-forwards from Phase 2.A: N3, N7 (per
`/workspace/artifacts/phase-approval.json:47-51`).

## Verdict

**REVISE BEFORE IMPLEMENTATION.**

The memo is structurally sound and the algorithmic choices (one-action-per-chain
advance, integer FSM AI, frozen roll domains, sandbox/live phase split) are the
right ones. But several wire-format details are under-specified in ways two
competent implementers would *not* converge on byte-identically; one frozen
contract claim about `ai:tiebreak` is internally contradictory; one runtime
guard is under-tightened in a way that lets a Phase 6 regression slip past;
and one carry-forward (N7) has a hidden import-graph hazard the memo asserts
away without verifying. Each is cheap to fix in the memo before any
`src/sim/**` code is written. After the addendum below, this memo is
APPROVE.

The phase split (3.0 / 3.A / 3.B), the four-action vocabulary, the
ascending-id tick order, the immutable `RunState` shape, and the
`SIM_DIGEST` golden self-test are endorsed without modification.

## Blocking issues (must address before any code)

### B1. `lp_utf8(domain)` in the roll-derivation pre-image is silently a *new* prefixing scheme, not Phase 1's `lp_utf8(name)`

Decision 4 specifies:

```
function rollBytes(stateHashPre, action, domain, index) =
  sha256(stateHashPre ‖ encodeAction(action) ‖ lp_utf8(domain) ‖ u32_le(index))

  // lpDomain = lp_utf8(domain)              // [len:1][utf8...]
```

Read in isolation, this looks like reuse of Phase 1's
`streamSeed`/`streamPrng` pre-image format. It is *not* — and the memo does
not say what `lp_utf8` does on the edge cases that matter:

1. **Empty / overlong rejection.** Phase 1's `streamSeed`
   (`/workspace/src/core/streams.ts:71-76`) explicitly rejects
   `nameBytes.length === 0` and `nameBytes.length > 255`. The Phase 3 memo
   constrains `domain` to "≤ 31 bytes" (decision 4a), but says nothing about
   empty-string rejection, well-formed-UTF-16 validation, or the exact
   error text on violation. Two implementers will diverge on whether
   `domain = ""` is accepted (one byte `0x00` length prefix, four bytes
   index — totally legal SHA-256 input) or rejected.

2. **UTF-8 byte length vs UTF-16 code-unit length.** The frozen
   roll-domain registry is "bare ASCII" (decision 4a), so for the *current*
   domains the two are identical. But the memo says adding domains is
   additive. A Phase 6 PR that adds a domain like `"crit:✦special"` would
   expose the choice — UTF-8 byte length (Phase 1 idiom) vs JavaScript
   `string.length` (UTF-16 code units). The memo has not pinned this, so
   adding the first non-ASCII domain is a silent fingerprint break. That
   is exactly the bug class B1 of the Phase 2 review caught for `tilesB64`
   (alphabet ambiguity).

3. **Domain pre-image is not symmetric with `streamSeed`.** Phase 1's
   `streamSeed` interleaves `STREAM_DOMAIN` (`"icefall:v1:"`) between the
   root seed and the length-prefixed name
   (`/workspace/src/core/streams.ts:81`). The Phase 3 roll pre-image has
   no such anchor. A maliciously-constructed `encodeAction` payload could
   in principle be made to look like a roll pre-image — and even if no
   such collision is reachable in practice, the absence of a domain
   anchor is a regression in defence in depth relative to the
   stream-derivation idiom the memo claims to be mirroring (decision 4
   "Why this option").

**Fix.** State explicitly:

> `lp_utf8(domain)` is `[byteLen:1][utf8_bytes...]` where `byteLen =
> TextEncoder.encode(domain).length`, identical to the
> `streamSeed`-internal name-prefix encoding. `domain` must satisfy
> `1 ≤ byteLen ≤ 31`, must be well-formed UTF-16 (no unpaired
> surrogates), and Phase 3's frozen domains additionally must be 7-bit
> ASCII. `index` is encoded by `DataView.setUint32(_, value, true)`
> (little-endian unsigned 32-bit), with `value ∈ [0, 2^32 - 1]`. Negative
> or non-integer `index` is rejected at runtime.

Also: pin a domain anchor between `encodeAction(action)` and
`lp_utf8(domain)` — e.g., the literal byte `0xff` (a tag the Phase 1
encoder already declares "reserved" — `docs/ARCHITECTURE.md:249`) or the
ASCII string `"icefall:roll:v1:"` length-prefixed. This makes the
roll pre-image impossible to confuse with any future action-encoding tag
extension. (Right now, two consecutive action descriptors and a roll
pre-image starting at the same `stateHashPre` are not collision-proof
*by construction*; they are collision-proof only because adversarial
inputs are not on the threat model. Phase 8 may broaden the threat
model when external action logs land.)

This is blocking because the roll function is the new hot frozen
contract (the memo's own risk section calls it that), and an
under-specified pre-image is the cheapest possible Phase-3-ships-then-bumps
mistake.

### B2. `rollU32` byte order is *implicitly* little-endian — pin it explicitly and pin the hash bytes consumed

Decision 4 shows:

```ts
function rollU32(stateHashPre, action, domain, index): uint32 {
  const b = rollBytes(stateHashPre, action, domain, index);
  return (b[0] | (b[1]<<8) | (b[2]<<16) | (b[3]<<24)) >>> 0;
}
```

This is little-endian-from-the-low-bytes. It is the intuitive choice and
matches `sfc32FromBytes` (`/workspace/src/core/prng.ts` consumes
`streamSeed[0..16]` as four little-endian u32s — see also the
`streamSeed[0..16]` comment at `docs/ARCHITECTURE.md:76`). But:

1. **The memo does not say "little-endian" anywhere in decision 4.** The
   formula is shown but the byte-order *name* never appears in the prose,
   and the prose-vs-code split is exactly where Phase 2's review caught
   B1 (alphabet name vs alphabet semantics). A future maintainer
   skim-reading the memo prose for the contract may not realize the
   little-endianness is load-bearing.

2. **The choice of bytes 0..4 is silent.** The hash is 32 bytes; bytes
   `4..32` are unused. Decision 4's "Roll bytes = `stateHashPost[0..4]`"
   alternative was rejected for collision reasons, but the memo's chosen
   formula *also* uses only bytes `0..4` of a fresh per-call hash. That
   is fine, but the memo should state it: "`rollU32` consumes
   `rollBytes(...)[0..4]` little-endian; future helpers `rollU64`,
   `rollFloat01`, etc. consume non-overlapping byte ranges from the same
   subhash and will be added when needed." Otherwise a Phase 4 or Phase 6
   helper that says "I'll just take bytes `4..8` for my second roll on
   the same action" silently double-consumes the same input distribution
   in a way the formula never warned about.

3. **`bonus = rollU32(...) & 0x03` discards 30 of 32 bits.** Fine for
   bonus ∈ [0..3], but the memo should note that future combat formulas
   will use *more* of the u32 — and any change to the bit-extraction
   recipe (e.g., taking the top two bits instead of the bottom two)
   silently changes pre-bump fingerprints. Pin: "bottom N bits via
   bitwise AND mask; never top bits via shift."

**Fix.** Add to the frozen-contract list:

> Frozen contract item 4 (combat damage formula) is fully spelled
> as: `rollU32(state, action, domain, index)` returns
> `(b[0] | (b[1]<<8) | (b[2]<<16) | (b[3]<<24)) >>> 0` where `b` is
> `rollBytes(...)[0..4]`. Bit extraction of sub-ranges from the u32 is
> by bitwise AND with a low-bit mask (e.g., `& 0x03` for 0..3, `& 0x0f`
> for 0..15); top-bit shifts are not used. Future per-roll helpers
> (`rollU64`, etc.) take non-overlapping byte ranges of the subhash and
> are pinned at point of introduction, not implicitly.

Blocking because the combat formula is item 4 of the new frozen-contract
list and the memo's own risk section says "any change to `rollBytes`
invalidates every fingerprint." The byte-order claim is currently
implicit *and* the bit-extraction recipe is unannotated.

### B3. `ai:tiebreak` roll domain contradicts decision 7's "no PRNG inside an AI tick"

Decision 4a's roll domain registry includes:

```
| `ai:tiebreak`           | Reserved — used in decision 7 ties.          |
```

Decision 7 says — twice — that AI is zero-PRNG:

- "No PRNG inside an AI tick; the lexicographic direction tiebreak makes
  every transition deterministic without randomness."
- Frozen-contract item 7: "Monster AI is zero-PRNG inside a tick."

These are contradictory on the wire. Either decision 7's tiebreak rule
is purely lexicographic (in which case `ai:tiebreak` is dead code in the
registry and must not be marked "frozen"), *or* there is some case
where the lexicographic order is insufficient and a roll is consulted
(in which case the runtime guard in decision 8 — "per-tick `__consumed`
delta is empty" — is correct only because rolls don't go through
`__consumed`, but the no-PRNG-in-AI claim is wrong).

This matters because frozen-contract item 3 (the roll-domain registry)
says "Adding additive; removing/renaming a bump." If `ai:tiebreak` is
shipped in Phase 3 as a frozen domain and Phase 7 decides BFS-equidistant
ties should still be lexicographic, *removing* `ai:tiebreak` from the
registry is a `rulesetVersion` bump for no behavioral change.

**Fix.** Pick one:

a. **Remove `ai:tiebreak` from the Phase 3 registry.** The lexicographic
   tiebreak in decision 7 is sufficient. If Phase 7's boss FSM ever
   needs randomized tiebreaks, the addition is a frozen-contract addendum
   at that point. (Recommended — keep the v1 surface minimal.)

b. **Keep `ai:tiebreak` and rewrite decision 7 to say what triggers a
   roll.** E.g., "BFS produces equidistant cells X and Y at the same
   `(distance, tiebreak-direction)` priority — disambiguate via
   `rollU32(state, action, "ai:tiebreak", 0) & 0x07`." Then frozen-contract
   item 7 must say "AI consumes zero PRNG cursors but may emit one or
   more rolls per tick; rolls are not PRNG cursors and do not appear in
   `__consumed`."

The current text is internally inconsistent and a verifier reading the
memo cannot tell which behavior is intended.

### B4. `streams.simFloor(floorN)` accepting `floorN ≤ 0` or non-int produces a silent collision-or-error split

Decision 6 specifies:

```ts
simFloor(floorN: int32): PRNG
// derives streamPrng(rootSeed, "sim", floorN)
// records `"sim:" + floorN` into __consumed
```

Phase 1 floor numbers are `1..10` (frozen by Phase 2 mapgen), but
`int32` is the type-level constraint and the memo says nothing about
runtime validation. Three concrete failure modes:

1. **`simFloor(0)`.** `streamPrng(rootSeed, "sim", 0)` is a *legal* call
   under the Phase 1 contract — `encodeSalt(0)` produces
   `[0x01][0x00,0x00,0x00,0x00]` = 5 bytes. `__consumed` records `"sim:0"`.
   This is a real PRNG state, distinct from `streams.sim()` (zero salts,
   fewer bytes). If a future Phase 7 boss-fight refactor reaches for
   `streams.simFloor(0)` thinking "floor 0 = pre-run" while another
   commit elsewhere reaches for `streams.simFloor(0)` thinking "floor
   0 = tutorial", they collide.

2. **`simFloor(-1)`.** Also legal — `encodeSalt(-1)` is
   `[0x01][0xff,0xff,0xff,0xff]`. Records `"sim:-1"`.

3. **`simFloor(1.5)` or `simFloor(NaN)`.** `Number.isInteger(1.5)` is
   false; `encodeSalt` *throws* (`/workspace/src/core/streams.ts:22-24`).
   But the memo's "type-level" defence (decision 8 layer 1) is just
   `int32` in TypeScript, which does not guard at runtime. The error
   path *does* fire from `encodeSalt`, but its message ("encodeSalt:
   integer out of int32 range") is not "simFloor: floorN must be 1..10",
   so the diagnostic is misleading.

**Fix.** Add to decision 6:

> `simFloor(floorN)` validates `Number.isInteger(floorN) && 1 ≤ floorN ≤
> 10` at runtime and throws `simFloor: floorN must be 1..10 (got N)` on
> violation. The valid range matches the frozen floor-count contract
> (`docs/PHASES.md` Phase 2). Bumping the floor count is a separate
> `rulesetVersion` change with its own architecture review.

Also: confirm explicitly in decision 6 that `(name="sim", salts=[])`
(the existing `streams.sim()`) and `(name="sim", salts=[1])`
(`streams.simFloor(1)`) produce *distinct* `streamSeed` pre-images and
therefore distinct PRNG states. They do — because `streamSeed` includes
salts left-to-right and zero-salts vs one-int-salt differ by 5 bytes —
but the memo doesn't *say* this. Without the explicit non-collision
claim, a reader has to walk through `streamSeed`'s implementation to
verify. (Phase 2's review caught the symmetric problem on
`tilesB64`-vs-padding; this is the same shape.)

Blocking because the salt encoding `(name="sim", salts=[floorN])` is
listed as a frozen contract (item 8 of the memo's new list); a frozen
contract that doesn't pin the legal range of `floorN` is incomplete.

### B5. The runtime guard's "per-tick `__consumed` delta is empty" claim has a sharp boundary problem at floor entry

Decision 8 layer 3 says:

> `tick(state, action)` snapshots `runStreams.__consumed` at entry and
> asserts at exit that the delta is empty — i.e., a single tick
> consumes no PRNG state. The spawn-only PRNG consumption happens at
> floor-entry (decision 6a) and asserts the per-floor delta is exactly
> `{"sim:" + floorN}`.

Read together with decision 6a:

> When the player enters a floor (including floor 1 at run start),
> `spawnFloorEntities(floorN, floor, runStreams)` ... [consumes
> `streams.simFloor(floorN)`] ... and returns the populated
> `FloorState`.

Two implementers will diverge on the boundary:

1. **Implementer A.** `tick(state, action)` is "the function that takes
   one player action." On `descend`, the action *triggers* a
   floor-transition, which calls `spawnFloorEntities(n+1, ...)`. Under
   this reading, the per-tick delta on a `descend` tick is *not* empty
   — it includes `"sim:" + (n+1)`. The runtime guard in decision 8
   layer 3 false-positives on every successful descend.

2. **Implementer B.** `spawnFloorEntities` is called *outside* `tick`,
   in a wrapper that drives the run state machine; `tick` only resolves
   monster-loop and player-resolution effects, so the per-tick delta is
   empty by construction. Under this reading, the harness
   (`runScripted`) has to make two separate calls — one for the action,
   one for the floor entry — which the harness signature in decision 9
   does not advertise.

The memo says "spawn happens at floor entry separately from `tick`"
(prose only — line 8 — without function names), but does not say
*where* the floor-entry call lives or how `runScripted` orchestrates
it. The only data point is decision 11: "`descend` action on floor `n`
... moves the player to floor `n+1`'s entrance" — which is exactly the
ambiguous case.

**Fix.** Specify the orchestration surface:

> `tick(state: RunState, action: Action): RunState` is *the only*
> function that consumes the per-roll subhash and the *only* function
> the runtime guard asserts has empty `__consumed` delta. When the
> resolved action is `descend` and the descent succeeds, `tick` does
> the following in this order: (a) compute new `floorN`, (b) call
> `spawnFloorEntities(newFloorN, newFloor, runStreams)`, (c) update
> `RunState.floorState`. The runtime guard inside `tick` therefore
> asserts the per-tick delta is *either* `{}` (non-descent or
> failed-descent) *or* exactly `{"sim:" + newFloorN}` (successful
> descent). The acceptance-criterion-equivalent self-test
> (`sim-stream-isolation`) tests both branches.

Equivalent fix: keep the empty-delta-only invariant and pull
`spawnFloorEntities` out of `tick`, but then `runScripted` has to
explicitly orchestrate floor entry — say so in decision 9.

Either is acceptable; the current memo is silent and the runtime guard
will fire on the wrong branch. Blocking because frozen-contract item 9
("Per-tick `__consumed` delta is empty") is wrong as written for the
descent case.

### B6. Carry-forward N7 (decoder relocation) creates a *test-coverage* and *lint-scope* drift the memo asserts away

The memo's risk section claims:

> Carry-forward N7 ... `src/core/hash.ts` would now host both
> `base64url` encoder and `decodeBase64Url` decoder; `src/mapgen/serialize.ts`
> imports the decoder. The existing `base64url` encoder import in
> `src/mapgen/serialize.ts` already establishes the `mapgen → core/hash`
> direction; adding the decoder import does not create a cycle.
> Verified by reading the import graph; documented here as a check item
> for the code-reviewer.

The cycle claim is correct (mapgen → core is allowed; core → mapgen is
the forbidden direction, and the relocation does not introduce a core
→ mapgen edge). But two other concerns the memo does *not* address:

1. **Test-coverage drift.** The Phase 2 100% coverage gate
   (`/workspace/artifacts/phase-approval.json:9` — "100% lines /
   100% statements / 100% functions on src/core/**, src/mapgen/**") is
   currently satisfied by the round-trip tests in `src/mapgen/**`
   (which exercise `decodeBase64Url` *via* `serialize.ts`). After the
   relocation, `decodeBase64Url` lives in `src/core/hash.ts` —
   `src/core/**` has its own 100% coverage gate. The round-trip tests
   reaching from mapgen still cover the function transitively, but the
   *Vitest scope* changes: a mapgen test exercising
   `decodeBase64Url(invalidInput)` now produces coverage attributed to
   `src/core/hash.ts`. This is fine *if* the existing mapgen
   round-trip tests already exercise every branch of
   `decodeBase64Url` (the `r === 0`, `r === 2`, `r === 3` branches in
   `serialize.ts:411-441`). Only `r === 0` and `r === 3` are exercised
   by the standard fixture-pack widths (1440 = 60×24 → r=0; 1120 =
   40×28 → r=1 mod 4 — wait, 1120 is exactly 4×280 so r=0 again).
   *Both standard floor sizes have payload length divisible by 3, so
   neither exercises r=2 or the explicit-error branch (r=1 throw).*

   The Phase 2.A coverage gate passes today only because of the
   `/* v8 ignore start/stop */` blocks in `serialize.ts:222-229` and
   the negative-input tests; relocating without checking each branch
   re-test will silently drop a branch from `src/core/hash.ts`'s 100%
   gate.

2. **Lint-scope drift.** The `src/core/**` scope in `eslint.config.js:80-101`
   forbids imports from `src/mapgen/**`. That is preserved. But
   `src/core/**` also has a separate `no-restricted-syntax` rule set
   (FORBIDDEN_TIME) and *does not* have the
   `SIM_UNORDERED` / `no-float-arithmetic` rules. `decodeBase64Url`
   uses `Int16Array(128).fill(-1)`, integer bitwise ops, and a literal
   `-1` sentinel. All of those pass the existing core/ rules
   trivially. But `serialize.ts:395-403` defines `B64URL_REVERSE` as
   an IIFE-returned constant initialized via a string-iteration loop;
   the relocation should preserve the IIFE's exact text, since the
   `Int16Array(128).fill(-1)` initialization is the only place
   touching `Int16Array` in `src/core/**` — and TS-eslint may or may
   not flag the implicit-typed `(c)` parameter inside `lookup` (it
   doesn't currently because mapgen's rules are looser; check core's
   lint scope catches it).

**Fix.** Add to decision 16:

> The N7 relocation includes:
>
> 1. A unit test in `src/core/hash.test.ts` covering all four
>    `decodeBase64Url` branches (`r === 0, 1, 2, 3`), the
>    invalid-character path, and the high-codepoint path
>    (`charCodeAt > 127`). Goal: 100% line + branch coverage on the
>    relocated function under `src/core/**`'s coverage gate.
> 2. A re-export of the decoder from `src/mapgen/serialize.ts` (or a
>    direct import from `src/core/hash.ts`) so the existing fixture-pack
>    round-trip tests continue to pass without modification.
> 3. Verification that `src/core/**`'s lint scope (no
>    `Math.random`, no time, no member-access bans) passes the
>    relocated implementation, including the IIFE init and the
>    `lookup` closure.
>
> Lint and coverage observations land before the sim/ scope is
> introduced — they are part of the drift-detection sweep, not part
> of Phase 3.A's net-new sim/ work.

Blocking because the memo claims "verified by reading the import
graph; documented here as a check item" but actually misses two
non-cycle drift surfaces. Code-reviewer hand-off without explicit
test/coverage scope will land the relocation under-tested.

## Non-blocking concerns (address as addendum or in implementation)

### N1. `descend` does not have an inverse — and the SPEC may or may not require one

Decision 3's action vocabulary is `wait | move | attack | descend`. No
`ascend`, no "go back up the stairs." The memo's "Why this option" says
the four-action vocabulary "covers death and boss-kill state
transitions (the Phase 3 acceptance criteria)" — true. But:

- `docs/SPEC.md:79-86` ("Gameplay") says "Fixed depth: 10 floors. Boss
  arena on floor 10." It does not say one-way descent.
- `docs/PHASES.md:130-149` says "The player and monsters move on the
  grid, take turns, and resolve combat" — no direction mandate.

If a Phase 5+ design decision says "the player can return to a
previous floor to retrieve dropped loot," that's a new
`type: "ascend"` action — additive, fine. If the design says "and
returning to a floor regenerates monsters," that interacts with
`spawnFloorEntities` (idempotency under repeated entry). The memo
should document the v1 stance: "Phase 3 ships *one-way* descent. A
future `ascend` is an additive action-vocabulary entry; whether
re-entering a floor re-runs `spawnFloorEntities` or restores a
preserved snapshot is a Phase 6+ decision and not a frozen contract
yet." Otherwise an implementer reading the memo today might reasonably
choose to make `descend` to floor `n+1` then `descend` back to floor
`n` (via some `entrance`-cell convention) work, and that path isn't
designed for.

### N2. "Trailing actions after dead are discarded" creates a fingerprint-equivalence class the verifier should explicitly know about

Decision 11 says:

> Once `dead`, all further actions are no-ops (the state is terminal).
> The state hash *does not* advance after `dead` is reached; trailing
> actions in the log are discarded by `runScripted`.

This is correct for the *prefix-replay invariant* (running the
truncated-at-death log and the full log give the same final state and
state hash — which is what the acceptance criterion needs). But it
implies an equivalence class on action logs that the SPEC's "action log
is the save" claim (principle 2) silently widens:

- Log A: `[a_0, ..., a_46, a_47-killing]` (length 48)
- Log B: `[a_0, ..., a_46, a_47-killing, a_48, a_49, ...]` (length 100)

Both log A and log B have the same `(finalState, finalStateHash,
outcome="dead")`. The fingerprint contract
(`docs/ARCHITECTURE.md:262-272`) does *not* include the action log on
the pre-image, so two players who share a fingerprint plus log A vs log
B will have indistinguishable runs in the verifier — *but their
localStorage-saved logs are different sizes*. Phase 8's replay viewer
will need to either:

a. Truncate the log on save (lossy — the player typed those keystrokes,
   the save discards them).

b. Preserve the log verbatim and treat it as "trailing post-death input
   ignored" at replay time (verifier-tolerant, but a verifier that
   *also* sees the log can flag suspicious-trailing-action logs as a
   weak cheating signal).

The memo's risk section flags this generally — "Trailing-action-after-dead
semantics surprise" — but does not pin the verifier-side rule. State:
"Phase 3's harness truncates trailing actions after death from the
returned `logLength`. Phase 8's verifier API is responsible for
deciding whether to canonicalize logs (drop trailing) or annotate
them. Either is consistent with the Phase 3 contract; the choice is
Phase 8's." This avoids a Phase 8 `rulesetVersion` debate framed as
"oh wait, what does the action log mean *after* death."

### N3. The lint-scope plumbing claim "extends `eslint.config.js`" is partially a no-op

Decision 8 layer 2 says:

> Implemented as a new `eslint.config.js` scope with
> `no-restricted-syntax` selectors on
> `MemberExpression[property.name='mapgen' | 'ui']` and the existing
> `no-restricted-imports` patterns for `**/render/**`, `**/input/**`.

Three of the four mentioned items already exist in `eslint.config.js`:

- The `src/sim/**` scope is *already* listed in line 66 (FORBIDDEN_TIME),
  line 103 (no-restricted-imports for render/input), and line 137
  (SIM_UNORDERED + no-float-arithmetic). Phase 1 set this up.
- The `**/render/**` and `**/input/**` ban under no-restricted-imports
  already covers `src/sim/**` at line 103-117.

What's *new* in Phase 3 is the member-access ban on `.mapgen` /
`.ui` / `.sim` (no-arg) for `src/sim/**`. The memo's prose conflates
"add a new scope" (which is mostly a no-op — the scope exists) with
"add new selectors to an existing scope" (which is the actual work).

Also: the AST selector pattern needs care. The existing mapgen lint
(eslint.config.js:189-209) bans `.sim` and `.ui` member access by
matching `MemberExpression[property.name='sim'|'ui']` *anywhere* in
mapgen code. For sim, the equivalent must:

- Ban `streams.mapgen(...)` member-call.
- Ban `streams.ui(...)` member-call.
- Ban `streams.sim()` (no-arg) — but *allow* `streams.simFloor(N)`.

The naive selector
`MemberExpression[property.type='Identifier'][property.name='sim']` would
match `streams.sim` but *also* match `streams.simFloor` — wait, no —
`'sim' === 'simFloor'` is false. Identifier node `name` is the exact
string. `streams.sim` matches `property.name='sim'` and
`streams.simFloor` matches `property.name='simFloor'` — different.
Good.

But: `const { sim, simFloor } = streams; sim();` is a
*destructuring* pattern (`ObjectPattern` → `Property` →
`key.name='sim'`), not a `MemberExpression`. The selector misses it
entirely. This is the same false-negative class the Phase 2 memo
caught for mapgen, but neither memo flags it for the destructuring
case. Add a selector or a typed destructuring constraint, or rule by
convention "destructuring `RunStreams` is forbidden in
`src/sim/**`" with a separate selector. State the choice.

Also: the *test files* under `src/sim/**` will need to construct
`streams.simFloor(...)`-mock cases; the existing test-relaxation
override (eslint.config.js:220-226) keeps tests under the strict
scope but turns off `no-restricted-syntax`. Confirm this still
holds with the new sim selectors.

### N4. AI BFS-coordinate-system ambiguity is not pinned

Decision 7 says monsters move "one step toward the player along the
BFS-optimal path (lexicographic tiebreak: prefer cardinal directions
in the order `N, E, S, W`, then diagonals `NE, SE, SW, NW`)."

The integer grid in Phase 2 uses `tiles[y * width + x]`
(`docs/ARCHITECTURE.md:138`) — y-axis increases downward (row-major
top-to-bottom). The mnemonic "N, E, S, W" maps to:

- N = `(0, -1)` (y decreases)
- E = `(+1, 0)`
- S = `(0, +1)` (y increases)
- W = `(-1, 0)`
- NE = `(+1, -1)`, SE = `(+1, +1)`, SW = `(-1, +1)`, NW = `(-1, -1)`

…*if* "north" means "up on screen" / "toward smaller y." That's the
standard convention but the memo doesn't pin it. A reader writing a
unit test against decision-7's example "monster at (5,5), player at
(5,2)" — three rows above — could reasonably:

- Move N first (toward smaller y), getting to (5,4). ✓
- Or move S first (toward smaller y in a y-up coordinate system).

These are byte-equal *if* the implementer also flipped the encoding,
but the SIM_DIGEST golden constant pins one. Pin it explicitly:

> Direction ordinals are: N=`dy=-1, dx=0`, E=`dy=0, dx=+1`,
> S=`dy=+1, dx=0`, W=`dy=0, dx=-1`, NE=`dy=-1, dx=+1`,
> SE=`dy=+1, dx=+1`, SW=`dy=+1, dx=-1`, NW=`dy=-1, dx=-1`. The y-axis
> matches `Floor.tiles[y * width + x]` row-major addressing — y
> increases southward.

And: BFS parent-map ambiguity. Decision 7 says "BFS-optimal path
(lexicographic tiebreak)" — the *path* is what's lexicographically
broken, but BFS in itself doesn't produce paths, it produces a
distance map. The memo should clarify whether:

- BFS is run from the *monster* outward, expanding neighbors in the
  fixed direction order, with first-visit-wins (and the parent
  pointer is the order-first neighbor). The path is reconstructed
  from the parent pointer.
- BFS is run from the *player* outward, and the monster picks the
  neighbor whose distance-to-player is one less, with ties broken by
  the direction order.

These produce different paths in non-trivial topologies (a maze with
a branching corridor). The memo's "tiebreak `N, E, S, W, NE, SE, SW,
NW`" implies the second reading (monster picks among neighbors). Pin
it: "BFS distance map is computed from the player; monster picks the
single adjacent walkable cell whose distance is one less than the
monster's own distance, ties broken by the direction-order list."

### N5. `MAX_LOS_RADIUS = 8` measurement metric is not pinned

Decision 7 says:

> `los = bfsDistance(monster.pos, player.pos, walkable, MAX_LOS_RADIUS)`.
> If `los <= MAX_LOS_RADIUS`: state ← `chasing`.

Two implementers diverge on what `bfsDistance` counts:

- **Step count.** Walking through walkable cells. A diagonal step is
  one BFS step (typical 8-connected BFS). MAX_LOS_RADIUS=8 = 8
  diagonal steps = ~11 chebyshev.
- **Manhattan capped at radius.** The function name `bfsDistance`
  implies BFS (path-aware), not euclidean LOS. Phase 1's lint rule
  bans floats so euclidean is out anyway.

The memo says BFS; pin "BFS step count over walkable cells (8-connected
neighborhood, all 8 directions counted as one step each); MAX_LOS_RADIUS
is the maximum step count at which a monster transitions to chasing."

Also: "if `los > MAX_LOS_RADIUS`" — what does `bfsDistance` return if
the BFS is *cut off* at radius 8 because the player is unreachable in
≤ 8 steps? Implementer A returns `Infinity` (a float, banned in
sim/), implementer B returns `MAX_LOS_RADIUS + 1`, implementer C
returns `-1`. Pin: "returns the smallest step count if found in
`[0, MAX_LOS_RADIUS]`, else returns `MAX_LOS_RADIUS + 1` to remain
integer-typed."

### N6. Spawn ordering and the sense of "shuffle" in decision 6a is unclear

Decision 6a step 2 says:

> Iterates the floor's `encounters` array (Phase 2 sorts it by
> `(kind, y, x)` deterministically) and, for each slot whose kind
> allows the current floor (per the Phase 2 encounter registry's
> `allowedFloors` field), draws a `MonsterKindId` from the floor's
> eligible monster pool (decision 12) using the
> `spawn:monster-pick` roll domain seeded from a *snapshot of the
> spawn PRNG* (so the per-call subhash discipline still applies for
> audit; the PRNG provides the index into the eligible-monster array,
> not the bonus roll).

This mixes two different determinism sources:

- A PRNG (`streams.simFloor(floorN)`) for "shuffle."
- A roll domain (`spawn:monster-pick`) which is the per-roll
  state-hash subhash mechanism.

The phrase "seeded from a *snapshot of the spawn PRNG*" is unclear —
is the PRNG providing the index directly (PRNG cursor consumed N
times across N spawn slots), or is the PRNG state's first 4 bytes
substituted for `stateHashPre` in the roll formula? These are
incompatible.

Spec the choice. The cleanest answer: **at floor entry, before any
action is on the chain, there is no `action` to feed `rollBytes`**
(decision 6a even acknowledges this in the alternative-considered
list). So the spawn pick must be PRNG-cursor-based:

> `spawnFloorEntities` allocates `prng = streams.simFloor(floorN)` once.
> For each encounter slot in (Phase 2's deterministic) order: if the
> kind is `combat.basic` or `combat.elite`, draw `idx = prng() %
> eligibleMonsters.length` (or a rejection-sampling variant for
> uniform distribution), spawn `eligibleMonsters[idx]`, assign next
> integer id. Loot slots and boss-arena entry slots are placed
> per-Phase-6 / Phase-3 boss-singleton rules without consuming the
> PRNG. The `spawn:monster-pick` and `spawn:monster-pos` *roll
> domains* are reserved but unused in Phase 3 — they exist so a
> Phase 6 PR adding action-triggered spawns (e.g., a corp-sec
> reinforcement on player's hp threshold) can use them without
> bumping the registry.

This dovetails with B3: if the roll domains are reserved-but-unused,
just say so explicitly and don't claim "spawn:monster-pick is used in
decision 6a's per-floor spawn" (the table on line 242-243 makes that
claim).

### N7. `outcome="dead"` transition: `player.hp` int underflow is not specified

Decision 11 says `dead` is "set when `player.hp` drops to ≤ 0
*during action resolution*." The combat formula (decision 4):

```
dmg = Math.max(1, atk - def + bonus)
```

Always at least 1 damage. Player HP is integer. Multiple rolls per
action = multiple subtractions = HP can go to large negative numbers
in principle (e.g., player at hp=2 takes 5 monster counterattacks = -23
HP).

Pin:

> When `player.hp <= 0`, the resolver clamps `player.hp = 0` and sets
> `outcome = "dead"`. Subsequent rolls in the same action that would
> further damage the player are not computed (no PRNG/subhash
> consumption). Death is detected at every damage application, not at
> end-of-action.

Without this, two implementers diverge on whether the boss-kill
counter-rolls from the same action drop the player to -50 (and emit a
SIM_DIGEST that depends on those rolls being computed) or short-circuit
on the first death detection (and emit a different SIM_DIGEST).

### N8. `runScripted` `logLength` field semantics

Decision 9's harness signature returns `logLength: int` and `outcome:
"running" | "dead" | "won"`. Decision 11 says trailing actions after
death are discarded.

If the input action list is 100 actions and the player dies on action
47, what is `logLength`? Three readings:

- 47 (count of actions that advanced the chain)
- 48 (count of actions including the killing blow)
- 100 (count of actions in the input log)

For prefix-replay invariant testing
(`runScripted({...args, actions: actions.slice(0, k)}).finalState`
matches the k'th intermediate state — decision 9 "Why this option"),
the answer needs to be ≤ k. Pin: "`logLength` is the count of input
actions that were *actually resolved* — i.e., 48 in the example, since
the killing blow itself advanced the chain. Trailing actions after
death do not increment `logLength`." Without this, the harness's own
test surface is ambiguous.

### N9. The `sim-stream-isolation` self-test placement vis-à-vis the existing self-test array

Decision 15 adds `sim-stream-isolation` to `src/core/self-test.ts`'s
checks array. The Phase 2 review (B4) explicitly called out that
tests in this array share allocated `streamsForRun(...)` instances if
any earlier check forgot to allocate fresh — this is in fact the
exact bug class the existing
`src/core/self-test.ts:241-262` ("mapgen-stream-isolation") guards
against by allocating a fresh `streamsForRun` (line 243).

The new `sim-stream-isolation` check must do the same: allocate
fresh, exercise `spawnFloorEntities`, exercise one `tick`, assert.
The memo's decision 15 prose says this in passing ("allocate a fresh
`streamsForRun(...)`") but does not call out the precedent (Phase 2
B4 fix) or insist that the check's `RunStreams` is *not* the one
shared with `runScripted` for `SIM_DIGEST`. Cross-state pollution
between the two new self-tests would manifest as a SIM_DIGEST
mismatch under reordering. Spell out: "each new self-test allocates
its own fresh `RunStreams`; no `RunStreams` instance is shared across
checks."

### N10. The "items present as data" registry has no Phase 3 consumer — confirm it builds

Decision 13's item registry is "data only — no inventory mechanics,
no `use` action, no equip slot." Decision 6a's spawn step says "loot
slots in Phase 3 are placeholders — they record an `item.cred-chip`
data marker but no inventory mechanics fire." Two questions for the
implementer:

- The encounter slot kind `encounter.loot.basic` is in the Phase 2
  registry. Does Phase 3 actually populate spawned-loot-slots with a
  reference into the item registry, or does it store nothing? If the
  former, what is the exact shape — a string id on the
  `FloorState.items` array? If the latter, why ship the item
  registry at all in Phase 3 vs. deferring to Phase 6?

- The TS-eslint config has `@typescript-eslint/no-unused-vars` set to
  `"error"` (`eslint.config.js:59`). If the item registry is exported
  but no `src/sim/**` code imports it, the export is fine (top-level
  exports are not flagged as unused), but a non-exported helper would
  be. The memo should note that the item registry is at minimum
  imported by `tests/registries/items.test.ts` (or equivalent) so
  there is one consumer in the build graph.

This is non-blocking but cleaning it up now is cheap.

## Confirmations (decisions specifically endorsed)

### C1. The four-action vocabulary `wait | move | attack | descend` is sufficient for Phase 3 acceptance criteria.

Death and boss-kill state transitions are reachable: a 100-action log
on a fixed seed where (a) several `attack` actions kill the floor-1
monster, (b) `move` + `descend` walks the player to floor 10, (c)
several `attack` actions kill the boss singleton — all four types
suffice. Future `pickup`, `use`, `target` extensions are additive.
Endorsed.

### C2. Per-action chain advance is exactly one per *player action*, not per monster decision.

Frozen-contract item 6 of the memo's new list, plus Phase 1's
"monster behavior is drawn from `streams.sim()` cursor advancement
keyed on the post-action state hash; monster decisions do not appear
on the chain themselves" (`docs/ARCHITECTURE.md:222-223`). The Phase
3 memo restates this *and* further constrains monster behavior to
zero-PRNG (decision 7) — strictly stricter than Phase 1's
`docs/ARCHITECTURE.md` line 222 hint, which is *fine* (more
deterministic, audits more cleanly). Endorsed.

### C3. The phase split into 3.0 / 3.A / 3.B is correct.

Same precedent as Phase 1.A/1.B and Phase 2.0/2.A/2.B. The
diagnostic-page scripted-playthrough button cannot be observed inside
the sandbox; the live URL deploy is the only signal. Repeating the
pattern preserves the audit trail and matches the operating rule
"next smallest verified step." Endorsed.

### C4. `streams.simFloor(floorN)` as a Phase 1 contract addendum, not a "no change" claim.

The memo correctly classifies this as the same change-class as Phase
2's `__consumed` extension — frozen-contract item 8 of the new list
explicitly says "added to `RunStreams`" and ties the salt encoding
back to Phase 1's `streamSeed` rules. The B4 of the Phase 2 review
caught the prior "additive but actually adds a side effect" error;
the Phase 3 memo applies that lesson correctly. Endorsed (modulo B4
of *this* review, which is about `floorN` range validation, not the
contract-addendum classification itself).

### C5. The immutable `RunState` shape with sorted-by-id collections.

Decision 5's `monsters: readonly Monster[]` (sorted by id) and
`items: readonly FloorItem[]` (sorted by `(y, x, id)`) is the right
discipline. It mirrors Phase 2's `(kind, y, x)` floor-data sort
(`docs/ARCHITECTURE.md:144` "sorted by (kind, y, x)"). Iterating
sorted readonly arrays in `tick` cannot leak object-iteration-order
nondeterminism. Endorsed.

### C6. The `SIM_DIGEST` golden constant + `sim-stream-isolation` runtime-guard self-test.

Mirrors `RANDOM_WALK_DIGEST` (Phase 1) and `MAPGEN_DIGEST` (Phase 2)
exactly. Cross-runtime drift in the turn loop, AI FSM, combat
formula, or roll derivation surfaces as a single hex-mismatch.
Endorsed.

### C7. The N7 carry-forward decoder relocation *as a goal* is correct.

Co-locating `decodeBase64Url` next to `base64url` in
`src/core/hash.ts` is symmetric and reduces the module surface of
`src/mapgen/serialize.ts`. The cycle-risk analysis is also correct.
The blocking item B6 of *this* review is about the under-specified
test/coverage scope of the relocation, not the relocation itself.

## Cross-references — which Phase 3 decisions touch which Phase 1/2 frozen contracts

| Phase 1/2 contract | Phase 3 decision touching it | Risk class |
|---|---|---|
| `streamSeed(rootSeed, name, ...salts)` (Phase 1, `docs/ARCHITECTURE.md:63-110`) | 4 (lp_utf8 reuse), 6 (simFloor) | B1 (lp_utf8 ambiguity), B4 (floorN range) |
| `RunStreams` shape + `__consumed` Phase-2 addendum (`docs/ARCHITECTURE.md:112-127`) | 6, 8, 15 | B5 (per-tick delta semantics on descend), N9 (fresh-instance discipline) |
| `streams.sim()` no-arg (Phase 1, `docs/ARCHITECTURE.md:109`) | 6 (kept reserved), 8 (banned in src/sim/**) | N3 (lint selector for destructuring), B4 (collision proof for sim() vs simFloor(N)) |
| `encodeAction(action)` wire format (Phase 1, `docs/ARCHITECTURE.md:218-258`) | 3 (new type strings only), 4 (used in roll pre-image) | B1 (no domain anchor between encodeAction bytes and lp_utf8(domain)) |
| `advance(state, action) = sha256(state || encodeAction(action))` (Phase 1, `docs/ARCHITECTURE.md:212`) | 4 (rolls use stateHashPre, not stateHashPost), 5 (advance per player action only) | C2 endorsed; no risk |
| `seedToBytes(seed) = sha256(utf8(seed))` (Phase 2, `src/core/seed.ts`) | implicit upstream of `streamsForRun` | none (Phase 3 doesn't redefine; just consumes) |
| Phase 1 self-test framework `runChecks` (`src/core/self-test.ts:265-283`) | 15 (two new checks added) | N9 (fresh-instance discipline) |
| Phase 2 floor JSON contract + `parseFloor` strictness (`docs/ARCHITECTURE.md:160-176`) | 5 (`FloorState.floor: Floor` reuses Phase 2 type unchanged) | none (read-only consumption) |
| `RANDOM_WALK_DIGEST` + `MAPGEN_DIGEST` golden constants (`src/core/self-test.ts:24-41`) | 15 (adds `SIM_DIGEST` peer) | C6 endorsed; no risk if SIM_DIGEST is its own constant |
| ESLint determinism config (`eslint.config.js:34-46, 137-147`) | 8 (new selectors for `.sim`/`.mapgen`/`.ui` in `src/sim/**`) | N3 (memo conflates "new scope" with "new selectors in existing scope"; destructuring escape) |
| `tools/**` boundary (Phase 2, `eslint.config.js:153-174`) | 16 (gen-fixtures.ts unit test) | none — additive |
| `src/core/**` import ban on higher layers (`eslint.config.js:80-101`) | 16 (decoder relocation) | B6 (test-coverage drift, not cycle) |
| Phase 1 `ACTION_VERSION = 0x01` (`docs/ARCHITECTURE.md:236`) | 3 (no schema change, only new type strings) | none |
| Reserved field tags `0x00`, `0xFF` (`docs/ARCHITECTURE.md:249`) | 4 (could pin one as roll-pre-image domain anchor) | B1 mitigation suggestion |

## Deferred questions that should remain deferred

The four open questions at the end of the memo are correctly deferred:

- Whether `streams.sim()` (no-arg) ever gets a Phase 3 caller — it is a
  Phase 1 frozen accessor; deletion is a bump regardless. Phase 3
  doesn't need it; defer.
- Monster spawn density scaling — Phase 6 tuning territory.
- 3-state AI FSM (`investigating`) — Phase 7 boss-AI candidate.
- Per-step state hashes on the diagnostic page — debug tooling, not a
  contract.

Endorsed.

The memo does *not* defer one question that should be flagged
explicitly: **does `runScripted` accept multiple `inputs.modIds` and
exercise the fingerprint-mod-list interaction?** Phase 1's
fingerprint code (`docs/ARCHITECTURE.md:262-272`) sorts `modIds`
into the pre-image. Phase 3's `RunState.fingerprintInputs` typing
will quietly hardcode whether mods affect the run. Phase 8's verifier
will see this. Recommend: defer to Phase 8 explicitly with a single
sentence, "Phase 3 ships with `mods: []`-only test cases; Phase 8
introduces mod-bearing fingerprint assertions when the verifier API
exists."

## Summary

The memo is close to APPROVE quality. Six blockers, all wire-format or
contract-precision issues:

- **B1.** `lp_utf8(domain)` empty/overlong/UTF-8-vs-UTF-16 semantics
  are unspecified; no domain anchor in the roll pre-image.
- **B2.** `rollU32` byte order and bit-extraction recipe are implicit;
  pin them.
- **B3.** `ai:tiebreak` registry entry contradicts decision 7's
  no-PRNG-AI claim. Drop or rewrite.
- **B4.** `streams.simFloor(floorN)` legal range is unpinned; explicit
  collision-non-equivalence with `streams.sim()` is undocumented.
- **B5.** Per-tick `__consumed` delta is *not* always empty — a
  successful `descend` consumes the next floor's `simFloor`. Pin the
  branch.
- **B6.** N7 decoder relocation has test-coverage and lint-scope drift
  the memo asserts away without verifying.

Each is a one- or two-paragraph addendum to the existing memo. None
require an algorithmic change. Once addressed, this memo is APPROVE
and Phase 3.A may begin.

The non-blocking concerns (N1–N10) can either be folded into the
addendum or deferred to implementation — the implementer may flush
them out in code, but the memo will read more cleanly with at least
N3 (lint scope), N4 (coordinate system), N5 (BFS distance metric),
N6 (spawn determinism), and N7 (HP underflow clamp) addressed in the
addendum.

## Relevant files cited in this review

- `/workspace/artifacts/decision-memo-phase-3.md` (subject)
- `/workspace/artifacts/decision-memo-phase-2.md`
- `/workspace/artifacts/red-team-phase-2.md`
- `/workspace/artifacts/phase-approval.json`
- `/workspace/docs/SPEC.md`
- `/workspace/docs/ARCHITECTURE.md`
- `/workspace/docs/PHASES.md`
- `/workspace/docs/QUALITY_GATES.md`
- `/workspace/src/core/streams.ts` (existing `RunStreams` shape, `streamSeed`, `encodeSalt`)
- `/workspace/src/core/encode.ts` (existing `encodeAction`, `ACTION_VERSION`, reserved tags)
- `/workspace/src/core/state-chain.ts` (existing `advance`, `genesis`)
- `/workspace/src/core/self-test.ts` (existing self-test framework + golden digest pattern)
- `/workspace/src/core/hash.ts` (existing `base64url` encoder; relocation target for `decodeBase64Url`)
- `/workspace/src/core/seed.ts` (existing `seedToBytes`)
- `/workspace/src/mapgen/serialize.ts` (current home of `decodeBase64Url`; relocation source)
- `/workspace/src/mapgen/generate.ts` (existing per-call `__consumed` runtime guard pattern)
- `/workspace/src/mapgen/index.ts` (public surface of mapgen)
- `/workspace/src/registries/encounters.ts` (existing encounter slot kinds)
- `/workspace/eslint.config.js` (existing scopes incl. `src/sim/**` already listed)
- `/workspace/tools/gen-fixtures.ts` (carry-forward N3 target)
