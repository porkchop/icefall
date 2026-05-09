# Architecture Red-Team Review — Phase 8 Decision Memo

**Memo under review:** `/workspace/artifacts/decision-memo-phase-8.md`
**Reviewer:** `architecture-red-team`
**Phase 7.B baseline:** commit `08d88b6` on master (`artifacts/phase-approval.json`).
**Verdict:** **NEEDS REWORK (BLOCKERS).** After the addendum at the bottom of this review is folded into the memo, this becomes APPROVE-AFTER-ADDENDUM.

## Summary

Phase 8 is correctly identified by the memo author as the load-bearing pillar of the project's identity: every URL, every share, every save, every release pin that ships post-8.B becomes byte-frozen forever. The structural decisions — query-vs-fragment split, magic+version envelope, content-addressed `releases/<commit-short>/` layout, pure `verify(...)` discriminated-union, and the 8.0 → 8.A.1 → 8.A.2 → 8.A.3 → 8.B decomposition — are the right shape and inherit Phase 4's planning-gate discipline cleanly. The phase-split rationale (8.A.2 sandbox-verifiable JS vs 8.A.3 not-sandbox-verifiable CI) is the same correct pattern that Phases 1/4/7.B used, and the inheritance of fflate's cross-runtime byte-identity is the right reuse story.

That said, the memo has **eight byte-level under-specifications** that two competent implementers would not converge on identically, plus three structural defects in the Phase split / chicken-and-egg story, plus one outright contract contradiction with already-shipped code. Most are "tighten one paragraph" fixes — but they are exactly the class Phase 8's planning gate exists to catch, because a single divergent byte in the URL-routed envelope makes every shared `?run=` URL irrecoverable and a Phase 9 `rulesetVersion` bump would be the only escape valve. Below: nine blockers (B1–B9), seven non-blocking advisories (A1–A7), and an addendum block ready for paste-in.

## Blocking issues

### B1. Decision 2 specifies `fflate.deflateSync` (raw DEFLATE) but the entire cross-runtime byte-identity guarantee inherited from Phase 4 is established for `fflate.zlibSync` (zlib-wrapped DEFLATE). These two functions emit DIFFERENT bytes for the same input.

**Decision affected:** decision 2 (action-log envelope), decision 13 (`REPLAY_DIGEST`), risk R2, "fflate level-1 byte-identity (inherited from Phase 4)".

**Issue.** The memo's frozen-contract item 2 reads `wire = base64url(fflate.deflateSync(envelope, { level: 1 }))` and the cross-runtime claim is "fflate's level-1 is the same level used by the Phase 4 atlas PNG encoder. Cross-runtime byte-identity is already established by the Phase 4.B `cross-os-atlas-equality` matrix" (memo `decision-memo-phase-8.md:368-371`). But the existing PNG encoder at `src/atlas/png.ts:19` imports and uses `zlibSync`, not `deflateSync`:

```
// src/atlas/png.ts:9-11, 19
* Compression is `fflate.zlibSync` at `level: 1` (deterministic; same bytes
* across Node, Chromium, Firefox, WebKit per memo decision 4 + addendum-2).
import { zlibSync } from "fflate";
```

`zlibSync` emits a 2-byte zlib header (`0x78 0x01`), the DEFLATE stream, and a 4-byte big-endian Adler-32 checksum trailer. `deflateSync` emits *only* the raw DEFLATE stream — no header, no checksum. For the same input these produce byte sequences that share their middle but differ at both ends: never byte-identical, and never round-trippable through each other's inverse.

That alone is a contract issue, but the deeper problem is the cross-runtime claim: **no test in the project today exercises `fflate.deflateSync` at all.** The cross-OS matrix (`tests/playwright/cross-os-*` and the related Node/Vitest fixtures) compares `assets/atlas.png` byte equality, which exercises `zlibSync`'s output via the encoder. The claim that "cross-runtime byte-identity is already established" is true for `zlibSync` and unverified for `deflateSync`. Two implementers will either (a) read decision 2 literally and call `deflateSync`, breaking the inheritance argument; or (b) silently switch to `zlibSync` to inherit the matrix and thereby ship a contract that does not match the memo's frozen prose.

The mismatch also propagates into the decoder. The memo's pseudocode at line 480 says `decoded = fflate.inflateSync(base64urlDecode(s))`; `inflateSync` accepts raw DEFLATE *or* zlib-wrapped data depending on what was emitted, and the symmetry is implicit in the codebase's untested "use the matching pair" convention. A deflateSync↔inflateSync mismatch with a zlibSync↔unzlibSync mismatch is a silent corruption surface.

**Why blocking.** This is the same defect class as Phase 2 B1 (alphabet ambiguity in `tilesB64`) and Phase 3 B1 (`lp_utf8(domain)` pre-image semantics): the byte-level wire prose of the frozen contract is internally inconsistent with what the project actually ships, and two implementers reading the memo will produce non-interoperable wire bytes. A fingerprint URL minted under one choice will not decode under the other; once the first such URL is shared the wire is frozen forever.

**Suggested fix.** Pick `zlibSync` (the existing function with established cross-runtime byte-identity in the cross-OS matrix) and rewrite decision 2 + frozen contract item 2 to specify it byte-explicitly:

```
ACTION_LOG_MAGIC      = [0x49, 0x43, 0x45]                     // "ICE"
ACTION_LOG_VERSION    = 0x01

Envelope (uncompressed):
  [ACTION_LOG_MAGIC][ACTION_LOG_VERSION][actionCount:u32 LE]
  [encodeAction(actions[0])]...[encodeAction(actions[N-1])]

Wire form:
  base64url(fflate.zlibSync(envelope, { level: 1 }))
                  ^^^^^^^^^                                    // decision 2 amended

Decoder:
  decoded = fflate.unzlibSync(base64urlDecode(s))
                  ^^^^^^^^^^^                                  // raw deflate banned
```

Additionally, extend the cross-OS matrix in 8.A.2 with a self-test `action-log-cross-runtime` that takes a known 8-byte action envelope (`"ICE\x01" + u32(0)` — empty action list), runs it through `zlibSync(level=1)`, and asserts a hardcoded golden hex prefix on three platforms / four runtimes. This makes the byte-identity claim *test-pinned*, not *inherited-by-prose*.

### B2. `decodeAction` does not exist in the codebase. Decision 2's decoder pseudocode invents it as if it were a Phase 1 frozen contract.

**Decision affected:** decision 2 ("Decoder" pseudocode at memo lines 478–497, "decodeAction(bytes, offset) is the inverse of encodeAction(action) per Phase 1 wire format" at line 494–496).

**Issue.** Phase 1 ships only the encoder (`src/core/encode.ts:57`, `encodeAction(action: Action): Uint8Array`); there is no `decodeAction` in `src/core/encode.ts` or anywhere in `src/`. `git grep -n "decodeAction"` returns zero matches. The memo's decision 2 leans on `decodeAction(bytes, offset) → (action, bytesConsumed)` as if it were a Phase 1 frozen contract; it is in fact a Phase 8.A.2 *new contract* whose byte-level inverse properties (rejecting unknown tags, rejecting tag-order violations, rejecting truncated payloads, rejecting redundant whitespace, etc.) are unspecified.

This matters because `encodeAction`'s wire format has at least four edge cases the inverse must pin:

1. **Unknown tag tolerance.** Phase 1 reserves tags `0x00` and `0xFF` (`docs/ARCHITECTURE.md:249`) and says "new optional fields must use a strictly greater tag than any existing one and must be strictly increasing on the wire." A v1 decoder that *encounters* a tag `0x40` in v1 wire bytes must do what — reject? skip? Phase 9 may add new tags to support new actions; if the v1 decoder skips unknown tags, then a v2-encoded log replays byte-identically through v1 *minus the new field*, which silently corrupts the action sequence. If v1 rejects unknown tags, a v2 log running through v1 errors clearly. Decision 2 picks neither; the choice is load-bearing.

2. **Tag-order violation.** A maliciously-formed log with `TAG_DIR (0x30)` before `TAG_ITEM (0x20)` is encodable-by-bytes but not encoder-emittable. Does the decoder reject? The Phase 1 prose says "strictly increasing on the wire" but the decoder doesn't yet exist to enforce it.

3. **`type_len = 0`.** `encodeAction` rejects empty `type` (`encode.ts:59-61`). A wire byte with `type_len = 0` round-trips through the codec and falls through to the per-action dispatcher, which does what?

4. **`item_len > remaining_bytes_until_action_end`.** With no per-action length prefix (decision 2 explicitly rejects per-action prefixes at lines 431–437 — "`encodeAction(...)` is already self-delimiting"), the decoder must prove the next action starts at `offset + bytes_consumed` from the *previous* `decodeAction`. If the previous call reads past its actual payload (because `item_len` is corrupt), the rest of the log decodes into garbage but will likely *not* fail until either a malformed `ACTION_VERSION`, a malformed `type_len > 64`, or an end-of-buffer mismatch — at which point the action *count* claimed in the envelope header may still match but the *content* is corrupted.

The "self-delimiting" claim is true *if and only if* every input field's length is internally consistent; a single corrupt `item_len` byte can shift every subsequent action by `(corrupt_len - actual_len)` bytes silently. Without an explicit reject-on-mismatch decoder contract, the memo's "trailing bytes" assertion (memo line 491: `assert offset === decoded.length`) is the *only* tripwire — and a sufficiently-corrupted log can easily leave `offset === decoded.length` with garbage actions in between.

**Why blocking.** The decoder is the trust boundary for every URL-shared run, every clipboard paste, every localStorage resume. Decision 2 specifies the encoder wire form byte-exactly and then handwaves "decodeAction(...) is the inverse" — but the inverse of an injection-tolerant encoder is *not* automatically a strict decoder, especially when the encoder has documented tag-extension rules that the v1 decoder must take a stance on.

**Suggested fix.** Add an explicit decision 2a or extend decision 2 with the byte-exact decoder contract:

