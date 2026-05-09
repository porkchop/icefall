# Decision Memo — Phase 8 (Run Fingerprint, Replay, Saves & Content-Addressed Releases)

**Status.** Drafted before any Phase 8 code is written, per the planning gate
in `docs/PHASES.md:534-567`. Architecture-red-team review is required before
implementation. Phase 7 (Phase 7.B; live-deploy + cross-runtime + cross-OS
verification of NPC + shop + boss + win-state) is approved on master at commit
`08d88b6` (see `artifacts/phase-approval.json`).

## Decision summary

Phase 8 is the load-bearing pillar of the project's identity. It turns the
deterministic core (Phases 1–7) into a *shareable* artifact: a 22-character
URL parameter that resolves on any browser, on any machine, to the same
dungeon, the same sprites, the same combat outcomes, and — when an action log
is supplied — to the same replay byte-for-byte. The phase introduces:

1. The **fingerprint URL syntax** that Phase 9's title screen and every
   future shared run will route through (`?run=<fingerprint>` + an action-log
   slot in the URL hash fragment).
2. The **action-log codec** that converts an `Action[]` (Phase 1 wire format)
   into a URL-safe string short enough to fit in a clipboard paste, an
   `<input>` field, and a tweet for typical-length runs, with a clipboard /
   file fallback for the rare long run.
3. The **mismatched-version UX**: when a user opens a fingerprint generated
   by an older `commitHash` than the bare-URL `latest` build, the page
   detects the mismatch, redirects to `releases/<commit-short>/`, and
   preserves the action-log slot through the redirect.
4. The **verifier API contract**: a single pure function
   `verify({ fingerprint, actionLog, claimedFinalStateHash, expectedRulesetVersion?, expectedAtlasBinaryHash? }) → VerifyResult`,
   exposed in three runtimes (browser, Node CLI, in-page replay viewer)
   without code duplication.
5. The **content-addressed release layout**: the GitHub Pages deploy
   publishes every commit to BOTH `latest/` and `releases/<commit-short>/`,
   with the atlas pinned per release, so an old fingerprint always loads its
   pinned visuals. The phase's hardest scope item is the chicken-and-egg
   problem that an "old fingerprint" only exists once at least one prior
   commit has published a release.
6. The **localStorage persistence** layer that auto-saves an action log
   every N actions and silently replays it on page load, plus the multi-slot
   save UI keyed by fingerprint and the resume-vs-fresh UX.
7. The **mod-ID slot wiring** in the fingerprint format: the registry stays
   empty in Phase 8, but the URL parser, the verifier, and the canonical
   sort are all exercised against `modIds: []` and against a synthetic
   `modIds: ["<test-mod-id>"]` test vector so Phase 9+'s first mod doesn't
   need a fingerprint-format change to land.

The interesting decisions in this phase are **not** the algorithms (URL
parsing, base64url, fflate compression, localStorage I/O are all boring,
well-understood) — they are the **contracts** that flow forward into every
post-release shared run:

- The **action-log envelope**: header bytes, version byte, length prefix,
  optional compression header, base64url. Every byte is part of the
  URL-shared identity of a replayed run.
- The **URL hash-fragment shape** (the fragment, not the query string —
  decision 6 below). This is the `?run=...&seed=...#log=...` shape every
  Phase 8+ shared link will use.
- The **release-pinning contract**: filesystem layout on `gh-pages`,
  per-release Vite `base`, pruning policy, atlas-relative-path rules. A
  pinned release that's published under a different layout is unloadable.
- The **error string vocabulary** for the eight failure modes (bad
  fingerprint, mismatched commit, missing release, log-decode failure,
  ruleset mismatch, atlas mismatch, replay outcome mismatch, replay-hash
  mismatch). These strings are pinned with the same rigor as Phase 4's
  atlas-loader strings (`PLACEHOLDER_REFUSAL_MESSAGE`, addendum N7) — the
  exact em-dash, the exact quote characters, the exact substitution
  variables.

The Phase 1–7 frozen contracts are honored unchanged. **No `rulesetVersion`
bump is in scope for Phase 8.0 (this memo).** A bump may be needed at most
once during 8.A.2 if the action-log envelope's length-prefix or
compression-header byte falls inside `RULES_FILES` (it does not — see
decision 14 — so the bump is anticipated to be unneeded), and if the
`mod-ID slot` wiring requires any change to `fingerprint.ts` (it does not —
the existing `sortedModIds.join(",")` encoding is the contract; Phase 8 only
*exercises* the empty-mods path that was already pinned in Phase 1
addendum N4).

The cross-runtime determinism golden chain is preserved unchanged:
- `RANDOM_WALK_DIGEST` (Phase 1)
- `MAPGEN_DIGEST` (Phase 2)
- `SIM_DIGEST` (Phase 3)
- `ATLAS_DIGEST` + four preset-seed `expectedHash` values (Phase 4)
- `INVENTORY_DIGEST` (Phase 6)
- `WIN_DIGEST` + reachability (Phase 7.A.2b)

A new `REPLAY_DIGEST` golden joins this chain in 8.A.2 — see decision 13.

Like Phases 1–4, Phase 8 splits into a planning gate (8.0), a
drift-detection sweep (8.A.1), a sandbox-verifiable implementation (8.A.2),
a build-pipeline extension (8.A.3), and a live-deploy + cross-runtime +
cross-OS verification (8.B). The 8.A.2 / 8.A.3 split is novel for this
project (prior phases used a single 8.A.2-like step) and is justified
explicitly in decision 17.

---

## Decisions

### 1. Fingerprint format and length budget: **22-char base64url short retained; mod-ID slot already wired; no churn**

