# Phase 4 architecture red-team review

**Memo under review:** artifacts/decision-memo-phase-4.md (commit <none yet, sandbox draft>)
**Reviewer:** architecture-red-team
**Verdict:** NEEDS REWORK (BLOCKERS)

## Summary

The memo is structurally on the same level as the Phase 2 and Phase 3
memos: it pre-empts a long list of red-team concerns, mirrors the
established phase-split discipline, names the right load-bearing
contracts (PNG byte layout, palette, manifest schema, `rulesetVersion`
derivation), and correctly identifies the cross-OS DEFLATE drift surface
as the headline risk. The four-phase split (4.0 / 4.A.1 / 4.A.2 / 4.B),
the indexed-PNG choice with explicit chunk ordering, the
fixed-grid-no-bin-packing layout, and the dev-mode preview-UI design
are endorsed without modification.

That said, the memo has at least seven byte-level under-specifications
that two competent implementers would not converge on identically, plus
two structural ordering bugs in the phase split itself. Most are
narrow ("decision N's prose is missing a clause") but they are exactly
the class of defect Phase 4's `architecture-red-team` review exists to
catch — once `assets/atlas.png` lands on master with an
under-specified contract, every drift becomes a `rulesetVersion` bump
and breaks every shared fingerprint. After the addendum below, this
memo is APPROVE.

## Blocking issues (must be resolved before any Phase 4.A.1 / 4.A.2 code is written)

### B1. Phase split is internally contradictory: 4.A.1 cannot retire the Phase 1 placeholder ruleset because `atlasBinaryHash` does not yet exist

**Decision affected:** decisions 7, 13 (Phase 4.A.1 step 5).

**Issue.** Decision 13 step 5 (`decision-memo-phase-4.md:1495-1509`)
says 4.A.1 lands "Phase 1 placeholder ruleset retirement plumbing" in
`vite.config.ts` and `vitest.config.ts`. The memo then concedes the
real `sha256(rulesText ‖ atlasBinaryHash)` derivation cannot be wired
in 4.A.1 because `assets/atlas.png` does not yet exist (it is created
in 4.A.2). To bridge the gap, 4.A.1 introduces a *new transient
sentinel* `4.A.1-pre-atlas-` that "must not be present on master" but
is the actual value injected for the duration of the 4.A.1 commit.

This is a circular dependency dressed as a phase split:

1. The PHASES.md acceptance criterion for 4.A.1
   (`docs/PHASES.md:242`) says "Phase 1 placeholder ruleset retirement
   plumbing in `vite.config.ts` and `vitest.config.ts`" — i.e., the
   placeholder must be gone after 4.A.1 lands.
2. But the 4.A.1 commit *cannot* compute the real `rulesetVersion`
   because step 7's `assets/atlas.png` does not yet exist in the
   sandbox or on master.
3. So 4.A.1 ships *with* a transient `4.A.1-pre-atlas-` sentinel, and
   master temporarily carries a sentinel value that the memo itself
   says "must not be present on master."

Phase 1's `DEV-` prefix is precisely the affordance this situation
needs (`src/core/fingerprint.ts:74-77`), and Phase 1's whole point is
that the placeholder *stays* on master until atlas-binary-hash exists.
Introducing a second transient sentinel creates two simultaneous
"loader refuses this" code paths: 4.A.2 must remove the
`4.A.1-pre-atlas-` sentinel and add the real derivation in the same
commit; but the memo's loader (`decision-memo-phase-4.md:932-945`) only
refuses `=== PLACEHOLDER_RULESET_VERSION`, which is the *Phase 1*
sentinel, not the new `4.A.1-pre-atlas-` one. The new sentinel slips
past the loader entirely.