```
decodeAction(bytes, offset) → { action, bytesConsumed } | throws

  Validation (all rejections produce pinned error strings):

  1. bytes[offset] === ACTION_VERSION (0x01); else
     throw "decodeAction: unsupported action version <v> at offset <i>"

  2. type_len ∈ [1, 64]; else
     throw "decodeAction: type_len <n> out of range [1, 64] at offset <i>"

  3. After reading type, optional fields are parsed in tag order:
     - Each tag must satisfy tag > previousTag (strictly increasing).
     - Each tag must be one of the registered v1 tags
       (TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30).
       UNKNOWN tags throw
       "decodeAction: unknown tag 0x<hh> at offset <i>; this build is
        v1 — load 'releases/<commit>/' for the build that produced this log".
     - Each tag's payload bytes are read with strict length matching;
       a payload that requires more bytes than remain throws
       "decodeAction: truncated tag 0x<hh> at offset <i>".

  4. Action ends when the next byte is either:
     - the start of the next action (a valid ACTION_VERSION byte), OR
     - the end of the buffer.
     The decoder DOES NOT use a length prefix; it relies on the
     ACTION_VERSION byte being non-{TAG_TARGET, TAG_ITEM, TAG_DIR}.

  Test fixture vectors (8.A.2 unit tests):
     - action with no optional fields (just version + type)
     - action with TAG_DIR only
     - action with TAG_TARGET + TAG_ITEM + TAG_DIR
     - REJECT: tag 0x40 (forward-compat unknown)
     - REJECT: TAG_DIR (0x30) before TAG_ITEM (0x20)
     - REJECT: TAG_DIR appearing twice (strictly-increasing rule)
     - REJECT: type_len = 0
     - REJECT: type_len = 65
     - REJECT: item_len causing read past buffer end
```

The "unknown tag rejects" stance is the right v1 default: a Phase 9 build that adds a new tag MUST also publish a new release whose version of this decoder accepts it; `releases/<commit-short>/` routing then channels old fingerprints carrying the new tag to the build that supports it. The "skip unknown tag" alternative silently corrupts the action sequence and would necessitate a `rulesetVersion` bump every time an action gains a field, defeating the additive-extension principle from Phase 1.

### B3. Decision 5's mismatched-version fingerprint enumeration is described as "O(N) over the index, ~1ms each, ~1s at N=1000," but the index format pinned in decision 7 does not contain `seed` or `modIds` — so enumeration cannot disambiguate `(commitHash mismatch)` from `(seed/mods tampered after fingerprint generation)` without the original URL's `?seed=` and `?mods=`.

**Decision affected:** decision 5 (sub-cases 5a/5b/5c/5d), decision 7 (`releases/index.json` schema).

**Issue.** Decision 5's algorithm at memo lines 887–937 reads:

```
For each commit-short in the index (newest-first), compute
  a candidate fingerprint using the per-release manifest
  entry's commitHash and rulesetVersion.
On the first match, redirect to releases/<commit-short>/...
```

The candidate fingerprint pre-image is `sha256(commitHash || 0x00 || rulesetVersion || 0x00 || seed || 0x00 || sortedModIds.join(","))`. The router has `commitHash` and `rulesetVersion` from the index entry; it has `seed` and `modIds` from the URL's `?seed=` and `?mods=`. So far so good — *if* the URL's `?seed=` and `?mods=` are intact. But sub-case 5c is precisely the case where they are not: the URL was edited or corrupted between the original sharer and the recipient, so the recipient's `?seed=` value is wrong.

The enumeration algorithm therefore has a hidden dependency on URL parameter integrity that the memo does not call out. Concretely:

1. A user shares `?run=ABC&seed=alpha-1`. The original sharer's seed was `alpha-1`; the router computes the candidate fingerprint over every release using `seed=alpha-1` and `modIds=[]`; the matching release is found; redirect.

2. A user shares `?run=ABC&seed=alpha-1`; a malicious link-shortener (or an autolinker that lowercases) silently changes the URL to `?run=ABC&seed=ALPHA-1`. The router enumerates every release using `seed=ALPHA-1`; nothing matches; sub-case 5d fires (`ROUTE_ERR_NO_MATCHING_RELEASE`).

3. A user shares `?run=ABC&seed=alpha-1`; the recipient's email client URL-encodes the seed differently (a `+` becomes a space, a Unicode character is double-encoded). Same outcome: nothing matches; sub-case 5d fires.

The error message for 5d says "no matching pinned release was found" which is misleading: the *correct* release exists, but the seed doesn't match any candidate fingerprint at any release. The user has no way to know which of (a) their build is wrong, (b) the seed was edited, (c) the URL was double-encoded.

The deeper issue: sub-case 5c claims the redirect *target* (a `releases/<commit-short>/` URL) and the *current* page mismatch implies tampering. But sub-case 5c can only fire when the page is *already at* `releases/<commit-short>/`. The first visit is always at `latest/`. So 5a's enumeration loop is the only path that can produce a "this URL won't work" outcome on the first visit — and 5a's algorithm has no `seed`-tampered detection at all. A tampered `?seed=` deterministically returns 5d, never 5c.

This makes the error UX wrong in the most common attack: a typo / autolinker mangling of the seed. The user gets "no matching release was found" when in fact the correct release exists and the seed is the problem.

**Why blocking.** The mismatched-version UX is one of the seven enumerated frozen contracts of Phase 8 (`docs/PHASES.md:559`: "Mismatched commit hash in a fingerprint produces a clear, actionable error directing the player to the correct release URL"). The memo's contract directs users with seed-corrupted URLs to the wrong fix ("the release may not yet be published" / "may have been pruned") instead of the right one ("the URL's seed parameter does not match the run's fingerprint").

**Suggested fix.** Two changes to decision 5:

1. **Distinguish "no matching release" from "no matching `(release, seed, mods)` candidate."** After 5a's enumeration over releases fails, if the URL's `?run=` does not match *any* `fingerprint(commitHash, rulesetVersion, parsedSeed, parsedMods)` for any release, ALSO try every release with `parsedMods=[]` (in case `?mods=` was tampered). If the seed passed-through the URL is a base64url-alphabet string of length 22, try interpreting `?run=` as an *embedded fingerprint* and `?seed=` as the actual run seed. Only after exhausting these does the sub-5d "this URL doesn't reproduce any known run" message fire.

2. **Tighten the error string vocabulary.** Add a ninth error string:

```
ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED =
  "router: this run's fingerprint matches no release at the supplied seed
   '<seed-repr>'. Either the seed was edited after sharing, the URL was
   double-encoded by an email or link-shortener, or the build that
   produced the fingerprint was never published. Try opening the original
   sharer's URL or use 'New Run' with this seed."
```