- **Chosen.** Phase 8 ships **no change** to the fingerprint byte
  pre-image, the SHA-256 truncation, or the 22-character base64url short
  form (`FINGERPRINT_SHORT_LEN = 22`, `src/core/fingerprint.ts:4`). The
  existing 43-character `fingerprintFull(...)` form remains the verifier's
  authoritative input. The mod-ID slot is already wired:

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

  fingerprint(...)        = base64url(fingerprintBytes).slice(0, 22)
  fingerprintFull(...)    = base64url(fingerprintBytes)            // 43 chars
  ```

  (Phase 1 frozen contract; `docs/ARCHITECTURE.md:262-292`,
  `src/core/fingerprint.ts:42-86`.)

  Phase 8 *exercises* the mod-ID slot in three new places without changing
  any byte:
  - The verifier's signature accepts `modIds: readonly string[]`
    (already part of `FingerprintInputs`).
  - The URL parser exposes `?mods=<comma-separated>` in addition to
    `?seed=`. The existing `,` separator inside the canonical
    `sortedModIds.join(",")` pre-image is preserved by URL-decoding the
    `?mods=` value, splitting on `,`, and passing the resulting array
    unchanged to `fingerprint(...)` — which itself sorts and re-joins,
    making the input order on the URL irrelevant to the computed
    fingerprint.
  - The localStorage save key includes the fingerprint short form, so
    `mods=[]` and `mods=["icefall.mod.experimental.alpha"]` runs of the
    same `(commitHash, rulesetVersion, seed)` tuple key into different
    save slots.

- **Length budget rationale.** 22 characters of base64url ≈ 132 bits of
  entropy. Collision probability for 1 million distinct shared runs is
  ≈ 10⁻²⁹ (birthday-bound). 132 bits is ~50× the 80-bit threshold
  conventionally cited for collision-resistance against motivated
  adversaries; the relevant threat model here is **accidental collision
  in casual sharing**, not adversarial preimage-finding (which is
  bounded by SHA-256's 256-bit security in any case — Phase 1 decision 5
  prose).

- **Alternatives considered:**
  - **Lengthen to 32 chars (192 bits).** Rejected. Phase 1 chose 22
    *deliberately* to fit a tweet (now a 280-char post on X / 500-char
    post on Mastodon / Bluesky), and 132 bits is already absurdly far
    above any realistic collision threat. Lengthening is a
    `rulesetVersion` bump (it changes the displayed string); the
    benefit is zero.
  - **Shorten to 16 chars (96 bits).** Rejected. 96 bits is below the
    "comfortable" threshold for collision-resistance against motivated
    actors (8 bytes is the size of a typical hash-table key, and the
    lower-bound analysis for collisions in a population of N runs is
    `1 - exp(-N²/2^bits)`). At 96 bits and 1B runs the probability
    spikes to ~10⁻¹⁰; at 132 bits it's ~10⁻²⁹. The marginal six
    characters of URL length are not worth a 23-order-of-magnitude
    reduction in safety margin.
  - **Add a checksum suffix** (so a typo trips a clear error before
    SHA-256 mismatch). Rejected. Base64url over a SHA-256 digest *is*
    the checksum — flipping any character in the displayed fingerprint
    yields a different decoded byte sequence and the verifier's
    `fingerprintFull(...) !== claimedFingerprint` check catches it
    immediately. A separate Luhn/CRC suffix would be a second contract
    surface to pin and would lengthen the URL with no real benefit.
  - **Crockford base32** (case-insensitive). Rejected. URL-safe base64
    is universal in browser-native APIs (`atob`/`btoa` plus the
    `base64url` helper at `src/core/hash.ts`); switching alphabets is
    a `rulesetVersion` bump for cosmetic gain only.
  - **Punycode-style mnemonic encoding** (e.g. BIP-39-style word
    list). Rejected. Three-word phrases at 132 bits = 12 short words,
    which is *longer* than the 22-character base64url form and locks
    the project into an English wordlist that becomes a localization
    obligation forever after.

- **Why this option.** Phase 1's choice was correct and the existing
  byte pre-image is well-tested across the cross-runtime golden chain
  (RANDOM_WALK_DIGEST onward). Bumping the format would invalidate
  every fingerprint already generated against `latest/` (zero today,
  but the principle stands as soon as one player generates one).
  The mod-ID slot is already in the pre-image; "wiring it up" in
  Phase 8 means *exercising* it in tests, not changing the format.

- **Frozen contract.**
  ```
  FINGERPRINT_SHORT_LEN = 22                                  (unchanged)
  fingerprintBytes = sha256(
       utf8(commitHash) || 0x00
    || utf8(rulesetVersion) || 0x00
    || utf8(seed) || 0x00
    || utf8(sortedModIds.join(","))
  )                                                           (unchanged)
  fingerprint(inputs).length === 22                           (Phase 8 test)
  fingerprint(inputs).startsWith("DEV-") iff
    inputs.rulesetVersion === PLACEHOLDER_RULESET_VERSION    (unchanged)
  ```

- **Tests required.**
  - `tests/core/fingerprint.test.ts` already asserts the 22-char form
    and the byte pre-image (Phase 1 + 4). Phase 8 adds:
    - A test vector `{ commitHash: "abc1234", rulesetVersion:
      "<computed at first green 8.A.2 CI>", seed: "phase-8-vector-1",
      modIds: [] }` with a pinned full 43-char golden. The same
      input sorted-modIds-permuted (`["a", "b"]` vs `["b", "a"]`)
      asserts the same fingerprint (canonical sort).
    - A test vector with `modIds: ["icefall.mod.test-vector-1"]`
      (synthetic; the registry is empty in Phase 8) with a pinned
      golden showing a *different* fingerprint than the empty-mods
      case. This exercises the load-bearing pre-image byte that
      Phase 9+ mods will populate.
    - A property-style check: shuffling a fixed `modIds` array
      `["m1", "m2", "m3"]` 24 ways (4! = 24 permutations) yields the
      same `fingerprint(...)` 24 times. (This catches a regression
      where someone changes the sort to `localeCompare` and breaks
      under ICU updates; UTF-16 code-unit `<` is the contract.)

- **Risks.**
  - `localeCompare`-vs-string-`<` drift is a known JS hazard. Phase 1
    addendum pinned UTF-16 code-unit ordering. Phase 8 adds the
    permutation-shuffle test as defense-in-depth.
  - Phase 9+ mod-loader changes that introduce mod-ID validation
    (length caps, character classes) must respect the existing
    `modIds[i]: string with no NUL, no comma` rule (Phase 1
    `fingerprint.ts:32-39`). Tightening is fine; loosening is a
    `rulesetVersion` bump.

### 1a. Mod-ID slot — empty-list-now, exercised-everywhere: **canonical sort, NUL/comma exclusion, length cap punted to Phase 9 mod loader**

- **Chosen.** Phase 8 ships with the registry **empty** (no mod-ID is
  registered, no mod loader exists, no mod is loadable). The fingerprint
  pre-image's `sortedModIds.join(",")` slot is exercised in the URL
  parser, in test vectors, and in the localStorage save-key derivation.
  The validation contract pinned in Phase 1 (`fingerprint.ts:28-40`)
  applies unchanged:

  - Each `modId` is a well-formed UTF-16 string.
  - Each `modId` contains neither NUL (`0x00`) nor comma (`0x2C`).
  - Empty array → empty string in the pre-image, distinguishable from
    the singleton array containing the empty string `[""]` (which would
    encode as the empty pre-image segment, since `sortedModIds.join(",")
    === ""` in both cases — a Phase 9 mod-loader concern surfaced as a
    deferred follow-up here; see "Risks" below).

- **Phase 9+ extension surface.** When the first mod registers, it
  receives a stable ID matching the same regex Phase 4 pins for atlas
  recipes (a sensible default; the actual mod-ID regex is a Phase 9
  decision):

  ```
  ^icefall\.mod\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$
  // namespace.modgroup.modname (e.g. icefall.mod.community.balance-tweaks)
  ```

  Adding the first mod-ID to a fingerprint is **additive by
  construction** — the canonical-sort encoding (Phase 1 frozen) handles
  the order; the comma separator handles concatenation; the SHA-256
  pre-image absorbs the new bytes the same way it already absorbs
  `seed` and `commitHash`.

- **What Phase 8 explicitly does NOT decide.**
  - Mod-ID byte cap (Phase 1 has no per-modId byte cap; Phase 9 may add one).
  - Mod-ID character class (Phase 1 only excludes NUL + comma; Phase 9
    may tighten to ASCII / restricted regex).
  - The empty-string-in-modIds-array foot-gun (`[""]` vs `[]` both
    encoding to `""` in the canonical join). Pinned in the addendum
    follow-up list as a Phase 9 mod-loader concern; in Phase 8 the
    URL parser strips empty strings from the parsed array (decision 6's
    URL parser implementation), so `?mods=` and `?mods=,` both decode
    to `[]`.

- **Tests required.**
  - `tests/core/fingerprint.test.ts` already covers the validation
    paths (Phase 1).
  - 8.A.2 adds a test asserting the empty-string-strip behavior at the
    URL parser layer (decision 6), so the Phase 8 surface never
    *reaches* the Phase 1 validator with `[""]`.
  - 8.A.2 adds the synthetic-mod-ID fingerprint vector noted in
    decision 1.

- **Risks.**
  - **The `[""]` vs `[]` ambiguity.** Two callers passing `modIds:
    [""]` and `modIds: []` produce the same fingerprint pre-image.
    The URL parser layer (decision 6) handles this by stripping
    empties before reaching `fingerprint(...)`, so the two cases
    cannot both reach the verifier. A Phase 9 mod-loader landing the
    first real mod will pin this further (likely by rejecting
    `modId === ""` at registration time).
  - **Phase 9 mod-ID cap drift.** When Phase 9 lands a per-modId byte
    cap, every Phase 8 fingerprint with `modIds: []` is unaffected
    (no `modId` is examined for length). This isolation is the
    rationale for *exercising* but not *changing* the slot now.

### 2. Action-log envelope: **`[ICE\x01][version:1][actionCount:u32 LE][concat(encodeAction(a) for a in actions)]` then base64url(fflate-deflate(envelope))**

- **Chosen.** A canonical action log is a self-describing byte sequence
  with a 4-byte magic, a 1-byte version, a 4-byte action count, and
  the concatenated Phase 1 `encodeAction(...)` output for every action,
  in order. The total envelope is then DEFLATE-compressed at fflate's
  deterministic level-1 (the same compression level Phase 4 pins for
  the atlas PNG; cross-runtime byte-identity guaranteed by the same
  cross-OS matrix the atlas uses), and the compressed bytes are
  base64url-encoded for URL transport.

  ```
  ACTION_LOG_MAGIC      = utf8("ICE")               // 3 bytes: 0x49, 0x43, 0x45
  ACTION_LOG_VERSION    = 0x01

  Envelope (uncompressed):
    [0x49 0x43 0x45 0x01]                           // 4 bytes: magic + version
    [actionCount:u32 LE]                            // 4 bytes (max 2^32 - 1)
    [encodeAction(actions[0])]
    [encodeAction(actions[1])]
    ...
    [encodeAction(actions[N-1])]                    // total length sum

  Wire form:
    base64url(fflate.deflateSync(envelope, { level: 1 }))
  ```

  Decoding inverts the chain: `fflate.inflateSync(base64urlDecode(s))`
  → assert magic == "ICE" + version 0x01 → read action count → loop
  `decodeAction(...)` for each. A separate `decodeAction(bytes,
  offset)` returns `(action, bytesConsumed)`; the loop terminates after
  exactly `actionCount` actions and asserts the input is fully
  consumed (no trailing bytes).

- **Why a magic prefix at all.** Two reasons:
  1. **URL-safe disambiguation.** Without a magic, a user pasting a
     base64url string from a different system (a fingerprint full
     form, a base64url-encoded image, a base64url-encoded atlas
     manifest fragment, etc.) into the action-log paste box would
     decode to bytes that *might* parse as an action log all the way
     up to the first encoder error — surfacing a confusing
     "decodeAction: type_len 200 too large at offset 7" instead of
     the clear "not an action log" error.
  2. **Forward compatibility.** Bumping `ACTION_LOG_VERSION` is the
     only allowed way to change this format. The magic + version is
     the contract surface a future v2 reader checks first; pre-v2
     logs decode under v1, post-v1 logs reject under v2 unless a
     migrator is shipped.

  The magic is the ASCII bytes `"ICE"` — three bytes, 0x49 0x43 0x45.
  This pattern is byte-distinct from the Phase 4 PNG header (`0x89 P
  N G 0x0D 0x0A 0x1A 0x0A`), the Phase 2 floor JSON's `{` opener
  (`0x7B`), and the Phase 1 fingerprint base64url alphabet's first
  characters. It is *not* a project-wide invariant that all magic
  bytes start with `"ICE"`; it is the action-log's specific prefix.

- **Why DEFLATE.** Action sequences are extremely compressible:
  - Most actions are `move dir=N` repeated runs (LZ-friendly).
  - `attack`, `descend`, `wait` are short three-byte payloads.
  - `pickup`, `equip`, `use` carry an `item` field that repeats per
    consumable (a player using 5 stim-patches has 5 byte-identical
    `[0x01 0x03 'u' 's' 'e' 0x20 0x10 'i' 't' 'e' 'm' '.' ...
    'p' 'a' 't' 'c' 'h']` payloads, perfect for the LZ77 sliding
    window).
  - The Phase 7 `WIN_LOG` (1217 actions) was specifically measured
    against this codec design (see Sizing below).

  fflate's level-1 is the same level used by the Phase 4 atlas PNG
  encoder. Cross-runtime byte-identity is already established by the
  Phase 4.B `cross-os-atlas-equality` matrix; the Phase 8.B build
  pipeline (decision 17) re-uses the same matrix discipline against
  a synthetic 1217-action input.

- **Sizing — the `WIN_LOG` reference run.** `SELF_TEST_WIN_LOG` from
  `src/sim/self-test-win-log.ts` is 1217 actions. Average action wire
  size from `encodeAction(...)`:
  - `wait` / `descend` (no fields): 5 bytes (1 version + 1 len + 4
    bytes for `"wait"` or 7 bytes for `"descend"` UTF-8). Adjust:
    actually 1+1+4 = 6 bytes for `"wait"`, 1+1+7 = 9 bytes for
    `"descend"`.
  - `move dir=N` / `attack dir=N`: 1 (version) + 1 (type len) + 4 or
    6 (type bytes for `"move"`/`"attack"`) + 1 (TAG_DIR) + 1 (dir
    byte) = 8 or 10 bytes.
  - `use item=item.stim-patch`: 1 + 1 + 3 (`"use"`) + 1 + 1 +
    16 (`"item.stim-patch"`) = 23 bytes.
  - `buy item=item.cyberdeck-mod-1 target=ordinal`: 1 + 1 + 3 +
    1 + 4 + 1 + 1 + 22 = 33 bytes.

  Mean ≈ 9 bytes per action across a typical run (mostly `move` +
  `attack`). 1217 actions × 9 bytes = ~11 KB uncompressed envelope.
  fflate level-1 on highly-repetitive integer-arithmetic data
  achieves ~70–80% reduction → ~2.5–3.5 KB compressed. base64url
  inflates by 4/3 → ~3.5–5 KB URL.

  **URL length budget (decision 6).** Modern browsers cap URLs at
  ~32 KB (Chrome ~32 KB, Firefox ~64 KB, Safari ~80 KB) but practical
  shareability (Twitter/X 280 chars, Discord ~2000 chars, email
  clients often 2000 chars) caps useful URL length at ~2000 chars.
  A 5 KB action log is **too long for inline URL sharing** but well
  within the **clipboard-paste** path. The Phase 8 sharing UX
  reflects this: the URL contains the `?run=<fingerprint>&seed=...`
  prefix (always short, 22+seed-length characters), and the action
  log slot is one of two:
  - URL hash fragment `#log=<base64url>` for runs ≤ 1500 chars
    compressed (≈ 350-action mean run; covers a typical floor 1–4
    death).
  - Clipboard-paste box for any longer run, with a "Copy log to
    clipboard" button and a "Paste log here" `<textarea>` on the
    receiving side.

  See decision 4 (URL placement) for the details.

- **Alternatives considered:**
  - **No magic, no version byte.** Rejected — see "Why a magic
    prefix" above. The 4 bytes overhead is rounding error against
    even a 100-action log.
  - **JSON envelope `{v:1, fp:"...", actions:"..."}`.** Rejected.
    JSON adds 30+ bytes of fixed overhead, requires a JSON.parse
    trust boundary on input (Phase 4 explicitly bans JSON.parse
    inside `src/atlas/**` interiors; Phase 8's verifier should
    inherit the same discipline), and provides nothing the binary
    envelope doesn't. The wire format must round-trip
    byte-identically.
  - **Embed the fingerprint inside the envelope** (so the log
    self-identifies its run). Rejected. The fingerprint is already
    in the URL (`?run=...`); double-binding it in the log is
    redundant and creates two failure modes (URL `?run=X` + log's
    embedded `fp=Y`) that the verifier must adjudicate. Cleaner to
    keep the URL the source-of-truth for "which run is this?" and
    the log the source-of-truth for "what happened?".
  - **Length-prefix every action individually** (so a partial log
    can be decoded). Rejected. `encodeAction(...)` is already
    self-delimiting (the optional-field tag-order rule plus the
    fixed-byte-count for each tag's payload uniquely determines the
    end of an action), so a per-action length prefix duplicates
    information the encoding already conveys. Adding it would also
    bump the envelope size by 1 byte per action (~10% overhead at
    typical 9-byte-per-action density).
  - **Use `gzip` via the browser's `CompressionStream` API.**
    Rejected. `CompressionStream` is browser-only (no Node parity
    without a polyfill), is async, and is *not* byte-deterministic
    across browser engines (the gzip wrapper includes a `MTIME`
    field that some implementations populate, plus the underlying
    DEFLATE engine differs between Chromium's zlib and Firefox's
    miniz). fflate is sync, byte-deterministic, and already in
    `package.json` from Phase 4. Re-use, not re-implement.
  - **Use `brotli`.** Rejected. Brotli compresses ~15% better than
    DEFLATE on this kind of data, but the Node `zlib.brotliCompress`
    output is not byte-identical to the browser's
    `CompressionStream("br")` (where supported), and there is no
    pure-JS Brotli encoder with fflate's deterministic-output
    guarantee. The 15% win does not justify breaking the cross-OS
    matrix property.
  - **Compress at level 6 (default) or level 9 (max).** Rejected.
    fflate's level-1 is the same level used by the Phase 4 PNG
    encoder; cross-runtime byte-identity is established. Higher
    levels gain 5–10% size but break parity with the existing
    cross-OS matrix discipline (and would require a separate
    cross-OS matrix run to re-establish byte-identity at the new
    level).

- **Why this option.** Magic + version + count + concat-encoded-actions
  is the smallest self-describing envelope. fflate level-1 + base64url
  reuses Phase 4's existing cross-runtime byte-identity guarantee.
  No new cryptographic primitives, no new compression libraries, no
  new encoding contracts beyond the magic-and-version 4 bytes.

- **Frozen contract.**
  ```
  ACTION_LOG_MAGIC      = [0x49, 0x43, 0x45]                 // "ICE"
  ACTION_LOG_VERSION    = 0x01

  Envelope (uncompressed):
    [ACTION_LOG_MAGIC][ACTION_LOG_VERSION][actionCount:u32 LE]
    [encodeAction(actions[0])]...[encodeAction(actions[N-1])]

  Wire form:
    base64url(fflate.deflateSync(envelope, { level: 1 }))

  Decoder:
    decoded = fflate.inflateSync(base64urlDecode(s))
    assert decoded.length >= 8                                // magic+ver+count
    assert decoded[0..3] === ACTION_LOG_MAGIC                 // "ICE"
    assert decoded[3] === ACTION_LOG_VERSION                  // 0x01
    actionCount = readU32LE(decoded, 4)
    actions = []
    offset = 8
    for i in 0..actionCount:
      (action, n) = decodeAction(decoded, offset)
      actions.push(action)
      offset += n
    assert offset === decoded.length                          // no trailing
    return actions

  decodeAction(bytes, offset) is the inverse of encodeAction(action) per
  Phase 1 wire format (src/core/encode.ts:57). Returns the action plus
  the byte count consumed.
  ```

- **Tests required.**
  - `tests/core/action-log.test.ts` (new):
    - Round-trip property: for 1000 random `Action[]` of varying sizes
      drawn from the same `streamPrng(rootSeed, "test:action-log")`
      seed (so the test is itself deterministic),
      `decodeActionLog(encodeActionLog(actions)) === actions`
      byte-identically.
    - Pinned-vector test: `SELF_TEST_WIN_LOG` (1217 actions)
      round-trips byte-identically; the resulting URL form's length
      is asserted ≤ a pinned upper bound (the actual length is
      pinned during 8.A.2 on the sandbox, see decision 13).
    - Magic mismatch: input with `"PNG"` magic decodes to a pinned
      error message: `"action-log: bad magic — expected
      'ICE' (49 43 45), got '<hex>'"`.
    - Version mismatch: input with version `0x02` decodes to:
      `"action-log: unsupported version 2 (this build supports
      version 1) — load a newer release with 'releases/<commit>/'"`.
    - Trailing bytes: input with a valid envelope plus extra bytes
      decodes to: `"action-log: trailing bytes after final action
      (offset N, length M)"`.
    - Truncated input: input cut off mid-action decodes to:
      `"action-log: truncated at offset N (expected at least M
      bytes for action <type>)"`.
    - Action count mismatch: header claims N actions but only M are
      present: `"action-log: declared <N> actions but envelope ran
      out at <M>"`.
  - `tests/core/action-log-cross-runtime.test.ts` (new): runs the
    same `(action[], envelope, base64url)` golden vector under Node
    and (via the cross-runtime Playwright suite, 8.B) under
    chromium/firefox/webkit, asserts byte-identity. This is the
    fflate level-1 cross-runtime check at the action-log layer.

- **Risks.**
  - **fflate version bump silently changes output.** Already
    mitigated by Phase 4 addendum N1: any change to the `fflate`
    line in `package-lock.json` triggers an architecture-red-team
    review and a fresh cross-OS matrix run. Phase 8 inherits this
    rule unchanged; the action-log codec is added to the test
    surface that exercises it.
  - **`SELF_TEST_WIN_LOG`-sized URL exceeds the 1500-char hash-fragment
    budget.** Anticipated; the clipboard fallback (decision 4)
    handles it. The size budget is **measured** during 8.A.2, not
    *predicted* — if the budget is wildly off, the URL/clipboard
    threshold (decision 4) is tuned, not the envelope format.
  - **Action-version drift.** Phase 6 added `pickup, drop, equip,
    unequip, use`; Phase 7 added `talk, buy, sell` (or whatever
    final shop vocabulary lands per Phase 7 frozen contract). These
    are all *string values* of `Action.type`, all under the existing
    `ACTION_VERSION = 0x01` (Phase 1 frozen + Phase 6/7 additive
    rule). The action-log envelope's `ACTION_LOG_VERSION = 0x01`
    is **independent** of `ACTION_VERSION` (they are versioning
    different layers — the action wire format vs. the envelope
    around a sequence of actions). A future Phase 9 introduction
    of `ACTION_VERSION = 0x02` does NOT auto-bump
    `ACTION_LOG_VERSION`; the envelope stays v1 because it is a
    pure container. (If a Phase 9 v2 action were to require a
    different envelope structure — e.g. a v2 action whose length
    cannot be inferred from per-tag fixed widths — only then would
    the envelope bump.) This decoupling is intentional.

### 3. URL parameter syntax: **`?run=<fingerprintShort>&seed=<seed>&mods=<csv>` in query string; `#log=<encoded>` in hash fragment**

- **Chosen.** A shareable URL has the shape:

  ```
  https://porkchop.github.io/icefall/?run=<22-char-fingerprint>&seed=<url-encoded-seed>[&mods=<comma-separated>]#log=<base64url-encoded-action-log>
  ```

  - `?run=<fingerprintShort>` — 22-char base64url fingerprint
    (decision 1). The ONLY required URL parameter for routing.
    Verifier asserts `fingerprint(parsedInputs).slice(0,22) ===
    parsedRun` after the page is loaded; mismatch produces a clear
    error (decision 5).
  - `?seed=<url-encoded-seed>` — the run seed string. The ONLY way
    a user-facing URL transmits the seed. Required; absence is an
    error. (The fingerprint is a one-way hash; without `seed`, the
    receiving page cannot reconstruct the run.)
  - `?mods=<comma-separated>` — optional, encodes the canonical
    `sortedModIds` array. Empty / absent → `[]`.
  - `#log=<base64url>` — optional. The action log, encoded per
    decision 2. Absence → no replay; the page boots into "fresh
    run from seed" mode.

- **Why query string for `run` / `seed` / `mods` and hash fragment
  for `log`.** Three reasons, in priority order:

  1. **Server-side privacy of the action log.** GitHub Pages is a
     static host; its access logs see the *full request URL*
     including the query string. The query string is also captured
     by analytics, link previews (Slack, Discord, Twitter card
     scrapers), and is logged in browser history. The hash fragment
     `#...` is **never sent to the server**, never seen by analytics,
     never captured in HTTP referer headers leaving the browser, and
     never appears in CDN logs. For the action log — which encodes
     the *exact play history* of a run — this matters: a player who
     shares a fingerprint URL on Discord is implicitly trusting the
     URL's contents to Discord's link-preview crawler, which fetches
     the URL but only sees the query-string portion. A 5-KB action
     log in `#log=` is invisible to Discord's crawler.

  2. **URL-length budget.** Browsers are most forgiving of
     hash-fragment length. Chromium / Firefox / WebKit all support
     hash fragments well into the tens of KB without truncation;
     query-string length caps are tighter and vary across CDNs.

  3. **Loading-time UX.** A change to the hash fragment does NOT
     trigger a page reload (whereas changing the query string
     navigates to a new URL). This means the replay viewer can
     update `#log=` as the user pastes a new log without bouncing
     through a redirect. The query-string portion (`?run=`,
     `?seed=`) is set once and never mutated by the page.

- **Routing flow.**

  ```
  Page load (any URL)
    ↓
  Parse window.location.search (?run, ?seed, ?mods)
    ↓
  No ?run present → boot into "title screen" / "new run" mode
                     (Phase 9 work; Phase 8 ships a minimal
                     "fresh-from-seed" path here)
    ↓
  ?run present:
    ↓
  Parse ?seed and ?mods.
  Compute fingerprint(parsedInputs) using the BUILD's commitHash
  + rulesetVersion + parsed seed + parsed mods.
    ↓
  computed[0..22] === ?run ?
    yes → boot into the run; if window.location.hash starts with
          #log=, decode the log and silently replay (decision 8).
    no  → mismatched-version path (decision 5).
  ```

  The fingerprint check is what catches a mismatched commit hash:
  if the URL's `?run=` was generated against a different
  `commitHash` (or `rulesetVersion`, or `seed`, or `mods`) than the
  build serving the page, the recomputed fingerprint will not
  match. The mismatched-version handler (decision 5) takes over.

- **Alternatives considered:**
  - **Encode the action log inline in the query string
    (`?log=...`).** Rejected — see "server-side privacy" above plus
    the URL-length budget. Also: link-preview crawlers eagerly
    follow query-string URLs and would generate Discord/Slack/Twitter
    embeds containing the full action log in the embed metadata.
    This is not catastrophic but is mildly leaky.
  - **Encode the entire run as one big hash-fragment blob.**
    Rejected — the fingerprint is the *identifier*; servers and
    bookmarks treat URL identity off the query string. Putting
    `?run=` in the hash means refresh / bookmark / browser-history
    behavior breaks: navigating via browser-history forward/back
    wouldn't trigger a re-route on a bookmarked fingerprint.
  - **Use `&run=` after `?seed=` (ordering).** Rejected — the order
    of query parameters is canonical-irrelevant per RFC 3986;
    `URLSearchParams` parses any order. The displayed URL
    (whatever the browser shows) puts `?run=` first because the UI's
    `history.replaceState` uses a fixed order — see "Frozen
    contract" below.
  - **Path-style routing (`/icefall/run/<fingerprint>/seed/<seed>`).**
    Rejected — paths require the static host to serve any path
    under `/icefall/run/...` as `/icefall/index.html` (SPA-style
    routing). GitHub Pages does NOT support fallback-to-index;
    every path has to either exist as a file or 404. The path
    fallback would require either a 404.html shim
    (`<meta http-equiv="refresh">` redirect to `/?run=...`) or a
    client-side router that intercepts navigation. Both add
    complexity and the redirect introduces a flicker. Query-string
    routing avoids the entire mess.
  - **Custom URL scheme (`icefall://run/<fingerprint>`).** Rejected
    — completely unshareable on the web.

- **Why this option.** Query string for routing identity (the bytes
  that determine "which run is this") and hash fragment for replay
  data (the bytes that say "what happened in this run") cleanly
  separate concerns: server logs see only the identifier, the
  client sees both, the analytics and link-preview ecosystems see
  only the identifier. This is the same pattern used by Google Docs
  share links (`?id=...#offset=...`), Notion shared pages, and most
  modern static-site SPAs.

- **Frozen contract.**
  ```
  Canonical URL form (the form `history.replaceState` writes):
    <basePath>?run=<fp22>&seed=<encodeURIComponent(seed)>[&mods=<encodeURIComponent(modsCsv)>][#log=<base64url>]

  Where:
    <basePath> = "/icefall/" or "/icefall/releases/<commit-short>/" (decision 7)
    <fp22>     = the 22-char fingerprint short form (no DEV- prefix; if
                 input would be DEV-, the URL is refused at generation
                 time — see decision 5 mismatch flow)
    encodeURIComponent applied to seed and modsCsv exactly once
    base64url   = RFC 4648 §5 alphabet, unpadded (Phase 1 frozen)

  Parser tolerates:
    - Any param order in the query string (URLSearchParams).
    - Missing #log= (replay slot empty; boot fresh from seed).
    - Missing ?mods= (modIds: []).

  Parser rejects:
    - Missing ?run= when the URL's query string is non-empty (the page
      treats this as "title screen" or "fresh run" path, not as an error).
    - ?run= length !== 22 (after URL decode).
    - ?run= contains non-base64url-alphabet characters.
    - ?seed= absent when ?run= is present.
    - ?seed= URL-decodes to a string that violates the existing
      seed validation (well-formed UTF-16, no NUL — Phase 1 contract).
    - #log= present but base64url-decode fails or envelope decode fails.
  ```

- **Tests required.**
  - `tests/url/url-parser.test.ts` (new):
    - Round-trip: `parseUrl(formatUrl(inputs, log))` returns inputs
      + log byte-identically.
    - Param-order property: 24 permutations of three query params
      (`?run, ?seed, ?mods`) all parse to the same `inputs`.
    - URL-encoding correctness: seed `"floor 7 cat 🐈"` (with space
      and emoji) round-trips byte-identically through
      `encodeURIComponent` + parser.
    - Empty `?mods=` → `modIds: []`. `?mods=,,,` → `modIds: []`
      (decision 1a's empty-string-strip).
    - Pinned URL fixtures for the eight failure modes in decision 5.
  - `tests/url/url-routing.test.ts` (new): exercises the
    fingerprint-mismatch routing path (decision 5) using a synthetic
    build's `commitHash` + a synthetic URL `?run=<fp-from-different-commit>`.

- **Risks.**
  - **Browser history pollution.** `history.replaceState` (used to
    canonicalize the URL form on page load) does NOT add a history
    entry, so the user's back-button is not bloated. `pushState`
    would; the implementation MUST use `replaceState` for
    canonicalization. Pinned in 8.A.2 implementation review.
  - **iframe / embedded contexts.** `window.location.hash` is
    visible to the parent frame in same-origin embeds. Phase 8
    does not target iframe embedding; if Phase 9 polish adds
    iframe support, the action log's hash-fragment privacy should
    be re-reviewed.

### 4. URL-length policy and clipboard fallback: **`#log=` if compressed log ≤ 1500 chars; clipboard paste box otherwise**

- **Chosen.** The "Share This Run" UI in Phase 8 picks the URL form
  vs. the clipboard form based on a measured threshold:

  - Compute the encoded action log: `wire =
    base64url(fflate.deflateSync(envelope, { level: 1 }))`.
  - If `wire.length ≤ 1500` characters: include `#log=<wire>` in
    the shareable URL. The full URL fits comfortably in a 2000-char
    budget (`?run=` + `&seed=` + `#log=` typically ≤ 1700 chars).
  - If `wire.length > 1500` characters: omit `#log=` from the URL.
    The "Share This Run" widget shows two affordances:
    1. **"Copy URL"** — copies the shorter URL (just `?run=` +
       `?seed=` + `?mods=`) to the clipboard.
    2. **"Copy log"** — copies the bare `wire` string to the
       clipboard. The receiving page has a "Paste log here"
       `<textarea>` that accepts the same `wire` string.
    Plus an explainer: "This run is too long for inline URL
    sharing. Share the URL above (which loads the run from genesis)
    and ask the recipient to paste the action log into the box at
    the bottom of the page to fast-forward to your final state."

- **Why 1500 characters as the threshold.** Empirical: a typical
  short share URL is approximately:
  - `https://porkchop.github.io/icefall/` → 36 chars
  - `?run=` + 22 chars → 27 chars
  - `&seed=` + ~12 chars URL-encoded → 18 chars
  - `&mods=` + 0 chars → 6 chars (or absent)
  - `#log=` + N chars
  - Total ≈ 87 + N chars

  At N = 1500, total URL ≈ 1587 chars — well under the 2000-char
  practical limit for casual sharing (Discord, X/Twitter post-text,
  email body). Chrome's hard cap is ~32 KB, so we're nowhere near the
  browser limit; the cap is **shareability**, not technical.

  The threshold is **configurable in `src/share/params.ts`** but
  pinned to 1500 for v1; bumping it later does not change any
  encoded byte (the same `wire` is just inlined into one path
  vs. another).

- **Action-count math at the threshold.** `wire.length === 1500
  chars base64url` ≈ `1500 * 3/4 = 1125 bytes` compressed envelope ≈
  `~5–6 KB` uncompressed envelope (assuming 4–5x compression typical
  for repetitive action streams) ≈ `~600–700 actions`. So the URL
  path covers a typical floor 1–4 death (most playtested runs fall
  here); the clipboard path covers full-victory runs (`WIN_LOG` is
  1217 actions = ~1500–2500 wire chars compressed; close to or just
  past the threshold).

- **Alternatives considered:**
  - **Always use clipboard for the log.** Rejected — the inline-URL
    case for short runs is a much smoother first-share UX. The
    death screen on a floor-1 dive (50 actions, ~150 wire chars)
    fits in a tweet trivially; forcing the user through clipboard
    here is friction.
  - **Always use URL hash; truncate or refuse if too long.**
    Rejected — Phase 7's `WIN_LOG` is the canonical "completed
    victory" run and is right at or past the threshold. Refusing
    to share a winning run via URL is a bad outcome.
  - **Server-hosted gist** (paste the log to a third-party gist
    service, share the gist URL). Rejected — adds a runtime
    dependency on a third-party service, breaks "browser-first, no
    backend" (SPEC.md principle 6), introduces a network failure
    mode for sharing.
  - **Browser-side IndexedDB share via Web Share Target API.**
    Rejected — not universally supported, and the UX of "save to
    your local DB then share" is no better than clipboard.
  - **Two URLs: a short identifier URL plus a separate log URL.**
    Rejected — same UX problem as gist (two pieces to share); also
    breaks the "URL is the share unit" pattern.

- **Why this option.** Inline URL when it fits, clipboard when it
  doesn't, with a clear receiving-page paste box for the long-log
  case. Two paths is one more than ideal but is irreducible given
  browser URL length caps. The threshold is empirical and can be
  tuned without breaking any frozen contract (the `wire` bytes are
  the same in both paths).

- **Frozen contract.**
  ```
  URL_LOG_THRESHOLD_CHARS = 1500    // base64url log length
                                    // compressed envelope; bumping is
                                    // a UX tweak, not a rulesetVersion bump
  Sharing UI behavior:
    let wire = encodeActionLog(actions)         // base64url string
    let sharePath = formatSharePath(inputs)     // ?run=...&seed=...&mods=...
    if wire.length <= URL_LOG_THRESHOLD_CHARS:
      shareUrl = baseUrl + sharePath + "#log=" + wire
      uiMode = "url-only"
    else:
      shareUrl = baseUrl + sharePath
      uiMode = "url-plus-clipboard-log"
      // Show "Copy log" button + "Copy URL" button; explain on receiver

  Receiver behavior:
    on page load, after fingerprint matches:
      if window.location.hash starts with "#log=":
        wire = window.location.hash.slice("#log=".length)
        actions = decodeActionLog(wire)
        replay(actions)
      else:
        show "Paste log here" textarea (input ID pinned: paste-log-textarea)
        on paste: wire = textarea.value.trim()
                  actions = decodeActionLog(wire)
                  replay(actions)
                  history.replaceState(..., baseUrl + sharePath + "#log=" + wire)
                  // canonicalize URL after paste so refresh preserves the log
  ```

- **Tests required.**
  - `tests/share/share-url.test.ts` (new): given `(inputs, actions)`
    pairs of varying sizes (50, 500, 1000, `WIN_LOG` 1217),
    `formatShareUrl(...)` produces a URL that round-trips through
    `parseShareUrl(...)` to the original `(inputs, actions)`.
    Asserts `wire.length` for `WIN_LOG` matches a pinned upper
    bound (the actual size pinned during 8.A.2 on sandbox; see
    decision 13).
  - 8.A.2 paste-box integration test: `tests/share/paste-replay.test.ts`
    simulates pasting the `WIN_LOG` `wire` string into the
    textarea, asserts the receiver's `__SIM_FINAL_STATE_HASH__`
    matches `WIN_DIGEST` (i.e., the log replays correctly).
  - 8.B Playwright cross-runtime: after the share roundtrip, all
    three browsers produce the same `__SIM_FINAL_STATE_HASH__`.

- **Risks.**
  - **Threshold drift.** As the action vocabulary grows, the
    average action size grows (item IDs in `use`/`buy` actions are
    long-ish strings). The threshold may need re-tuning. Phase 8
    implementation includes a `stats` log on every share that
    records the wire-length distribution; Phase 9 polish revisits
    if needed.
  - **Clipboard API availability.** Modern browsers expose
    `navigator.clipboard.writeText`; Firefox has historically been
    behind. Phase 8 falls back to `document.execCommand("copy")`
    on a hidden textarea for the older path; both paths produce
    the same wire bytes.

### 5. Mismatched-version UX: **detect at fingerprint-recompute step; redirect to `releases/<commit>/` with the original URL parameters preserved; pinned error strings on every failure mode**

- **Chosen.** When a user opens a URL with `?run=<fp>` but the
  page's build does not match the fingerprint's claimed
  `(commitHash, rulesetVersion)`, the page redirects via
  `window.location.replace(...)` to the matching pinned release
  URL. If no matching pinned release exists, the page shows an
  actionable error.

  **Detection algorithm:**

  1. Page loads at `https://porkchop.github.io/icefall/?run=<fp>&seed=<seed>&mods=<csv>#log=<log>`
     (or the `releases/<commit>/` variant).
  2. Parse `(claimedFp, claimedSeed, claimedModIds)` from the URL.
  3. Compute `actualFp = fingerprint({ commitHash:
     <BUILD_COMMIT>, rulesetVersion: <BUILD_RULESET>, seed:
     claimedSeed, modIds: claimedModIds })`.
  4. **If `actualFp.slice(0,22) === claimedFp`:** the build matches
     the fingerprint's expected build. Boot normally. Exit.
  5. **If `actualFp.slice(0,22) !== claimedFp`:** the build does
     NOT match. Three sub-cases:
     - **Sub-case 5a: We are at `latest/`.** The URL was generated
       against an older `commitHash`. The user does NOT know the
       older commit hash from the fingerprint alone (the fingerprint
       is a hash, not an encoding). We must enumerate the *known
       set* of release commits and try each one — but that requires
       a release manifest (decision 7's `releases/index.json`).
       - Load `releases/index.json` (decision 7). It lists the
         commit-short of every published release.
       - For each commit-short in the index (newest-first), compute
         a candidate fingerprint using the per-release manifest
         entry's `commitHash` and `rulesetVersion`.
       - On the first match, redirect to
         `releases/<commit-short>/?run=...&seed=...&mods=...#log=...`.
       - On no match (the URL's fingerprint doesn't match any
         published release): show error UX 5d.
     - **Sub-case 5b: We are at `releases/<commit-short>/`.** The
       URL was generated against a *different* commit-short, OR
       against a different `(seed, modIds)` from what's claimed,
       OR was tampered with. Show error UX 5c.
     - **Sub-case 5c: We are at the right commit-short but the
       fingerprint still doesn't match.** This means `?seed=` or
       `?mods=` was tampered with after the fingerprint was
       generated. Show: `"This run's fingerprint doesn't match the
       seed or mods in its URL. The link may have been edited or
       corrupted. Open the original sharer's URL or generate a new
       run."`
     - **Sub-case 5d: We are at `latest/`, no release in the index
       matches.** Either the URL is from a future commit (possible
       if the user clicked a link before the release pipeline
       published the corresponding release — race condition window
       of seconds), or the URL is from a deeply-pruned old release
       (decision 7 retention policy).
       Show: `"This run was created with build <claimed-commit> but
       no matching release was found. The release may not yet be
       published (try refreshing in a minute) or may have been
       pruned. Open the run on the original sharer's machine, or
       use 'New Run' to start fresh."`
       (Actually we don't *know* `<claimed-commit>` — see "Risks"
       below; the error message is rephrased to "no release
       matched this run.")

  **Critical refinement (red-team-anticipating).** Sub-case 5a's
  enumeration is bounded but worst-case O(N) where N is the number
  of published releases. The retention policy (decision 7) caps N
  at ~500–1000 releases for v1 (a few years of weekly commits).
  Each candidate fingerprint computation is one SHA-256 over ~80
  bytes — well under 1ms in any modern browser. Worst-case
  enumeration time at N=1000 ≈ 1s — acceptable but not ideal.
  Optimization (decision 7's `releases/index.json` MAY include a
  reverse `fingerprintShortPrefix → commitShort` index): a 4-char
  base64url prefix has 16M slots, so a 1000-commit index can
  pre-index by 4-char prefix in ~1KB JSON; the lookup becomes O(1)
  in the typical case and O(few candidates) when prefixes collide.
  Phase 8.A.2 ships the linear scan; 8.A.3 may add the index if
  measurement shows it's needed (decision 13 measurement plan).

- **Error string vocabulary** (pinned in `src/router/messages.ts`,
  Phase 4-style exact-character match):

  ```
  // src/router/messages.ts
  export const ROUTE_ERR_FP_INVALID =
    "url: ?run= must be 22 base64url characters (got <N>: <repr>)";

  export const ROUTE_ERR_FP_BAD_CHAR =
    "url: ?run= contains non-base64url character at position <i>";

  export const ROUTE_ERR_SEED_MISSING =
    "url: ?run= present but ?seed= missing — cannot reconstruct run";

  export const ROUTE_ERR_SEED_INVALID =
    "url: ?seed= invalid — must be a non-empty UTF-8 string with no NUL byte";

  export const ROUTE_ERR_MODS_INVALID =
    "url: ?mods= entry <i> contains forbidden character (NUL or comma)";

  export const ROUTE_ERR_LOG_DECODE =
    "url: #log= failed to decode — <inner-error>";

  export const ROUTE_ERR_NO_MATCHING_RELEASE =
    "router: this run was created with a different build than 'latest'; no matching pinned release was found in releases/index.json — the release may not yet be published (try refreshing in a minute) or may have been pruned";

  export const ROUTE_ERR_FP_TAMPERED =
    "router: this run's fingerprint doesn't match its seed or mods — the URL may have been edited or corrupted; open the original sharer's URL or click 'New Run'";

  export const ROUTE_ERR_RELEASE_INDEX_FETCH =
    "router: failed to fetch releases/index.json — cannot route mismatched-build URLs (network error or release index missing)";
  ```

  Em-dashes are U+2014 (the same character class Phase 4 addendum
  N7 pinned for `PLACEHOLDER_REFUSAL_MESSAGE`). Substitution
  variables (`<N>`, `<repr>`, `<i>`, `<inner-error>`) are filled at
  throw time with deterministic values.

- **Why this option.** The redirect path (sub-case 5a) is the
  user-visible "I shared a fingerprint with a friend; they opened
  it; it works" critical path. Anything other than transparent
  redirect — a banner, a "click here to open in v0.7", a manual
  copy/paste — adds friction at the moment of trust-building (the
  friend just opened the URL, expecting a working game; instead
  they get a "click here to continue" prompt). The redirect must
  preserve `?seed=`, `?mods=`, AND `#log=` through the
  `window.location.replace(...)`. This is testable.

- **Alternatives considered:**
  - **Banner with "click to redirect" link (no auto-redirect).**
    Rejected — adds friction. Auto-redirect is the right default;
    the URL bar updating to `releases/abc1234/...` is a clear
    signal to the user that something resolved.
  - **Refuse with explainer "this fingerprint doesn't match the
    current build"** (no redirect attempt). Rejected — defeats the
    entire point of content-addressed releases. The `releases/`
    layout exists precisely so old fingerprints stay loadable.
  - **HTTP 301 redirect at the static-host layer.** Rejected —
    GitHub Pages is static; we can't generate a per-fingerprint
    redirect rule on the server. Even Vercel/Netlify edge functions
    couldn't generate this (they'd need to know the fingerprint→
    commit mapping, which is exactly what `releases/index.json` is).
  - **`<meta http-equiv="refresh">` redirect.** Rejected — same
    problem (no per-fingerprint logic).
  - **Don't auto-redirect; instead `<iframe src="releases/<commit>">`
    inside `latest/`.** Rejected — breaks the URL's identity (the
    user-visible URL is still `latest/?run=...`), so back/forward
    button and bookmark behavior is wrong. Also: nested-frame
    determinism flags (`window.__SIM_FINAL_STATE_HASH__`) wouldn't
    propagate cleanly.

- **Frozen contract.**
  ```
  // The redirect URL preserves query string AND hash fragment.
  function redirectToPinnedRelease(commitShort, originalUrl) {
    const u = new URL(originalUrl);
    const release = `${BASE_PATH}releases/${commitShort}/`;
    const target = `${u.origin}${release}${u.search}${u.hash}`;
    window.location.replace(target);
  }
  // Note window.location.replace, NOT window.location.assign — we
  // do not want the back-button to bounce back to the latest/ URL
  // that we just redirected away from.
  ```

  Pinned in 8.A.2; `tests/router/redirect.test.ts` asserts
  `replace`-vs-`assign` and that `search` + `hash` survive the
  redirect.

- **Tests required.**
  - `tests/router/router.test.ts` (new):
    - Same-build path (5a base case): URL's fingerprint matches the
      build → no redirect, parsed inputs returned.
    - Older-build path (5a redirect): URL's fingerprint matches a
      synthetic pinned release in a fixture `releases/index.json`
      → asserts `redirectToPinnedRelease` is called with the
      correct commit-short, and the URL preserved.
    - No-matching-release path (5d): fingerprint doesn't match
      build OR any release index entry → throws
      `ROUTE_ERR_NO_MATCHING_RELEASE`.
    - Tampered URL path (5c): at `releases/abc1234/` with a
      fingerprint that doesn't match the build's commit AND the
      build's commit IS abc1234 → throws `ROUTE_ERR_FP_TAMPERED`.
    - Each error string is asserted byte-identical (em-dash, exact
      substitutions).
  - `tests/router/messages.test.ts` (new): every error string in
    `src/router/messages.ts` matches a pinned regex `^(url|router):
    ` and contains a U+2014 em-dash where shown.
  - 8.B Playwright: a synthetic test fingerprint is generated
    against a known-old commit (the previous Phase 7.B commit's
    short hash); the live deploy at `latest/` is exercised; the
    test asserts the URL bar updates to `releases/<old-commit>/`.

- **Risks.**
  - **`releases/index.json` fetch failure.** Network error,
    `index.json` malformed, or 404 (early in the project's life
    when `releases/` doesn't yet exist). The error
    `ROUTE_ERR_RELEASE_INDEX_FETCH` is shown; the user can fall
    back to opening the run with manual seed entry on `latest/`
    (which won't reproduce visuals if rulesets differ but at least
    starts the game).
  - **Race condition: URL-with-new-commit-fp clicked before the
    new release publishes.** `gh-pages` deploy takes ~30s; a user
    sharing a URL the moment they finish a run might be ahead of
    the deploy by up to a minute. The `ROUTE_ERR_NO_MATCHING_RELEASE`
    text ("try refreshing in a minute") covers this.
  - **Pruning collision.** If a release was pruned (decision 7),
    the redirect cannot succeed. Same error path; same UX.
  - **`releases/index.json` size growth.** At 1000 commits with
    `{commitShort, commitHash, rulesetVersion}` per entry,
    `index.json` ≈ 1000 × 100 bytes ≈ 100 KB. Acceptable for the
    routing path; brotli'd over the wire, ≈ 20 KB. Phase 8.A.3
    can revisit if it grows unreasonably.

### 6. URL parser implementation: **`src/router/url-parse.ts`, single function, returns discriminated union**

- **Chosen.** A single pure function `parseShareUrl(href: string):
  ParseResult` with a discriminated-union return type:

  ```ts
  // src/router/url-parse.ts
  export type ParseResult =
    | { kind: "no-run-param"; baseUrl: URL }
    | { kind: "ok"; inputs: FingerprintInputs;
        claimedFingerprint: string;       // 22-char short
        actionLog: Action[] | null;       // null if no #log=
        baseUrl: URL }
    | { kind: "error"; error: string;     // pinned error string
        message: string;                  // human-readable variant
        baseUrl: URL };

  export function parseShareUrl(href: string): ParseResult;
  export function formatShareUrl(
    inputs: FingerprintInputs,
    actionLog: readonly Action[] | null,
    baseUrl: string,
  ): string;
  ```

  The function lives in `src/router/url-parse.ts`. It is **pure** —
  no DOM access, no `window.*`, no `localStorage` — so it is
  Vitest-testable in Node and re-usable by the verifier (decision
  10) and the router (decision 5).

- **Layer.** A new top-level `src/router/` directory joins
  `src/core/`, `src/sim/`, `src/mapgen/`, `src/atlas/`, `src/render/`,
  `src/input/`, `src/ui/`. Layer constraints (added to
  `docs/ARCHITECTURE.md`'s layer table in 8.A.1):

  | Layer | Imports allowed | Imports forbidden |
  |---|---|---|
  | `src/router/` | `src/core/`, `src/build-info.ts` | `src/sim/`, `src/mapgen/`, `src/render/`, `src/atlas/`, `src/input/`, `src/ui/`, `src/main.ts`; `node:*`, `Buffer`; `crypto.subtle`, `Date.*`, `Math.random`, `performance.*` |

  Same hardline as `src/core/`. The router consumes `commitHash`
  and `rulesetVersion` from `src/build-info.ts` (already exported)
  and the action-log codec from `src/core/action-log.ts` (which
  imports `encodeAction` from `src/core/encode.ts`).

- **Why a separate `src/router/` layer.** Three reasons:
  1. **Bundle-size isolation.** The Phase 9 title screen will
     statically import `src/router/url-parse.ts` to read the
     `?seed=` parameter. We don't want it to also pull in the sim,
     the atlas, or the renderer. A top-level layer with hard import
     boundaries makes this cleanly tree-shakeable.
  2. **Testability.** Pure URL parsing in a Node-only test surface
     means no browser harness is required. The router's "redirect"
     side effect (decision 5) is in a separate file
     `src/router/redirect.ts` that imports the parser; the
     redirect file is the only one that touches `window.location`.
  3. **Layer contract enforcement.** ESLint `no-restricted-imports`
     for `src/router/**` matches the discipline already pinned for
     `src/core/**`, `src/sim/**`, `src/atlas/**`. Adding a new
     layer is a surgical change.

- **Alternatives considered:**
  - **Put URL parsing in `src/core/`.** Rejected — `src/core/`
    is already crowded (state-chain, fingerprint, hash, encode,
    streams, prng, seed, intmath, self-test). Adding `url-parse`
    blurs the "core deterministic primitives" role of `src/core/`
    with the "presentation/routing" role of router code. Better to
    split.
  - **Put URL parsing in `src/main.ts`.** Rejected — `src/main.ts`
    is the orchestration entry point, which is browser-only (it
    imports `document`, `window`). Putting URL parsing there
    means tests have to either run in a browser harness or stub
    `window` heavily. The pure-Node testability of a top-level
    `src/router/` layer is cleaner.
  - **Put URL parsing in `src/ui/`.** Rejected — same problem as
    `src/main.ts`; `src/ui/` is visual/rendering. URL routing is
    not UI; it's the contract surface for share/restore.

- **Why this option.** The `src/router/` layer is small (~200–400
  lines for the parser + redirect helper) but is one of the most
  load-bearing surfaces in the project (decision 5's redirect
  determines whether shared fingerprints actually load). Isolating
  it makes layer-contract enforcement and bundle-size accounting
  straightforward. The Phase 9 title screen and the Phase 8 verifier
  are both downstream consumers.

- **Frozen contract.**
  ```
  src/router/url-parse.ts:
    export function parseShareUrl(href: string): ParseResult;
    export function formatShareUrl(inputs, log, baseUrl): string;
    Pure (no DOM); deterministic; total (every input returns a result,
    no thrown exceptions for malformed input — errors are surfaced via
    ParseResult's "error" variant).

  src/router/redirect.ts:
    export function redirectToPinnedRelease(commitShort, href): void;
    The ONLY function in src/router/** that touches window.location.
    Calls window.location.replace(...) with the rewritten URL.

  src/router/messages.ts:
    Pinned error strings (decision 5).
  ```

- **Tests required.** Listed in decision 3 + 5; no new test surfaces
  here.

- **Risks.**
  - **`URL` constructor cross-runtime drift.** WHATWG `URL` is
    well-specified and consistent across Node 20+ / chromium /
    firefox / webkit. Phase 8.B Playwright verifies on all three
    browsers.
  - **`URLSearchParams` ordering.** Iteration order is
    insertion-order in all targets. We don't rely on a specific
    iteration order in `parseShareUrl` — it's a flat lookup
    (`params.get("run")`).

### 7. `releases/<commit-short>/` layout: **single deploy artifact, gh-pages branch holds latest/ AND releases/<commit>/; Vite per-release `base`; `releases/index.json` manifest; keep-all-releases retention until size budget hit**

- **Chosen.** The deploy pipeline is extended to publish, on every
  push to `master`:
  1. The bare deploy at `https://porkchop.github.io/icefall/` (i.e.,
     `latest/` from the user's perspective; the GH-Pages deploy root).
  2. A pinned copy at
     `https://porkchop.github.io/icefall/releases/<commit-short>/`
     where `<commit-short>` is the same 7-char prefix Phase 1 reads
     from `git rev-parse --short=7 HEAD` (`vite.config.ts:7`).

  Both copies are produced from the **same `npm run build`** output
  (one Vite build); the per-release copy uses Vite's `base:
  '/icefall/releases/<commit-short>/'` so its asset URLs resolve
  correctly under the per-release path. (The two outputs differ
  only in the `<base href>` element of `index.html` and in the
  asset paths in the bundled JS — the actual JS, the atlas PNG, the
  atlas JSON, the floor JSON fixtures are byte-identical between
  the two copies.)

- **Filesystem layout on `gh-pages`** (after several releases):
  ```
  /                                  ← latest/, served at /icefall/
    index.html
    assets/
      atlas.png
      atlas.json
      <chunked-js>.js
    releases/
      index.json                      ← release manifest (decision 5's lookup)
      abc1234/
        index.html                    ← Vite base = /icefall/releases/abc1234/
        assets/
          atlas.png                   ← THIS commit's atlas (ruleset-pinned)
          atlas.json
          <chunked-js>.js
      def5678/
        index.html
        assets/
          ...
  ```

  The `releases/index.json` manifest is the source-of-truth for
  routing (decision 5):

  ```json
  {
    "schemaVersion": 1,
    "releases": [
      {
        "commitShort": "abc1234",
        "commitHash": "abc1234",
        "rulesetVersion": "<64-char-hex>",
        "atlasBinaryHash": "<64-char-hex>",
        "publishedAt": "2026-05-09T12:34:56Z"
      },
      ...
    ]
  }
  ```

  Sorted by `publishedAt` descending (newest first); the router
  (decision 5) iterates from the top.

  **Pinning notes.**
  - `commitShort` is the 7-char form (matches `vite.config.ts`
    `--short=7`); `commitHash` is the same 7-char form for now (we
    do NOT inject the full 40-char hash anywhere — Phase 1 frozen
    contract). If a future phase wants the full hash, that's a
    separate decision; for now, both fields hold the 7-char short.
    Keeping both fields in the manifest schema is defense-in-depth
    against a future Phase 9+ shift to full hashes.
  - `publishedAt` is a UTC ISO-8601 timestamp — the **only** wall-clock
    value that touches the project, and it lives outside `src/sim/`,
    `src/mapgen/`, `src/atlas/` (the lint-banned scopes), inside
    `src/router/`. The router does NOT use it for any byte-affecting
    computation; it's metadata for sort-by-recency and human
    debugging.

- **Vite `base` per release.** The current build (`vite.config.ts:16`)
  hard-codes `base: "/icefall/"`. The Phase 8.A.3 build pipeline
  produces TWO build outputs:
  1. `dist-latest/` — built with `base: "/icefall/"`, deployed to
     `gh-pages:/`.
  2. `dist-release/` — built with `base:
     "/icefall/releases/<commit-short>/"`, deployed to
     `gh-pages:/releases/<commit-short>/`.

  Implementation: a build script (`scripts/build-dual.mjs`) runs
  `vite build --base /icefall/ --outDir dist-latest`, then
  `vite build --base /icefall/releases/<commit-short>/ --outDir
  dist-release`. The `vite-plugin-atlas-binary-hash.mjs` plugin
  is invoked twice — but it reads `assets/atlas.png` from disk (which
  is byte-identical between invocations because no rebuild
  happens between the two), so `__ATLAS_BINARY_HASH__`,
  `__RULESET_VERSION__`, and `__COMMIT_HASH__` are byte-identical
  across the two builds. The only difference is `base`.

  Then a publish script (`scripts/publish-dual.mjs`) merges
  `dist-latest/` and `dist-release/<commit-short>/` into a single
  `dist-publish/` tree, regenerates `releases/index.json` by
  appending the new entry, and uploads the merged tree to
  `gh-pages` via `actions/upload-pages-artifact@v3`.

  See decision 17 for why this is a separate phase (8.A.3) from the
  JS-only changes in 8.A.2.

- **Retention policy.** **Keep all releases forever** until the
  `gh-pages` repo size approaches GitHub's soft cap (1 GB per repo,
  with a 100 GB hard cap). Estimated growth:
  - Each release is ~250 KB of JS+CSS+HTML+atlas (a typical Vite
    build of this scope, plus the atlas at ~5 KB and the floor
    fixtures at ~30 KB).
  - At 250 KB/release × 500 releases = ~125 MB. Well within the
    soft cap.
  - At 1000 releases = ~250 MB. Still under.
  - At 4000 releases = ~1 GB. **Soft cap hit; pruning policy
    activates** (Phase 9 polish or earlier if growth surprises).

  The retention rule pinned in `docs/PROD_REQUIREMENTS.md`
  (8.A.1's deliverable per `docs/PHASES.md:554`):

  > **Keep all releases forever until repo size exceeds 800 MB on
  > `gh-pages`.** When triggered, prune the oldest releases (the
  > ones least likely to be currently shared) until repo size is
  > under 600 MB. Pruning is a maintainer action, not automatic;
  > pruned-release URLs return 404 from `releases/<commit>/` and
  > the router (decision 5) shows
  > `ROUTE_ERR_NO_MATCHING_RELEASE`. Prior shared fingerprints
  > under pruned releases are unrecoverable; the user is directed
  > to start a new run on `latest/` with the same seed.

  This is a Phase 8 *policy* decision, not a Phase 8 *code* change.
  No pruning script is shipped in 8.A.3 (the policy doesn't
  trigger for years at typical commit cadence). When pruning is
  needed, a Phase 9+ planning gate revisits.

- **Why this option.**
  - **Single artifact merge** (vs. two artifacts uploaded
    separately): GH-Pages's `actions/deploy-pages` consumes a
    single artifact uploaded by `actions/upload-pages-artifact`.
    Two separate artifacts would require two deploys (which
    GH-Pages serializes per-repo) or a custom `gh-pages` branch
    workflow (which exists but is more complex than the
    `actions/configure-pages` flow already in
    `.github/workflows/deploy.yml`). The single-merge approach
    keeps the existing workflow shape.
  - **Per-release atlas pinning**: the atlas PNG is duplicated in
    `latest/assets/atlas.png` AND `releases/<commit>/assets/
    atlas.png`. They are byte-identical for the *current* commit
    but diverge for *prior* commits (each prior release pinned
    its atlas at publish time; that's the entire point of
    per-release pinning).
  - **Keep-all-forever retention** is the correct default for a
    project of this size. The math is comfortably under GH limits
    for years; revisiting only when actual growth threatens the
    cap. Eager pruning is premature optimization.

- **Alternatives considered:**
  - **Single artifact, no per-release subtree** (i.e., only
    `latest/` is published). Rejected — defeats the entire Phase 8
    promise. Old fingerprints would silently break on every
    `rulesetVersion` bump.
  - **Two CI artifacts: one for `latest/`, one for `releases/<commit>/`,
    deployed separately.** Rejected — GH-Pages's API is one-deploy-per-push;
    a second artifact would require a different deploy mechanism
    (custom `gh-pages` branch script). More complexity for no benefit.
  - **`releases/<commit>/` is a separate repo or submodule.**
    Rejected — adds operational surface (a second repo to maintain,
    a sync script, etc.) and doesn't reduce growth (the bytes are
    the same).
  - **Append-only `git` tags as the release index.** Rejected —
    `git` tags are tracked in the source repo, not the `gh-pages`
    deploy. The router would need to fetch `tags` from the GitHub
    REST API, which is rate-limited and async; `releases/index.json`
    is fetchable as a plain static asset.
  - **Build per-release artifacts on-demand** (i.e., when a
    fingerprint URL hits `latest/`, fetch the per-release build
    from a server). Rejected — this is exactly the "no backend"
    SPEC.md principle 6 violation that Phase 8 is engineered
    around.

- **Why a single artifact for both deploys.** GitHub Pages's
  `actions/deploy-pages@v4` consumes one artifact. Producing two
  artifacts would require a separate deploy mechanism. The
  publish-dual script merges the two builds into one dist tree;
  this is the cleanest path that keeps the existing workflow
  shape.

- **Frozen contract.**
  ```
  GH-Pages root layout:
    /                                  → latest, served at /icefall/
      index.html (base = /icefall/)
      assets/
      releases/
        index.json                     → manifest (schemaVersion = 1)
        <commitShort>/                 → per-release pinned subtree
          index.html (base = /icefall/releases/<commitShort>/)
          assets/atlas.png             → THIS commit's atlas
          assets/atlas.json
          <chunked-js>.js

  releases/index.json schema (Phase 8 frozen):
    {
      "schemaVersion": 1,
      "releases": [
        { "commitShort": "<7 chars>",
          "commitHash":  "<7 chars>",  // alias of commitShort for v1
          "rulesetVersion": "<64-char hex>",
          "atlasBinaryHash": "<64-char hex>",
          "publishedAt": "<ISO-8601 UTC>" },
        ...
      ]
    }

  Sort: descending by publishedAt (newest first).

  schemaVersion = 2 reserved for a future schema change; v1 reader
  rejects v2 (forward-compat constraint, mirrors Phase 4 atlas
  manifest schema).
  ```

- **Tests required.**
  - `tests/build/release-index.test.ts` (new): asserts
    `releases/index.json` schema (alphabetical-key order,
    schemaVersion = 1, all fields present per release).
  - `tests/build/dual-base.test.ts` (new): given a synthetic build
    output, asserts that `dist-release/<commit>/index.html`
    contains `<base href="/icefall/releases/<commit>/">` and
    that all asset paths in the bundled JS resolve to
    `/icefall/releases/<commit>/assets/...`.
  - 8.A.3 / 8.B CI: the actual gh-pages deploy is exercised
    by-eyeball at first; an automated check is added that fetches
    `https://porkchop.github.io/icefall/releases/<latest-commit>/`
    after deploy and asserts a 200 response.

- **Risks.**
  - **GH-Pages deploy artifact size cap.** GH-Pages limits the
    upload artifact size to 10 GB per deploy; we're nowhere near
    this even at thousands of commits.
  - **Git history of `gh-pages` branch.** The branch grows ~250 KB
    per commit (one new release directory). At 1000 commits, the
    branch's working tree is ~250 MB; the `.git` directory carries
    historical packs that GH-Pages deploys *replace* (it's a
    force-push pattern, not append). Soft cap of 1 GB per repo
    applies to the *checkout size*, which is 250 MB — under the
    cap. No special handling needed.
  - **First deploy ever** (when `releases/` doesn't yet exist):
    the publish-dual script must handle "no prior `index.json`"
    by initializing one. Pinned in 8.A.3 implementation review.
  - **Race condition between two simultaneous deploys.** The
    GH-Pages workflow's `concurrency: { group: pages,
    cancel-in-progress: false }` (already in
    `.github/workflows/deploy.yml:13-14`) serializes deploys, so
    `releases/index.json` is updated atomically per deploy. No
    locking needed.
  - **`releases/index.json` rebuild correctness.** The publish-dual
    script needs to *append* to the existing index, not overwrite.
    Implementation: fetch the previous deploy's `releases/index.json`
    via the GH-Pages URL, parse, prepend the new entry, write. If
    the fetch fails (e.g., first deploy ever), initialize an empty
    index. Tested via 8.A.3 fixture.

### 8. localStorage persistence: **action-log auto-save every N=10 actions; key = `icefall:save:v1:<fingerprintShort>`; resume = silent replay; quota-exceeded triggers oldest-slot eviction**

- **Chosen.** The game's run loop appends each player action to an
  in-memory action log. Every N=10 actions (and on the
  `beforeunload` event), the action log is encoded (decision 2) and
  written to `localStorage` under the key
  `icefall:save:v1:<fingerprintShort>`.

  ```ts
  const SAVE_KEY_PREFIX = "icefall:save:v1:";
  const SAVE_INTERVAL_ACTIONS = 10;

  type SaveSlot = {
    readonly schemaVersion: 1;
    readonly fingerprintShort: string;        // 22-char form
    readonly fingerprintFull: string;         // 43-char form (verifier convenience)
    readonly inputs: FingerprintInputs;       // stored unchanged for resume
    readonly actionLog: string;               // wire form (base64url)
    readonly logLength: number;               // count of actions in actionLog
    readonly outcome: RunOutcome;             // last-known outcome
    readonly floorN: number;                  // last-known floor
    readonly hpRemaining: number;             // last-known player.hp
    readonly stateHashHex: string;            // last-known stateHash hex
    readonly savedAt: string;                 // ISO-8601 UTC
  };
  ```

  On page load, after the URL parser yields `inputs` (decision 6):
  1. Compute `fingerprintShort = fingerprint(inputs)`.
  2. Read `localStorage[SAVE_KEY_PREFIX + fingerprintShort]`.
  3. If present and `JSON.parse`-decoded successfully, decode the
     `actionLog` field (decision 2) and run `runScripted(inputs,
     actions)` silently — the resulting `RunState` is the resumed
     state. If a `#log=` URL fragment is also present, the URL
     fragment **wins** (it's a deliberate share, presumably
     overriding any in-progress local play). Verify
     `localState.stateHashHex === replayedState.stateHash` to
     confirm the slot is consistent.
  4. If absent: boot a fresh run from the inputs (no resume).

- **Why N=10.** Empirically:
  - Average action latency in the harness is < 1 ms; 10 actions ≈
    10 ms of play. Saving every 10 actions is 0.1% overhead.
  - Worst-case loss-on-crash is 9 actions of progress (≈ 9
    seconds of typical play, though "seconds" is meaningless under
    determinism — it's 9 actions of *intent*). Acceptable.
  - `localStorage.setItem` is synchronous and ~1ms; doing it every
    action would dominate frame-time budget. Every 10 amortizes
    well.
  - 10 is the same N the SPEC.md "Resume after closing the tab"
    user journey implicitly assumes (the player closes the tab,
    reopens, expects to be at "their current floor" — which under
    every-10 saves is always within the same floor, since floors
    are typically 50–200 actions long).

- **Multi-slot support.** A player can have multiple in-progress
  runs (e.g., "I'm playing seed alpha-123 on my laptop and seed
  beta-456 on my desktop, both branches of the same commitHash").
  Each `(commitHash, rulesetVersion, seed, modIds)` tuple has a
  distinct fingerprint, so each is a distinct localStorage slot —
  no collision possible by construction.

  The "Multi-slot save UI" deliverable
  (`docs/PHASES.md:551`) is a list view in the title screen / start
  menu (Phase 9 polish) that enumerates all `localStorage` keys
  starting with `SAVE_KEY_PREFIX`, displays each as a row
  `(seed, floor, hp, last-saved)`, and lets the user click to
  resume or delete. Phase 8.A.2 ships a minimal version of this
  UI; Phase 9 polishes.

- **Quota-exceeded handling.** `localStorage` per-origin quota is
  ~5–10 MB depending on browser. Phase 8 maintains an upper bound:
  - Each save slot is ~1–10 KB (typical compressed action log
    plus metadata).
  - 100 in-progress runs ≈ 1 MB. Well under the cap.
  - 1000 in-progress runs ≈ 10 MB. Approaches the cap.

  When `localStorage.setItem` throws `QuotaExceededError`:
  1. Enumerate all `SAVE_KEY_PREFIX` keys, sort by `savedAt`
     ascending (oldest first).
  2. Delete the oldest 5 slots (or until 1 MB free, whichever is
     larger).
  3. Retry `setItem`.
  4. If still throws: surface
     `"save: localStorage quota exceeded; export your action
     log via 'Share This Run' to preserve progress"`.

  No automatic eviction without user action under steady-state
  (the eviction only happens at `setItem` failure; if a user has
  exactly 950 KB of saves and never adds new ones, none are
  evicted).

- **Schema migration.** `SaveSlot.schemaVersion = 1` is pinned;
  bumping to 2 is a Phase 9+ event with its own migrator. v1
  readers reject v2 (`if (parsed.schemaVersion !== 1) { delete the
  slot, log a migration warning, treat as no-resume }`).

- **Alternatives considered:**
  - **Save every action.** Rejected — 10× the localStorage write
    rate for 1.1× the data preserved (loss-on-crash is at most 1
    action vs. at most 9). The amortized cost is small but the
    "save every action" UX does NOT meaningfully change the
    "resume" semantic: the player who closes the tab and reopens
    can't tell whether they lost 1 action or 9, because the
    granularity of "resume" is "the floor I was on" anyway.
  - **Save every 100 actions.** Rejected — 99 actions of loss
    on crash is too much (a full floor's worth).
  - **IndexedDB instead of localStorage.** Rejected for v1 —
    IndexedDB is async, has more complex error semantics, and
    isn't needed at our data size (<<10 MB). Phase 9+ may
    revisit if save-slot growth demands it.
  - **Cookie storage.** Rejected — sent on every HTTP request,
    quota is much smaller (~4 KB), serialization is restrictive.
  - **No persistence; resume always starts fresh.** Rejected —
    SPEC.md user journey 4 ("Resume after closing the tab") is a
    canonical product requirement. Defeats half of Phase 8's
    point.
  - **Save the full `RunState` snapshot instead of the action
    log.** Rejected — violates SPEC.md principle 2 ("action log is
    the save"). State serialization would need its own version
    contract, would be much larger than the compressed action log,
    and would lose the "any action log replays to the same state"
    guarantee.
  - **Save the action log as JSON instead of base64url(deflate).**
    Rejected — JSON is 5–10× larger than the compressed binary
    envelope. Each slot would be ~50 KB instead of ~5 KB,
    consuming 10× the quota.

- **Why this option.** N=10 amortizes the localStorage I/O cost
  over ten actions, never loses more than 9 actions of progress on
  a crash, and uses the same wire format (decision 2) for both
  on-disk and on-URL action-log storage. The
  multi-slot UI is keyed by fingerprint with collision-free
  guarantee from the fingerprint pre-image.

- **Frozen contract.**
  ```
  SAVE_KEY_PREFIX             = "icefall:save:v1:"
  SAVE_INTERVAL_ACTIONS       = 10
  SAVE_SLOT_SCHEMA_VERSION    = 1

  SaveSlot.actionLog uses the wire form pinned in decision 2
  (fflate level-1 deflate of the envelope, base64url-encoded).
  SaveSlot.inputs is JSON.stringify-able (FingerprintInputs is
  string-only).

  Save trigger: every SAVE_INTERVAL_ACTIONS actions, plus the
  beforeunload event.

  Resume: on page load, fingerprint→slot lookup; if present, replay
  the action log silently and assert stateHashHex matches the
  replayed final state hash. If mismatch (corrupted slot, or schema
  drift), DELETE the slot, log
  "save: slot for <fp> failed integrity check; deleted" and boot a
  fresh run.

  Quota-exceeded: evict oldest 5 slots by savedAt ascending; retry.
  If still throws: surface error string in decision 8 above.

  Schema bump: schemaVersion === 2 reserved for Phase 9+; v1 reader
  treats v2 slots as no-resume + warning.
  ```

- **Tests required.**
  - `tests/save/save-slot.test.ts` (new):
    - Round-trip: a `RunState` after K actions is persisted, then
      restored; replayed state matches byte-identically.
    - Multi-slot: two distinct fingerprints have two distinct
      slots; deleting one does not affect the other.
    - Quota-exceeded simulation: a fixture localStorage with 950
      KB of saves + a new write triggers eviction; assertion that
      the oldest 5 are deleted.
    - schemaVersion=2 input: read returns "no-resume + warning";
      slot is deleted.
    - Integrity check: slot with corrupted `stateHashHex` fails the
      replay-vs-state check and is deleted.
  - 8.B Playwright: open the diagnostic page, perform 10 actions,
    refresh, assert the state hash matches.

- **Risks.**
  - **localStorage available?** Safari ITP, private-browsing mode,
    and storage-disabled scenarios: `localStorage.setItem` throws
    or is no-op. The save layer wraps every call in try/catch and
    surfaces a non-fatal warning ("save: localStorage unavailable;
    progress will not persist across page reloads"). The game
    continues to play; just no resume.
  - **Schema drift between phases.** A Phase 9 SaveSlot v2 must
    interoperate with v1 slots (load v1 → migrate to v2 in memory
    → next save writes v2). Deferred to Phase 9.
  - **`replayed.stateHashHex !== saved.stateHashHex` integrity
    check failure.** Indicates either a corrupted slot or a
    `rulesetVersion` mismatch (the build's ruleset changed but the
    save was kept). The "delete + warn + boot fresh" fallback is
    the safe behavior; the user loses the corrupted slot but the
    new run is internally consistent.

### 9. Replay viewer: **dedicated `?mode=replay` URL parameter; pause/resume/step/speed UI; reuses the existing diagnostic page's `__SIM_FINAL_STATE_HASH__` flag**

- **Chosen.** A "replay" mode is activated by `?mode=replay`. In
  replay mode:
  - The page loads at the given fingerprint + log (decision 5
    routing applies as usual; if the fingerprint mismatches the
    build, the redirect to `releases/<commit>/` happens before
    replay starts).
  - The action log is decoded and held in memory.
  - The game's input source is **the action log**, not the
    keyboard. A timer (default 100 ms / action; user-tunable from
    10 ms to 1000 ms via a slider) feeds one action per tick.
  - UI: play/pause button, step-one-action button, step-back button,
    speed slider, "jump to end" button, action-counter display
    (`action 47 / 1217`), state-hash-at-current-step display
    (debugging affordance).
  - **At the end:** the `__REPLAY_FINAL_STATE_HASH__` window flag
    is set with the final hex hash, mirroring the existing
    `__SIM_FINAL_STATE_HASH__` flag. The cross-runtime Playwright
    suite can then assert that the replay reaches the claimed
    final state.

- **Why a dedicated `?mode=replay`** vs. a UI button on the regular
  game page:
  - **Determinism**: in replay mode, the keyboard input layer is
    disconnected. A user accidentally pressing arrow keys during
    replay would corrupt the state hash.
  - **Predictability for verifiers**: the verifier (decision 10)
    runs in headless Node; the in-page replay viewer runs in a
    browser with the same `runScripted` core. Both produce the
    same `__REPLAY_FINAL_STATE_HASH__`.
  - **Bookmarkability**: a "I want to send this replay" URL is
    self-describing (`?run=...&seed=...&mods=...&mode=replay#log=...`).

- **Frozen contract.**
  ```
  URL parameter: ?mode=replay
    accepted values: "replay" | absent (default = play)
    invalid values throw ROUTE_ERR_MODE_INVALID:
      "url: ?mode= must be 'replay' or absent (got <repr>)"

  Window flags exposed in replay mode:
    window.__REPLAY_READY__ = "ready" | "error";
    window.__REPLAY_ERROR__ = string | undefined;
    window.__REPLAY_FINAL_STATE_HASH__ = string | undefined;  // hex
    window.__REPLAY_OUTCOME__ = "running" | "dead" | "won" | undefined;
    window.__REPLAY_ACTION_INDEX__ = number;                 // current step
    window.__REPLAY_TOTAL_ACTIONS__ = number;                // log length

  Replay completes silently: when action_index === total_actions,
  no further state updates; the final hash is pinned in the window
  flag.
  ```

- **Tests required.**
  - `tests/replay/replay-viewer.test.ts` (new): unit-tests the
    timer-driven step machine.
  - 8.B Playwright: load `?mode=replay&run=<fp>&seed=<seed>#log=<wire>`
    against the live deploy on chromium / firefox / webkit; await
    `__REPLAY_OUTCOME__ === "won"`; assert
    `__REPLAY_FINAL_STATE_HASH__ === WIN_DIGEST`.

- **Risks.**
  - **Animation timing affects perceived determinism.** The
    underlying state-hash chain is timer-independent (decision
    8.A.2 guarantees that the *N*-th step's state hash is a pure
    function of the input log, not of the wall-clock time of the
    replay). The animation delay is presentation; it does not
    enter the chain.
  - **User pauses/resumes mid-replay.** No state-hash impact;
    the replay's per-step hash sequence is purely log-driven.

### 10. Verifier API contract: **`verify(args) → VerifyResult` pure function; runtime-agnostic; CLI wrapper for headless replay; in-page wrapper for the replay viewer**

- **Chosen.** A single pure function `verify(...)` lives in
  `src/verifier/verify.ts` (a new top-level layer, decision 12). It
  takes a fingerprint, an action log, and the claimed final state
  hash, and returns a discriminated-union result.

  ```ts
  // src/verifier/verify.ts
  export type VerifyArgs = {
    readonly fingerprint: string;                // 22-char short or 43-char full
    readonly inputs: FingerprintInputs;          // claimed (commitHash, ruleset, seed, mods)
    readonly actionLog: readonly Action[];       // decoded (Phase 1 wire format)
    readonly claimedFinalStateHash: string;      // hex; or "" to skip the check
    readonly claimedOutcome?: RunOutcome;        // optional; if present, asserted
    readonly expectedRulesetVersion?: string;    // optional; if present, asserted
    readonly expectedAtlasBinaryHash?: string;   // optional; if present, asserted
  };

  export type VerifyResult =
    | { kind: "valid";
        finalStateHash: string;                  // hex
        outcome: RunOutcome;
        logLength: number }                      // actually-resolved actions
    | { kind: "fingerprint-mismatch";
        expected: string;                        // recomputed from inputs
        actual: string }                         // claimedFingerprint
    | { kind: "ruleset-mismatch";
        expected: string;
        actual: string }
    | { kind: "atlas-mismatch";
        expected: string;
        actual: string }
    | { kind: "state-hash-mismatch";
        expected: string;                        // claimedFinalStateHash
        actual: string }                         // computed from replay
    | { kind: "outcome-mismatch";
        expected: RunOutcome;
        actual: RunOutcome }
    | { kind: "log-rejected";
        reason: string };                        // e.g. "tick threw"

  export function verify(args: VerifyArgs): VerifyResult;
  ```

  **Pseudocode.**
  ```
  function verify(args):
    expectedFp = args.fingerprint.length === 22
      ? fingerprint(args.inputs).slice(0, 22)
      : fingerprintFull(args.inputs);
    if expectedFp !== args.fingerprint:
      return { kind: "fingerprint-mismatch",
               expected: expectedFp, actual: args.fingerprint };

    if args.expectedRulesetVersion !== undefined
       and args.expectedRulesetVersion !== args.inputs.rulesetVersion:
      return { kind: "ruleset-mismatch",
               expected: args.expectedRulesetVersion,
               actual: args.inputs.rulesetVersion };

    if args.expectedAtlasBinaryHash !== undefined:
      // The verifier doesn't have access to the atlas binary; this
      // check is informational. The build-info module's
      // atlasBinaryHash is asserted equal to args.expectedAtlasBinaryHash
      // only if the verifier is running inside a build context that
      // injects the constant.
      if expectedAtlasBinaryHash !== buildInfo.atlasBinaryHash:
        return { kind: "atlas-mismatch", ... };

    let result;
    try:
      result = runScripted({ inputs: args.inputs, actions: args.actionLog });
    catch (e):
      return { kind: "log-rejected", reason: e.message };

    if args.claimedOutcome !== undefined
       and args.claimedOutcome !== result.outcome:
      return { kind: "outcome-mismatch",
               expected: args.claimedOutcome,
               actual: result.outcome };

    const finalStateHash = sha256Hex(result.finalState.stateHash);
    if args.claimedFinalStateHash !== ""
       and args.claimedFinalStateHash !== finalStateHash:
      return { kind: "state-hash-mismatch",
               expected: args.claimedFinalStateHash,
               actual: finalStateHash };

    return { kind: "valid",
             finalStateHash,
             outcome: result.outcome,
             logLength: result.logLength };
  ```

- **Three runtimes.**
  1. **Browser (in-page).** `src/verifier/verify.ts` is imported by
     `src/main.ts`'s replay viewer (decision 9) and by the title
     screen's "Verify a Run" affordance (Phase 9 polish; Phase 8
     ships a minimal "verify pasted log" UI in the diagnostic
     page).
  2. **Node CLI.** `tools/verify.ts` is a new file that:
     - Reads `--fingerprint=...`, `--seed=...`, `--mods=...`,
       `--log=...` (path to a file containing the base64url log),
       `--final-state-hash=...` from CLI args.
     - Calls `verify(...)` with parsed inputs.
     - Prints the result as JSON to stdout.
     - Exits 0 on `kind === "valid"`, 1 on any mismatch.
     - Wired into `package.json` as `npm run verify`.
  3. **In-test (Vitest).** `tests/verifier/*.test.ts` exercise
     `verify(...)` with golden inputs. No I/O; pure function.

- **Layer.** A new top-level `src/verifier/` directory joins the
  layer table:

  | Layer | Imports allowed | Imports forbidden |
  |---|---|---|
  | `src/verifier/` | `src/core/`, `src/sim/` (via `src/sim/harness`'s `runScripted` only), `src/build-info.ts` | `src/render/`, `src/input/`, `src/atlas/` (the verifier doesn't render anything; atlas-mismatch is asserted via `build-info`'s `atlasBinaryHash` constant), `src/router/`, `src/ui/`, `src/main.ts`; `Math.random`, `Date.*`, `crypto.subtle`, `Buffer`, `node:*` (the verifier is sandbox-pure) |

  This layer pinning is added to `docs/ARCHITECTURE.md` in 8.A.1.

- **Why a separate `src/verifier/` layer.** Mirrors the
  `src/router/` reasoning (decision 6): isolation, testability,
  bundle-size accounting. The verifier's bundle can be lazy-loaded
  (it's only needed in `?mode=replay` and the verify-pasted-log
  UI).

- **Alternatives considered:**
  - **Inline `verify(...)` into `src/sim/harness.ts`.** Rejected —
    `src/sim/` is the simulation interior; the verifier is
    presentation/contract. Putting them in the same layer blurs
    the discipline (`runScripted` is sim; `verify` is the
    *consumer* of `runScripted`).
  - **Verifier as a class with state.** Rejected — the
    deterministic-by-construction property is easier to reason
    about with a pure function. Each `verify(...)` call is
    standalone.
  - **Verifier returns `boolean`.** Rejected — the `kind`
    discriminator + per-kind diagnostic data is critical for
    debugging "why did my friend's run not verify?" The boolean
    form would force every consumer to carry the diagnostic
    out-of-band.
  - **HTTP endpoint** (`POST /verify`). Rejected — SPEC.md
    principle 6 (no backend). The Node CLI covers offline
    verification; the in-page UI covers in-browser verification.

- **Frozen contract.**
  ```
  src/verifier/verify.ts:
    export function verify(args: VerifyArgs): VerifyResult
    Pure (no I/O, no DOM); deterministic; total.
    The kind set is FROZEN: { valid, fingerprint-mismatch,
    ruleset-mismatch, atlas-mismatch, state-hash-mismatch,
    outcome-mismatch, log-rejected }. Adding a kind is additive;
    removing or renaming is a Phase 9+ planning-gate event.

  tools/verify.ts: a Node CLI wrapper. Exits 0 on valid, 1 on
  invalid. Output format pinned (one-line summary; details on
  --verbose).

  package.json scripts:
    "verify": "vite-node tools/verify.ts"
  ```

- **Tests required.**
  - `tests/verifier/verify.test.ts` (new): one test per `kind`,
    with a positive case and a negative case for each.
  - `tests/verifier/golden-replay.test.ts` (new): the
    `SELF_TEST_WIN_INPUTS` + `SELF_TEST_WIN_LOG` pair verifies as
    `kind: "valid"` with `finalStateHash === WIN_DIGEST`.
  - `tests/verifier/cli.test.ts` (new): runs `tools/verify.ts` as
    a child process with golden inputs, asserts exit code and
    output format.
  - 8.B Playwright: in-page verify-pasted-log UI exercise.

- **Risks.**
  - **Verifier ⟂ live game determinism.** Both consume
    `runScripted(...)`, which is the *only* path that advances
    `RunState`. Their outputs are byte-identical by construction.
    The test suite asserts this via the cross-runtime golden
    chain.
  - **CLI Node version drift.** Node 20.x is pinned (matches
    `.github/workflows/deploy.yml:25`). A future Node bump to 22
    re-runs the cross-runtime matrix.

### 11. `?seed=` standalone (no `?run=`): **boots fresh from seed in `latest/` build; provides the daily-seed convention from Phase 9**

- **Chosen.** When the URL has `?seed=...` but no `?run=`, the
  page boots a fresh run with the given seed. This is the "daily
  seed" convention from SPEC.md user journey 5
  (`SPEC.md:138`):

  > Daily seed (informal). Player tweets `?seed=2026-05-03`. Anyone
  > using the same release plays the same dungeon with the same
  > sprites.

  The `latest/` build is the canonical "today's release" source —
  pre-Phase 9, this is "the most recent commit"; post-Phase 9, this
  is "the v1 release tag." Either way, `?seed=2026-05-03` on
  `latest/` is sufficient to reproduce the daily-seed dungeon.

  The fingerprint is **NOT** required in this case; the fingerprint
  is computed from the build's `(commitHash, rulesetVersion)` plus
  the URL's `?seed=` plus `?mods=`. The user can then click "Share
  This Run" to add the `?run=...` token; the URL becomes the
  canonical share form.

- **Why support this path.** Two reasons:
  1. **Daily seed UX.** A bare `?seed=` URL is shorter than a
     `?run=` URL (no 22-char fingerprint needed). For social
     distribution where the share is "play this seed" (not
     "verify my run"), the shorter form is valuable.
  2. **Fingerprint generation forward-compatibility.** Pre-Phase 9
     (no title screen yet), the only entry to the game is the
     URL. A `?seed=` URL means "start a new run with this seed";
     a `?run=` URL means "load this specific run's pinned
     visuals." Both are meaningful; both are tested.

- **Frozen contract.**
  ```
  URL with ?seed= but no ?run=:
    Boot fresh from seed against the build's commitHash + ruleset.
    Compute fingerprint(...) for the run; expose via the HUD's
    fingerprint widget. The user can then click "Share This Run"
    to canonicalize to ?run=...

  URL with ?run= but no ?seed= → ROUTE_ERR_SEED_MISSING (decision 5).
  URL with both → fingerprint-recompute-and-match (decision 5).
  URL with neither → title screen / "New Run" path (Phase 9).
  ```

- **Tests required.** Covered by `tests/url/url-parser.test.ts`
  (decision 3 + 6).

- **Risks.** None new beyond decision 5's mismatch handling.

### 12. Layer additions: **`src/router/`, `src/verifier/`, `src/share/`, `src/save/` as new peers; lint-scoped per the existing pattern**

- **Chosen.** Phase 8 introduces four new top-level layers under
  `src/`:

  | Layer | Purpose | Imports allowed | Imports forbidden |
  |---|---|---|---|
  | `src/router/` | URL parsing, routing decisions, redirect helpers | `src/core/`, `src/build-info.ts` | `src/sim/`, `src/mapgen/`, `src/atlas/`, `src/render/`, `src/input/`, `src/ui/`, `src/main.ts`; `Math.random`, `Date.*`, `crypto.subtle`, `Buffer`, `node:*` |
  | `src/verifier/` | Pure verify function over (fingerprint, log, claimed hash) | `src/core/`, `src/sim/harness` (for `runScripted`), `src/build-info.ts` | `src/render/`, `src/input/`, `src/atlas/`, `src/router/`, `src/ui/`, `src/main.ts`; `Math.random`, `Date.*`, `crypto.subtle`, `Buffer`, `node:*` |
  | `src/share/` | Action-log envelope + URL formatting + clipboard helpers | `src/core/`, `src/router/`, `fflate` | `src/sim/`, `src/mapgen/`, `src/atlas/`, `src/render/`, `src/input/`, `src/ui/`, `src/main.ts` (except for the `share-button` widget integration); `Math.random`, `Date.*`, `crypto.subtle`, `Buffer`, `node:*` |
  | `src/save/` | localStorage persistence layer | `src/core/`, `src/share/` (for log envelope) | `src/sim/`, `src/mapgen/`, `src/atlas/`, `src/render/`, `src/input/`, `src/ui/`; `Math.random`, `Date.*`, `crypto.subtle`, `Buffer`, `node:*` (except `localStorage` access — gated through one helper) |

  All four layers share the **deterministic-pure** discipline of
  `src/core/` and `src/sim/`: no `Math.random`, no `Date.now()`,
  no floats, no async, no DOM. The exceptions are:
  - `src/router/redirect.ts` calls `window.location.replace(...)`
    (the only DOM access in the layer; isolated to one file).
  - `src/save/storage.ts` calls `localStorage.{get,set,remove}Item`
    (the only DOM access in the layer; isolated to one helper).
  - `src/share/clipboard.ts` calls `navigator.clipboard.writeText`
    (with `document.execCommand` fallback; isolated to one
    helper).

  Lint enforcement uses the existing `no-restricted-imports`
  pattern (already in use for `src/atlas/**`, etc.).

- **Why four layers.** Each has a distinct responsibility:
  - **router**: URL → routing decision. No replay, no I/O.
  - **verifier**: (fp, log, hash) → result. No I/O, no UI.
  - **share**: (state, log) → URL form + clipboard. No replay.
  - **save**: localStorage I/O. No URL parsing.

  Could collapse into fewer layers; would lose the bundle-size
  isolation and the testability isolation. Four is the smallest
  set that respects the responsibilities.

- **Frozen contract.** Layer boundaries pinned per the table
  above. `docs/ARCHITECTURE.md`'s layer table is updated in
  8.A.1.

- **Tests required.** Lint passes are the enforcement; per-layer
  tests are listed under each respective decision.

### 13. `REPLAY_DIGEST` golden constant: **SHA-256 of replayed final state for the canonical Phase 8 test vector; pinned during 8.A.2 on sandbox**

- **Chosen.** A new golden constant `REPLAY_DIGEST` joins the
  cross-runtime determinism golden chain in
  `src/core/self-test.ts`. Its value:

  ```
  REPLAY_DIGEST =
    sha256_hex(
      replay(SELF_TEST_WIN_INPUTS, decode(encode(SELF_TEST_WIN_LOG))).finalStateHash
    )
  ```

  i.e., the final state hash of replaying `SELF_TEST_WIN_LOG`
  *after* a round-trip through the action-log codec (decision 2).
  This pins the codec's byte-identity property end-to-end:
  encode → base64url → decode → `runScripted` → final state hash.

  The expected value: `REPLAY_DIGEST === WIN_DIGEST` (which
  already exists at
  `fb36a2fe54e3581a6105ed0ef80afcf8269fc5f97ba633612028c54039828447`,
  per `src/sim/self-test-win-log.ts:16`). The codec round-trip
  must be a no-op modulo bytes; if `REPLAY_DIGEST !== WIN_DIGEST`,
  the codec drops or corrupts an action.

- **Why a separate golden** when `REPLAY_DIGEST === WIN_DIGEST`?
  Subtle but important: `WIN_DIGEST` is computed by running
  `SELF_TEST_WIN_LOG` directly through `runScripted`.
  `REPLAY_DIGEST` is computed by running the *re-decoded* log
  through `runScripted`. They are equal by construction — but the
  test asserts that **the re-decoded log is byte-identical to
  the original log**, which is the load-bearing property of
  decision 2. A regression that drops one action from the codec
  would surface here as `REPLAY_DIGEST !== WIN_DIGEST` even
  though `WIN_DIGEST` itself is unchanged.

- **Cross-runtime exercise.** The same way Phase 1's
  `RANDOM_WALK_DIGEST`, Phase 3's `SIM_DIGEST`, and Phase 7.A.2b's
  `WIN_DIGEST` are exercised in chromium / firefox / webkit,
  `REPLAY_DIGEST` is exercised by:

  ```ts
  // tests/verifier/cross-runtime.test.ts (new)
  const wire = encodeActionLog(SELF_TEST_WIN_LOG);
  const decoded = decodeActionLog(wire);
  const replayed = runScripted({
    inputs: SELF_TEST_WIN_INPUTS,
    actions: decoded,
  });
  expect(sha256Hex(replayed.finalState.stateHash)).toBe(REPLAY_DIGEST);
  expect(REPLAY_DIGEST).toBe(WIN_DIGEST);   // codec round-trip is byte-identical
  ```

  Plus a Playwright test exposing
  `window.__REPLAY_DIGEST__` from the diagnostic page that the
  three browsers all read identically.

- **Tests required.**
  - `tests/core/self-test.test.ts` — adds `replay-cross-runtime-digest`
    to `runChecks`.
  - `tests/playwright/replay-cross-runtime.spec.ts` (new) — three
    browsers all expose the same `__REPLAY_DIGEST__`.

- **Risks.**
  - **`REPLAY_DIGEST !== WIN_DIGEST` at landing time.** Indicates
    the codec drops an action; the codec is buggy; fix the codec.

### 14. `RULES_FILES` impact: **no additions in Phase 8.0; 8.A.1 evaluates whether new files belong in the hash; default is NO unless they affect deterministic byte output**

- **Chosen.** Phase 8 introduces four new layers and ~15 new
  source files (`src/router/url-parse.ts`,
  `src/router/redirect.ts`, `src/router/messages.ts`,
  `src/share/encode.ts`, `src/share/share-url.ts`,
  `src/save/storage.ts`, `src/save/save-slot.ts`,
  `src/verifier/verify.ts`, `tools/verify.ts`, etc.). **None of
  them belong in `RULES_FILES`** (the canonical sorted list at
  `src/build-info.ts:63-76` that feeds `rulesetTextHash`).

- **Why not.** `RULES_FILES` exists to capture the source files
  whose contents affect the **deterministic byte output of the
  game** (the action-log → final-state-hash mapping; the
  atlas-seed → atlas-bytes mapping; the floor-seed → floor-JSON
  mapping). Phase 8's layers are:

  - **Routing.** A change to `src/router/url-parse.ts` does not
    change any byte output of the simulation. It changes which
    URL forms route correctly, but a URL that *does* route is
    handed off to the same `runScripted` either way.
  - **Verifier.** A change to `src/verifier/verify.ts` does not
    change any byte output. The verifier *consumes* the byte
    output; it does not produce it.
  - **Share/Save.** A change to the action-log codec
    (`src/share/encode.ts`) WOULD potentially change output
    (encoder bytes that fail to round-trip). But: the codec is
    self-consistent. If `decode(encode(x)) === x` byte-identically
    (asserted by the round-trip test, decision 13), then the
    codec is byte-stable; the resulting `runScripted` output is
    unchanged. If the codec breaks the round-trip, every
    fingerprint with `#log=` is unloadable — which is a *bug*,
    not a `rulesetVersion` bump.

  By contrast, files like `src/sim/turn.ts` ARE in `RULES_FILES`
  because changing their interior changes which `RunState`
  results from a given action sequence. That is what
  `rulesetVersion` exists to identify.

- **Phase 8.A.1 review event.** During the 8.A.1 drift-detection
  sweep, the architecture-red-team checks every new file's
  classification:
  - Does the file's content affect any `RunState`,
    `assets/atlas.png` byte, or `Floor` JSON byte? If yes, it
    enters `RULES_FILES`.
  - If no, it does NOT enter `RULES_FILES`.
  - The classification is documented per-file in the 8.A.1
    addendum.

- **Anticipated outcome.** No new entries in `RULES_FILES` for
  Phase 8. (If 8.A.1 surfaces a surprise — e.g., a new file
  inadvertently affects sim output via a static const that's
  imported — the classification flips and the file enters
  `RULES_FILES`. This would be a `rulesetVersion` bump, since
  the existing fingerprint chain wouldn't include the new file.)

- **Frozen contract.**
  ```
  RULES_FILES is unchanged in Phase 8.0 (this memo).
  Phase 8.A.1's drift sweep may add entries IF AND ONLY IF a new
  file affects deterministic byte output.
  Phase 8.A.2 surfaces any surprise additions as red-team review
  events; the addendum to this memo records the disposition.
  ```

- **Tests required.** `tests/build/rules-text.test.ts` already
  enforces alphabetical order and LF discipline on `RULES_FILES`
  (Phase 4). Phase 8 adds no new test surface here.

### 15. Diagnostic page extension: **paste-log textarea + verify button + replay-mode link, all wired to the existing `__*__` flag pattern**

- **Chosen.** The existing diagnostic page (Phase 1–7's
  `index.html` + `src/main.ts`) gains three new sections, all
  collapsible:

  1. **"Verify a Pasted Log"** — a `<textarea>` for the wire-form
     log + a "Verify" button. Calls `verify(...)` (decision 10);
     displays the discriminated-union result in a status panel.
     Exposes `window.__VERIFY_RESULT__` for the Playwright suite.
  2. **"Replay This Run"** — a link `?mode=replay&...` that opens
     the current run in replay mode. Click the link → page
     navigates to the replay viewer with the current
     `(fingerprint, log)` slot inlined.
  3. **"Save Slots"** — a list view of all `localStorage` save
     slots (decision 8). Each row has a "Resume", "Verify",
     "Delete" button. Exposes `window.__SAVE_SLOTS__` (a
     deterministic-order list keyed by fingerprint) for the
     Playwright suite.

- **Why minimal UI in Phase 8.** The actual title screen, the
  polished replay UI, the multi-slot save management, and the
  shareable-URL widget are Phase 9 polish work. Phase 8 ships
  the **functional surfaces** (parse, verify, replay, save) and
  exposes the bare-minimum UI to exercise them in tests. Phase
  9's title screen plugs into the same APIs.

- **Frozen contract (window flags added).**
  ```
  window.__VERIFY_READY__: "ready" | undefined
  window.__VERIFY_RESULT__: VerifyResult | undefined
  window.__REPLAY_READY__: "ready" | "error" | undefined
  window.__REPLAY_FINAL_STATE_HASH__: string | undefined
  window.__REPLAY_OUTCOME__: RunOutcome | undefined
  window.__REPLAY_ACTION_INDEX__: number | undefined
  window.__REPLAY_TOTAL_ACTIONS__: number | undefined
  window.__SAVE_SLOTS__: ReadonlyArray<{ fp: string; floor: number;
                                          outcome: RunOutcome; }> | undefined
  window.__SHARE_URL__: string | undefined            // current run's share URL
  window.__SHARE_LOG_LENGTH__: number | undefined     // current run's wire-log length
  ```

  Same convention as the existing `__SIM_FINAL_STATE_HASH__`,
  `__GAME_READY__`, etc. (Phase 3 + 5 + 7 frozen).

- **Tests required.** Listed in decisions 9, 10. 8.B Playwright
  asserts each flag.

- **Risks.** None beyond the existing diagnostic-page flag
  discipline.

### 16. Bundle size budget: **bump from 75 KB to 110 KB gzipped JS to accommodate fflate (~30 KB) + new layers (~15 KB combined)**

- **Chosen.** The Phase 1 bundle budget (50 KB; addendum) was
  bumped to 75 KB in Phase 2. Phase 4 retained the 75 KB cap
  (the atlas binary + manifest are *separate* artifacts; the JS
  budget is JS only — see `.github/workflows/deploy.yml:37-45`).
  Phase 8 adds:

  - `fflate` (~30 KB minified, ~9 KB gzipped — lighter than
    initial estimate; `fflate` aggressively tree-shakes).
  - `src/router/` (~5 KB minified, ~2 KB gzipped).
  - `src/verifier/` (~3 KB minified, ~1 KB gzipped).
  - `src/share/` (~5 KB minified, ~2 KB gzipped).
  - `src/save/` (~3 KB minified, ~1 KB gzipped).
  - URL-parser + replay-viewer wiring in `src/main.ts` (~4 KB
    minified, ~1.5 KB gzipped).

  Total Phase 8 addition: ~50 KB minified, ~17 KB gzipped (rough
  estimate; actual size measured during 8.A.2 and pinned at first
  green CI run).

  **New cap: 110 KB gzipped** in
  `.github/workflows/deploy.yml`. Allows headroom for Phase 9
  polish (audio, post-processing shaders) without another bump.

- **Why a single bump now** vs. incremental:
  - Phase 4's 75 KB has been holding; the actual current bundle
    is ~50 KB gzipped (well under cap).
  - Phase 8 adds ~17 KB; bringing total to ~67 KB. Still under
    75 KB.
  - But: Phase 9 will add post-processing shaders (canvas-side
    GLSL or 2D-context filtering) and audio (Web Audio API
    setup) — another ~15–25 KB.
  - One budget bump now (with explicit headroom) is cheaper
    than two bumps in 8.A.3 + 9.A.

- **Frozen contract.**
  ```
  CI bundle gate (.github/workflows/deploy.yml):
    if [ "$gzip_size" -gt 112640 ]; then exit 1; fi
    # 110 KB = 110 * 1024 = 112640 bytes
  Pinned in 8.A.2; bumping again is an architecture-red-team
  review event.
  ```

- **Tests required.** The CI gate already runs on every push;
  Phase 8 just bumps the threshold. The bundle-report artifact
  already uploads `dist/**/*.js` for inspection.

- **Risks.**
  - **Underestimate.** If the actual bundle exceeds 110 KB at
    8.A.2 landing, the gate fires; the architecture-red-team
    re-reviews the budget. Soft-cap bump to 130 KB would be
    plausible if the new layers turn out larger.
  - **fflate tree-shaking.** `fflate` exports many functions; we
    use only `deflateSync` and `inflateSync` plus
    base64url-encoding. Vite/Rollup tree-shakes aggressively;
    expected gzipped contribution ~9 KB.

### 17. Phase decomposition: **8.0 (memo + red-team + addendum) → 8.A.1 (drift + scaffold) → 8.A.2 (JS-only impl) → 8.A.3 (CI extension) → 8.B (live verification)**

- **Chosen.** Phase 8 decomposes into five sub-phases:

  - **8.0 (planning gate).** This memo + architecture-red-team
    review + addendum. No code changes.
  - **8.A.1 (drift-detection sweep).** Per-Phase pattern
    (1.A.1, 2.A.1, 3.A.1, 4.A.1, 5.A.1, 6.A.1, 7.A.1):
    drift-detection sweep, lint scope additions for
    `src/router/`, `src/verifier/`, `src/share/`, `src/save/`,
    `docs/ARCHITECTURE.md` updates, `docs/PROD_REQUIREMENTS.md`
    finalization (retention policy, repo-size budget, error
    string vocabulary). No net-new functional code.
  - **8.A.2 (sandbox-verifiable implementation, JS-only).** The
    URL parser, the action-log codec, the verifier, the
    localStorage save layer, the multi-slot UI, the replay
    viewer, the new `?run=` / `?seed=` / mismatched-version UX,
    the new `__VERIFY_RESULT__` / `__REPLAY_*__` window flags.
    Bundle gate bumps to 110 KB. `REPLAY_DIGEST` is computed and
    pinned. NO changes to `.github/workflows/deploy.yml` beyond
    the bundle-size threshold. NO changes to the gh-pages
    layout — the build still publishes only `latest/`. Old
    fingerprints from this commit can be served (and will route
    correctly when 8.A.3 lands), but the per-release pinning
    isn't exercised yet.
  - **8.A.3 (build-pipeline extension).** Modifies
    `.github/workflows/deploy.yml` to publish to BOTH `latest/`
    AND `releases/<commit-short>/`. Adds the dual-build script
    (`scripts/build-dual.mjs`), the publish-merge script
    (`scripts/publish-dual.mjs`), and the `releases/index.json`
    rebuild logic. The first 8.A.3 deploy creates the first
    `releases/<commit-short>/` entry. The 8.A.2 build (one
    commit prior) is now retroactively the "first old release"
    — but it was deployed to `latest/` only, so there's no
    pinned subtree to redirect to. This is the chicken-and-egg
    issue.
  - **8.B (live-deploy + cross-runtime + cross-OS verification).**
    Cross-runtime Playwright suite extended with:
    - URL parser test (URL → boot → fingerprint match).
    - Replay viewer test (`?mode=replay&run=...&seed=...#log=...`
      reaches `WIN_DIGEST`).
    - Verify-pasted-log test (paste `WIN_LOG` wire form, click
      Verify, assert `kind === "valid"`).
    - localStorage resume test (perform 10 actions, refresh,
      assert resumption).
    - Mismatched-build redirect test (synthetic
      `?run=<old-commit-fp>` against `latest/` → assert
      redirect to `releases/<old-commit>/`).
    - Cross-OS atlas equality matrix continues to run unchanged.
    - The "stranger on different machine" test: a fingerprint
      generated on the sandbox host is opened on the live deploy
      via cross-runtime Playwright; final state hashes match
      across machines.
    - The "old fingerprint after master moves on" test: pin a
      fingerprint at commit X; advance master to commit Y with a
      breaking ruleset change (atlas regen, sim tweak); confirm
      the X-fingerprint URL still loads via
      `releases/<X-commit>/`.

- **Why split 8.A.2 from 8.A.3.** Three reasons:
  1. **JS-only changes are sandbox-verifiable.** 8.A.2 lands
     hundreds of lines of TypeScript across 15+ new files. Every
     line is testable inside the sandbox via Vitest +
     `vite preview`-driven Playwright. The architecture-red-team
     and code-reviewer can review 8.A.2 against `npm ci && npm
     run lint && npm run test && npm run build && npm run
     test:e2e` all green inside the sandbox — the same
     acceptance criterion every prior `*.A.2` phase has used.
  2. **CI changes are NOT sandbox-verifiable.** The gh-pages
     dual-deploy is a property of the GitHub Actions runner, the
     Pages deploy API, and the static-host filesystem. None of
     these are in the sandbox. 8.A.3 cannot have an
     "all-green-in-sandbox" acceptance criterion the way 8.A.2
     can; its criterion is "the live deploy successfully writes
     to `releases/<commit>/`" (visible only after the host
     pushes 8.A.3 to master). This is exactly the same dynamic
     that motivated splitting 1.A from 1.B (Phase 1 decision 11),
     splitting 4.A from 4.B (Phase 4 decision 13), etc.
  3. **The chicken-and-egg pinning issue is bounded.** When 8.A.3
     first lands, `releases/<commit>/` exists for that one
     commit only; older fingerprints (from 8.A.2 and prior)
     have no pinned subtree. The 8.B "stranger" test deliberately
     uses a `?run=` generated *at the 8.A.3 commit* against the
     `latest/` build, so the routing path matches without
     needing prior history. Subsequent commits accumulate
     pinned subtrees naturally; the chicken-and-egg is resolved
     by simple time-passing.

  Splitting 8.A.2 from 8.A.3 means 8.A.2 lands a fully
  functional in-page verifier, replay viewer, share UX, save
  layer, and URL routing — all gated entirely by sandbox tests.
  8.A.3 is a focused CI/deploy change that builds on the now-
  stable 8.A.2 surface. The architecture-red-team can review
  each in isolation.

- **Why NOT a different decomposition.** Three rejected:
  - **Single 8.A.** All-or-nothing: either everything lands at
    once or nothing does. The CI/deploy changes are coupled to
    the JS changes by review schedule; a regression in either
    blocks both. Unhealthy.
  - **8.A and 8.B without 8.A.1.** Skipping the drift sweep
    contradicts the established phase pattern (every phase
    1.A–7.A has had an A.1 sweep). The new layers warrant lint
    scope additions, doc updates, and `RULES_FILES`
    classification (decision 14) — exactly the work an A.1
    sweep is for.
  - **8.A.1, 8.A.2, 8.A.3, 8.A.4, 8.B** (further split). Phase
    splits should match natural review boundaries.
    Over-splitting creates phase-update churn for marginal
    benefit. The current 5-step split is the smallest that
    cleanly separates "JS-only sandbox-verifiable" from
    "CI/live-deploy live-verification" — the same split Phases
    1–4 each respected.

- **Phase 8.A.1 deliverables (drift sweep).**
  - Lint scope additions for `src/router/`, `src/verifier/`,
    `src/share/`, `src/save/`.
  - `docs/ARCHITECTURE.md` extension: layer table additions
    (decision 12), action-log envelope frozen contract
    (decision 2), URL parameter syntax frozen contract (decision
    3), error string vocabulary (decision 5), per-release layout
    frozen contract (decision 7).
  - `docs/PROD_REQUIREMENTS.md` finalization (Section: Reliability
    — retention policy, repo-size budget; Section: Security —
    URL fragment privacy, no third-party fetch on game-load
    path; Section: Performance — bundle size budget bump
    rationale; Section: Operations — release pruning manual
    procedure).
  - Carry-forward atlas regen if any (Phase 7.A.1 carried 3
    recipes; Phase 8 carries none — the atlas binary is
    untouched).
  - `RULES_FILES` review per decision 14 (anticipated: no
    additions).
  - `tests/url/url-parser.test.ts` test fixture scaffolding
    (file exists but tests stubbed — TDD-style; 8.A.2 fills in).

- **Phase 8.A.2 deliverables (sandbox-verifiable JS).** Per
  decisions 1–16. Acceptance criterion: `npm ci && npm run lint
  && npm run test && npm run build && npm run test:e2e` all
  green inside the sandbox. `REPLAY_DIGEST === WIN_DIGEST`
  asserted. Bundle gate bumped and passing.

- **Phase 8.A.3 deliverables (build-pipeline).** Per decision 7.
  `.github/workflows/deploy.yml` modified to dual-build and
  dual-publish. `scripts/build-dual.mjs` and
  `scripts/publish-dual.mjs` added.
  `releases/index.json` first-write logic. Acceptance criterion:
  the first 8.A.3 push to master results in `latest/` AND
  `releases/<commit>/` both being live. Verified manually
  (eyeball + curl); 8.B Playwright cross-runtime checks the
  second 8.A.3 push (or any subsequent 8.B exercise).

- **Phase 8.B deliverables (live-deploy + cross-runtime +
  cross-OS).** Per the Phase 8 acceptance criteria in
  `docs/PHASES.md:556-562`. The five new Playwright tests, the
  cross-OS atlas equality re-run (atlas binary unchanged so
  pass should be a no-op), and the "stranger" + "old run after
  master moves on" tests.

- **Frozen contract.** Phase 8 splits into 8.0, 8.A.1, 8.A.2,
  8.A.3, 8.B per the above. `docs/PHASES.md` Phase 8 section is
  amended (during 8.A.1) with the per-sub-phase acceptance
  criteria.

- **Tests required.** Per-sub-phase, listed under each decision.

- **Risks.**
  - **8.A.3 first deploy fails.** No prior `releases/index.json`;
    the publish-dual script has to handle the bootstrap. Tested
    via `tests/build/release-index-bootstrap.test.ts`. If it
    fails on the first live push, the 8.A.3 commit is reverted
    and the script is fixed; no data loss (8.A.3 just adds the
    `releases/` subtree, doesn't touch existing `latest/`).
  - **8.A.3 publish-dual race with concurrent push.** Concurrency
    group `pages` (already in `deploy.yml:13-14`) serializes
    deploys; race-free by construction.
  - **8.B "old run after master moves on" requires at least two
    sequential deploys with a `rulesetVersion` change between
    them.** This is a multi-commit test sequence; it can only
    fully exercise after 8.A.3 + at least one ruleset-bumping
    follow-up commit. Phase 9.A may be the natural follow-up
    (atlas-seed bump). The test is *defined* in 8.B but its
    *full assertion* (against an actually-stale fingerprint) is
    deferred to "the first commit after 8.B that bumps
    `rulesetVersion`" — likely Phase 9. Until then, 8.B's test
    asserts the *routing path* using a synthetic stale
    fingerprint (constructed from a fake commitHash that doesn't
    exist in the index, to exercise
    `ROUTE_ERR_NO_MATCHING_RELEASE`).

---

## Risks (cross-cutting)

### R1. Fingerprint format churn after release would invalidate every saved run

**Mitigation.** Decision 1's "no churn" pin: Phase 1's existing
22-char base64url fingerprint format is preserved unchanged. The
mod-ID slot is exercised but not changed. The
permutation-shuffle test (decision 1) is defense-in-depth against
sort-comparator drift.

### R2. Action-log encoding drift between fflate versions

**Mitigation.** Phase 4 addendum N1 already pins fflate's exact
version and triggers an architecture-red-team review on any
version-line change in `package-lock.json`. Phase 8 inherits
this rule unchanged; the action-log codec joins the test surface
that exercises fflate level-1 byte-identity. The cross-OS atlas
matrix already exercises fflate; the cross-runtime action-log
test (decision 13) extends the surface.

### R3. URL hash-fragment leakage via browser extensions / page scripts

**Mitigation.** The hash fragment is read by client-side JS only;
no third-party scripts run on the icefall page (no analytics, no
ads, no embeds). A future Phase 9 polish that adds analytics
must preserve the privacy property — pinned in
`docs/PROD_REQUIREMENTS.md`'s Security section (8.A.1 work).

### R4. `releases/index.json` corruption or loss

**Mitigation.** The `gh-pages` branch is git history; the index
is regenerated atomically per deploy via the publish-dual
script. If a single deploy's index is corrupt, the next
non-corrupt deploy heals it. If the entire branch is lost, the
recovery procedure (Phase 9 polish) re-derives the index from
the commit log. Pinned in `docs/PROD_REQUIREMENTS.md`'s
Reliability section.

### R5. Repo size growth past GitHub's soft cap

**Mitigation.** Decision 7's keep-all-forever-until-800-MB
retention policy. At ~250 KB/commit, the cap is hit at ~3000
commits — years out at typical commit cadence. Pruning
procedure documented but not yet automated; revisited in a
future phase if growth surprises.

### R6. localStorage quota exceeded on heavy users

**Mitigation.** Decision 8's eviction-on-overflow handling.
Worst case: the user's oldest 5 saves are silently dropped; the
new save succeeds. The user is not blocked.

### R7. Mismatched-build redirect circular loop

**Mitigation.** The redirect target is computed once
(`releases/<commit-short>/?run=...`); on landing at the target,
the fingerprint check at the new build's `commitHash` matches
(by construction — the redirect was triggered specifically
because that's the build whose fingerprint matches). No re-redirect
fires. If for some reason the index lies (release not actually
present at target), the target's fetch fails → user sees a 404
(GH-Pages's standard 404 page). Pinned: the publish-dual script
verifies post-publish that the target is fetchable; if it isn't,
the index is rolled back. (8.A.3 implementation review.)

### R8. URL truncation by social platforms

**Mitigation.** Decision 4's threshold (`URL_LOG_THRESHOLD_CHARS
= 1500`) is inside the conservative envelope of every major
social platform's link-preview length budget. Cases where the
log exceeds the threshold use the clipboard fallback explicitly.
Tested via 8.B "stranger" test using a `WIN_LOG`-sized share.

### R9. Verifier in untrusted contexts

**Mitigation.** The verifier is a pure function over its inputs;
it does not network-fetch or execute any untrusted code. The
action log is bytes; `decodeAction(...)` rejects malformed input
with pinned error strings (decision 2). The verifier has the
same trust boundary as the URL parser: an attacker can supply
arbitrary bytes via `?run=` / `#log=` / paste-box; the verifier
rejects mismatch deterministically. SPEC.md principle 6 (no
backend) means there is no "trusted server"; the
attack surface is the user's own browser, which the user
already trusts to run icefall.

### R10. Verification of mod-bearing fingerprints in Phase 9+

**Mitigation.** Phase 8 ships with `modIds: []` exercised
end-to-end. The synthetic mod-ID test vector (decision 1)
exercises the load-bearing pre-image bytes that a Phase 9+ mod
would hit. Phase 9's mod-loader plan inherits the existing
fingerprint pre-image unchanged.

---

## Acceptance criteria — Phase 8.0 (this memo + planning gate)

- This memo (`artifacts/decision-memo-phase-8.md`) is written
  with each of decisions 1–17 covering Decision / Rationale /
  Alternatives considered / Frozen contract / Tests required /
  Risks.
- `architecture-red-team` review file written
  (`artifacts/red-team-phase-8.md`); blockers resolved via an
  addendum at the bottom of this memo.
- `docs/PHASES.md` is **NOT** modified by 8.0 (the planning gate
  outputs only the memo + red-team artifacts; downstream changes
  to PHASES.md happen in 8.A.1).
- `docs/PROD_REQUIREMENTS.md` is **NOT** modified by 8.0
  (finalization happens in 8.A.1).
- `artifacts/phase-approval.json` is written marking Phase 8.0 as
  approved.

## Acceptance criteria — Phase 8.A.1 (drift sweep + scaffolding)

- Lint scope additions for `src/router/`, `src/verifier/`,
  `src/share/`, `src/save/` land in `eslint.config.js`. Sample
  test files in each new layer (stubbed) prove the lint scope
  fires correctly.
- `docs/ARCHITECTURE.md` updated with:
  - Layer table additions (decision 12).
  - Action-log envelope frozen contract (decision 2).
  - URL parameter syntax frozen contract (decision 3).
  - Error string vocabulary (decision 5).
  - Per-release layout frozen contract (decision 7).
  - SaveSlot schema (decision 8).
  - Verifier API contract (decision 10).
- `docs/PROD_REQUIREMENTS.md` finalized:
  - Security section: URL fragment privacy; no third-party
    fetch on game-load path; SHA-256 collision argument (132 bits).
  - Reliability section: `releases/index.json` regeneration
    semantics; release pruning manual procedure.
  - Performance section: bundle size budget bump rationale (110
    KB gzipped JS); URL length threshold (1500 chars).
  - Operations section: deploy pipeline (dual-build + dual-publish);
    pruning policy threshold (800 MB / 600 MB).
- `RULES_FILES` reviewed per decision 14 (anticipated: no
  additions; documented in 8.A.1 addendum).
- 8.A.1 stub files created (tests stubbed, contracts pinned, no
  net-new functional code).
- `npm ci && npm run lint && npm run test && npm run build &&
  npm run test:e2e` all green inside the sandbox (no behavior
  change from Phase 7.B).

## Acceptance criteria — Phase 8.A.2 (sandbox-verifiable JS implementation)

- All four new layers (`src/router/`, `src/verifier/`,
  `src/share/`, `src/save/`) implemented per decisions 6, 10, 2,
  8.
- The URL parser, mismatched-version routing (5a/5b/5c/5d
  branches), action-log codec, verifier, replay viewer, save
  layer, multi-slot UI, and diagnostic-page extension are all
  functional inside the sandbox.
- `REPLAY_DIGEST` constant is computed (on the sandbox) and
  pinned in `src/core/self-test.ts`. `REPLAY_DIGEST === WIN_DIGEST`.
- A pinned `__SHARE_LOG_LENGTH__` value for `WIN_LOG` is recorded
  in the addendum (8.A.2-discovered constant; the actual
  measurement of "how long is `WIN_LOG` after fflate
  compression"). Used by the URL-vs-clipboard threshold logic
  (decision 4) at runtime; pinned at landing time as
  defense-in-depth.
- The new `__VERIFY_RESULT__` / `__REPLAY_*__` / `__SAVE_SLOTS__`
  / `__SHARE_URL__` / `__SHARE_LOG_LENGTH__` window flags are
  exposed and documented in `src/main.ts` (alongside the existing
  `__SIM_FINAL_STATE_HASH__` etc.).
- Bundle size gate bumped to 110 KB; the actual bundle is
  measured and within budget.
- All eight pinned error strings (decision 5) are unit-tested
  for byte-identity (em-dash, exact substitutions).
- `npm ci && npm run lint && npm run test && npm run build &&
  npm run test:e2e` all green inside the sandbox.
- The previously-pinned cross-runtime golden chain
  (`RANDOM_WALK_DIGEST` through `WIN_DIGEST`) continues to
  match across chromium / firefox / webkit. **No
  `rulesetVersion` bump.**

## Acceptance criteria — Phase 8.A.3 (build-pipeline extension)

- `.github/workflows/deploy.yml` modified to dual-build and
  dual-publish. The single deploy artifact contains both
  `latest/` (Vite base `/icefall/`) and `releases/<commit-short>/`
  (Vite base `/icefall/releases/<commit-short>/`).
- `scripts/build-dual.mjs` and `scripts/publish-dual.mjs` added
  and unit-tested.
- `releases/index.json` is generated on every deploy; the
  schema matches decision 7.
- The first 8.A.3 push to master results in `latest/` AND
  `releases/<commit-short>/` both being live and correctly
  serving the build. Manually verified post-deploy.
- The cross-OS atlas equality matrix continues to pass (atlas
  binary unchanged).
- `releases/index.json` is fetchable from
  `https://porkchop.github.io/icefall/releases/index.json` and
  parses correctly.

## Acceptance criteria — Phase 8.B (live-deploy + cross-runtime + cross-OS verification)

- Per `docs/PHASES.md:556-562`:
  - A run shared by URL is reproducible by a stranger on a
    different machine, exactly — including identical visuals.
    (Cross-runtime Playwright matrix exercises the
    `?run=&seed=#log=` path on chromium / firefox / webkit
    against the live deploy.)
  - Replay viewer reaches the same final state hash as the
    original run. (`__REPLAY_FINAL_STATE_HASH__` matches the
    pinned `WIN_DIGEST` across all three browsers.)
  - Mismatched commit hash in a fingerprint produces a clear,
    actionable error directing the player to the correct
    release URL. (Synthetic
    `?run=<bad-fp>` test exercises
    `ROUTE_ERR_NO_MATCHING_RELEASE`; synthetic
    `?run=<old-commit-fp>` test exercises the redirect to
    `releases/<old-commit>/`.)
  - Verifier correctly accepts valid runs and rejects tampered
    logs. (Test exercises both via
    `tools/verify.ts` + the in-page verifier UI.)
  - Closing and reopening the tab mid-run drops the player at
    the same floor with the same state hash. (10-action +
    refresh + assert-state-hash test.)
  - An old fingerprint loads its pinned release with its pinned
    atlas even after master has moved on. (Synthetic stale-
    commit test in 8.B; full assertion deferred to first
    `rulesetVersion`-bumping commit after 8.B — see decision 17.)
- The cross-OS atlas equality matrix re-runs unchanged.
- The full game (10 floors + boss) is winnable from a clean
  start on the live deploy via the keyboard input (Phase 7.B
  acceptance criterion preserved).
- `npm ci && npm run lint && npm run test && npm run build &&
  npm run test:e2e` all green inside the sandbox; the live
  Playwright suite runs green on chromium / firefox / webkit.

---

## Frozen contracts established by this phase

These join the frozen contracts in `docs/ARCHITECTURE.md`.

1. **Fingerprint format unchanged.** `FINGERPRINT_SHORT_LEN =
   22`; pre-image is the existing
   `sha256(commitHash || 0x00 || rulesetVersion || 0x00 || seed
   || 0x00 || sortedModIds.join(","))` (Phase 1 contract).

2. **Action-log envelope.** `ACTION_LOG_MAGIC = [0x49, 0x43,
   0x45]` ("ICE"); `ACTION_LOG_VERSION = 0x01`. Envelope:
   `[magic][version][actionCount:u32 LE][concat(encodeAction(a)
   for a in actions)]`. Wire form:
   `base64url(fflate.deflateSync(envelope, { level: 1 }))`.
   Decoder asserts magic + version + count + no-trailing-bytes.

3. **URL parameter syntax.** Query string for routing:
   `?run=<22-char>&seed=<url-encoded>&mods=<csv>`. Hash fragment
   for replay data: `#log=<base64url>`. Optional `?mode=replay`
   activates replay viewer. URL-LENGTH threshold for inline
   `#log=` is 1500 base64url characters; longer logs use
   clipboard fallback.

4. **Mismatched-version UX.** Page-load fingerprint recompute;
   `latest/` redirects to `releases/<commit-short>/` via
   `window.location.replace(...)` preserving query string and
   hash fragment. Eight pinned error strings (decision 5).

5. **`releases/<commit-short>/` layout.** Single deploy artifact
   contains `latest/` AND `releases/<commit-short>/`. Per-release
   Vite base `/icefall/releases/<commit-short>/`. Per-release
   atlas pinned at deploy time.
   `releases/index.json` (schemaVersion = 1) is the routing
   manifest.

6. **`releases/index.json` schema.** Top-level `schemaVersion =
   1`; `releases: ReleaseEntry[]` sorted by `publishedAt`
   descending. Each entry: `{ commitShort, commitHash,
   rulesetVersion, atlasBinaryHash, publishedAt }`. v1 reader
   rejects v2.

7. **localStorage save-slot format.** Key prefix `icefall:save:v1:`;
   `SaveSlot` record with `schemaVersion = 1`. Save trigger:
   every 10 actions + `beforeunload`. Quota-exceeded:
   evict-oldest-5 and retry; ultimately surface error.

8. **Verifier API.** `verify(args: VerifyArgs): VerifyResult`
   pure function. Result kinds: `valid`,
   `fingerprint-mismatch`, `ruleset-mismatch`, `atlas-mismatch`,
   `state-hash-mismatch`, `outcome-mismatch`, `log-rejected`.
   Adding a kind is additive; removing/renaming is a
   `rulesetVersion` bump.

9. **Layer additions.** `src/router/`, `src/verifier/`,
   `src/share/`, `src/save/` are new top-level peers of
   `src/sim/`, `src/atlas/`, etc. Lint-scoped per the layer
   table in `docs/ARCHITECTURE.md`.

10. **`REPLAY_DIGEST` golden constant.** `REPLAY_DIGEST` is the
    hex of `runScripted(decode(encode(SELF_TEST_WIN_LOG)))`'s
    final state hash. By construction `REPLAY_DIGEST ===
    WIN_DIGEST`; the test asserts both equality with
    `WIN_DIGEST` and inclusion in the cross-runtime
    chromium/firefox/webkit chain.

11. **`RULES_FILES` unchanged in Phase 8.0.** New layers do not
    affect deterministic byte output (decision 14). Phase 8.A.1
    classifies any surprise additions.

12. **Bundle size budget.** 110 KB gzipped JS (raised from 75
    KB). Pinned in `.github/workflows/deploy.yml` in 8.A.2.

13. **Mod-ID slot wiring.** The pre-image's
    `sortedModIds.join(",")` slot is exercised end-to-end via
    URL parser, verifier, save layer, and a synthetic-mod test
    vector. Phase 9+ mod-loader inherits the existing
    fingerprint pre-image unchanged.

14. **Replay-mode window flags.** `__VERIFY_RESULT__`,
    `__REPLAY_READY__`, `__REPLAY_FINAL_STATE_HASH__`,
    `__REPLAY_OUTCOME__`, `__REPLAY_ACTION_INDEX__`,
    `__REPLAY_TOTAL_ACTIONS__`, `__SAVE_SLOTS__`,
    `__SHARE_URL__`, `__SHARE_LOG_LENGTH__`. Pinned in
    `src/main.ts`.

15. **Eight pinned error strings.** `ROUTE_ERR_FP_INVALID`,
    `ROUTE_ERR_FP_BAD_CHAR`, `ROUTE_ERR_SEED_MISSING`,
    `ROUTE_ERR_SEED_INVALID`, `ROUTE_ERR_MODS_INVALID`,
    `ROUTE_ERR_LOG_DECODE`, `ROUTE_ERR_NO_MATCHING_RELEASE`,
    `ROUTE_ERR_FP_TAMPERED`,
    `ROUTE_ERR_RELEASE_INDEX_FETCH`. Em-dashes are U+2014. Exact
    character match is unit-asserted.

16. **GH-Pages retention policy.** Keep all releases forever
    until repo size exceeds 800 MB; prune oldest releases until
    repo size is under 600 MB. Pruning is a maintainer action.
    Pinned in `docs/PROD_REQUIREMENTS.md`.

17. **fflate level-1 byte-identity** (inherited from Phase 4).
    The action-log codec uses fflate's deterministic level-1
    output; the cross-OS matrix already exercises this; Phase 8
    extends the matrix to the action-log codec.

18. **Phase 8 decomposition.** 8.0 (memo) → 8.A.1 (drift) →
    8.A.2 (JS impl, sandbox) → 8.A.3 (CI/deploy extension) →
    8.B (live + cross-runtime + cross-OS).

---

## Deferred Phase 8 contracts

- **Title screen.** Phase 9 polish work
  (`docs/PHASES.md:582`). Phase 8 ships a minimal "Verify a
  Pasted Log" + "Save Slots" + "Replay This Run" UI in the
  diagnostic page; the polished title screen with seed entry,
  random-seed button, paste-fingerprint affordance is Phase 9.
- **Daily-seed convention.** Phase 9 polish; documented in
  `README.md` once the v1 release lands.
- **Pruning automation.** Phase 9+ if growth surprises;
  manually documented in `docs/PROD_REQUIREMENTS.md` until
  triggered.
- **`SaveSlot` schema v2.** Phase 9+ if save data evolves.
  Migrator pinned at point of introduction.
- **Mod-ID validation tightening.** Phase 9+ when the first mod
  registers; Phase 8's NUL/comma exclusion is the v1 floor.
- **`releases/index.json` schemaVersion = 2.** Phase 9+ if the
  manifest needs new fields. v1 reader rejects v2.
- **Brotli compression.** Phase 9+ if bundle / atlas / log size
  becomes a concern. Re-evaluation requires a cross-runtime
  byte-identity argument equivalent to fflate's.
- **HTTP endpoint verifier.** Out of scope (SPEC.md principle
  6). Out of v1 forever.
- **Native CLI verifier (non-Node).** Out of scope; a Go / Rust
  re-implementation would need an independent cross-runtime
  byte-identity argument (SHA-256 + custom encoder + fflate-
  equivalent). Far future.
- **Multi-machine synchronized save** (one player, two devices,
  both resuming the same run). Out of scope; would require
  a backend (SPEC.md principle 6 violation).
- **Action-log import via file drag-and-drop.** Phase 9 polish;
  Phase 8 ships clipboard paste only.
- **Bookmarklet** to copy the current state's URL. Phase 9
  polish; Phase 8 ships a "Copy URL" button.

---

## What this memo deliberately does NOT decide

These are framed by the user prompt or downstream of this
phase; the architecture-red-team should not flag their absence
here:

- **Phase 9 title screen layout.** Out of scope.
- **Audio system for replay.** Out of scope.
- **CRT shader for replay.** Out of scope.
- **Mod loader sandbox model.** Out of scope (SPEC.md "Open
  Questions").
- **Theme switching at runtime.** Out of scope.
- **Pruning policy automation.** Documented but not implemented.
- **Stranger's machine connectivity to GitHub Pages.** Assumed;
  the static deploy is plain HTTP-cacheable.
- **Whether `?run=` URLs should also work over IPFS.** Way out
  of scope.
- **CSP headers for the deploy.** Phase 9 polish; the static
  GH-Pages deploy is not currently shipping a CSP header but
  could be locked down via `<meta http-equiv="Content-Security-Policy">`
  in `index.html` if Phase 9 deems necessary.

---

## Phase split — one-screen summary

```
Phase 8.0 (planning gate)       ← THIS MEMO
  • decision-memo-phase-8.md (this file)
  • red-team-phase-8.md (architecture-red-team review)
  • addendum at the bottom of this memo (red-team blockers resolved)
  • phase-approval.json marks 8.0 approved

Phase 8.A.1 (drift-detection sweep)
  • lint scopes for src/router, src/verifier, src/share, src/save
  • docs/ARCHITECTURE.md extended (layer table + 18 frozen contracts)
  • docs/PROD_REQUIREMENTS.md finalized (security/reliability/perf/ops)
  • stub test files (tests pinned, no net-new functional code)
  • RULES_FILES classification documented (anticipated: no additions)
  • npm ci && npm run lint && npm run test && npm run build &&
    npm run test:e2e all green inside sandbox

Phase 8.A.2 (sandbox-verifiable JS implementation)
  • src/router/ implemented (URL parser + redirect + messages)
  • src/share/ implemented (action-log codec + URL formatter)
  • src/save/ implemented (localStorage persistence)
  • src/verifier/ implemented (verify function + Node CLI tools/verify.ts)
  • src/main.ts wired with all decision-15 diagnostic UIs
  • REPLAY_DIGEST pinned and asserted == WIN_DIGEST
  • bundle gate raised to 110 KB
  • all golden chain (RANDOM_WALK_DIGEST through WIN_DIGEST) preserved
  • no rulesetVersion bump
  • npm ci && npm run lint && npm run test && npm run build &&
    npm run test:e2e all green inside sandbox

Phase 8.A.3 (build-pipeline extension; not sandbox-verifiable)
  • scripts/build-dual.mjs (Vite base = /icefall/ + /icefall/releases/<c>/)
  • scripts/publish-dual.mjs (merge dist into one tree; rebuild index.json)
  • .github/workflows/deploy.yml extended to call dual scripts
  • releases/index.json bootstrap on first deploy
  • acceptance: live deploy after first 8.A.3 push has both
    latest/ and releases/<commit>/ paths working

Phase 8.B (live-deploy + cross-runtime + cross-OS verification)
  • Playwright tests on the live deploy:
    - URL parser (?run=...&seed=... → boot)
    - Replay viewer (?mode=replay → __REPLAY_FINAL_STATE_HASH__)
    - Verify pasted log (paste WIN_LOG wire → kind: "valid")
    - localStorage resume (10 actions + refresh + assert state hash)
    - Mismatched-build redirect (synthetic ?run=<old-fp> → redirect)
  • cross-OS atlas equality matrix unchanged (atlas binary untouched)
  • "stranger on different machine" property exercised
  • "old run after master moves on" deferred-assertion (full check at
    next rulesetVersion-bumping commit; routing path tested via
    synthetic stale fingerprint)
  • acceptance: docs/PHASES.md:556-562 fully satisfied
```

---

## Sequencing relationship to prior phases

The Phase 1–7 frozen contracts are honored unchanged:

- Phase 1 fingerprint pre-image (decision 1).
- Phase 1 action-descriptor wire format (decision 2 reuses
  `encodeAction(...)`).
- Phase 1 streams + state-chain.
- Phase 2 floor JSON.
- Phase 3 `RunState`, turn loop, combat.
- Phase 4 atlas binary, manifest, fflate level-1 cross-runtime
  byte-identity (extended to action log).
- Phase 4 `RULES_FILES` canonicalization (decision 14: no
  additions in 8.0).
- Phase 5 layer-import enforcement (extended in decision 12).
- Phase 6 inventory + equipment + new action types (used in
  `WIN_LOG` test fixtures).
- Phase 7 NPCs + shops + boss + win-state (used in
  `WIN_LOG` test fixtures).

The cross-runtime golden chain is preserved:
`RANDOM_WALK_DIGEST`, `MAPGEN_DIGEST`, `SIM_DIGEST`,
`ATLAS_DIGEST` + 4 preset-seed values, `INVENTORY_DIGEST`,
`WIN_DIGEST` — all unchanged, all asserted in
`tests/playwright/cross-runtime.spec.ts`. `REPLAY_DIGEST` joins
the chain in 8.A.2.

This memo is the load-bearing planning artifact for Phase 8;
the architecture-red-team will challenge weak decisions; the
addendum below resolves blockers; 8.A.1 begins after the
addendum is recorded and `phase-approval.json` marks 8.0
approved.

---

## Addendum (post-red-team review): resolutions for B1–B9 and disposition of A1–A7

> The architecture-red-team review at `artifacts/red-team-phase-8.md`
> raised **9 blocking issues (B1–B9)** and **7 non-blocking advisories
> (A1–A7)**. This addendum supersedes the original prose where they
> conflict. The numbered decisions above remain canonical; this
> addendum pins the additional details and fixes the contracts the
> red-team flagged. Mirroring the Phase 2/3/4 pattern, each blocker
> has a focused resolution that names the byte-level fix, the test
> that would catch a regression, and any decisions amended above.
> Each advisory has a single-row disposition.

### B1 (resolves red-team B1) — compression function is `fflate.zlibSync`, NOT `fflate.deflateSync`

**Resolution.** The action-log envelope's "Wire form" prose, the
"Decoder" pseudocode, and frozen-contract item 2 are amended
verbatim:

```
Wire form:  base64url(fflate.zlibSync(envelope, { level: 1 }))
Decoder:    fflate.unzlibSync(base64urlDecode(s))
```

`zlibSync` is the same function `src/atlas/png.ts:19` already uses
(verified `import { zlibSync } from "fflate";` at that exact line);
the cross-runtime byte-identity claim "inherited from Phase 4" is
therefore *test-supported* by the existing `cross-os-atlas-equality`
matrix. `deflateSync` (raw DEFLATE, no zlib header, no Adler-32
trailer) is byte-distinct from `zlibSync` and is never to be used
in `src/share/**`; lint-enforce in 8.A.1 by extending the existing
`no-restricted-imports` rule with
`{ name: "fflate", importNames: ["deflateSync", "inflateSync"] }`
for `src/share/**` and `src/verifier/**`. Decision 2's prose at
`decision-memo-phase-8.md:308-310, 322-325, 367-371, 477` is
amended in-place by this addendum.

A new self-test entry `action-log-cross-runtime` is added to
`src/core/self-test.ts` and pinned at first-green 8.A.2 CI: a known
8-byte action envelope (`"ICE\x01" + u32(0)` — empty action list)
is run through `zlibSync(envelope, { level: 1 })` and the resulting
base64url-encoded bytes are asserted to match a hardcoded golden
constant across chromium / firefox / webkit / Node 20 inside the
existing `cross-os-atlas-equality` matrix harness. The constant is
the binary `[0x49 0x43 0x45 0x01 0x00 0x00 0x00 0x00]` envelope,
zlib-wrapped (2-byte CMF/FLG header `0x78 0x01` + DEFLATE stored
block + 4-byte big-endian Adler-32 trailer), then base64url-encoded;
the exact value is pinned at first-green CI alongside `REPLAY_DIGEST`.

**Test that would catch a regression.** A vitest test asserts the
golden envelope round-trips through `unzlibSync` to the original
8 bytes; the cross-OS matrix asserts byte-identity across runners.
Any change to `fflate` in `package-lock.json` triggers an
architecture-red-team review (Phase 4 addendum N1, inherited).

**Decisions amended above.** Decision 2 prose blocks at lines 308-310,
322-325, 367-371, 467-477 — substitute `zlibSync` for `deflateSync`
and `unzlibSync` for `inflateSync`. The frozen contract block at
lines 467-497 is similarly amended.

### B2 (resolves red-team B2) — `decodeAction` contract, byte-explicit

**Resolution.** Verified that no `decodeAction` symbol exists in
`/workspace/src/`; only `encodeAction` ships today. Decision 2 gains a
new sub-section pinning `decodeAction(bytes, offset)` byte-explicitly
as a Phase 8 deliverable (NOT a "Phase 1 frozen contract" — the memo's
original prose at line 494 mis-attributed it).

```
decodeAction(bytes: Uint8Array, offset: number)
  → { action: Action; bytesConsumed: number }

Validation rules (all rejections produce pinned error strings under
the prefix "decodeAction: " for Phase 4-style exact-match testing):

  1. bytes[offset] === ACTION_VERSION (0x01); else throw
     "decodeAction: unsupported action version <v> at offset <i>"

  2. type_len = bytes[offset+1]; require type_len ∈ [1, 64]; else throw
     "decodeAction: type_len <n> out of range [1, 64] at offset <i>"

  3. type_bytes are the next type_len bytes; must be well-formed UTF-8
     (decoder does NOT validate semantics — type values are passed
     through to the action runner unchanged); insufficient bytes throw
     "decodeAction: truncated type at offset <i> (need <n>, have <m>)"

  4. After the type, optional fields are parsed in tag order:
     - previousTag = 0 (sentinel below TAG_TARGET=0x10)
     - On reading any byte tag T:
       - T must be in {TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30};
         else throw
         "decodeAction: unknown tag 0x<hh> at offset <i> (this build
         supports v1 tags 0x10, 0x20, 0x30 only — load
         'releases/<commit>/' for the build that produced this log)"
       - T must be > previousTag (strict ordering); else throw
         "decodeAction: tag 0x<hh> appears after tag 0x<prev> at
         offset <i> (tags must be strictly increasing)"
       - The tag's payload is read with strict length matching:
         - TAG_TARGET (0x10): 4 bytes int32 LE
         - TAG_ITEM   (0x20): 1+N bytes [item_len][item_bytes],
                              with item_len ≤ 255
         - TAG_DIR    (0x30): 1 byte 0..7
         insufficient bytes or out-of-range payload throws
         "decodeAction: truncated tag 0x<hh> payload at offset <i>"
       - previousTag := T

  5. Action ends when bytes[offset+bytesConsumed] is either:
     - the next ACTION_VERSION byte (start of next action), OR
     - past the end of the buffer.
     The decoder relies on ACTION_VERSION (0x01) being byte-distinct
     from {TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30}; this
     property is part of the Phase 1 frozen contract and is not at
     risk under additive tag extension (new tags must be > 0x30 and
     < 0xFF, never 0x01).

Phase 8 v1 decoder REJECTS unknown tags (rule 4 above). This forces
forward-compatibility through release pinning: a Phase 9 build that
adds a new tag publishes its own release subtree; a Phase 8 user
clicking that build's fingerprint URL is redirected via
'releases/<commit>/' (decision 5) to the build that supports the
new tag. The "skip unknown tag" alternative silently corrupts action
sequences and is explicitly forbidden.
```

**Test fixtures (8.A.2 deliverable, `tests/core/decode-action.test.ts`):**

- positive: action with no optional fields
- positive: action with TAG_DIR only
- positive: action with TAG_TARGET + TAG_ITEM + TAG_DIR
- positive: round-trip property — for 1000 random `Action[]` from
  the canonical streamPrng, `decodeAction(encodeAction(a)) === a`
  byte-identically
- REJECT: type_len = 0
- REJECT: type_len = 65
- REJECT: tag 0x40 (forward-compat unknown)
- REJECT: TAG_DIR (0x30) before TAG_ITEM (0x20)
- REJECT: TAG_DIR appearing twice (strictly-increasing violation)
- REJECT: item_len causing read past buffer end

**Decisions amended above.** Decision 2 prose at lines 326-332 and
479-497 — `decodeAction` is no longer described as a "Phase 1 frozen
contract" but as a Phase 8 sub-deliverable with the byte-explicit
contract above. The 8.A.2 deliverable list in decision 17 gains
`src/share/decode.ts` (or co-located in `src/core/encode.ts`).

### B3 (resolves red-team B3) — ninth error string, two-phase router enumeration

**Resolution.** Decision 5's error vocabulary expands from 8 to **9**
pinned error strings. The new entry is:

```
export const ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED =
  "router: this run's fingerprint matches no release at the
   supplied seed '<seed-repr>'. Either the seed was edited after
   sharing, the URL was double-encoded by an email or
   link-shortener, or the build that produced the fingerprint was
   never published. Try opening the original sharer's URL or use
   'New Run' with this seed.";
```

The em-dashes are U+2014 (matching addendum prose); the substitution
`<seed-repr>` follows advisory A5's substitution rule (URL-decoded,
non-printable bytes shown as `\x<hh>`).

Decision 5 sub-case 5a's enumeration algorithm gains a phase-2 retry:

```
1. Phase-1 enumeration (existing, unchanged):
   For each commit-short in releases/index.json (newest-first):
     candidate = fingerprint({
       commitHash: entry.commitHash,
       rulesetVersion: entry.rulesetVersion,
       seed: parsedSeed,
       modIds: parsedModIds,
     })
     if candidate.slice(0, 22) === parsedRun: redirect; return.

2. Phase-2 retry (NEW — disambiguates "wrong build" from "tampered
   mods/seed"):
   For each commit-short in releases/index.json (newest-first):
     candidate2 = fingerprint({
       commitHash: entry.commitHash,
       rulesetVersion: entry.rulesetVersion,
       seed: parsedSeed,
       modIds: [],     // strip mods to test seed-only collision
     })
     if candidate2.slice(0, 22) === parsedRun:
       throw ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED with
         seed-repr := parsedSeed.

3. Final: no candidate matched. Throw ROUTE_ERR_NO_MATCHING_RELEASE.
```

Phase-2 retry costs only on the failure path (which is already
user-error-pending), bounded by one extra full enumeration. Combined
with B5's incremental-state optimization, total cost is ~100 ms even
at N=1000 entries.

**Decisions amended above.** Decision 5 prose at the "8 pinned error
strings" line (and the bullet list of 8) becomes "9 pinned error
strings"; the enumeration algorithm gains the phase-2 retry. The
"Frozen contracts established by this phase" section (decision-15
summary at line 2770-2776) updates the count from 8 to 9.

### B4 (resolves red-team B4) — bump `__COMMIT_HASH__` to 12 characters in 8.A.1

**Resolution.** Verified the current pin: `vite.config.ts:7` reads
`git rev-parse --short=7 HEAD`; `vitest.config.ts:13` injects the
fixture string `"dev0000"` (7 chars). 7-char short hashes are
collision-prone over the project's expected lifetime (Linux kernel
hits 7-char collisions at ~50K commits; conservative threshold for
icefall is the same).

Phase 8.A.1's drift sweep includes a one-line change in both files:

- `vite.config.ts`: `git rev-parse --short=7 HEAD` →
  `git rev-parse --short=12 HEAD`
- `vitest.config.ts`: `JSON.stringify("dev0000")` →
  `JSON.stringify("dev000000000")` (12 chars)

The fingerprint pre-image is byte-changed (commitHash UTF-8 bytes
are 5 bytes longer); `WIN_DIGEST` is unchanged (fingerprints are not
in the digest); a new test vector for the 12-char commit-hash form
is pinned in `tests/core/fingerprint.test.ts`.

Decision 7's `releases/index.json` schema is amended:

```
ReleaseEntry = {
  commitShort:    string matching /^[0-9a-f]{12}$/;   // 12-char short
  commitHash:     string matching /^[0-9a-f]{12}$/;   // alias of
                                                      // commitShort
                                                      // for v1
                                                      // (a future bump
                                                      // to 40-char
                                                      // full hash is a
                                                      // schemaVersion
                                                      // = 2 event)
  rulesetVersion: string matching /^[0-9a-f]{64}$/;   // 64-char
                                                      // SHA-256 hex
  atlasBinaryHash: string matching /^[0-9a-f]{64}$/;
  publishedAt:    string matching
                  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
}
```

Each field's regex is asserted by the parser at
`tests/build/release-index.test.ts`.

**This is a fingerprint-format change.** It is recorded as such in
this addendum. Phase 8.A.1's drift sweep DOES bump every potentially-
existing fingerprint (from 7-char-commit pre-images to 12-char-commit
pre-images), but since no `?run=` URL has shipped to any user (Phase
7.B is the latest landed phase; URL routing first ships in 8.A.2),
no live URL is invalidated. **This is the correct moment to bump.**

The memo's headline summary at lines 70-78 ("No `rulesetVersion`
bump in Phase 8.0") is amended to:

> Phase 8.0 (this memo) is a planning gate; no code changes. Phase
> 8.A.1's drift sweep bumps `__COMMIT_HASH__` from 7-char to 12-char
> short hash, which changes `commitHash` in the fingerprint pre-image
> but does NOT change `rulesetVersion` (which derives from `rulesText`
> + `atlasBinaryHash`, neither of which include `commitHash`). The
> 12-char bump is a *forever-collision-resistant* pin and is
> documented in `docs/PROD_REQUIREMENTS.md`'s Reliability section.

**Decisions amended above.** Decision 7 schema at line 2720-2724,
decision summary at lines 70-78. Phase 8.A.1's deliverable list in
decision 17 gains the `vite.config.ts` / `vitest.config.ts`
short-hash bump.

### B5 (resolves red-team B5) — index-fetch URL pinning + caching + incremental-state optimization

**Resolution.** Decision 7's frozen contract gains:

```
RELEASES_INDEX_URL: string =
  `${origin}${BASE_LATEST_PATH}releases/index.json`

where BASE_LATEST_PATH = "/icefall/" by default, overridable via a
build-time constant exported from src/build-info.ts. Custom-domain
deploys (Phase 9 polish) update BASE_LATEST_PATH at build time.

The router ALWAYS fetches the index from BASE_LATEST_PATH, never
from the per-release basePath (regardless of whether the page itself
is loaded from latest/ or releases/<commit>/). This eliminates the
<base href>-relative-URL confusion the red-team flagged.

Caching: per-page-session in-memory cache keyed by
RELEASES_INDEX_URL. HTTP Cache-Control on the index file is set to
'public, max-age=300, stale-while-revalidate=86400' at the GH-Pages
deploy step (8.A.3 publish-dual.mjs pin).
```

Decision 5's enumeration optimization (8.A.2 deliverable):

```
When releases/index.json is published (8.A.3 publish-dual.mjs),
each ReleaseEntry's pre-image partial-state is precomputed:

  {
    commitShort, commitHash, rulesetVersion, atlasBinaryHash,
    publishedAt,
    fpPrefixHashState: base64url(sha256_partial(
      utf8(commitHash) || 0x00 || utf8(rulesetVersion) || 0x00
    )),                                              // 32 bytes encoded
  }

The router's enumeration loop resumes from each entry's
fpPrefixHashState, hashes only utf8(parsedSeed) || 0x00 ||
utf8(parsedModsCsv), and finalizes — dropping per-iteration cost
from sha256(200 bytes) to sha256(50 bytes). At N=1000 entries this
is ~50 ms on a midrange phone, ~100 ms total with the phase-2
retry from B3.

Implementation: src/core/hash.ts gains
  sha256_resume(state: Uint8Array, suffix: Uint8Array): Uint8Array
(a thin wrapper over @noble/hashes's sha256.create() with
state-loading). Lint-banned outside src/core/ and src/router/ via
no-restricted-imports.
```

DoS bait is bounded: the action-log decode happens AFTER the
redirect (decision 5 already), so no compressed-bomb in `#log=`
ever runs on the wrong-build page; the index enumeration is
pre-state-cached and capped by `releases/index.json` length (max
1000 entries before the size budget triggers pruning, decision 16).

**Decisions amended above.** Decision 7 frozen contract gains the
`RELEASES_INDEX_URL` pin and the cache-control header. Decision 5
algorithm gains the partial-state optimization. Decision 12 (layer
additions) notes `src/core/hash.ts` exports `sha256_resume`.

### B6 (resolves red-team B6) — save-slot resume routes through release-redirect

**Resolution.** Decision 8's resume algorithm is amended:

```
On page load (any URL):
  1. Compute parsedInputs from URL parser (decision 6).
  2. Compute fingerprintShort = fingerprint(parsedInputs) under
     CURRENT BUILD's commitHash + rulesetVersion.
  3. Look up localStorage[SAVE_KEY_PREFIX + fingerprintShort].
  4. If present and integrity-check passes:
     → silent resume (existing behavior).
  5. If absent:
     → enumerate ALL localStorage[SAVE_KEY_PREFIX + ...] keys.
     → for each slot, parse the SaveSlot record.
     → if any slot has SaveSlot.inputs.seed === parsedInputs.seed
       AND SaveSlot.inputs.commitHash !== CURRENT_BUILD.commitHash:
         → this is a STALE-RELEASE slot. Surface in the multi-slot
           UI:
           "Found a save for seed <s> from build <commitShort>;
            open in pinned release?"
           Clicking redirects to
              releases/<savedCommit>/?seed=<s>
           via window.location.replace.
         → after redirect, the per-release page's load step
           computes fingerprintShort under the matching build, and
           step 3 hits.
     → otherwise: boot fresh from seed (existing behavior).

The integrity-check-fails path (replayed.stateHashHex !==
saved.stateHashHex) ONLY triggers inside step 4 — i.e., when the
slot's build matches the current build but the replay disagrees. A
build-mismatched slot is NEVER deleted by the integrity-check path;
it is preserved indefinitely so the user can always recover by
visiting the pinned release.
```

Decision 15's "Save Slots" diagnostic-page UI is amended: stale-
release slots render an "[Open in pinned release]" link, not a
"Resume" button; the link's `href` is the redirect target so the
user can right-click → copy / open-in-new-tab.

**Decisions amended above.** Decision 8 algorithm at lines
1467-1663. Decision 15 UI at "Save Slots" sub-section.

### B7 (resolves red-team B7) — URL-length threshold is on full-URL length, not `wire.length`

**Resolution.** Decision 4's frozen contract is replaced with:

```
URL_FULL_LENGTH_THRESHOLD = 2000     // chars; covers email, Slack,
                                     // X embed
URL_FULL_LENGTH_HARD_CAP  = 32000    // chars; refuses share above

Sharing UI behavior:
  let wire        = encodeActionLog(actions)
  let sharePath   = formatSharePath(inputs)   // ?run=&seed=&mods=
  let baseUrlLen  = baseUrl.length
  let pathLen     = sharePath.length
  let logFragLen  = "#log=".length + wire.length
  let fullUrlLen  = baseUrlLen + pathLen + logFragLen

  if fullUrlLen <= URL_FULL_LENGTH_THRESHOLD:
    shareUrl = baseUrl + sharePath + "#log=" + wire
    uiMode   = "url-only"
  else if (baseUrlLen + pathLen) + 5 + wire.length
            <= URL_FULL_LENGTH_HARD_CAP:
    shareUrl = baseUrl + sharePath
    uiMode   = "url-plus-clipboard-log"
  else:
    shareUrl = baseUrl + sharePath
    uiMode   = "url-plus-export-log"
    showError "share: this run's action log exceeds the 32-KB
               safe-share limit; export via 'Download log' as a
               .ice-log file"
    // Phase 9 polish: implement download. Phase 8 surfaces only
    // the error.
```

`baseUrl` is the build-time-pinned canonical share origin (e.g.
`https://porkchop.github.io/icefall/` for `latest/` or
`https://porkchop.github.io/icefall/releases/<commit>/` for a pinned
release). Percent-encoding is applied by the URL formatter before
the length is measured (i.e., `pathLen` is the post-encoding length;
emoji/CJK seeds expand by their UTF-8-byte percent-encoded length).

**Test fixtures (8.A.2):**

- seed `"floor 7 cat 🐈"` (4-byte UTF-8 emoji) round-trip
- seed `"2026-05-09 — Tokyo 東京 ☔"` (mixed CJK + symbols + dashes)
- double-encoded seed (chat-client autolinker scenario) — the parser
  rejects `%2525` as an invalid seed (`ROUTE_ERR_SEED_INVALID`)
- WIN_LOG with 100-char emoji seed asserts
  `uiMode === "url-plus-clipboard-log"` (the seed pushes past 2000)
- WIN_LOG with empty-string seed `""` asserts `uiMode === "url-only"`
  for the typical case (round-trip identity)

**Decisions amended above.** Decision 4 frozen contract at lines
738-876 (entire decision-4 block) — `URL_LOG_THRESHOLD_CHARS = 1500`
is REPLACED with `URL_FULL_LENGTH_THRESHOLD = 2000` and the new
hard-cap rule. Decision 15 UI gains the three uiMode rendering
branches.

### B8 (resolves red-team B8) — `RULES_FILES` reachability is mechanical and CI-enforced

**Resolution.** Phase 8.A.1's drift sweep includes a new test:

```
tests/build/rules-files-reachability.test.ts:

  1. Walk the static-import graph from src/sim/harness.ts.
  2. Filter to files under src/.
  3. Compare the set with RULES_FILES paths (canonical sort).
  4. Fail with pinned error message if mismatched in either
     direction:
     - "rules-files: file <path> is reachable from
        src/sim/harness.ts but not in RULES_FILES — add it to
        src/build-info.ts:RULES_FILES or remove the import"
     - "rules-files: file <path> is in RULES_FILES but not
        reachable from src/sim/harness.ts — remove from
        RULES_FILES"

  Implementation: madge programmatic API, or hand-rolled via the
  TypeScript Compiler API. Cost target: <500ms in CI.
```

Decision 14's anticipated outcome is replaced with a *gate*:

```
Phase 8.A.2 lands no file reachable from src/sim/harness.ts that is
not already in RULES_FILES. The rules-files-reachability test
enforces this at CI time. A violation is an architecture-red-team
review event before merge; if the file IS in fact rules-bearing,
RULES_FILES is amended in the same commit and the addendum to this
memo records the change (making it a rulesetVersion bump and a
planning-gate revisit, not a silent slip).
```

Decision 12's verifier-imports-harness rule is amended:

```
src/verifier/ may import src/sim/harness.ts (for runScripted) BUT
src/verifier/**/*.ts is itself NOT in RULES_FILES (the verifier's
content does not affect simulation byte output — it consumes the
output). The reachability check explicitly excludes
src/verifier/** and src/router/** from the "reachable from
src/sim/harness.ts" walk because the import direction is reverse:
harness does not import verifier. The test asserts the reverse
direction is empty, defending against an accidental
harness → verifier import.
```

**Decisions amended above.** Decision 14 at lines 2081-2150 (anticipated
outcome → CI-enforced gate). Decision 12 verifier-imports rule.
Phase 8.A.1 deliverable list in decision 17 gains
`tests/build/rules-files-reachability.test.ts`.

### B9 (resolves red-team B9) — "Share This Run" UI ships in 8.A.3, not 8.A.2

**Resolution.** Phase 8.A.2's deliverables are amended:

```
8.A.2 ships:
  - URL parser (src/router/url-parse.ts) + tests
  - Action-log codec (src/share/encode.ts + src/share/decode.ts)
    + tests + REPLAY_DIGEST
  - Verifier (src/verifier/verify.ts + tools/verify.ts) + tests
  - localStorage save layer (src/save/storage.ts) + tests
  - Replay viewer (src/main.ts replay-mode wiring) + tests
  - Diagnostic page sections: "Verify a Pasted Log", "Save Slots",
    "Replay This Run" (from decision 15)

8.A.2 does NOT ship:
  - "Share This Run" button (the URL-formatter is exercised by
    tests only; no in-page user-visible affordance to mint a
    `?run=` URL).
  - The window.__SHARE_URL__ flag (deferred to 8.A.3).
  - history.replaceState canonicalization on page load (the URL
    bar is read but never mutated by the page in 8.A.2).
```

Phase 8.A.3's deliverables gain (in addition to dual-build CI):

```
  - "Share This Run" button in the diagnostic page; mints the URL,
    copies via navigator.clipboard.writeText, and exposes
    window.__SHARE_URL__.
  - history.replaceState canonicalization on page load (the URL bar
    becomes the canonical share form after fingerprint match).
```

This guarantees the *first* user-visible URL share happens in the
same commit that publishes the corresponding
`releases/<commit-8.A.3>/` subtree — closing the 8.A.2-window
described in red-team B9.

Decision 5's `ROUTE_ERR_NO_MATCHING_RELEASE` text is amended for the
bootstrap case:

```
export const ROUTE_ERR_NO_MATCHING_RELEASE =
  "router: this run was created with a build that is not present in
   releases/index.json. The release may not yet be published (try
   refreshing in a minute) or may have been pruned. If this URL was
   shared before per-release pinning was live (Phase 8.A.3), the
   run can be re-created with seed '<seed>' on 'latest/'.";
```

The `<seed>` substitution is the URL-decoded seed (advisory A5's
`<repr>` rule applies). Test fixture: a synthetic pre-8.A.3
fingerprint URL produces this exact string with the seed
substituted.

**Decisions amended above.** Decision 17 (phase split) — 8.A.2 vs
8.A.3 deliverable boundary. Decision 5 — `ROUTE_ERR_NO_MATCHING_RELEASE`
text for the bootstrap case.

### Disposition of advisories A1–A7 (non-blocking)

| ID | Disposition |
|----|-------------|
| **A1** | **ACCEPT.** `src/router/` gains a single explicit lint exception in 8.A.1: `Date.toISOString()` allowed *only* inside `src/router/release-index-parse.ts` (read-only consumption of the `publishedAt` ISO-8601 string from `releases/index.json`); writes are still banned. The `publishedAt` field is generated at deploy time by `scripts/publish-dual.mjs` (which is not lint-scoped to the `src/` layer rules). Pinned in 8.A.1's lint-scope additions. |
| **A2** | **ACCEPT (rewrite).** Decision 3's "Discord crawler" prose at lines 583-597 is amended to frame `#log=` privacy as a *desideratum* ("the hash fragment is not transmitted to the server in any browser today and is not captured by any link-preview crawler we are aware of") rather than a *contract*. The contract is "the page MUST NOT depend on `#log=` being secret"; the verifier accepts a forwarded log unchanged. |
| **A3** | **ACCEPT.** Decision 11's `?seed=` standalone path gains a "Share This Run" affordance only AFTER the user mints a fingerprint (i.e., the standalone seed never produces a `?run=` URL until they click an explicit button). The button text in `latest/` reads "Share Run (pinned to current build)" to make the latest-pinning explicit; in `releases/<commit>/` it reads "Share Run (pinned to commit <short>)". A regression test asserts the button label differs in the two contexts. |
| **A4** | **ACCEPT.** `expectedAtlasBinaryHash` becomes a *required* field of `VerifyArgs` for the browser and Node-CLI runtimes; the in-test runtime passes the test build's atlas hash. Verifier returns `kind: "atlas-mismatch"` if the field is omitted in a runtime where it is required (defense-in-depth). Pinned in decision 10's `VerifyArgs` shape. |
| **A5** | **ACCEPT.** Substitution rule for `<repr>` (and the new `<seed-repr>` from B3): URL-decode the parameter; if any byte is non-printable (outside U+0020..U+007E), substitute that byte as `\x<HH>` (uppercase hex). Pinned at decision 5 / decision 6 prose. Test fixture: `?seed=%01abc` decodes to `\x01abc` in the error message. |
| **A6** | **ACCEPT.** `__SHARE_LOG_LENGTH__` pin is extended: the test fixture pins (a) the WIN_LOG length, (b) a 1-action `["wait"]` log length, (c) a 100-action move-only log length, and (d) a 1000-action mixed log length. Four data points provide the cross-runtime byte-identity surface across the realistic length spectrum. |
| **A7** | **ACCEPT.** `scripts/publish-dual.mjs` falls back to the local `dist/releases/index.json` when fetching the previous deploy's index fails (any HTTP error or DNS failure); the fallback is logged. The very-first 8.A.3 deploy seeds `releases/index.json` from local-only state. Pinned in 8.A.3's deliverable list. |

---

**End of memo.** Architecture-red-team review at
`artifacts/red-team-phase-8.md` recorded; all 9 blockers (B1–B9)
resolved by this addendum; all 7 advisories (A1–A7) accepted with
disposition above. Phase 8.0 (planning gate) is approved; Phase
8.A.1 (drift sweep) is unblocked once `artifacts/phase-approval.json`
is committed by the outer loop.