Worse, 4.A.1's acceptance criterion `npm run build all green inside
the sandbox` (`docs/PHASES.md:243`) means a build artifact will be
produced from master with a `__RULESET_VERSION__` value of
`"4.A.1-pre-atlas-..."`. Anyone who pulls master between 4.A.1 and
4.A.2 lands and runs the diagnostic page locally will compute
fingerprints under a sentinel that the loader does not refuse.

**Why blocking.** This is the same B-class defect as Phase 3 B5 (a
runtime guard whose semantics were accidentally weaker than the prose
claimed). The memo's own rule that the new sentinel "must not be
present on master" is unenforced — there is no CI gate that asserts
the absence of a `4.A.1-pre-atlas-` string in the built bundle.

**Suggested resolution.** Either:

(a) **Recommended.** Move the `__RULESET_VERSION__` derivation entirely
    out of 4.A.1 and keep emitting `PLACEHOLDER_RULESET_VERSION`
    through 4.A.1. 4.A.1's acceptance criterion becomes "wire the
    derivation function (defined but unused) and the
    `__ATLAS_BINARY_HASH__` Vite-config plumbing"; the actual
    `define`-block call still injects the Phase 1 placeholder. 4.A.2
    then flips the call site to use the real derivation in the same
    commit that lands `assets/atlas.png`. No new sentinel is needed;
    the loader's existing `=== PLACEHOLDER_RULESET_VERSION` refusal
    continues to cover the in-between state.

(b) Alternatively, fold the placeholder retirement entirely into 4.A.2
    and remove decision 13 step 5 from 4.A.1 (4.A.1 stays a pure
    drift-detection sweep with no `vite.config.ts` changes). This
    matches the Phase 3.A.1 / 3.A.2 split more cleanly — 3.A.1 was
    explicitly "no net-new sim code"; 4.A.1 should be "no net-new
    atlas-affecting bytes."

Pick one and update both `decision-memo-phase-4.md:1495-1509` and
`docs/PHASES.md:242` to match.

### B2. `rulesText` file-list itself is not part of the hash → silent fingerprint break when a sim file is split or renamed

**Decision affected:** decision 7.

**Issue.** Decision 7 (`decision-memo-phase-4.md:854-893`) pins
`rulesText` as the byte-concatenation (with the
`"\n----icefall-ruleset-file-boundary-v1----\n"` separator) of 12
listed files in a pinned order. The hash inputs are *the file
contents* and *the separator*; they are **not** the file *names* and
**not** the file *order*.

This means:

1. Renaming `src/sim/turn.ts` to `src/sim/turn-loop.ts` and updating
   the file list in `vite.config.ts` produces the *same* `rulesText`
   bytes (file contents are unchanged, separator is unchanged) and
   therefore the *same* `rulesetTextHash`. The rules have not
   behaviorally changed but a Phase-6 reviewer reading `git diff`
   would expect a `rulesetVersion` bump, and there is none.

2. Splitting `src/sim/combat.ts` into `src/sim/combat.ts` +
   `src/sim/combat-rolls.ts` and adding the new file to the list
   *also* produces the same `rulesText` bytes (the concatenation of
   the two halves equals the original; the separator falls between).
   This is the classic boundary-confusion attack the separator was
   meant to prevent; the separator only prevents *content* collisions,
   not *file-list* collisions.

3. Reordering two files in the list silently changes `rulesText`
   without changing any file's contents. The memo says reordering "is
   also a bump" (`decision-memo-phase-4.md:1003`) — but a
   well-meaning future planner can reorder for readability without
   realizing what they have done. There is no test that asserts the
   pinned order.

The separator addresses *file-content* boundary confusion, not
*file-list* boundary confusion. A second hash input — the file list
itself — is needed.

**Why blocking.** Phase 6 and Phase 7 will both append entries to the
12-file list (decision 7's own "If wrong" clause, line 1001-1004,
acknowledges this). One careless rename or split silently breaks every
fingerprint shared after Phase 4 ships, with no regression test that
catches it before deploy.

**Suggested resolution.** Two steps:

1. Include the file *paths* in the pre-image. Concretely:

   ```
   rulesetText = utf8(JSON.stringify(filenames.sort())) ‖
                 separator ‖
                 file_0_bytes ‖ separator ‖ file_1_bytes ‖ ... ‖ file_n_bytes
   ```

   where `filenames` is the canonical list of 12 paths (sorted
   alphabetically for ordering invariance, or kept in the pinned
   order — pick one and pin it). This makes a rename a `rulesText`
   change.

2. Add a regression test `tests/atlas/build-info.test.ts` that asserts
   the file list itself (the array literal in `vite.config.ts`)
   matches a hardcoded golden array. Reordering the list trips this
   test before it ships.

Pick the alphabetical-sort approach for invariance; it matches the
Phase 2 manifest discipline (alphabetical key order) and removes the
"order is part of the hash" foot-gun entirely.

### B3. CRLF handling is asserted but not enforced — `.gitattributes` does not exist in the repository, and decision 7's mitigation is hypothetical

**Decision affected:** decisions 7, 13; risk "Windows line-ending drift in rulesText".

**Issue.** The risks section
(`decision-memo-phase-4.md:1860-1866`) says the CRLF drift risk is
"Mitigated by `.gitattributes` rule (`* text=auto eol=lf`) and a CI
step that verifies sim/registry files have LF endings before
computing `rulesText`." Neither artifact exists today:

- `ls -la /workspace/.gitattributes` returns no such file.
- The CI workflow verification step is not described in any phase
  (4.A.1, 4.A.2, or 4.B) acceptance criterion.

The memo also says decision 7 "asserts `git config core.autocrlf
input` on Windows runners" (`decision-memo-phase-4.md:870-872`); a
runner-side `git config` cannot retroactively fix CRLF endings that
the contributor's local clone wrote into the index — once `git diff`
sees CRLF on a sim file in 4.A.2's commit, every CI run that
recomputes `rulesText` from disk gets a different hash than every
contributor's local build.

Two further issues compound:

1. **`assets/atlas.png` must be marked `binary` in `.gitattributes`.**
   Without `assets/atlas.png binary`, Git's `text=auto` heuristic on a
   Windows clone *can* CRLF-corrupt the binary on checkout,
   trivially breaking the `git diff --exit-code assets/` gate
   (decision 10) and the cross-OS byte-equality matrix (decision 13)
   on Windows. This is a decade-old well-known PNG-in-Git foot-gun;
   the memo does not pin the mitigation.

2. **BOM handling.** Decision 7 reads "as UTF-8 bytes with LF line
   endings" but says nothing about a UTF-8 BOM (`0xEF 0xBB 0xBF`) at
   the head of any of the 12 files. Most modern editors do not insert
   a BOM by default but VSCode on Windows + a non-default
   `files.encoding` setting will. A BOM-prefixed `src/sim/run.ts`
   silently changes `rulesText`. The memo should pin "files must not
   contain a UTF-8 BOM" and add a CI assertion.

**Why blocking.** The cross-OS byte-equality matrix in Phase 4.B is
the load-bearing assertion of the whole phase. If `.gitattributes`
does not pin `* text=auto eol=lf` *and* `assets/atlas.png binary`
*and* `assets/atlas.json text eol=lf`, the matrix will either fail
spuriously on Windows (binary corruption) or pass spuriously when one
contributor's CRLF commit drifts the rulesText hash on every CI
checkout but not on theirs. Either failure mode discovers the bug
*after* the binary is on master.

**Suggested resolution.** Add to Phase 4.A.1 acceptance criteria:

1. Create `.gitattributes` at the repo root with at minimum:
   ```
   * text=auto eol=lf
   *.png binary
   *.json text eol=lf
   assets/atlas.png binary
   assets/atlas.json text eol=lf
   ```
2. Add a unit test under `tests/build/rules-text.test.ts` that, for
   each of the 12 listed files, asserts (a) the on-disk bytes do not
   contain `0x0D` (no CR), and (b) the on-disk bytes do not start with
   the BOM `0xEF 0xBB 0xBF`. This runs in `npm run test`, so a
   CRLF-introducing commit fails CI before the cross-OS matrix even
   runs.
3. Pin the error-message format the test emits, mirroring the memo's
   "rulesText: file <path> has CRLF; convert to LF and recommit"
   text.

### B4. `assets/atlas.png` byte-equality is asserted across OSes, but the in-browser regen path that Phase 4.B's Playwright job verifies has not been reasoned about for byte equality

**Decision affected:** decisions 4, 9, 12.

**Issue.** Decision 9 (`decision-memo-phase-4.md:1086-1098`) says
"The fresh atlas is generated **in the browser** by importing
`src/atlas/generate.ts` and running it against the user's seed." The
Phase 4.B Playwright assertion
(`decision-memo-phase-4.md:1112-1123`) is:

> Assert `window.__ATLAS_PREVIEW_BUILD_HASH__ ===
> window.__ATLAS_PREVIEW_LIVE_HASH__` when seed is `ATLAS_SEED_DEFAULT`
> (proves the in-browser regen matches the build-time atlas
> byte-for-byte — cross-runtime determinism).

This requires that `src/atlas/png.ts` + `fdeflate` produce
byte-identical output in **the browser** (chromium, firefox, webkit)
that they produce in **Node** at build time. The memo asserts this
("`fdeflate` produces byte-identical output for the same input +
compression level on Node, Chromium, Firefox, and WebKit",
`decision-memo-phase-4.md:514-519`) but the assertion is on the
*compression* step. The wider encoder pipeline has at least one
likely browser-vs-Node divergence that the memo does not address:

1. **`Buffer` vs `Uint8Array`.** Node has a `Buffer` global that
   inherits from `Uint8Array` and adds methods (`Buffer.alloc`,
   `Buffer.concat`, `Buffer.from(...)`); browsers do not. The memo's
   pseudocode (`decision-memo-phase-4.md:1170-1198`) does not say
   which the encoder uses internally. A `Buffer.alloc(N)` call works
   in Node, throws in the browser. Conversely, a
   `new Uint8Array(N)` allocation always works in both, but the
   contents are zero-initialized in both — no drift surface there.
   But if the encoder uses Node's `Buffer.concat`, the browser
   side breaks loudly; if it uses `node:buffer` import, the import
   fails in the browser bundle.

2. **`crypto.subtle` (async) vs `@noble/hashes` (sync).** The atlas
   loader's runtime hash check (decision 7,
   `decision-memo-phase-4.md:964-970`) and the manifest's
   `atlasBinaryHash` field (decision 6) both require SHA-256. The
   memo's encoder side uses `sha256Hex(atlasPng)` in Node
   (`decision-memo-phase-4.md:1189`) and the atlas-loader hashes
   "the actual fetched bytes." Which SHA-256 implementation? SPEC.md
   says "browser SubtleCrypto + small JS fallback for hot paths"
   (`docs/SPEC.md:64`); the existing `src/core/hash.ts` uses
   `@noble/hashes` synchronously. The memo does not say "the atlas
   pipeline uses `@noble/hashes` only, never `crypto.subtle`." Under
   the documented design that is the obvious choice (sync API), but
   the constraint must be pinned because:

   - `crypto.subtle.digest("SHA-256", bytes)` is async and returns an
     `ArrayBuffer`. Wrapping it requires a `Uint8Array(await
     crypto.subtle.digest(...))` round-trip; an off-by-one in
     converting `ArrayBuffer → Uint8Array → hex` is a silent
     `atlasBinaryHash` corruption.
   - The Node `crypto` module's `createHash("sha256")` is a *third*
     implementation that *should* match `@noble/hashes` byte-for-byte
     but has its own quirks (encoding-string handling, Buffer-vs-Uint8Array
     output). If `tools/gen-atlas.ts` uses Node `crypto` and the
     browser uses `@noble/hashes`, two different hashes can disagree
     on a malformed input case.

3. **`TextEncoder` for `atlasSeed`.** `seedToBytes(atlasSeed)`
   (`docs/PHASES.md:215` indirection) routes through
   `src/core/seed.ts` which calls `utf8(seed)` (a `TextEncoder` call,
   `src/core/hash.ts:109`). `TextEncoder` is identical across all
   four runtimes for valid UTF-16; the memo confirms this
   (`decision-memo-phase-4.md:1962-1967`). But the dev-mode preview
   UI accepts a *user-typed* atlas-seed string — and if a user types
   a lone surrogate (`\uD800` with no low surrogate),
   `TextEncoder.encode` silently substitutes `0xEF 0xBF 0xBD`
   (U+FFFD). The memo does not say whether the preview UI validates
   the seed before passing it to `seedToBytes`, and the loader-refusal
   error message would confuse a Phase 9 atlas-tuning author.

**Why blocking.** Phase 4.B's whole premise is that an in-browser
regeneration of the atlas matches the build-time PNG byte-for-byte.
If even one byte of the encoder pipeline behaves differently in the
browser (a `Buffer.concat` call, a hash output type, a `TextEncoder`
quirk), the Playwright assertion fails *after* the binary is shipped
to production. The cross-OS matrix is a distinct risk; the
cross-runtime browser-vs-Node match is an even higher-risk surface
because it executes during normal play, not just in CI.

**Suggested resolution.** Pin in the memo:

1. The encoder uses **only** `Uint8Array` (no `Buffer`); concatenation
   is via a hand-written `concatBytes(parts: Uint8Array[]):
   Uint8Array` helper; no `node:buffer` import anywhere in
   `src/atlas/**`. (Lint-enforce: add `node:buffer` to the existing
   no-restricted-imports list for `src/atlas/**`.)
2. The encoder uses `@noble/hashes/sha256` exclusively (the same
   `sha256` re-exported from `src/core/hash.ts`). Both
   `tools/gen-atlas.ts` and the in-browser preview-regen path import
   from `src/core/hash.ts`. Lint-enforce: forbid `crypto` and
   `node:crypto` and `crypto.subtle` from `src/atlas/**`.
3. The dev-mode preview UI normalizes the user-typed seed via the
   same `seedToBytes` validation contract Phase 2 pins (well-formed
   UTF-16, length 1..255). Invalid seeds surface in the preview-UI
   error area, not as an obscure encoder failure. Pin the error
   message.
4. Add a self-test `atlas-encoder-cross-runtime` that, in the
   browser, encodes a hardcoded 16×16 single-color tile and asserts
   its SHA-256 equals a Node-computed hardcoded golden hex. This is
   the same shape as the Phase 1 `RANDOM_WALK_DIGEST` discipline,
   applied to the encoder's smallest meaningful unit.

### B5. `atlasBinaryHash` is computed in `vite.config.ts` synchronously, but Vite dev mode does not load the same config path the same way

**Decision affected:** decision 7.

**Issue.** Decision 7 (`decision-memo-phase-4.md:885-888`) says
`atlasBinaryHash` is "computed at Vite-config-load time by
`vite.config.ts`'s `define` block, which reads `assets/atlas.png`
synchronously via `fs.readFileSync`." The memo also says
(`decision-memo-phase-4.md:911-916`):

> Vite reads `assets/atlas.png` from the file system. If the file is
> missing (e.g. a fresh clone that hasn't run `npm run gen-atlas`),
> `vite.config.ts` throws ...

Vite's behavior here is more subtle than the memo allows:

1. **`vite dev` reads the config once at startup, not on every
   request.** A developer who runs `vite dev`, then runs
   `npm run gen-atlas` to regenerate the atlas with a new seed, then
   reloads the browser, will see the *old* `__ATLAS_BINARY_HASH__`
   injected into the HMR'd bundle while the *new* `assets/atlas.png`
   is served by the dev server's static-file middleware. The atlas
   loader's hash check (decision 7,
   `decision-memo-phase-4.md:964-970`) immediately throws on every
   reload until the dev server is restarted. The memo does not
   describe this UX or pin a Vite-plugin config that watches
   `assets/atlas.png` and triggers a config reload.

2. **`vite preview` is a different binary path with its own config
   resolution.** The memo's Phase 4.B Playwright assertion runs
   against `vite preview` output served from `dist/`; if the build-time
   atlas hash is injected into `dist/index.html` but a CI step then
   regenerates `assets/atlas.png` after `vite build` completes, the
   served `dist/assets/atlas.png` still equals what `vite build`
   copied at build time. So far so good. But: does the
   `regenerate-atlas-assert-no-drift` CI step
   (`decision-memo-phase-4.md:1213-1219`) run *before* or *after*
   `npm run build`? If after, the Vite-config-resolved hash and the
   `dist/`-copied atlas are guaranteed consistent. If before, they
   are also consistent. The memo doesn't say which.

3. **Module-level `fs.readFileSync` in `vite.config.ts` interacts
   poorly with `vitest`.** `vitest` loads the same `vite.config.ts`
   (or `vitest.config.ts` if present) at test startup. If
   `vitest.config.ts` extends or imports `vite.config.ts`, the
   `fs.readFileSync('assets/atlas.png')` call runs in the test
   environment too — and during 4.A.1 (when `assets/atlas.png` does
   not yet exist) or in CI shards that do not regenerate the atlas
   first, every `vitest` invocation throws on config load. The memo's
   own decision-13 step 5 acknowledges 4.A.1 must inject *something*
   for `__ATLAS_BINARY_HASH__`, which is what motivates the
   `4.A.1-pre-atlas-` sentinel tarpit (B1).

**Why blocking.** The Vite-config-load-time hash computation is the
single point of trust for the build-vs-runtime hash check. Its
behavior under `vite dev` (HMR-adjacent regen → silent stale hash),
under `vitest` (config-load runs in test env → file-not-found in
4.A.1 and CI), and under `vite preview` (build artifact vs. file
system) needs to be enumerated and pinned before code is written.

**Suggested resolution.** Decide and pin one of:

(a) **Recommended.** Move the hash computation out of
    `vite.config.ts`'s top level into a Vite plugin that hooks
    `configResolved` and `handleHotUpdate` for `assets/atlas.png`.
    On HMR for the atlas file, recompute the hash and push a
    full-page reload (`server.ws.send({ type: "full-reload" })`).
    This makes dev-mode regen seamless. Plumb the same plugin into
    `vitest.config.ts` (Vitest understands Vite plugins), with a
    build-time fallback constant (e.g. zeros) when the file is
    absent.

(b) Keep the top-level `fs.readFileSync` but make it tolerate
    `ENOENT` — return a sentinel `"atlas-not-yet-generated"` that
    the loader refuses with the same error class as
    `PLACEHOLDER_RULESET_VERSION`. This avoids the 4.A.1 chicken-and-egg
    of B1 *if* B1's option (a) is also taken.

Either way: pin the dev-mode regen UX in the memo. Without it, the
dev-mode preview UI (decision 9) will produce baffling
"hash-mismatch" errors during atlas-seed iteration — the exact
workflow Phase 9 atlas tuning depends on.

### B6. Atlas-grid placement function: `ATLAS_TILES_HIGH = 8` is a frozen contract but Phase 6/7 may need to bump it, and bumping it shifts the rendered atlas pixel dimensions silently

**Decision affected:** decisions 3, 3a; frozen contract item 5.

**Issue.** Decision 3 pins `ATLAS_TILES_HIGH = 8`
(`decision-memo-phase-4.md:1706-1709`) but adds the parenthetical
"Phase 6/7 may bump `ATLAS_TILES_HIGH` additively without moving
existing sprites." Decision 3a's "frozen invariant" is *coordinate
stability under additive registry growth*. Both claims interact
problematically with how `ATLAS_TILES_HIGH` enters the PNG header:

1. The IHDR chunk encodes `width = 272` and `height = ATLAS_TILES_HIGH
   * 17 = 136` for v1 (`decision-memo-phase-4.md:534-547`). Bumping
   `ATLAS_TILES_HIGH` from 8 to 16 in Phase 6 changes the IHDR
   `height` field, changes every IDAT scanline beyond the v1 row
   count, and *therefore changes `atlasBinaryHash`*.

2. So bumping `ATLAS_TILES_HIGH` is a `rulesetVersion` bump. Fine —
   except the memo says it is *additive* in 3a and item 5, suggesting
   coordinates of existing sprites do not shift. Coordinates do not
   shift, but the binary does. The memo conflates "atlasX/atlasY
   stable" (true) with "atlas binary stable" (false).

3. The same applies to the *width* — `ATLAS_TILES_WIDE` is also
   pinned. If Phase 9 polish ever needs a wider sheet for visual
   tuning, every Phase 4–8 sprite's `atlasX` is preserved (rows
   re-flow but the existing prefix stays in place at the same `(col,
   row)` only if `ATLAS_TILES_WIDE` is unchanged) — but if both
   `ATLAS_TILES_WIDE` and `ATLAS_TILES_HIGH` are pinned, then "atlas
   coordinates stable" is *only* true under additive recipe growth
   that fits in the existing 8-row × 16-col cell budget. The memo's
   Phase 4 sprite count is 7; the Phase 7 ceiling estimate is ~31
   entries plus boss multi-tile cells (~34 effective cells).
   `ATLAS_TILES_HIGH = 8 * 16 = 128 cells` headroom is more than
   enough for Phase 6/7, so the bump may never be needed before v1.
   But the memo does not state this clearly.

**Why blocking.** The "additive without moving existing sprites"
phrase appears in two places (decision 3a invariant, frozen contract
item 5 parenthetical). It is *true* about coordinates but *false*
about the binary; a Phase 6/7 planner reading the memo could believe
that bumping `ATLAS_TILES_HIGH` is a non-bump action because "the
invariant is preserved." It is not.

**Suggested resolution.** Tighten the wording in two places:

1. Item 5: replace "Phase 6/7 may bump `ATLAS_TILES_HIGH` additively
   without moving existing sprites" with "Phase 6/7 *may not* bump
   `ATLAS_TILES_HIGH` without an `architecture-red-team` review and a
   `rulesetVersion` bump; the cell-budget at v1 is `8 × 16 = 128`,
   well above the Phase 7 ceiling of ~34 effective cells, so no bump
   is anticipated through v1."

2. Decision 3a invariant: clarify that the invariant is on
   `(atlasX, atlasY)` *coordinates*, not on the *binary bytes*. Any
   recipe addition is a `rulesetVersion` bump (the binary bytes
   change when a new cell is filled); the invariant guarantees the
   *renderer* can be coded against existing coordinates without
   breakage from a Phase 6/7 PR.

3. Add a regression test that asserts `ATLAS_TILES_HIGH = 8` and
   `ATLAS_TILES_WIDE = 16` against hardcoded constants under the
   100% coverage gate. Bumping either is a `rulesetVersion` bump *and*
   a test failure that an `architecture-red-team` review is required
   to override.

### B7. `atlasSeed` shares `seedToBytes` with `runSeed`, conflating two domains that have no business sharing a normalization path

**Decision affected:** decisions 7, 8, 9.

**Issue.** Decision 8 (`decision-memo-phase-4.md:1023-1025`) says the
atlas seed "is a user-facing string passed to `seedToBytes(...)`
(Phase 2 frozen contract) before being fed into `streamsForRun(...)`."
Decision 7 + 9 also route the atlas seed through `seedToBytes`.

`seedToBytes(seed) = sha256(utf8(seed))` (`src/core/seed.ts:13-15`)
is the same function that Phase 2 pins for the *run seed*. The two
seeds have completely different domains:

- **Run seed.** Identifies a *playthrough*. Combined with mod IDs,
  ruleset version, and commit hash to form a `fingerprint`. Shared
  in URLs.
- **Atlas seed.** Identifies a *visual revision*. Folded into
  `rulesetVersion` via `atlasBinaryHash`. Bumping it is a process
  taboo (after Phase 9). *Not* something an end-user types.

Under SPEC principle 4 ("Art is data, generated from a seed") these
are explicitly different seeds. Sharing `seedToBytes` with no domain
separator means an attacker (or a Phase 9 typo) that picks an
`atlasSeed` string equal to a known `runSeed` produces the *same
32-byte rootSeed for the atlas pipeline as that run uses for its
mapgen/sim*. There is no security exploit from this in v1 (atlas
generation is build-time-only, mods are deferred), but:

1. It is the same defence-in-depth oversight Phase 3 B1 caught for
   `lp_utf8(domain)` — the absence of a domain anchor between two
   semantically-different inputs means the SHA-256 pre-image space is
   accidentally shared.

2. The memo's own decision 1a routes each recipe's PRNG through
   `streamsForRun(seedToBytes(atlasSeed)).atlas(recipeId)` — i.e.,
   the atlas seed ends up in `streamSeed(rootSeed, "atlas",
   recipeId)`'s pre-image. The `"atlas"` salt provides the
   in-pipeline domain separation, so this is *recoverable* — but the
   `seedToBytes` step itself has no domain separation. A Phase 9 mod
   that wants to compute "the atlas hash for run X's seed" would
   produce a binary that collides with the run's mapgen rootSeed.

3. The memo does not state explicitly that `atlasSeed` and `runSeed`
   are different domains. A Phase 8 maintainer reading
   `tools/gen-atlas.ts` and seeing `seedToBytes(atlasSeed)` could
   reasonably wonder "wait, can I use a run seed as an atlas seed?"
   The memo should say no, and pin why.

**Why blocking.** This is a fingerprint-domain hygiene issue and
exactly the class of latent contract bug Phase 4 is the planning gate
to head off. The cost to fix is small (an extra string in the
pre-image); the cost not to fix is a Phase 9-or-later "wait, atlas
seeds and run seeds collide" decision memo that breaks every
fingerprint shared in the interim.

**Suggested resolution.** Introduce a one-line domain separator:

1. Decision 8 (or a new decision 8a): pin
   `atlasSeedToBytes(seed: string): Uint8Array =
   sha256(utf8("icefall:atlas-seed:v1:") ‖ utf8(seed))`. Keep
   `seedToBytes` for run seeds. The two functions are byte-distinct
   for every input (different prefix → different SHA-256 output).
2. `tools/gen-atlas.ts` and the dev-mode preview UI both call
   `atlasSeedToBytes`, never `seedToBytes`.
3. Add a test that asserts `atlasSeedToBytes("X") !==
   seedToBytes("X")` for at least one non-trivial X.
4. Frozen-contract item 4 (`streams.atlas(recipeId)` accessor) is
   updated to specify "consumed via `atlasSeedToBytes`, not
   `seedToBytes`."

This mirrors Phase 1's `STREAM_DOMAIN = "icefall:v1:"` discipline
(`docs/ARCHITECTURE.md:69`) which separates run-stream pre-images from
arbitrary other SHA-256 inputs. Phase 4 should not introduce a second
seed type without the same anchor.

### B8. `atlas-stream-isolation` self-test specification has a spurious "no `sim:*` keys" assertion that contradicts legitimate `simFloor()` usage

**Decision affected:** decision 12.

**Issue.** Decision 12 (`decision-memo-phase-4.md:1411-1416`)
specifies the `atlas-stream-isolation` self-test:

> Allocates a fresh `streamsForRun(seedToBytes(ATLAS_SEED_DEFAULT))`,
> calls `streams.atlas("atlas-recipe.cyberpunk.tile.floor")`, asserts
> `[...streams.__consumed]` includes
> `"atlas:atlas-recipe.cyberpunk.tile.floor"` and contains no
> `"sim:*"`, `"mapgen:*"`, or `"ui"` entries.

The assertion is correct for this specific scenario (a fresh streams
object that is only used for one atlas recipe call — nothing else
should be in `__consumed`). But the wording "no `sim:*` keys" is a
trap for a future Phase 6/7 maintainer who extends the test to
exercise a recipe alongside a sim call:

- `streams.simFloor(3)` records `"sim:3"` (`src/core/streams.ts:133`).
- `streams.sim()` records `"sim"` (`src/core/streams.ts:126`).
- The test's "no `sim:*`" pattern would *also* exclude these
  legitimate keys — but only if the test author misreads the
  intent.

The actual invariant is "atlas generation alone does not consume
mapgen/sim/ui streams." The test's wording should reflect that.

**Why blocking** (borderline, but stated as B for clarity). On its
own this is a nit-grade documentation issue. It promotes to B because
the same defect class — over-tight `__consumed` invariants — is what
Phase 3 addendum N7 had to retroactively patch (see Phase 3 red-team
report). Catching it pre-implementation is cheaper than retro-patching
it.

**Suggested resolution.** Reword decision 12's assertion:

> Asserts `streams.__consumed.has("atlas:atlas-recipe.cyberpunk.tile.floor")`,
> asserts `streams.__consumed.size === 1` (no other accessor was
> called in this test fixture). The "atlas alone does not consume
> sim/mapgen/ui" invariant is *implied* by `size === 1`; tests that
> exercise multiple accessors (Phase 6/7 fixtures) assert per-call
> deltas instead, mirroring the per-tick `__consumed`-empty
> invariant from Phase 3 frozen contract 11.

This also gives Phase 6 a cleaner pattern to follow when atlas-load
sits inside a real run (where `sim:*` keys *will* be present and
*should* not trigger a false-positive).

## Non-blocking nits (should be folded into the memo addendum or tracked as follow-ups)

### N1. `fdeflate` — pin major+minor+patch and document upgrade procedure

`decision-memo-phase-4.md:1903-1909` says `fdeflate` is "exact-pinned"
in `package.json`. The text should additionally say "no `npm update`
of `fdeflate` is permitted in any commit that does not include a
fresh cross-OS byte-equality CI run; major/minor/patch all bump
`atlasBinaryHash` if upstream tunes its compression heuristic."
Concretely, add a check to the `architecture-red-team` review
checklist: any `fdeflate` version change in `package-lock.json` is
auto-flagged.

Also: pin the *tarball SHA* in `package-lock.json` review (it's
already there but has no explicit recall in the memo). One-line nit.

### N2. `fdeflate`'s "byte-identical across Node, Chromium, Firefox, WebKit" claim is asserted but not cited

`decision-memo-phase-4.md:514-519` claims "It is used by `vite`,
`vitest`, and several audited tooling packages. It is **not** the
same as `pako`." Cite at least one piece of evidence — a vite
issue/PR link, a fdeflate test-suite link, or a one-paragraph
audit summary in the memo. The memo's strongest mitigation
(byte-stable pure-JS deflate) deserves a footnote.

### N3. `valueNoise2D` PRNG-state-after-call is unspecified

`decision-memo-phase-4.md:174-194` defines `valueNoise2D(prng, x, y) =
((prng.next() ^ hash2D(x, y)) & 0xff)`. So *one* `prng.next()` is
consumed per call. But a recipe that paints a 16×16 tile via
`valueNoise2D` advances the PRNG cursor by 256 calls. The memo should
state: "every recipe's `prng` cursor advancement is deterministic
from the recipe's primitive call count; recipes that paint
deterministically same-sized tiles produce same-length PRNG sequences."
Frozen contract item 1 should add a clause that `valueNoise2D`
consumes exactly one `prng.next()` per call.

### N4. `paletteGradient` integer-interpolation formula has a subtle off-by-one

`decision-memo-phase-4.md:68` shows
`(from * (steps - 1 - i) + to * i) / (steps - 1)`. With `steps = 1`
this divides by zero. Pin a check: `steps >= 2` is required (or
define `steps = 1` to return `[from]`). The memo's recipe set may
not need `steps = 1` today, but the contract is exposed for mods.

### N5. Color-quantization runtime check for out-of-range palette indices

The PNG encoder will happily encode any byte 0-255 as a palette
index; if a recipe writes a `7` and the palette only has 16 entries
(0..15), no error. But if a recipe writes a `200` (a bug in
`paletteSwap` arithmetic, say), the encoder produces a PNG that
references a nonexistent palette entry — most decoders show this as
black or transparent; some (older Safari) crash. Add to decision 4:
"the encoder asserts `pixels[i] < paletteCount` for every pixel before
emitting IDAT; violation throws `pngEncode: pixel <i> has palette
index <v> but palette has <N> entries`." This is a one-line check
with high defensive value.

### N6. `tRNS` chunk for paletteCount=16 is 16 bytes but PNG spec allows truncation

PNG spec says a `tRNS` chunk for indexed-color may be *shorter* than
the palette count; entries beyond the chunk length are implicitly
opaque. Since palette entries 1..15 are always opaque
(`decision-memo-phase-4.md:678-680`), the `tRNS` chunk could legally
be one byte (entry 0's alpha). The memo (decision 4 + decision 5)
emits all 16 entries. That is fine — but pin it explicitly: "tRNS
chunk emits all 16 entries (length=16) for byte-stability against
encoders that truncate." Some PNG decoders behave subtly differently
when `tRNS` is truncated; pinning the longer form removes the surface.

### N7. The `DEV-` refusal error message is pinned in prose but not as a regression test fixture

Decision 7 (`decision-memo-phase-4.md:937-944`) pins the error
message as

> "atlas-loader: refusing to load build with placeholder ruleset
> (DEV- fingerprint) — re-build with 'npm run build' to inject the
> real rulesetVersion"

Add a test fixture under `tests/atlas/manifest-loader.test.ts` that
asserts the exact string match. Pinning the message in prose is half
the work; the test is the other half.

### N8. Bundle-size budget: 75 KB gzipped from Phase 2 — the atlas-preview UI in `src/main.ts` will push toward this

The Phase 2.A bundle budget is `dist/`-gzipped ≤ 75 KB
(`docs/PHASES.md:117`). Phase 4.A.2 adds:

- `src/atlas/png.ts` + `src/atlas/png-crc.ts` (~150 lines + CRC
  table, ~3-5 KB minified)
- `fdeflate` (the memo says ≈ 8 KB minified)
- `src/atlas/generate.ts` + recipes + primitives (estimated ~5-8 KB)
- The dev-mode preview UI plumbing in `src/main.ts` (~2 KB)

Plus `assets/atlas.png` (~4-8 KB binary), which is not in the JS
bundle but is fetched at startup.

Total JS bundle delta: ~18-24 KB minified, perhaps ~6-8 KB gzipped.
The Phase 2 budget should still hold but the memo doesn't say so.
Add to decision 13's 4.A.2 acceptance criteria: "bundle-report shows
total dist-gzipped ≤ 75 KB; `bundle-report` artifact uploaded for
audit."

Also: distinguish "first-paint" budget vs "total atlas-included"
budget. Phase 5+ will load `assets/atlas.png` synchronously at run
start; the 256 KB binary budget does not double-count against the
75 KB JS budget, but a Phase 9 reviewer should not have to reverse-engineer
this.

### N9. The "skipped cells" in atlas-grid placement (decision 3a) are *fully transparent* but the `tilesHigh` extending into a "skipped" row from above is not addressed

Decision 3a's algorithm says "skipped cells … remain empty
(fully-transparent palette index 0)." But what about a `2×2` recipe
declared at `cursorCol = 15` (last column of a row)? The algorithm
advances to the next row (`cursorRow += 1; cursorCol = 0`) and
*then* places the 2×2. That leaves the `(15, currentRow)` cell
*before* the row-advance fully transparent. Fine — but a 2×1
declared at `(15, currentRow)` does fit (`cursorCol + w = 15 + 1 =
16 ≤ 16`); it places at `(15, currentRow)` and advances `cursorCol`
to 16, which then on the next iteration triggers the row-advance.
This is what the memo intends.

Pin a test fixture for the edge case: a 2×2 declared at registry
position 16 (i.e. when `cursorCol = 15`). It should produce coords
`(0, 1)`, leaving `(15, 0)` empty. The current decision-3a test
sketch (`decision-memo-phase-4.md:497-501`) covers a "12-entry mix"
but not the wrap-with-skip edge case. One extra test fixture.

### N10. `vite-node` import-graph hazard mitigation under-specifies which imports are "bare"

`decision-memo-phase-4.md:1890-1895` says `tools/gen-atlas.ts`
"uses only relative imports for `src/**` paths and bare imports for
the small set of pinned dependencies (`@noble/hashes`, `fdeflate`,
Node built-ins)." Node built-ins should be `node:fs`, `node:path` —
explicit `node:` prefix, never `fs` / `path` (which `vite-node`
resolves through Vite's resolver and which can collide with a
hypothetical mod's `fs.ts`). Pin the prefix in the memo.

### N11. `atlas-recipe.<theme>.<category>.<name>` regex anchors `<theme>` to exactly `cyberpunk` — but `<theme>` is the future modding seam

Decision 2 + frozen contract item 3 anchor `<theme>` to
`(cyberpunk)` (a single literal alternation). When the Phase 9-or-later
mod loader adds a `fantasy` or `horror` theme, the regex must change
— bumping `rulesetVersion`. The memo's decision 14 acknowledges the
theme seam but the regex doesn't. Two options:

(a) Loosen the regex now to `[a-z][a-z0-9_-]*` for `<theme>` and
    enforce the `cyberpunk`-only constraint at the registry layer
    (where it can be lifted without a `rulesetVersion` bump).

(b) Keep the regex tight and accept that adding a theme is a
    `rulesetVersion` bump *anyway* (every theme adds new recipes,
    which already bump the hash via `atlasBinaryHash`). In this case
    document the rationale in decision 2.

Either is defensible; pick one and note it.

### N12. Phase 4.B Playwright assertion for `variant-A` golden hex needs to be computed and pinned now, not "during 4.A.2"

`decision-memo-phase-4.md:1119-1122` says the Phase 4.B assertion is
"the new value matches a hardcoded golden hex string (proves variant
reproducibility)." But the golden hex cannot be computed until 4.A.2
runs. So the assertion is "we'll pin the constant in 4.A.2, then
4.B's Playwright test asserts against it." Fine — but mark this in
the memo as "pin-in-4.A.2-deliverables." Currently it reads as if
the constant is already known.

Also: there should be a *separate* golden hex per preset seed
(`variant-A`, `variant-B`, `variant-C`), not just one. All four
preset seeds should regenerate-and-assert; otherwise three of the
four buttons are untested.

### N13. The recipe registry being mutable from a mod is silently disallowed by the build-time wiring; pin this for clarity

SPEC principle 5 says "designed for mods, even before mods exist."
Decision 2a says recipes are baked at build time (`tools/gen-atlas.ts`
runs in Node, writes `assets/atlas.png` to disk). A mod-author's
addition to the recipe registry is therefore a *build-time*
concern, not a runtime one — which is the right call (atlas hash is
in `rulesetVersion`, which is in `fingerprint`, which mods are part
of). But the memo should pin: "atlas-recipe mods, when supported
post-v1, will run `npm run gen-atlas` at mod-install time and
produce a *new* `assets/atlas.png` with a *new* `atlasBinaryHash`
folded into a *new* `rulesetVersion`. The mod's recipe contributions
are visible in the next build's `atlasBinaryHash`; not at runtime
without a rebuild." This is a one-paragraph clarification in
decision 14.

### N14. The cross-OS aggregator job's matrix wiring is not specified: fail-fast or report-and-continue?

`decision-memo-phase-4.md:1394-1404` describes the `cross-os-atlas-equality`
matrix but does not say whether the matrix has `fail-fast: true` (the
GitHub Actions default). With fail-fast, the first OS to fail abort
the others, leaving a one-OS-failed-but-which-other-OSes-also-failed
diagnostic gap. Recommend `fail-fast: false` plus the aggregator job
(which already runs once after all three) as the source of truth.
Also: explicitly pin Node version in the matrix
(`node-version: '20.x'` or whatever the project standard is) — a
runner image bump on `macos-latest` that ships Node 22 mid-2026
could change `fdeflate` behavior subtly.

### N15. `assets/atlas.json` strict-parse is asymmetric with serialize: the parser is order-tolerant but the serializer is order-strict — flag this

`decision-memo-phase-4.md:777-782`: "The parser is order-tolerant on
input but the *serializer* guarantees the canonical order." Fine —
but the round-trip self-test (`tests/atlas/manifest.test.ts`) should
include a fixture where the input JSON is in *non-canonical* order
(say, sprite keys in declaration order), parsed, re-serialized, and
asserted byte-equal to the canonical-order serialization. Without
this, the asymmetry is unverified and a future loose-parse-tightening
PR could regress it.

### N16. The Phase 5 bridge assumes the manifest covers everything the renderer needs, but doesn't address animation frames

Decision 14 acknowledges animated sprites are deferred. But the
manifest schema (decision 6) has no slot for animation frames
(`framesPerSprite`, `frameDuration`, etc.). Adding those fields in
Phase 9 is a `schemaVersion` bump (decision 6 says so) — fine. But
the memo should note that a Phase 9 schemaVersion=2 migrator must
exist, and that v1 (pre-migrator) atlases will *not* support
animation. One-paragraph forward-compat note in decision 6 or 14.

### N17. `vite.config.ts` `define`-block expansion: confirm `__ATLAS_BINARY_HASH__` is JSON-stringified

Vite's `define` replaces tokens *literally*, so injecting a string
requires JSON-stringifying it (`'"abc..."'`, with quotes). The memo
shows the conceptual shape (`decision-memo-phase-4.md:902`) but does
not pin the exact `define` value. Forgetting the quotes injects
`__ATLAS_BINARY_HASH__ = abc123...` (an undefined identifier) at the
call site, which fails at build time. A one-line example in the memo
prevents the foot-gun.

## What is well-handled

The memo gets a lot right:

1. **Encoder choice is excellent.** `fdeflate` over `pako` (citing
   pako's heuristic-tuning history) and pure-JS over Node-zlib
   (citing system-zlib version drift across runner images) are
   exactly the right calls. The chunk-order pinning and filter-0-only
   stance are textbook deterministic-PNG discipline.
2. **Indexed-PNG over RGBA32** is justified for both binary size
   *and* future palette-swap mod support, in the same paragraph.
   Good engineering taste.
3. **Recipe primitive set is well-bounded.** The explicit rejection of
   Floyd–Steinberg, Perlin, polygon-fill, channel-split, and row-shift
   primitives — with concrete reasons each — is the kind of
   write-up that makes the planning-gate worth it. A future Phase 9
   reviewer will not have to re-derive these.
4. **Phase split mirrors Phase 3 exactly.** The 4.0 / 4.A.1 / 4.A.2 /
   4.B structure is the proven shape. (See B1 for the one place this
   broke down.)
5. **`atlas-grid placement function` is pinned with pseudocode**, not
   prose. Decision 3a's algorithm is unambiguous; the "registry
   declaration order, no backfill, no compaction" rule is the right
   trade-off (slight pixel waste for layout stability).
6. **Cross-runtime self-test pattern** (`ATLAS_DIGEST` peer to
   `RANDOM_WALK_DIGEST`, `MAPGEN_DIGEST`, `SIM_DIGEST`) extends the
   Phase 1+2+3 discipline naturally.
7. **Pre-emptive notes for the red-team** (decision-memo-phase-4.md
   §1955-2017) demonstrate the planner has internalized the prior
   reviews; many of my concerns above were *partially* addressed
   there. The remaining gaps are narrow.
8. **Mod-loader and theme-switching deferral** (decision 14) is
   honest: the recipe API is the future modding ABI, the registry is
   data-only, the primitive set is small and frozen. SPEC principle
   5 is honored.

The memo's biggest structural strength is that every decision lists
"alternatives considered" and "if wrong" — exactly the discipline
that makes future addenda easy to write. The blockers above are
nearly all "tighten one paragraph" or "add one regression test," not
"redesign the layer."

---

## Follow-up review (post-addendum)

**Reviewed:** addendum at decision-memo-phase-4.md:2026-3084 plus PHASES.md / ATLAS_GENERATOR.md updates
**Reviewer:** architecture-red-team
**Verdict:** APPROVE WITH NITS

## Summary

The addendum resolves all eight blockers with the same byte-level
discipline the original memo brought to the underlying decisions: B1
adopts the recommended option (a) and the placeholder-retirement is
folded entirely into 4.A.2; B2 swaps the file-content concatenation
for an alphabetically-sorted `(utf8(path), NUL, sha256(normalized
content), NUL)` tuple list that is provably rename/split/reorder
sensitive; B5 introduces a `vite-plugin-atlas-binary-hash` plugin
with `configResolved` + `handleHotUpdate` and an `EMPTY_SHA256`
fallback that closes the `vitest`/`vite dev` chicken-and-egg cleanly;
B7 introduces `atlasSeedToBytes` with the literal anchor
`"icefall:atlas-seed:v1:"` mirroring Phase 1's `STREAM_DOMAIN`
discipline. The remaining blockers (B3, B4, B6, B8) are also solidly
resolved, with byte-exact `.gitattributes` content, lint-enforced
encoder boundaries, distinct coordinate-vs-binary stability
invariants, and a `__consumed.size`-delta self-test that mirrors
Phase 3's per-tick discipline. `docs/PHASES.md` and
`docs/ATLAS_GENERATOR.md` are coherent with the addendum.

Three small new issues surfaced (raised below as N18–N20). All are
nit-grade — none warrants pushing the verdict back to NEEDS REWORK.
Phase 4.0 is unblocked for approval.

## Blocker disposition

| Blocker | Resolved? | Comment |
|---|---|---|
| B1 (phase split contradiction — placeholder retirement) | YES | Adopts option (a) cleanly. Decision 13 step 5's `4.A.1-pre-atlas-` sentinel paragraph is **deleted** (addendum:2061). 4.A.1's `vite.config.ts` and `vitest.config.ts` continue to inject `PLACEHOLDER_RULESET_VERSION`; `deriveRulesetVersion` is exported from `src/build-info.ts` but **not called**. 4.A.2 lands `assets/atlas.png`, the plugin, and the call-site flip from `PLACEHOLDER_RULESET_VERSION` to the derived value **all in the same commit** (addendum:2056-2061). `docs/PHASES.md:218-224` reflects this exactly: "Phase 4.A.1 is the no-net-new-atlas drift sweep (no placeholder retirement, no `__RULESET_VERSION__` call-site flip — the helper is defined but unused)." A regression test `tests/build/no-transient-sentinel.test.ts` greps `dist/` for `"4.A.1-pre-atlas-"` and fails if found (addendum:2079-2084). The two-state assertion (placeholder OR 64-char hex; no third form) is the right shape. No transient sentinel ever ships on master. |
| B2 (rulesText file-list not in hash) | YES | The pre-image is now byte-explicit: `for each (path, content) in RULES_FILES.sort_by_path_alphabetical(): utf8(path) ‖ 0x00 ‖ sha256(normalizeForHash(content)) ‖ 0x00` (addendum:2133-2136). `normalizeForHash` is pinned (`stripBom(content).replace(/\r\n/g, "\n")`) at addendum:2124-2131. The three properties the original draft lacked are now true *by construction*: rename changes the hash (path bytes feed the pre-image), split changes the hash (the new file's tuple appears), reorder does not change the hash (canonical alphabetical sort). The CRLF→LF and BOM-stripping steps are applied at hash-time as defense-in-depth above `.gitattributes`. The three tests at addendum:2173-2182 cover all three failure modes including a one-byte mutation round-trip. The `0x00` separator is safe: `utf8(path)` cannot contain `0x00` (POSIX rejects it; the 12 paths are ASCII). The original 44-byte separator is explicitly **superseded** (addendum:2185). |
| B3 (`.gitattributes` not enforced + BOM not pinned) | YES | The byte-exact `.gitattributes` content is pinned at addendum:2197-2219 with both `*.png binary` and `assets/atlas.png binary` (defense-in-depth via specific-overrides-general), `assets/atlas.json text eol=lf`, and the global `* text=auto eol=lf`. The `tests/build/rules-text.test.ts` CRLF/BOM scan is added in 4.A.1 with **pinned error-message format** (addendum:2230-2235). The `git config core.autocrlf input` runner-side prose from decision 7 is explicitly **superseded** as the wrong mitigation (addendum:2257-2260). `docs/PHASES.md:252-253` lifts the contract into the 4.A.1 acceptance criteria. |
| B4 (in-browser regen byte equality) | YES | The encoder is byte-equivalent across runtimes by construction. `Uint8Array`-only with a hand-written `concatBytes` helper (addendum:2274-2284); `node:buffer` and global `Buffer` lint-banned in `src/atlas/**`. `@noble/hashes/sha256`-only (addendum:2290-2306); `crypto`, `node:crypto`, `crypto.subtle` lint-banned in `src/atlas/**`. The dev-mode preview UI gets a `<div id="atlas-preview-error">` element and a pinned error message for invalid seeds (addendum:2314-2328). New `atlas-encoder-cross-runtime` self-test added (addendum:2330-2337) mirroring `RANDOM_WALK_DIGEST` discipline. Decision 4, 9, 11, 12 are all explicitly amended (addendum:2346-2353). |
| B5 (vite-config hash computation) | YES | Computation moves out of `vite.config.ts` top level into `vite-plugin-atlas-binary-hash.mjs`. The hook choice is correct: `configResolved` is the **single hook** that reads `assets/atlas.png` (runs once per `vite build`/`vite preview`/`vite dev`/`vitest`); `config` exposes `__ATLAS_BINARY_HASH__` and `__ATLAS_MISSING__` to the `define` block; `handleHotUpdate` watches the atlas file in dev mode and triggers `server.ws.send({ type: "full-reload" })` (addendum:2401-2407), eliminating the "edit seed → regen → stale hash on reload" trap. The `EMPTY_SHA256` fallback (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` — confirmed correct: SHA-256 of empty byte string) plus `__ATLAS_MISSING__ = true` removes the `vitest` config-load throw (addendum:2429-2449). The `regenerate-atlas-assert-no-drift` CI ordering is pinned: `gen-atlas` → `git diff --exit-code assets/` → `npm run build` → `npm run test:e2e` (addendum:2459-2465). The chicken-and-egg is closed without reintroducing one. |
| B6 (`ATLAS_TILES_HIGH` bumps) | YES | Two distinct invariants pinned separately (addendum:2486-2502): coordinate stability (preserved under additive growth) vs binary stability (NOT preserved under tile-grid resize). The replacement frozen-contract item 5 prose at addendum:2525-2535 is unambiguous. Tile-grid resize allowed only at `rulesetVersion` boundaries with `architecture-red-team` review and only as a pure increase. The `tests/atlas/layout-constants.test.ts` regression test (addendum:2537-2542) is the trip-wire that forces the review. Cell-budget headroom (8×16=128 vs Phase 7 ceiling ~34) is documented. |
| B7 (atlasSeed shares `seedToBytes` with `runSeed`) | YES | `atlasSeedToBytes` is byte-distinct from `seedToBytes` by virtue of a 22-byte fixed prefix `"icefall:atlas-seed:v1:"` (addendum:2557-2569). Encoding matches the `seedToBytes` style (`sha256(domain ‖ utf8(seed))` peer of Phase 1's `STREAM_DOMAIN = "icefall:v1:"` discipline — `docs/ARCHITECTURE.md:69` referenced). Collision-free with `seedToBytes` for every input by SHA-256 collision-resistance: pre-images differ in length (+22 bytes) AND in leading bytes (the anchor) for every `X`. All three call sites (decision 1a, decision 7, decision 8, frozen-contract item 4) explicitly amended. The regression test at addendum:2609-2621 asserts both byte-distinctness for non-trivial X and the 22-byte ASCII anchor in the pre-image. |
| B8 (`atlas-stream-isolation` self-test wording) | YES | Decision 12's prose is rewritten (addendum:2638-2653) to use `__consumed.size === 1` and `__consumed.has("atlas:" + recipeId)`, replacing the trap-prone "no `sim:*` keys" formulation. The per-call delta pattern is documented as the template for Phase 6/7 fixtures that exercise multiple accessors (addendum:2677-2685). Frozen-contract item 4 gains the per-call invariant clause. The companion `tests/atlas/recipes/no-cross-stream.test.ts` extends the discipline to every Phase 4 recipe (addendum:2691-2694). See N20 below for one over-strong claim in the supporting prose. |

## Nit disposition

- **N1** (fdeflate version-pin discipline) — Resolved at addendum:2726-2741. The `architecture-red-team` review-checklist hook on any `fdeflate` version-line or `integrity`-hash change is the right enforcement surface. Accepted.
- **N2** (fdeflate cross-runtime byte-identity citation) — Resolved at addendum:2743-2756 by pinning the version-bump → cross-OS-matrix-rerun rule rather than a URL that would rot. Acceptable; the phrasing "the package's README pins the level → output mapping" is unverified prose, but its only consequence is the rule-binding above. Accepted with a small caveat: the `vite >= 5.x` claim about `fdeflate` being a Vite dep is an assertion the planner has not cited; not worth blocking on.
- **N3** (`valueNoise2D` PRNG-cursor advancement) — Resolved at addendum:2758-2771. The "exactly one `prng.next()` per call" invariant is byte-explicit and frozen-contract item 1 is amended. The regression test (cursor-delta snapshot or two-call golden) is the right shape. Accepted.
- **N4** (`paletteGradient(steps)` runtime guard) — Resolved at addendum:2773-2785 with a pinned error message and `steps ∈ {0, 1}` throw / `steps ∈ {2, 3, 16}` pass test matrix. Accepted.
- **N5** (palette-index bounds check) — Resolved at addendum:2787-2800 with pinned error format and a one-pixel-out-of-range fixture. Accepted.
- **N6** (`tRNS` chunk full length) — Resolved at addendum:2802-2813. Pinning the 16-byte form removes the truncation surface; frozen-contract item 7 amended. Accepted.
- **N7** (`DEV-` refusal error-message regression test) — Resolved at addendum:2815-2829. Exact-character-match including the em-dash (U+2014) plus a `^atlas-loader:` prefix-regex defense. Accepted.
- **N8** (bundle-size budget) — Carry-forward to 4.A.2 at `docs/PHASES.md:264` with the explicit "JS bundle-report shows total `dist/`-gzipped under 75 KB" criterion. The carry-forward is specific enough; an implementer cannot misinterpret. Accepted.
- **N9** (atlas-grid wrap-with-skip edge case) — Carry-forward to 4.A.2 at `docs/PHASES.md:266`. Specific enough. Accepted.
- **N10** (`node:` prefix on Node built-ins) — Resolved at addendum:2832-2845 with a pinned ESLint error message. Accepted.
- **N11** (`<theme>` regex tightness) — Resolved at addendum:2847-2857 by adopting option (b) explicitly. Accepted.
- **N12** (variant golden-hex pin source) — Resolved at addendum:2859-2895. The pin-source rule (`ubuntu-latest` shard of the cross-OS matrix during the first green 4.B build) is unambiguous; the four-button Playwright assertion closes the three-of-four-untested gap. `docs/PHASES.md:273-274` lifts this into the 4.B acceptance criteria. Accepted.
- **N13** (atlas-recipe mod loader runtime semantics) — Carry-forward to 4.A.2 (decision 14 prose amendment). The disposition table says "Carried to 4.A.2 (decision 14 prose amendment)"; this is the kind of vague carry-forward the rules warn about — the addendum does not include a draft of the amendment text, so the implementer must invent it. Accepted but flagged: the carry-forward should at minimum say "decision 14 gains the paragraph: atlas-recipe mods, when supported post-v1, will run `npm run gen-atlas` at mod-install time and produce a *new* `assets/atlas.png` with a *new* `atlasBinaryHash` folded into a *new* `rulesetVersion`." Not blocking — the original red-team N13 prose is itself precise enough that a careful 4.A.2 implementer can lift it verbatim.
- **N14** (cross-OS matrix `fail-fast: false` + Node 20.x) — Resolved at addendum:2897-2919 with the pinned YAML snippet. `docs/PHASES.md:271` lifts this into 4.B acceptance. Accepted.
- **N15** (manifest non-canonical-input round-trip) — Carry-forward to 4.A.2 (decision 12 test list). Specific enough. Accepted.
- **N16** (manifest schemaVersion=2 forward-compat) — Deferred to Phase 9 with the constraint pinned: "the `schemaVersion = 1` parser must reject `schemaVersion = 2`" (addendum:2921-2937). The deferral rationale is sound (animation is a Phase 9 concern by SPEC) and the v1-side constraint is honored. Accepted.
- **N17** (`define`-block `JSON.stringify`) — Resolved at addendum:2939-2980 with the canonical injection pattern, escape rules for empty strings / quotes / `undefined` / booleans / numbers, and a `tests/build/` assertion that every `define` value parses as a valid JSON literal. Accepted.

## New issues introduced by the addendum

### N18 (NEW). 4.A.1's `tests/build/rules-text.test.ts` will fail because three `RULES_FILES` entries don't exist on disk yet

The `RULES_FILES` array (addendum:2108-2121) lists `src/atlas/palette.ts`,
`src/atlas/params.ts`, and `src/registries/atlas-recipes.ts`. None of
those files exist on master today, and the addendum's drift-sweep
sequencing at 3032-3066 explicitly says 4.A.1 "lands the following,
in this order, with **no net-new `src/atlas/**` recipe code**." Step
5 is "`tests/build/rules-text.test.ts` asserting LF + no-BOM on every
`RULES_FILES` entry (B3)."

If `RULES_FILES` is the canonical 12-entry list at 4.A.1, the test
opens each path with `fs.readFileSync` and three of those calls
ENOENT-throw. If the test is gated to skip missing files, it can
silently miss real CRLF/BOM violations once those files do appear
in 4.A.2 and the test is not re-evaluated. Neither failure mode is
caught by the addendum's other tests.

**Suggested resolution.** Either (a) split `RULES_FILES` into a
"present-at-4.A.1" subset (`src/sim/*.ts`, `src/registries/{encounters,
items, monsters, rooms}.ts`) and an "added-at-4.A.2" subset
(`src/atlas/{palette, params}.ts`, `src/registries/atlas-recipes.ts`),
with the CRLF/BOM scan iterating "every entry that exists on disk"
until the canonical 12-entry list is complete in 4.A.2; or (b) defer
the LF/BOM test to 4.A.2 and have 4.A.1 only ship `.gitattributes`
plus a static unit test that asserts the `.gitattributes` file content
(the byte-exact pinned form). Option (a) gives stronger CRLF
protection earlier; option (b) is simpler. Either is acceptable —
the addendum does not pick one, and a 4.A.1 implementer cannot
disambiguate. Nit-grade because the ordering bug surfaces at
implementation time (the test will fail loudly), not silently in
production.

### N19 (NEW). `validateSeedString` and the "Phase 2 frozen contract" precondition do not currently exist

The B7 implementation sketch (addendum:2554-2569) and the B4 prose
(addendum:2316) both reference a `validateSeedString` precondition
that "throws on lone surrogate or length out of range" and is "the
same `seedToBytes`-precondition validation Phase 2 pins (well-formed
UTF-16, length 1..255)." Verified against the codebase:

- `src/core/seed.ts:13-15` is `sha256(utf8(seed))`. No validation.
- `src/core/hash.ts` exports `isWellFormedUtf16` (line 133) but
  `utf8(...)` does **not** call it.
- `docs/ARCHITECTURE.md:197-206` ("`seedToBytes` (Phase 2)") shows
  the bare `sha256(utf8(seed))` formula with no precondition.
- The "length 1..255" constraint appears in **no** Phase 2 artifact
  or `src/**` file; it is introduced for the first time here.

The addendum's prose treats this precondition as a Phase 2 frozen
contract that already exists. It does not. The 4.A.2 implementer who
writes `atlasSeedToBytes` will either:

(a) Add `validateSeedString` to `src/core/` *and* retroactively wire
    it into `seedToBytes` (a Phase 2 frozen-contract change that
    bumps every existing fingerprint — silently, because no
    fingerprint existed under a lone surrogate or 256-char seed
    before, but the contract is changed).

(b) Add `validateSeedString` only as `atlasSeedToBytes`'s
    precondition and leave `seedToBytes` unchanged (creating the
    asymmetry "atlas seeds reject lone surrogates, run seeds
    silently U+FFFD-replace them" — the exact defence-in-depth
    inconsistency Phase 4's planning gate is supposed to head off).

**Suggested resolution.** The addendum should pick (b) — atlas-seed
validation is a Phase 4 *addition*, not a Phase 2 invariant — and
either (i) add a one-line note clarifying that `seedToBytes`
preconditions are unchanged in Phase 4 and the asymmetry is by
design (run seeds were already in use before validation was
considered; tightening them now would be a `rulesetVersion` bump for
no current bug), or (ii) defer atlas-seed validation to a Phase 4 nit
and have `atlasSeedToBytes` just invoke `utf8(seed)` directly with
the same lone-surrogate behavior as `seedToBytes`. Nit-grade because
either resolution is small; the planner's intent is clear from
context but the prose miscites the existing contract.

### N20 (NEW). B8's per-call delta template is wrong when the same recipe key is reused

The B8 resolution prose at addendum:2670-2675 says:

> The size-delta formulation is composable: any number of
> `streams.atlas(...)`, `streams.simFloor(...)`, `streams.mapgen(...)`
> calls can be made, each advancing `__consumed.size` by exactly 1,
> and the per-call delta invariant holds for each call independently.

This is false when the same key is added twice. `__consumed` is a
`Set<string>` (`src/core/streams.ts:115, 119`); a second call with
the same key is a no-op. So `streams.atlas("recipe-X")` followed by
`streams.atlas("recipe-X")` advances `__consumed.size` by 1 then by
0, not 1 then 1. The Phase 6/7 template offered at addendum:2680-2684
(`assert(streams.__consumed.size === sizeBefore + 1, ...)`) would
fire spuriously on a deduplicated atlas-load (which is a legitimate
runtime pattern: a renderer that loads the same sprite twice in one
frame).

The rewritten `atlas-stream-isolation` self-test itself is
correct — it makes a single call on a fresh streams object and the
assertion holds. The defect is only in the supporting prose that
generalizes the pattern.

**Suggested resolution.** Tighten the prose at addendum:2670-2675 to
"each first call to a fresh key advances `__consumed.size` by exactly
1; repeat calls to the same key are Set-deduplicated and advance by
0." The Phase 6/7 fixture template should assert
`streams.__consumed.has(expectedKey)` and the *count of distinct
keys* equals `expectedDistinctCount`, not the per-call delta. Nit-grade
because the rewritten self-test is correct and the defect only
surfaces if a Phase 6/7 author copies the template prose verbatim
into a multi-call fixture.

## Final recommendation

Phase 4.0 is **unblocked for approval**. All eight blockers are
resolved with byte-explicit fixes, regression-test coverage, and
explicit "decisions amended above" callouts that supersede the
original prose where it conflicts. `docs/PHASES.md` and
`docs/ATLAS_GENERATOR.md` are coherent with the addendum. The three
new nits (N18, N19, N20) are small enough to fold into the 4.A.1 and
4.A.2 implementation work — N18 has a clear 4.A.1-ordering fix
(option (a) or (b) above), N19 needs a one-paragraph clarification
of which contract is changing, and N20 is a one-sentence prose
tightening. None of the three needs a blocking re-review. The
addendum is the second-strongest planning-gate amendment in the
project's history (after Phase 3's), and the planner has internalized
the red-team's Phase 1, 2, and 3 lessons cleanly. Proceed to 4.A.1.