This makes the load-bearing UX failure mode actionable. It also costs zero on the critical-path (only fires when 5a's primary enumeration has already failed).

3. Extend `releases/index.json` (decision 7) with a *self-fingerprint* field per release: each entry includes a SHA-256 of the entry's own canonical bytes, so the router can quickly distinguish "we saw this release; its fingerprint pre-image lookup didn't match" from "we don't know about this release at all." (This is optional defense-in-depth; primary fix is item 1+2.)

### B4. The `releases/<commit-short>/` 7-character `commit-short` is collision-prone over the project's expected lifetime, and the memo aliases `commitShort` to `commitHash` in the index schema, making future collision recovery impossible without a `rulesetVersion` bump.

**Decision affected:** decision 7 (release index schema, "we do NOT inject the full 40-char hash anywhere"), risk R5.

**Issue.** Git's default short-hash length is 7 hex characters (28 bits, ~268M values). Linus's well-known cabal-of-rules paper notes that the Linux kernel started seeing 7-char collisions at ~50,000 commits; modern Git auto-bumps short-hash length to 8/9/10 characters when collisions are detected. The icefall project at 1000 commits (memo's growth estimate, decision 7) has collision probability ≈ `1 - exp(-1000² / (2 * 268M))` ≈ 0.19% — small but non-zero, and rising quadratically with N.

The memo's release-pinning contract makes this much worse than Git's normal recovery story:

1. **Two commits with the same 7-char short hash both publish to `releases/abc1234/`.** The second deploy overwrites the first's per-release subtree. If the first commit's atlas / ruleset differs (say, an atlas-seed bump landed in the second commit), the first commit's pinned URL silently begins serving the *second* commit's atlas — and the per-release Vite `base` matches, so the page loads, but the in-page hash check (decision 7's `__ATLAS_BINARY_HASH__` constant) detects the drift and refuses to render. The user sees a `DEV-` refusal or atlas-mismatch error from a URL that previously worked.

2. **The index entry's `commitShort` field aliases `commitHash` for v1** ("`commitHash` is the same 7-char form for now (we do NOT inject the full 40-char hash anywhere — Phase 1 frozen contract)" — memo line 1268-1271). The Phase 1 frozen contract is that **the build-time `commitHash` injected into `__COMMIT_HASH__` is `git rev-parse --short=7 HEAD`** (`vite.config.ts:7`). That value is one input to the fingerprint pre-image. The memo claims keeping `commitShort` and `commitHash` as duplicate fields is "defense-in-depth against a future Phase 9+ shift to full hashes." But:

   - The fingerprint pre-image uses *whatever string `__COMMIT_HASH__` holds* (Phase 1 frozen contract, `src/core/fingerprint.ts:42-86`). If that's the 7-char form forever, then fingerprints are 7-char-collision-vulnerable forever.
   - If Phase 9 wants to fix this, it must bump the pre-image (use a 40-char hash) — which is a **`rulesetVersion` bump that invalidates every Phase 8 fingerprint ever shared**. The "Phase 8 frozen forever" promise is broken on the *first* collision.

3. **Pruning makes this worse.** The retention policy ("keep all forever until 800 MB") has no mechanism to detect that a pruned release shared a 7-char prefix with a kept release — you can prune `releases/abc1234/` (commit X) and keep `releases/abc1234/` (commit Y, second-occurrence collision). At pruning time the index entry for X is removed; routing for X's old fingerprints now lands at Y's pinned subtree. There is no warning.

The memo's risk section R5 ("repo size growth") doesn't address collisions; risk R7 ("redirect circular loop") doesn't address collisions; the index-schema "Pinning notes" at line 1267-1274 hand-waves "Keeping both fields in the manifest schema is defense-in-depth against a future Phase 9+ shift to full hashes" but the *fingerprint* still consumes 7-char `__COMMIT_HASH__`.

**Why blocking.** Git's short-hash collision behavior is one of the small set of well-known long-lived-project foot-guns (Linux, Chromium, etc. all auto-extend to 8+ chars). Phase 8 ships a contract that locks 7 characters in for the lifetime of the project, and pretends that a future "shift to full hashes" is an additive change when it's actually a fingerprint-format break.

**Suggested fix.** Three steps. Pick the first two, optionally the third.

1. **Bump `__COMMIT_HASH__` to 12 characters now, before the first fingerprint ships.** Twelve hex chars is 48 bits, ~280T values; collision probability at 1B commits is ~10⁻¹². This is the same forward-compat move Linux used. Update `vite.config.ts:7` from `--short=7` to `--short=12` *as part of Phase 8.A.1*. This is a one-line `vite.config.ts` change. **It does change `__COMMIT_HASH__`** — and therefore changes `rulesetVersion` (which doesn't include `commitHash` directly but changes any test vector that does), and therefore every existing fingerprint. Since no fingerprints have shipped yet (Phase 7.B is the latest landed; no `?run=` URL is in any user's hands), this is the *correct moment* to bump. After Phase 8.B ships the routing, this exact change becomes a `rulesetVersion`-and-fingerprint-invalidating event.

2. **Pin the `commitShort` regex in the release-index schema.** Specify exactly: `commitShort: /^[0-9a-f]{12}$/` — twelve lowercase hex characters. Reject any other length at index-write and index-read time. The "commitHash alias for now" wording in the memo is dropped; `commitHash` is the same 12-char form, and a future Phase N change to a 40-char form is itself a `schemaVersion = 2` bump (decision 7's reserved schema-version bump) — *not* a silent additive change.

3. **Optionally** (defense-in-depth): include `rulesetVersion` (already pinned) and `atlasBinaryHash` (already pinned) in the per-release subtree filename, e.g. `releases/abc123def456-r<rulesetShort>/`. This makes a same-short-hash collision distinguishable. Cost: longer URLs in the redirect target. Recommend deferring unless the cost is acceptable — items 1 and 2 alone push collision probability into the irrelevant-tail.

The chicken-and-egg problem is real: Phase 1 froze 7-char `__COMMIT_HASH__` and the memo's "no `rulesetVersion` bump in 8.0" promise is incompatible with bumping it. But the bump is necessary; the right place to do it is 8.A.1's drift sweep, where it's already a `rulesetVersion` change wrapped in the existing per-phase amendment workflow. If the planner prefers to defer to a later phase, the memo must explicitly call out that Phase 8 fingerprints are 7-char-collision-vulnerable and may be invalidated at the future bump. That second option is less safe but at least honest.

### B5. The "page-load fingerprint recompute → enumerate every release in the index" routing path is a denial-of-service bait: the action-log decode happens AFTER the redirect, which means a malicious URL forces every visitor's browser to do up to 1000 SHA-256 computations before any error is shown.

**Decision affected:** decision 5 (sub-case 5a enumeration), decision 7 (`releases/index.json` size), risk R7.

**Issue.** Decision 5 sub-case 5a's algorithm is:

```
1. Load releases/index.json (~100 KB at 1000 releases, ~20 KB brotli'd over the wire).
2. For each entry, compute fingerprint(...) using parsed seed + parsed mods.
3. On match: redirect.
4. On no match: error.
```

Each `fingerprint(...)` call is `sha256(80-200 bytes)`. SHA-256 of 200 bytes in `@noble/hashes` is ~50–100 µs on a modern desktop, ~200–500 µs on a midrange phone. At N=1000 releases that's 50–500 ms of straight-line computation that **blocks the main thread before any user-visible error is shown**.

A malicious URL `?run=AAAAAAAAAAAAAAAAAAAAAA&seed=spam` (an arbitrary unmatching fingerprint) triggers the full 1000-iteration scan. A page that embeds icefall in an iframe (Phase 9 polish risk; the memo notes iframe non-coverage but doesn't enforce it) can spam-load fingerprints to lock a victim's browser tab. More mundanely, a benign-but-stale link from an old chat archive on a low-end phone produces a 1-second freeze before "no matching release" is shown.

The memo flags this as "acceptable but not ideal" (line 944) and floats a 4-char prefix index as a future optimization — but the optimization is not in 8.A.2, the linear-scan ships, and the URL is uncached: every page load redoes the whole scan, because `releases/index.json` is fetched fresh each time (no `Cache-Control` header is pinned in decision 7).

There's a separate but related issue: the `releases/index.json` fetch path itself. The router fetches `<basePath>releases/index.json` from the same origin. On `latest/` that's `/icefall/releases/index.json`. On `releases/<commit>/` Vite's per-release base would resolve relative URLs to `/icefall/releases/<commit>/releases/index.json` — which is wrong. The memo's frozen contract for decision 7 doesn't pin which URL the router fetches. If the router uses `new URL("releases/index.json", document.baseURI)`, the per-release page fetches the wrong path. If it uses `new URL("/icefall/releases/index.json", window.location.origin)`, that's hardcoded, which works on `porkchop.github.io/icefall/` but breaks on a custom domain (Phase 9 deferred polish).

**Why blocking.** The denial-of-service surface is real but mostly benign on first read. The `<base href>`-vs-absolute-path bug, however, is a load-bearing routing issue: the memo's "page-load fingerprint recompute" path does not specify how the per-release page reaches `releases/index.json`, and Vite's `base` rewrite makes the obvious relative path wrong on the per-release subtree.

**Suggested fix.** Three changes:

1. **Pin the index-fetch URL explicitly.** Decision 7's frozen contract gains:

```
RELEASES_INDEX_URL = `${origin}${BASE_LATEST_PATH}releases/index.json`

Where BASE_LATEST_PATH = "/icefall/" by default, override per
deployment via build-info.ts. The router ALWAYS fetches the
index from BASE_LATEST_PATH, never from the per-release basePath.
A custom-domain deploy (Phase 9 polish) updates BASE_LATEST_PATH.
```

This makes the index a single authoritative location regardless of which release the page is loaded from.

2. **Cache the index per page session.** Browser HTTP caching plus a manual in-memory `releaseIndexCache` keyed by `RELEASES_INDEX_URL` so two `?run=` URL evaluations (e.g. from a refresh) share the same fetch.

3. **Pre-compute fingerprints into the index.** Each entry already pins `commitHash` and `rulesetVersion`. The index-write step (8.A.3 publish-dual.mjs) cannot pre-compute the fingerprint because it doesn't know `seed` or `modIds` — but it can pre-compute *the partial pre-image SHA-256 state* up through the second NUL separator (`sha256_init(commitHash || 0x00 || rulesetVersion || 0x00)`), serialized as the 32-byte intermediate state. The router resumes from each entry's pre-state, hashes only `seed || 0x00 || sortedModIds.join(",")` (typically <50 bytes), and finalizes. This drops per-iteration cost from `sha256(200 bytes)` to `sha256(50 bytes)` and also avoids re-hashing the static prefix N times. Cost: 32 bytes × N entries in the index (~32 KB at N=1000). Total wire size still under 60 KB even at N=1000.

   This is implementable in `@noble/hashes` (the `sha256.create()` API exposes incremental state). It moves a 1000-iteration loop from ~500 ms to ~50 ms, well under the 100ms-perceptible threshold even on phones. **OR**, alternatively, just ship the 4-char-prefix lookup table the memo already mentions as a future optimization; it's a 50-line addition and brings worst-case to O(few candidates).

The DoS-via-malicious-URL surface is reduced by either #2 or #3; the `<base href>` bug is fixed only by #1 and is the truly blocking item.

### B6. Decision 8's localStorage save-slot key `icefall:save:v1:<fingerprintShort>` does not include the user's build, so a player who advances master to a new commit that bumps `rulesetVersion` finds their save silently invalidated with a "schema drift" warning — but the wire-form action log is still useful at the *previous* `releases/<old-commit>/` and there is no UI to recover it.

**Decision affected:** decision 8 (localStorage persistence), decision 5 (mismatched-build redirect), risk R6.

**Issue.** The save-slot key is `icefall:save:v1:<fingerprintShort>`. The fingerprint pre-image already includes `commitHash` and `rulesetVersion`, so a different commit with a different ruleset produces a different fingerprint — and therefore a different save-slot key. So far so good: there's no key collision.

But the save *value* (the `SaveSlot` record) records `inputs: FingerprintInputs` with the old build's `commitHash` and `rulesetVersion`. On page load at the new build (memo line 1494-1505: "On page load, after the URL parser yields `inputs`..."), the steps are:

1. URL parser yields `inputs` based on the *current* build's `commitHash` (because `?seed=` is preserved but `commitHash` is hardcoded into `build-info`).
2. Router computes `fingerprintShort = fingerprint(inputs)` *using the current build*.
3. Look up `localStorage[SAVE_KEY_PREFIX + fingerprintShort]`.

The current build's `fingerprintShort` is **different** from the old build's `fingerprintShort` (the `commitHash` differs). So the localStorage lookup misses, even though the user's save data is sitting right there under a different key.

The memo's decision 8 line 1494-1505 ("if a `#log=` URL fragment is also present, the URL fragment **wins**") only addresses the URL-vs-localStorage race, not the rulesetVersion-bump-on-master scenario. Concretely:

- Day 1, master @ commit A: user starts a run with seed `s`. Save key: `icefall:save:v1:<fp_A>`.
- Day 30, master @ commit B (atlas regen, ruleset bump): user opens `latest/`. Fresh URL `?seed=s` (no `?run=`) yields `fingerprintShort = fp_B`. Lookup `icefall:save:v1:<fp_B>` → miss. Boot fresh run.
- The `<fp_A>` slot is orphaned. The "Save Slots" UI (decision 15) enumerates *all* `SAVE_KEY_PREFIX` keys, so it lists both, but clicking "Resume" on the `<fp_A>` slot tries to verify `replayed.stateHashHex === saved.stateHashHex` *against the current build's `runScripted`*, which fails (the rules are different); the slot is deleted (memo line 1620: "if mismatch (corrupted slot, or schema drift), DELETE the slot"). The user's day-1 progress is silently destroyed.

The recovery path that *should* exist: clicking on the `<fp_A>` slot loads `releases/<commit-A>/` (the pinned old release where the rules still match) and resumes there. The memo's decision 8 doesn't describe this.

**Why blocking.** SPEC user journey 4 ("Resume after closing the tab") and the Phase 8 acceptance criterion `docs/PHASES.md:561` ("Closing and reopening the tab mid-run drops the player at the same floor with the same state hash") are violated the *first time master ships a `rulesetVersion` bump after Phase 8.B*. This will happen at every atlas regen, every sim balance tweak, every Phase 9 polish that lands. The user-visible breakage is "I closed my tab yesterday with my save; today my save was wiped."

**Suggested fix.** Two changes:

1. **Save-slot resume routes through the same release-redirect logic as URL `?run=`.** Decision 8's resume step:

```
On page load at LATEST/ (the bare deploy):
  1. Enumerate localStorage[SAVE_KEY_PREFIX + ...] keys.
  2. If the URL has ?seed= but no ?run=, AND there's a save slot whose
     SaveSlot.inputs.seed === parsed seed AND
     SaveSlot.inputs.commitHash === BUILD_COMMIT AND
     SaveSlot.inputs.rulesetVersion === BUILD_RULESET:
       → silent resume from that slot (current behavior).
  3. Otherwise, if there's a save slot whose
     SaveSlot.inputs.seed === parsed seed AND
     SaveSlot.inputs.commitHash !== BUILD_COMMIT:
       → multi-slot UI surfaces an "Open in pinned release" affordance
         that redirects to releases/<saved-commit>/?seed=... and then
         resumes from that slot (the pinned-release page has the same
         localStorage; the slot's fingerprint matches that build).
```

2. **The "Save Slots" UI's "Resume" button on a stale slot redirects, not deletes.** Decision 15's diagnostic-page Save Slots list checks each slot's `inputs.commitHash` against `BUILD_COMMIT`; a mismatch is rendered as a "Open in pinned release" link to `releases/<saved-commit>/`, not as "Resume". The "Delete" button still works. The integrity-check-fails path (decision 8 line 1619) only triggers if the slot's *own* claimed `stateHashHex` doesn't match its replayed-final-state-hash inside the *correct* build — i.e., genuine corruption — never on a `commitHash` mismatch.

This makes save-slot recovery survive `rulesetVersion` bumps, which is the entire point of the content-addressed-releases architecture. Without it, the save layer is effectively `latest/`-only, which contradicts the contract.

### B7. The `URL_LOG_THRESHOLD_CHARS = 1500` policy is calibrated against the wrong URL component: the limit that breaks shareability is the *full URL* length (including `?seed=`), not the `#log=` fragment alone — and the memo's math at lines 760–769 does not account for percent-encoded multi-byte seeds (emoji, CJK characters) which can multiply by 9× under double-encoding.

**Decision affected:** decision 4 (URL-length policy), tests required.

**Issue.** Memo lines 760-769:

```
At N = 1500, total URL ≈ 1587 chars — well under the 2000-char
practical limit for casual sharing.
```

But the `?seed=` parameter is `encodeURIComponent`'d, and `encodeURIComponent` expands characters per UTF-8 byte:

- ASCII printable (`a`-`z`, `0`-`9`, `-`, `_`, `.`, `~`): 1 char → 1 char
- Space, `+`, `&`, `?`, `=`: 1 char → 3 chars (`%20`, `%2B`, `%26`, etc.)
- Latin-1 supplement (e.g. `é`): 1 char → 6 chars (2 UTF-8 bytes × 3 chars)
- BMP CJK (e.g. `日`): 1 char → 9 chars (3 UTF-8 bytes × 3 chars)
- Emoji (e.g. `🐈` U+1F408, surrogate pair): 1 char → 12 chars (4 UTF-8 bytes × 3 chars)

The memo's example test vector at line 717 is `seed: "floor 7 cat 🐈"` — 13 visual characters that encode to:
`floor%207%20cat%20%F0%9F%90%88` = 30 chars URL-encoded. The memo's "≈ 12 chars URL-encoded" estimate at line 765 is wrong by 2.5×.

Worse: a worst-case Phase 9 daily-seed convention like `2026-05-09 — Tokyo 東京 ☔` is 26 visual chars and encodes to 87 URL chars. A 1500-char `#log=` plus 87 chars of seed plus 36 chars of `?run=` plus the 36-char base URL is 1659 chars — still under 2000, but well past the 1024-char limit several email clients impose (Microsoft Outlook 2007 wraps at 1024; Slack's link preview crops at 1900). And a *double-encoded* seed (a chat client that URL-encodes the URL again to embed it in a JSON `href`) doubles the seed length: `Tokyo%20%E6%9D%B1%E4%BA%AC` becomes `Tokyo%2520%25E6%259D%25B1%25E4%25BA%25AC`. A 1500-char log + double-encoded 100-char seed is over 2000.

Two further issues:

1. **The memo's threshold is on `wire.length`, not on full URL length.** A long seed silently moves the breakpoint without changing `wire.length`. Two players with the same actions but different seeds (`abc` vs a 100-char emoji seed) produce different shareability outcomes.

2. **Hash-fragment `#log=` is the only place the action log lives, but the URL-length-budget math conflates "fits in a tweet" (~280 chars) with "fits in an email" (~2000) with "fits in browser URL bar" (~32 KB). Decision 4's prose says "shareability ~2000" but doesn't pin which threshold the 1500-char `URL_LOG_THRESHOLD_CHARS` constant is actually serving. Twitter's 280-char limit excludes nearly every action log; the 2000-char limit covers most use cases but misses long-seed corner cases.

**Why blocking.** The threshold is in the frozen-contract list (memo line 819-820: "URL_LOG_THRESHOLD_CHARS = 1500 ... bumping is a UX tweak, not a rulesetVersion bump"). But the threshold is calibrated using the wrong metric (`wire.length` vs full-URL length); a careful planner reading the memo will conclude the threshold is sound when it's actually under-tight by 100-500 characters depending on seed.

**Suggested fix.** Three changes:

1. **The threshold is on full-URL length, not `wire.length`.** Recompute:

```
URL_FULL_LENGTH_THRESHOLD = 2000           // chars; covers email, Slack, X embed
URL_LOG_THRESHOLD_CHARS = computed at runtime from:
  full_url_budget = URL_FULL_LENGTH_THRESHOLD
                  - len(baseUrl)
                  - len(`?run=${fp}&seed=${encodeURIComponent(seed)}`)
                  - (modIds.length > 0 ? len(`&mods=${encodeURIComponent(modsCsv)}`) : 0)
                  - len(`#log=`)
  if wire.length <= full_url_budget: inline
  else: clipboard
```

This makes the policy adapt to seed/mods length, which can vary by 200+ characters depending on input.

2. **Pin the 2000-char `URL_FULL_LENGTH_THRESHOLD` constant in `src/share/params.ts`** with the rationale (Outlook ≥ 2007 truncates at 1024 — accept; modern email clients OK to 2048; Slack OK to 2900; Twitter X 4000-char paid; Discord 4000; the binding constraint is older email clients and the conservative practical limit).

3. **Add a `URL_FULL_LENGTH_HARD_CAP = 32000` constant** above which even the clipboard form is refused with `"share: this run's action log exceeds the 32-KB safe-share limit; export via 'Download log' as a .ice-log file"` (a Phase 9 deferred fallback that's at minimum hinted at). Without a hard cap, an adversarial fingerprint URL can push the URL bar past Chrome's 32K limit and crash the navigation.

The seed-encoding test fixture should be updated: the existing `tests/url/url-parser.test.ts` (decision 3 line 716) exercises `floor 7 cat 🐈` for round-trip; add fixtures for double-encoded seeds and for >100-char emoji seeds, with assertions on the threshold-driven URL-vs-clipboard decision.

### B8. The "no `rulesetVersion` bump in Phase 8.0" promise is silently violated by decision 14's "if 8.A.1 surfaces a surprise — e.g., a new file inadvertently affects sim output via a static const that's imported — the classification flips and the file enters `RULES_FILES`. This would be a `rulesetVersion` bump." This is a non-binding aspiration, not a contract.

**Decision affected:** decision 14 (`RULES_FILES` impact), decision 17 (Phase 8.A.1 deliverables), risk register.

**Issue.** Decision 14 (memo line 2081-2144) is structured as: "anticipated outcome: no new entries in `RULES_FILES` for Phase 8. (If 8.A.1 surfaces a surprise — ...)". The closing sentence says "This would be a `rulesetVersion` bump, since the existing fingerprint chain wouldn't include the new file" (line 2134-2136). The memo's headline summary at line 70-78 declares "**No `rulesetVersion` bump is in scope for Phase 8.0 (this memo).**"

These are inconsistent. The "anticipated" qualifier in decision 14 cannot bind without a *gate* — i.e., a test, a CI check, or a sandbox-verifiable assertion that fires *before* code lands. The memo lists the gate as "8.A.1's drift sweep" but doesn't describe how the sweep makes the determination. Concretely:

- **What surfaces a "surprise"?** A new `src/share/encode.ts` that imports `import { ITEM_TYPES } from "../registries/items"` to look up item display names *might* affect sim output (depending on what it does), or might not. No automated check distinguishes.
- **The memo's self-test discipline (Phase 1's `RANDOM_WALK_DIGEST` chain through Phase 7's `WIN_DIGEST`) catches a sim-byte change but only at test-running time. If 8.A.2 lands a new file that *does* affect sim output, `WIN_DIGEST` changes and the cross-runtime self-test fails, blocking the build. But by then the file is in the codebase under a `RULES_FILES`-classification decision that was made *before* the test ran. The remediation is an addendum that updates `RULES_FILES`, bumps `rulesetVersion`, and re-pins `WIN_DIGEST` — exactly the "rulesetVersion bump in Phase 8.0" the memo claims is out of scope.
- **There is no reverse check.** A new file that *should* be in `RULES_FILES` but accidentally isn't (because the planner judged it doesn't affect sim output) does not trip any gate. The next ruleset bump for *unrelated* reasons silently rolls in the missing file's contribution.

The memo's risk R10 ("Verification of mod-bearing fingerprints in Phase 9+") doesn't address this; risk R2 ("Action-log encoding drift") doesn't address it.

**Why blocking.** This is the same defect class as Phase 4 B1 (transient sentinel slipping past): a phase-split decision is asserted as enforced ("no rulesetVersion bump in 8.0") but the enforcement mechanism is hand-waved, and the discovery path is "the cross-runtime test happens to fail" — which is too late, because by the time the test fails the offending file is already in `RULES_FILES` ↔ `rulesetVersion` ↔ `fingerprint` lockstep, and unwinding requires a phase-revisit.

**Suggested fix.** Three changes to decision 14 + decision 17:

1. **`RULES_FILES`-classification rule is mechanical, not editorial.** A new file enters `RULES_FILES` if and only if it is reachable from `runScripted` (Phase 3 frozen contract: the only path that advances `RunState`) via static imports. The reachability is computed by:

```
src/sim/harness.ts → import graph → expand → final set
intersect with src/atlas/** → final set
intersect with src/registries/** → final set
union with anything else reachable
```

This is implementable as a CI check in `tests/build/rules-files-reachability.test.ts` (8.A.1 deliverable) using `madge` or a hand-rolled import-graph walker. The check fails if any file reachable from `src/sim/harness.ts` is NOT in `RULES_FILES`, OR if any file in `RULES_FILES` is NOT reachable.

2. **The Phase 8 invariant becomes:** "Phase 8.A.2 lands no file reachable from `src/sim/harness.ts` that is not already in `RULES_FILES`. The `rules-files-reachability` test enforces this in CI; a violation is an architecture-red-team review event before merge." This is a stronger commitment than "anticipated."

3. **If 8.A.2 *does* land a reachable file** (e.g. `src/share/encode.ts` if it ends up imported by `src/sim/harness.ts` for some reason), the addendum to this memo records the file, lists what `rulesetVersion` becomes, and updates the cross-runtime golden chain. **This is then a `rulesetVersion` bump and Phase 8.0 ceases to be the "no bump" planning gate.** That's fine — the project still lands — but it must be honest about what shipped, not pretend it didn't.

The "verifier-imports-from-sim" risk is real: decision 12's layer table (memo line 1979) says `src/verifier/` may import `src/sim/harness` (for `runScripted`). If verifier ships, and verifier imports harness, and verifier is deployed in the bundle, then the verifier IS reachable-from-harness in the reverse-import sense — and if the verifier imports anything that isn't already in `RULES_FILES`, that thing is now reachable too. The memo handwaves this. The reachability test makes it explicit.

### B9. The "first 8.A.3 deploy ever" bootstrap path (chicken-and-egg) is described but the mitigation has a critical race window: between the first 8.A.3 push and the first subsequent push, any user who lands on a `?run=` URL minted by the 8.A.3 commit gets a working redirect, but any URL minted before 8.A.3 lands has *no* corresponding pinned release subtree — and the memo's redirect logic falls through to `ROUTE_ERR_NO_MATCHING_RELEASE` with a misleading "may not yet be published (try refreshing in a minute)" message that will *never* be true.

**Decision affected:** decision 17 (Phase 8.A.3, "the chicken-and-egg issue"), decision 5 (sub-case 5d), decision 7 (first-deploy bootstrap).

**Issue.** Decision 17 line 2289-2295 acknowledges the issue:

> The first 8.A.3 deploy creates the first `releases/<commit-short>/` entry. The 8.A.2 build (one commit prior) is now retroactively the "first old release" — but it was deployed to `latest/` only, so there's no pinned subtree to redirect to. This is the chicken-and-egg issue.

The mitigation at line 2342-2347 ("the 8.B "stranger" test deliberately uses a `?run=` generated *at the 8.A.3 commit* against the `latest/` build, so the routing path matches without needing prior history") solves the *test path* but not the *user-visible path* during the live window between 8.A.2 and 8.A.3:

1. **8.A.2 lands on master.** The build at master @ 8.A.2's commit includes the URL parser, the share UI, the verifier — but NOT the dual-build CI extension. So `latest/` serves the 8.A.2 build; users can mint and share `?run=<fp_8.A.2>` URLs. There's no `releases/<commit-8.A.2>/` subtree because 8.A.3's CI extension hasn't shipped.

2. **8.A.3 lands on master.** The CI extension publishes `releases/<commit-8.A.3>/` for the first time. `releases/index.json` contains exactly one entry: the 8.A.3 commit. `latest/` is now the 8.A.3 build.

3. **A user who minted `?run=<fp_8.A.2>` at step 1 opens the URL at step 2.** The page loads at `latest/` (the 8.A.3 build). The fingerprint recompute against `commitHash_8.A.3 + ruleset_8.A.3 + parsed_seed + parsed_mods` doesn't match `<fp_8.A.2>`. Sub-case 5a's enumeration loops over `releases/index.json` — which has only the 8.A.3 entry. No match. Falls through to `ROUTE_ERR_NO_MATCHING_RELEASE`.

   The error string says: `"this run was created with a different build than 'latest'; no matching pinned release was found in releases/index.json — the release may not yet be published (try refreshing in a minute) or may have been pruned"`.

   But it WILL never be published. The 8.A.2 commit is on `gh-pages` history but only as `latest/`-at-the-time; there is no `releases/<commit-8.A.2>/` subtree and there will never be. The "try refreshing in a minute" hint is never going to help.

The 8.A.2-shared URL is permanently broken. The "stranger on a different machine" test that 8.B promises won't catch this either (the 8.B test uses an 8.A.3-minted fingerprint).

**Why blocking.** SPEC user journey 2 ("Replay a friend's run") — "Player clicks a shared link. Game loads with seed pre-filled; the linked release is served from `releases/<commit>/`" — is broken for every URL minted between 8.A.2 landing and 8.A.3 landing. The window is short (a single commit on master) but its duration is unbounded if 8.A.3 is delayed for any reason (a 8.A.2 follow-up code review pause, a holiday weekend, an unrelated CI failure). The user-visible failure is silent: a misleading error message that suggests time will help when it won't.

**Suggested fix.** Two structural options; pick one.

**Option A (recommended): Disable URL minting in 8.A.2.** The "Share This Run" button, the URL canonicalization on page load, and the URL formatter (decision 4 + decision 6) ship in 8.A.2 *as functions* but the in-page UI that exposes them to users ships only in 8.A.3 alongside the dual-build CI. Concretely:

- 8.A.2 ships `src/share/share-url.ts` (the formatter), `src/router/url-parse.ts` (the parser), and tests.
- 8.A.2's diagnostic page does NOT have a "Share This Run" button. The verify-pasted-log + replay-mode UIs ship; the URL-share UI does not.
- 8.A.3 lands the dual-build CI AND the in-page "Share This Run" button in the same commit. The first user-visible URL share is therefore at 8.A.3, and the corresponding pinned release exists by construction.

Cost: one extra commit's worth of UI plumbing carried-over to 8.A.3. Benefit: zero windows of unloadable URLs.

**Option B: Bootstrap `releases/index.json` with the prior commit's `latest/`.** 8.A.3's first publish-dual run also reads master's *previous* `latest/` deploy (the 8.A.2 build, served at `gh-pages` HEAD when 8.A.3's deploy starts), copies its assets into `releases/<commit-8.A.2>/`, and adds an entry to `releases/index.json`. This requires the 8.A.3 CI to fetch `commitHash_8.A.2` and `rulesetVersion_8.A.2` from the prior commit — which is in the deployed `latest/build-info.js` and accessible.

Cost: 8.A.3's publish-dual.mjs needs to handle "prior commit's latest" specifically, which is a one-time bootstrap that's hard to test (it only runs once, at the first 8.A.3 publish). Benefit: 8.A.2-minted URLs work.

Option A is cleaner and tests-cleanly. Option B addresses the issue more comprehensively (it also handles a hypothetical race where 8.A.2's in-page URL share is exposed to early adopters). Recommend Option A as the planning-gate disposition.

**Update decision 5d's error message** in either case: when the only reason a URL doesn't match is "the URL was minted before per-release pinning was live," the message should say `"router: this run was created with a build that predates per-release pinning; the run can be replayed by visiting the original sharer's bookmark or re-creating with seed '<seed>' on 'latest/'"` — not the misleading "try refreshing" text.

## Non-blocking advisories

### A1. `releases/index.json`'s `publishedAt: ISO-8601 UTC` field is the only wall-clock value in the project, and the memo says it lives "outside `src/sim/`, `src/mapgen/`, `src/atlas/` (the lint-banned scopes), inside `src/router/`" — but `src/router/` is also lint-banned `Date.*` per the layer table at memo line 1124. Pin the exception explicitly.

The memo's layer table (decision 12, line 1978) bans `Date.*` in `src/router/`. But decision 7's `publishedAt` field is generated at deploy time, and the router *reads* it at `index.json`-fetch time. Reading an ISO-8601 string is not a `Date.*` call (it's a `string`); but if any sort-by-recency code does `new Date(entry.publishedAt) - new Date(other.publishedAt)`, that's a `Date` constructor call inside `src/router/`. Pin: "the router treats `publishedAt` as an opaque ISO-8601 *string* and sorts lexicographically (which is correct for ISO-8601 UTC); no `Date` constructor is invoked in `src/router/`." Add a lint test under `tests/router/no-date.test.ts`.

### A2. The "`#log=` is invisible to Discord's link-preview crawler" privacy claim is correct for Discord today but not a guarantee — pin the privacy-property as a *desideratum*, not a *contract*.

Decision 3 (memo line 588-597) leans heavily on the privacy property: "The hash fragment `#...` is **never sent to the server**, never seen by analytics, never captured in HTTP referer headers leaving the browser, and never appears in CDN logs." This is true today across all major browsers and all major static-host CDNs, but it's a property of *every consumer* of the URL, not of the URL itself. A maliciously-crafted Slack integration can scrape the hash fragment via JavaScript on the destination page; a future browser feature (e.g. some hypothetical "share this URL with full content for accessibility" affordance) might leak it. The memo should say: "Phase 8 *relies on* the hash-fragment privacy property as it currently exists; if a future consumer leaks the fragment, the contract becomes 'the action log is shareable in clear text on URL-sharing platforms,' which is fine — there's no secret material in the action log — but is a UX regression worth flagging."

This is a one-paragraph clarification in decision 3.

### A3. `?seed=` standalone in `latest/` (decision 11) silently locks the run to the *current* `latest/` build's `rulesetVersion`, but a user who shares the resulting URL after running has shipped a fingerprint URL whose `?run=` was *never minted* — so a Phase 9 atlas regen will silently change the dungeon for anyone clicking the link.

Decision 11 (memo line 1920-1969) says: "When the URL has `?seed=...` but no `?run=`, the page boots a fresh run with the given seed." Fine. Then the user clicks "Share This Run" and the URL becomes `?run=<fp>&seed=<s>...` — which is correctly bound to the current commit. Good.

But the SPEC user journey 5 ("Daily seed: tweet `?seed=2026-05-03`") deliberately strips the `?run=` part. The recipient of a daily-seed URL boots a fresh run *against whatever `latest/` happens to be at click time*. If the daily-seed URL goes viral and `latest/` ships a `rulesetVersion` bump on day 2, the day-2 visitors play a different dungeon than day-1 visitors despite the same `?seed=`.

This is correct per the SPEC's "informal" framing of the daily-seed convention — but the memo's decision 11 doesn't pin it as informal. A reviewer reading "Phase 8 supports the daily-seed convention" could reasonably conclude that it provides reproducibility; it provides reproducibility only within a single `latest/` cohort. Add a note: "The `?seed=` standalone path is *informally* reproducible — it binds to whatever `latest/` is at click time, NOT to a pinned release. To bind to a specific release, the sharer must mint a full `?run=&seed=` URL via 'Share This Run'. Phase 9 daily-seed UX may pin a "release-of-the-day" link to a specific `releases/<commit>/?seed=<date>` for true reproducibility."

This is a one-paragraph addition to decision 11.

### A4. The `expectedAtlasBinaryHash` field of `VerifyArgs` is described as "informational" and only checked "if the verifier is running inside a build context that injects the constant" (memo line 1799-1803) — but the verifier's three runtimes (browser, Node CLI, in-test) don't all have a build context.

Decision 10's pseudocode at line 1796-1803:

```
if args.expectedAtlasBinaryHash !== undefined:
  // The verifier doesn't have access to the atlas binary; this
  // check is informational. The build-info module's
  // atlasBinaryHash is asserted equal to args.expectedAtlasBinaryHash
  // only if the verifier is running inside a build context that
  // injects the constant.
  if expectedAtlasBinaryHash !== buildInfo.atlasBinaryHash:
    return { kind: "atlas-mismatch", ... };
```

`buildInfo.atlasBinaryHash` is always defined (`src/build-info.ts:28-31` — the `EMPTY_SHA256` fallback). So the comment "only if the verifier is running inside a build context that injects the constant" is wrong; the condition always evaluates. The Node CLI verifier (`tools/verify.ts`) imports `src/build-info` like everything else, so it gets `EMPTY_SHA256` if `__ATLAS_BINARY_HASH__` is undefined at vite-node-time, which then *always* fails the `expectedAtlasBinaryHash` check (because no real fingerprint's expected hash is `EMPTY_SHA256`). Pin: "the Node CLI verifier reads `--atlas-binary-hash=` as an explicit CLI argument; if absent, the `atlas-mismatch` check is skipped (the kind is not returned). The browser verifier always uses `buildInfo.atlasBinaryHash`."

This is a one-line clarification in decision 10's pseudocode plus a CLI flag in `tools/verify.ts`.

### A5. The 8 (now 9, see B3) pinned error strings are pinned in `src/router/messages.ts` but the prose-vs-code distinction (em-dash U+2014, exact substitution variables) doesn't pin the **substitution rule** for ill-formed inputs — e.g., a `<repr>` substitution for `?run=` content that contains a non-printable byte.

Decision 5's `ROUTE_ERR_FP_INVALID = "url: ?run= must be 22 base64url characters (got <N>: <repr>)"`. The `<repr>` is "the input string" — but if the input string contains a literal newline or a Unicode RTL-override character, the error message is mangled in the diagnostic page's display. Phase 4 addendum N7 pinned the em-dash; Phase 8 should pin the **`<repr>` rendering**: 

```
<repr> is computed as:
  json.stringify(value).slice(0, 64) + (json.stringify(value).length > 64 ? "..." : "")
```

This makes the substitution unambiguous (JSON-escaping handles every non-printable, every quote, every backslash) and length-bounded. Without it, a malicious URL `?run=<a-hostile-string>` can inject content into the error display.

Add a test fixture: `?run=` with a literal newline in the URL-decoded form should produce a `\n`-rendered `<repr>`, not a multi-line error message.

### A6. The `__SHARE_LOG_LENGTH__` window flag (decision 15) is "pinned at landing time as defense-in-depth" (memo line 2611-2613) — but the pin applies only to the `WIN_LOG`-specific length, and the test fixture is the WIN_LOG. There's no pinning for shorter logs (which most actual users will produce).

Decision 13 + decision 15's pinning of `__SHARE_LOG_LENGTH__` is for `WIN_LOG = 1217 actions`. But the typical floor 1-4 death log is ~50-200 actions, and the URL-vs-clipboard threshold (decision 4) is calibrated against ~600-700 actions. There should be a *family* of pinned lengths:

- WIN_LOG (1217 actions) → pinned wire length WL_W
- Synthetic 100-action log → pinned wire length WL_100
- Synthetic 600-action log (right at threshold) → pinned wire length WL_600

The cross-runtime test asserts each. Without WL_100 and WL_600 pinned, a regression in the per-action codec (e.g., a future `pickup` action gaining a field that adds 5 bytes per occurrence) is caught only by `WIN_LOG`'s length, which is dominated by `move` and `attack`; the regression in `pickup`-heavy short logs slips through.

This is a 8.A.2 deliverable add; one-line to decision 13.

### A7. Phase 8.A.3's `scripts/publish-dual.mjs` "fetch the previous deploy's `releases/index.json` via the GH-Pages URL" (memo line 1462-1465) is brittle: the previous deploy's URL may not resolve at publish time (DNS propagation, CDN cache miss after deploy, the very first 8.A.3 deploy when the URL doesn't exist).

The bootstrap path is described at line 1463-1465: "If the fetch fails (e.g., first deploy ever), initialize an empty index." Better: read from the local `gh-pages` checkout that the deploy is updating. The CI workflow has access to the prior `gh-pages` HEAD via `actions/checkout@v4` with `ref: gh-pages`; the index can be read directly from the working tree, avoiding the network round-trip and its associated failure modes (DNS, TLS, HTTP). Restate the publish-dual algorithm:

1. Checkout the existing `gh-pages` branch HEAD into a side directory.
2. Read `gh-pages-side/releases/index.json` (initialize empty if absent).
3. Append the new entry, write to `dist-publish/releases/index.json`.
4. Merge `dist-publish/` with the GH-Pages-side existing tree (preserving every prior `releases/<commit>/` subtree).
5. `actions/upload-pages-artifact@v3` uploads `dist-publish/`.

This avoids the fetch-from-public-URL fragility entirely.

## Questions the memo must answer (collected, in priority order)

1. **Compression function.** `fflate.zlibSync` or `fflate.deflateSync`? (B1)
2. **Decoder contract.** What is `decodeAction`'s exact behavior on unknown tags, tag-order violations, and truncated payloads? (B2)
3. **Mismatched-version disambiguation.** How does the router distinguish "wrong build" from "tampered seed"? (B3)
4. **Commit-hash collision strategy.** Is 7 chars sufficient forever, or is 8.A.1 the right place to bump to 12? (B4)
5. **Index fetch URL.** Per-release page's relative-URL fetch of `releases/index.json` resolves to what? (B5)
6. **Save-slot recovery on `rulesetVersion` bump.** What happens to a slot whose build is no longer `latest/`? (B6)
7. **URL-length budget.** Is `URL_LOG_THRESHOLD_CHARS` calibrated against `wire.length` or full-URL length? (B7)
8. **`RULES_FILES` enforcement.** Mechanical reachability test, or editorial judgment? (B8)
9. **First-8.A.3-publish window.** What happens to URLs minted at 8.A.2 between the two phase commits? (B9)

## What the memo gets right

For balance, the memo's load-bearing strengths:

1. **Phase split (8.0 → 8.A.1 → 8.A.2 → 8.A.3 → 8.B) mirrors Phase 4's exactly,** with the same justification (sandbox-verifiable JS vs CI-only). Decision 17's "Why split 8.A.2 from 8.A.3" prose is the strongest single decision in the memo.

2. **Hash-fragment-vs-query-string privacy argument** (decision 3) is the right separation of concerns. Server-log privacy of action logs is a concrete property the project gets for free by following the established Google-Docs-style URL pattern.

3. **`verify(...)` discriminated-union return** (decision 10) is the right shape, and the seven-kind enumeration is exhaustive for v1 (with B3's ninth error string addition, it expands cleanly without breaking the additive-kind contract).

4. **Mod-ID slot exercise without format change** (decision 1 + 1a) preserves the Phase 1 frozen contract while pinning the test-vector evidence that the slot works. The synthetic mod-ID test vector approach is the right discipline.

5. **`REPLAY_DIGEST === WIN_DIGEST` as the codec round-trip pin** (decision 13) is clever — it costs zero new test fixtures because `WIN_DIGEST` is already the cross-runtime golden, and adds defense-in-depth at the codec layer.

6. **Layer additions (decision 12) follow the same lint-scoped discipline as `src/atlas/**` and `src/sim/**`,** with the deterministic-pure constraint preserved (modulo isolated `localStorage` / `window.location` / `navigator.clipboard` helpers).

7. **The deferred-items list at memo line 2796-2828 is honest and complete.** Title screen, daily-seed UX, pruning automation, schema v2 migration, multi-machine sync, drag-and-drop import — all correctly punted. SPEC principle 6 (no backend) is honored throughout.

The memo's biggest structural strength is that almost every decision has a "Frozen contract" block with byte-exact pinning. The blockers above are about the bytes that are *missing* from those blocks, not about decisions that are wrong.

---

## Addendum to paste into decision-memo-phase-8.md

> The following addendum resolves blockers B1–B9 from the architecture-red-team review at `/workspace/artifacts/red-team-phase-8.md`. It supersedes the prose of decision 2 (compression function), decision 5 (mismatched-version disambiguation), decision 7 (commit-hash length, index-fetch URL, bootstrap-from-local), decision 8 (save-slot recovery), decision 4 (URL-length policy), decision 14 (`RULES_FILES` enforcement), and decision 17 (8.A.3 first-deploy window).

### Addendum B1 (resolves red-team B1) — compression function is `fflate.zlibSync`, NOT `fflate.deflateSync`

Decision 2's "Wire form" prose, the "Decoder" pseudocode, and frozen-contract item 2 are amended to read:

```
Wire form:  base64url(fflate.zlibSync(envelope, { level: 1 }))
Decoder:    fflate.unzlibSync(base64urlDecode(s))
```

`zlibSync` is the same function `src/atlas/png.ts:19` already uses; the cross-runtime byte-identity claim "inherited from Phase 4" is therefore *test-supported* by the existing `cross-os-atlas-equality` matrix. `deflateSync` is byte-distinct and never to be used in `src/share/**`; lint-enforce via `no-restricted-imports` adding `{ name: "fflate", importNames: ["deflateSync", "inflateSync"] }` to the existing rule.

A new self-test `action-log-cross-runtime` is added to `src/core/self-test.ts` and pinned at first-green 8.A.2 CI: a known 8-byte action envelope (`"ICE\x01" + u32(0)` — empty action list) is run through `zlibSync(level=1)` and the resulting base64url-encoded bytes are asserted to match a hardcoded golden across chromium / firefox / webkit / Node 20 inside the cross-OS matrix. Pinning this constant ahead of any user-facing share button minted a real action log.

### Addendum B2 (resolves red-team B2) — `decodeAction` contract, byte-explicit

Decision 2 gains a new sub-section after frozen-contract block:

```
decodeAction(bytes: Uint8Array, offset: number) → { action: Action; bytesConsumed: number }

Validation rules (all rejections produce pinned error strings under the
prefix "decodeAction: " for Phase 4-style exact-match testing):

  1. bytes[offset] === ACTION_VERSION (0x01); else throw
     "decodeAction: unsupported action version <v> at offset <i>"

  2. type_len = bytes[offset+1]; require type_len ∈ [1, 64]; else throw
     "decodeAction: type_len <n> out of range [1, 64] at offset <i>"

  3. type_bytes are the next type_len bytes; must be well-formed UTF-8
     (decoder does NOT validate semantics — type values are passed through
     to the action runner unchanged); insufficient bytes throw
     "decodeAction: truncated type at offset <i> (need <n>, have <m>)"

  4. After the type, optional fields are parsed in tag order:
     - previousTag = 0 (sentinel below TAG_TARGET=0x10)
     - On reading any byte tag T:
       - T must be in {TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30}; else
         throw "decodeAction: unknown tag 0x<hh> at offset <i> (this build
         supports v1 tags 0x10, 0x20, 0x30 only — load 'releases/<commit>/'
         for the build that produced this log)"
       - T must be > previousTag (strict ordering); else throw
         "decodeAction: tag 0x<hh> appears after tag 0x<prev> at offset <i>
         (tags must be strictly increasing)"
       - The tag's payload is read with strict length matching (4 bytes
         int32 LE for TAG_TARGET; 1+N bytes [item_len][item_bytes] for
         TAG_ITEM, with item_len ≤ 255; 1 byte 0..7 for TAG_DIR);
         insufficient bytes or out-of-range payload throws
         "decodeAction: truncated tag 0x<hh> payload at offset <i>"
       - previousTag := T

  5. Action ends when bytes[offset+bytesConsumed] is either:
     - the next ACTION_VERSION byte (start of next action), OR
     - past the end of the buffer.
     The decoder relies on ACTION_VERSION (0x01) being byte-distinct from
     {TAG_TARGET=0x10, TAG_ITEM=0x20, TAG_DIR=0x30}; this property is part
     of the Phase 1 frozen contract and is not at risk under additive
     tag extension (new tags must be > 0x30 and < 0xFF, never 0x01).

Phase 8 v1 decoder REJECTS unknown tags (4. above). This forces forward-
compatibility through release pinning: a Phase 9 build that adds a new tag
publishes its own release subtree; a Phase 8 user clicking that build's
fingerprint URL is redirected via `releases/<commit>/` (decision 5) to
the build that supports the new tag. The "skip unknown tag" alternative
silently corrupts action sequences and is explicitly forbidden.
```

Test fixtures listed at addendum B2-tests (8.A.2 deliverable):

- positive: action with no optional fields
- positive: action with TAG_DIR only
- positive: action with TAG_TARGET + TAG_ITEM + TAG_DIR
- REJECT: type_len = 0
- REJECT: type_len = 65
- REJECT: tag 0x40 (forward-compat unknown)
- REJECT: TAG_DIR (0x30) before TAG_ITEM (0x20)
- REJECT: TAG_DIR appearing twice
- REJECT: item_len causing read past buffer end

### Addendum B3 (resolves red-team B3) — ninth error string, two-phase router enumeration

Decision 5's error vocabulary gains a ninth string:

```
export const ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED =
  "router: this run's fingerprint matches no release at the supplied seed
   '<seed-repr>'. Either the seed was edited after sharing, the URL was
   double-encoded by an email or link-shortener, or the build that
   produced the fingerprint was never published. Try opening the original
   sharer's URL or use 'New Run' with this seed.";
```

Decision 5 sub-case 5a's algorithm gains a phase-2 retry:

```
1. Phase-1 enumeration (existing, unchanged):
   For each commit-short in releases/index.json (newest-first):
     compute candidate = fingerprint({ commitHash, rulesetVersion, seed: parsedSeed, modIds: parsedModIds })
     if candidate.slice(0,22) === parsedRun: redirect; return.

2. Phase-2 retry (NEW):
   For each commit-short in releases/index.json (newest-first):
     compute candidate2 = fingerprint({ commitHash, rulesetVersion, seed: parsedSeed, modIds: [] })
     if candidate2.slice(0,22) === parsedRun:
        // Hit: ?mods= was tampered or stripped.
        throw ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED with seed-repr = parsedSeed.

3. Final: no candidate matched. Throw ROUTE_ERR_NO_MATCHING_RELEASE.
```

The phase-2 retry costs O(N) extra hashes only on the failure path (which is already user-visible-error-pending), so the latency impact is bounded by a single extra full enumeration. Combined with Addendum B5's incremental-state optimization, total cost is ~100 ms even at N=1000.

### Addendum B4 (resolves red-team B4) — bump `__COMMIT_HASH__` to 12 characters in 8.A.1

Phase 8.A.1's drift sweep includes a one-line `vite.config.ts` change: `git rev-parse --short=7 HEAD` → `git rev-parse --short=12 HEAD`. This changes `__COMMIT_HASH__` from 7 hex chars to 12 hex chars. The fingerprint pre-image is byte-changed (the commitHash UTF-8 bytes are 5 bytes longer); `WIN_DIGEST` is unchanged (fingerprints are not in the digest), but a new test vector for the 12-char commit-hash form is pinned in `tests/core/fingerprint.test.ts`.

`vitest.config.ts`'s `define` block matches; the test fixtures' `commitHash: "abc1234"` strings are updated to `commitHash: "abc1234def56"` (a synthetic 12-char form).

Decision 7's `releases/index.json` schema is amended:

```
ReleaseEntry = {
  commitShort:    string matching /^[0-9a-f]{12}$/;   // 12-char short hash
  commitHash:     string matching /^[0-9a-f]{12}$/;   // alias of commitShort for v1
                                                      // a future bump to 40-char full hash
                                                      // is a schemaVersion = 2 event
  rulesetVersion: string matching /^[0-9a-f]{64}$/;   // 64-char SHA-256 hex
  atlasBinaryHash: string matching /^[0-9a-f]{64}$/;
  publishedAt:    string matching /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
}
```

The strict regex on each field is asserted by the parser (`tests/build/release-index.test.ts`).

This *is* a fingerprint-format change; it is recorded as such in this addendum. **Phase 8.A.1's drift sweep therefore DOES bump every existing fingerprint** (from 7-char-commit pre-images to 12-char-commit pre-images), but since no `?run=` URL has shipped to any user (Phase 7.B is the latest landed phase; URL routing is 8.A.2), no live URL is invalidated. This is the *correct moment* to bump.

The memo's headline summary at lines 70-78 ("No `rulesetVersion` bump in Phase 8.0") is amended to:

> Phase 8.0 (this memo) is a planning gate; no code changes. Phase 8.A.1's drift sweep bumps `__COMMIT_HASH__` from 7-char to 12-char short hash, which changes `commitHash` in the fingerprint pre-image but does NOT change `rulesetVersion` (which derives from `rulesText` + `atlasBinaryHash`, neither of which include `commitHash`). The 12-char bump is a *forever-collision-resistant* pin and is documented in `docs/PROD_REQUIREMENTS.md`'s Reliability section.

### Addendum B5 (resolves red-team B5) — index-fetch URL pinning + caching + incremental-state optimization

Decision 7's frozen contract gains:

```
RELEASES_INDEX_URL: string =
  `${origin}${BASE_LATEST_PATH}releases/index.json`

where BASE_LATEST_PATH = "/icefall/" by default, overridable via a
build-time constant exported from src/build-info.ts. Custom-domain
deploys (Phase 9 polish) update BASE_LATEST_PATH at build time.

The router ALWAYS fetches the index from BASE_LATEST_PATH, never from
the per-release basePath (regardless of whether the page itself is
loaded from latest/ or releases/<commit>/).

Caching: per-page-session in-memory cache keyed by RELEASES_INDEX_URL.
HTTP Cache-Control on the index file is set to
'public, max-age=300, stale-while-revalidate=86400' at the GH-Pages
deploy step (decision 7 pin in 8.A.3).
```

Decision 5's enumeration optimization (8.A.2 deliverable):

```
When releases/index.json is published (8.A.3 publish-dual.mjs), each
ReleaseEntry's pre-image partial-state is precomputed:

  { commitShort, commitHash, rulesetVersion, atlasBinaryHash,
    publishedAt,
    fpPrefixHashState: base64url(sha256_partial(
      utf8(commitHash) || 0x00 || utf8(rulesetVersion) || 0x00
    ))                                                  // 32 bytes encoded
  }

The router's enumeration loop resumes from each entry's
fpPrefixHashState, hashes only utf8(parsedSeed) || 0x00 ||
utf8(parsedModsCsv), and finalizes — dropping per-iteration cost from
sha256(200 bytes) to sha256(50 bytes). At N=1000 entries this is ~50ms.

Implementation: src/core/hash.ts gains sha256_resume(state: Uint8Array,
suffix: Uint8Array): Uint8Array (a thin wrapper over @noble/hashes's
sha256.create() with state-loading). Lint-banned outside src/core/ and
src/router/.
```

Per-release subtree's relative-URL access of `releases/index.json` is fixed by the absolute-URL pin above; no `<base href>` interaction.

### Addendum B6 (resolves red-team B6) — save-slot resume routes through release-redirect

Decision 8's resume algorithm is amended:

```
On page load (any URL):
  1. Compute parsedInputs from URL parser (decision 6).
  2. Compute fingerprintShort = fingerprint(parsedInputs) (under
     CURRENT BUILD's commitHash + rulesetVersion).
  3. Look up localStorage[SAVE_KEY_PREFIX + fingerprintShort].
  4. If present and integrity-check passes:
     → silent resume (existing behavior).
  5. If absent:
     → enumerate ALL localStorage[SAVE_KEY_PREFIX + ...] keys.
     → for each slot, parse the SaveSlot record.
     → if any slot has SaveSlot.inputs.seed === parsedInputs.seed AND
       SaveSlot.inputs.commitHash !== CURRENT_BUILD.commitHash:
         → this is a STALE-RELEASE slot. Surface in the multi-slot UI:
           "Found a save for seed <s> from build <commitShort>; open
           in pinned release?" — clicking redirects to
           releases/<savedCommit>/?seed=<s> via window.location.replace.
         → after redirect, the per-release page's load step computes
           fingerprintShort under the matching build, and step 3 hits.
     → otherwise: boot fresh from seed (existing behavior).

The integrity-check-fails path (replayed.stateHashHex !== saved
.stateHashHex) ONLY triggers inside step 4 — i.e., when the slot's
build matches the current build but the replay disagrees. A
build-mismatched slot is NEVER deleted by the integrity-check path;
it is preserved indefinitely so the user can always recover by
visiting the pinned release.
```

Decision 15's "Save Slots" diagnostic-page UI is amended: stale-release slots render a "[Open in pinned release]" link, not a "Resume" button.

### Addendum B7 (resolves red-team B7) — URL-length threshold is on full-URL length, not `wire.length`

Decision 4's frozen contract is replaced with:

```
URL_FULL_LENGTH_THRESHOLD = 2000          // chars; covers email, Slack, X embed
URL_FULL_LENGTH_HARD_CAP  = 32000         // chars; refuses share above this

Sharing UI behavior:
  let wire        = encodeActionLog(actions)
  let sharePath   = formatSharePath(inputs)   // ?run=&seed=&mods=
  let baseUrlLen  = baseUrl.length
  let pathLen     = sharePath.length
  let logFragLen  = "#log=".length + wire.length

  let fullUrlLen  = baseUrlLen + pathLen + logFragLen

  if fullUrlLen <= URL_FULL_LENGTH_THRESHOLD:
    shareUrl = baseUrl + sharePath + "#log=" + wire
    uiMode = "url-only"
  else if (baseUrlLen + pathLen) + 5 + wire.length <= URL_FULL_LENGTH_HARD_CAP:
    shareUrl = baseUrl + sharePath
    uiMode = "url-plus-clipboard-log"
  else:
    shareUrl = baseUrl + sharePath
    uiMode = "url-plus-export-log"
    showError "share: this run's action log exceeds the 32-KB safe-share
               limit; export via 'Download log' as a .ice-log file"
    // Phase 9 polish: implement download. Phase 8 surfaces only the error.
```

Test fixtures gain:

- seed `"floor 7 cat 🐈"` (4-byte UTF-8 emoji) round-trip
- seed `"2026-05-09 — Tokyo 東京 ☔"` (mixed CJK + symbols + dashes)
- double-encoded seed (chat-client autolinker scenario)
- WIN_LOG with 100-char emoji seed asserts `uiMode === "url-plus-clipboard-log"` (the seed pushes past 2000)

### Addendum B8 (resolves red-team B8) — `RULES_FILES` reachability is mechanical and CI-enforced

Phase 8.A.1's drift sweep includes a new test:

```
tests/build/rules-files-reachability.test.ts:

  1. Walk the static-import graph from src/sim/harness.ts.
  2. Filter to files under src/.
  3. Compare the set with RULES_FILES paths (canonical sort).
  4. Fail with pinned error message if mismatched in either direction:
     - "rules-files: file <path> is reachable from src/sim/harness.ts
        but not in RULES_FILES — add it to src/build-info.ts:RULES_FILES
        or remove the import"
     - "rules-files: file <path> is in RULES_FILES but not reachable
        from src/sim/harness.ts — remove from RULES_FILES"

  Implementation: madge programmatic API, or hand-rolled via TypeScript
  Compiler API. Cost: <500ms in CI.
```

Decision 14's anticipated outcome is replaced with a *gate*:

```
Phase 8.A.2 lands no file reachable from src/sim/harness.ts that is not
already in RULES_FILES. The rules-files-reachability test enforces this
at CI time. A violation is an architecture-red-team review event before
merge; if the file IS in fact rules-bearing, RULES_FILES is amended in
the same commit and the addendum to this memo records the change
(making it a rulesetVersion bump and a planning-gate revisit, not a
silent slip).
```

Decision 12's verifier-imports-harness rule is amended:

```
src/verifier/ may import src/sim/harness.ts (for runScripted) BUT
src/verifier/**/*.ts is itself NOT in RULES_FILES (the verifier's
content does not affect simulation byte output — it consumes the
output). The reachability check explicitly excludes src/verifier/**
and src/router/** from the "reachable from src/sim/harness.ts" walk
because the import direction is reverse: harness does not import
verifier. The test asserts the reverse direction is empty, defending
against an accidental harness → verifier import.
```

### Addendum B9 (resolves red-team B9) — "Share This Run" UI ships in 8.A.3, not 8.A.2

Phase 8.A.2's deliverables are amended:

```
8.A.2 ships:
  - URL parser (src/router/url-parse.ts) + tests
  - Action-log codec (src/share/encode.ts) + tests + REPLAY_DIGEST
  - Verifier (src/verifier/verify.ts + tools/verify.ts) + tests
  - localStorage save layer (src/save/storage.ts) + tests
  - Replay viewer (src/main.ts replay-mode wiring) + tests
  - Diagnostic page sections: "Verify a Pasted Log", "Save Slots",
    "Replay This Run" (from decision 15)

8.A.2 does NOT ship:
  - "Share This Run" button (the URL-formatter is exercised by tests
    only; no in-page user-visible affordance to mint a `?run=` URL).
  - The window.__SHARE_URL__ flag (deferred to 8.A.3).
  - history.replaceState canonicalization on page load (the URL bar
    is read but never mutated by the page in 8.A.2).
```

Phase 8.A.3's deliverables gain:

```
8.A.3 ships (in addition to dual-build CI):
  - "Share This Run" button in the diagnostic page; mints the URL,
    copies via navigator.clipboard.writeText, and exposes
    window.__SHARE_URL__.
  - history.replaceState canonicalization on page load (the URL bar
    becomes the canonical share form after fingerprint match).
```

This guarantees the *first* user-visible URL share happens in the same commit that publishes the corresponding `releases/<commit-8.A.3>/` subtree — closing the 8.A.2-window described in B9.

Decision 5's `ROUTE_ERR_NO_MATCHING_RELEASE` text is amended for the bootstrap case:

```
export const ROUTE_ERR_NO_MATCHING_RELEASE =
  "router: this run was created with a build that is not present in
   releases/index.json. The release may not yet be published (try
   refreshing in a minute) or may have been pruned. If this URL was
   shared before per-release pinning was live (Phase 8.A.3), the run
   can be re-created with seed '<seed>' on 'latest/'.";
```

The `<seed>` substitution is the URL-decoded seed (B8's `<repr>` rule applies). Test fixture: a synthetic pre-8.A.3 fingerprint URL produces this exact string with the seed substituted.

---

## Final verdict

**NEEDS REWORK (BLOCKERS).** Nine blockers (B1–B9) and seven non-blocking advisories (A1–A7). The blockers are all the kind Phase 8's planning gate exists to catch: byte-level under-specifications that do not survive a careful read of the implementation surface. None requires a redesign of the layer model, the phase split, or the URL syntax — all are "tighten one paragraph + add one regression test" fixes whose cumulative cost is ~one day of memo work plus ~half a day of test scaffolding.

After the addendum block above is folded into the memo (resolving B1–B9 with the byte-explicit prose, regression tests, and pinned constants in each), this becomes **APPROVE-AFTER-ADDENDUM** and Phase 8.A.1 is unblocked.
