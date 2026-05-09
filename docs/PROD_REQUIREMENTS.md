# icefall production requirements

> **Status.** Finalized in Phase 8.A.1 per `docs/PHASES.md:554`.
> The basic deploy pipeline shape was decided in Phase 1; Phase 8
> adds the content-addressed `releases/<commit-short>/` layer on
> top, plus the run-fingerprint + replay-viewer + verifier surface,
> plus the localStorage save layer. Each section below is the v1
> floor — Phase 9 polish may tighten or extend, but never relax.

## Security

**Static-site posture.** icefall ships exclusively as a static
GitHub Pages deploy. No backend, no auth, no user accounts, no
PII collected. The deploy artifact is `index.html` + `assets/*` +
`releases/index.json` + `releases/<commit-short>/*`; nothing else.

**Content-Security-Policy.** A `<meta http-equiv="Content-Security
-Policy">` header is NOT shipped in Phase 8 (deferred to Phase 9
polish per memo's "What this memo deliberately does NOT decide"
list). The static deploy serves no third-party scripts, no inline
`<script>` other than the Vite-emitted bundle, and no external
fonts. If Phase 9 adds CSP, the directive set is at minimum
`default-src 'self'; script-src 'self'; style-src 'self'; img-src
'self' data:; connect-src 'self'`.

**Action-log paste boundary.** The replay viewer accepts a
user-pasted base64url string and runs it through
`fflate.unzlibSync(base64urlDecode(s))` followed by
`decodeAction(...)`. Both decode paths are byte-bounded:

- `unzlibSync` rejects malformed zlib headers and Adler-32
  checksum failures; the resulting `Uint8Array` is bounded by the
  caller's clipboard / hash-fragment input length (browser cap
  ~32–64 KB).
- `decodeAction` rejects unknown tags, non-strict-increasing tag
  ordering, out-of-range payloads, and trailing bytes (memo
  addendum B2).

There is no JSON.parse on user input; the wire format is purely
binary. Phase 4's `JSON.parse` ban inside `src/atlas/**` extends
in spirit to `src/share/**`: the action-log codec must use only
`Uint8Array` operations.

**Decompression-bomb posture.** fflate's `unzlibSync` does not
support a streaming output limit, but the input length is already
capped by `URL_FULL_LENGTH_HARD_CAP = 32000` chars (~24 KB
post-base64url-decode → 24 KB compressed). Even at the
DEFLATE-best-case ~1024:1 ratio, the maximum decompressed
envelope is ~24 MB — well within browser-tab memory. A future
hardening step (Phase 9 polish) may cap envelope length at a
smaller bound (e.g., 1 MB) inside the verifier, but the v1 floor
is "trust the URL length cap and crash if the browser runs out of
heap on a malicious payload."

**Fingerprint privacy.** The 22-char short fingerprint is a
SHA-256 truncation; recovering the seed from the fingerprint is
preimage-equivalent (256-bit security floor). Sharing a
fingerprint URL leaks: the seed (in clear text in `?seed=`), the
mod set (in `?mods=`), and the action log (in `#log=` for short
runs). The fingerprint itself does NOT leak any input not already
present in the URL.

**Hash-fragment privacy property.** `#log=` is in the URL hash
fragment, not the query string. The hash fragment is:

- Not transmitted to the server in any browser HTTP request.
- Not captured by Discord / Slack / Twitter / X link-preview
  crawlers (which fetch the URL's query-string portion only).
- Not logged by GitHub Pages access logs or Cloudflare CDN logs.

This is a **desideratum**, not a contract: the page MUST NOT
depend on `#log=` being secret (memo advisory A2). The verifier
accepts a forwarded log unchanged. If a chat client mistakenly
echoes the hash fragment to its server, the verifier still
operates correctly.

## Reliability

**Determinism floor.** Every byte of the deploy artifact is
reproducible from `git checkout <commit-short> && npm ci && npm
run build && npm run gen-atlas`. No timestamps in the bundle; no
`Math.random` / `Date.now` / `performance.now` in `src/core/**`,
`src/sim/**`, `src/mapgen/**`, `src/atlas/**`. The cross-OS
`cross-os-atlas-equality` matrix asserts byte-identity of
`assets/atlas.png` across `ubuntu-latest`, `macos-latest`,
`windows-latest` runners.

**Cross-runtime golden chain.** The following digests are pinned
in `src/core/self-test.ts` and asserted at every CI run + every
Playwright cross-runtime spec:

- `RANDOM_WALK_DIGEST` (Phase 1)
- `MAPGEN_DIGEST` (Phase 2)
- `SIM_DIGEST` (Phase 3)
- `ATLAS_DIGEST` + 4 preset-seed `expectedHash` values (Phase 4)
- `INVENTORY_DIGEST` (Phase 6)
- `WIN_DIGEST` + reachability (Phase 7.A.2b)
- `REPLAY_DIGEST` (Phase 8.A.2; will join the chain at first-green CI)

Any digest change requires either a `rulesetVersion` bump (with
architecture-red-team review) or a fix to the regression that
caused the change.

**12-character commit-hash collision-resistance pin.** Phase
8.A.1 bumped `vite.config.ts`'s `git rev-parse --short=7 HEAD`
to `--short=12 HEAD`. 12 hex chars = 48 bits = ~2.8e14 distinct
values, supporting >10⁷ commits before a 50% birthday-bound
collision (Linux kernel hits 7-char collisions at ~50K commits;
12 chars is forever-resistant for icefall's expected lifetime).
The `commitShort` field in `releases/index.json` is a 12-char
lowercase hex regex (memo addendum B4).

**Save-slot recovery property.** A run started under build A,
auto-saved 100 actions in, must remain recoverable after master
moves to build B (with a `rulesetVersion` bump). Resume
algorithm:

1. Page-load fingerprint recompute under CURRENT build.
2. If save key matches → silent resume.
3. If no exact match but a stale-build slot has the same seed →
   "Open in pinned release?" UI link, redirecting to
   `releases/<savedCommit>/`. Build-mismatched slots are
   preserved indefinitely.

**Mismatched-fingerprint UX.** A URL with a fingerprint that
does not match the current `latest/` build is enumerated against
`releases/index.json`; the matching pinned release is found and
the user is redirected with the original query string + hash
fragment preserved. If no release matches, one of nine pinned
error strings is shown; the user is not stranded silently.

## Observability

**No telemetry.** No analytics, no error reporting, no usage
metrics ship in v1. The deploy serves the static bundle; client
runtime errors surface only in the browser DevTools console.

**Diagnostic page.** `/?` (the bare URL) renders a diagnostic
section showing: `__SELF_TEST_RESULT__`, the cross-runtime
golden chain values, the action-log "Verify a Pasted Log"
textarea + button, the multi-slot Save Slots list, the "Replay
This Run" link, the win-state replay output, and the atlas
preview. These are observable via DOM inspection and the
`window.__*__` flag surface (chromium / firefox / webkit
read-only).

**Future observability hooks (Phase 9+).** A behind-a-flag
opt-in error-reporting endpoint MAY be added in Phase 9, gated
on user-explicit opt-in only. v1 ships none.

## Performance

**Lighthouse target.** Score > 90 for performance and
best-practices on the live URL (Phase 9 acceptance criterion).
The static bundle has minimal critical-path work: parse JS,
load `assets/atlas.png`, render the diagnostic page.

**Bundle-size budget.** ≤ 110 KB gzipped JS for the production
build (memo decision 16; bumped from 75 KB in 8.A.2 to
accommodate fflate ~30 KB + new layers ~15 KB). CI fails if
`dist/`-gzipped JS exceeds 110 KB.

**Replay viewer step latency.** A scripted replay of
`SELF_TEST_WIN_LOG` (1217 actions) completes in ~50 ms on a
midrange laptop in V8, ~70 ms in JavaScriptCore (webkit). The
`#sim-win-replay` section's page-load delta is ≤ 100 ms across
all three browsers.

**localStorage write throughput.** Auto-save fires every 10
actions (memo decision 8). At a player's typical 2 actions/sec,
that's one localStorage write every 5 seconds — well under the
~5 ms write latency localStorage provides on every browser.

**Index-fetch latency.** `releases/index.json` is served with
`Cache-Control: public, max-age=300, stale-while-revalidate=86400`
(memo addendum B5) so repeat page loads in the same 5-minute
window do not re-fetch. The router uses a per-page-session
in-memory cache keyed by `RELEASES_INDEX_URL` for the same
property within a single page load.

**Mismatched-fingerprint enumeration cost.** O(N) SHA-256
computations across `releases/index.json`, where N is the number
of pinned releases. With memo addendum B5's incremental-state
optimization (`sha256_resume` reuses precomputed prefix state),
each iteration costs ~50 µs; total enumeration cost is ~50 ms
even at N=1000 entries. The phase-2 retry from addendum B3 adds
another full enumeration on the failure path only (~100 ms
worst-case at N=1000). This is well within human-perceptual
latency.

## Operations

**Deploy pipeline.** Single workflow: `.github/workflows/deploy.yml`,
master only, GH Pages. Concurrency group `pages` so overlapping
pushes do not race. Pinned Action versions. The Phase 8.A.3
extension adds a dual-build step (`scripts/build-dual.mjs` +
`scripts/publish-dual.mjs`) that publishes every commit to BOTH
`latest/` AND `releases/<commit-short>/`, plus rebuilds
`releases/index.json`.

**Bootstrap-from-local fallback (memo advisory A7).** When
`scripts/publish-dual.mjs` fetches the previous deploy's
`releases/index.json`, an HTTP error or DNS failure falls back
to the local `dist/releases/index.json` and logs the fallback.
The very-first 8.A.3 deploy seeds `releases/index.json` from
local state.

**Retention policy.** Keep all releases forever until the
`gh-pages` branch exceeds 800 MB; prune oldest releases until
the branch is under 600 MB. Pruning is a maintainer action via
`scripts/prune-releases.mjs` (Phase 9+ if growth surprises);
the policy is documented but the script is deferred.

**Repo-size budget.** `gh-pages` branch ≤ 800 MB soft cap;
manual prune trigger above. Each release artifact is ~150 KB
(JS + CSS + atlas), so 800 MB ≈ 5,300 commits — multi-year
runway at typical project velocity.

**Master-branch protection.** Phase 9 polish: enforce
master-via-PR + green-CI-required + review-required for at
least one collaborator. v1 may rely on the maintainer's own
discipline; the policy is enforceable via GitHub branch
protection rules and is not a code change.

**Force-push / rebase to master.** Forbidden post-Phase-8.A.3.
A force-push that drops a commit's `releases/<commit-short>/`
subtree from `gh-pages` would orphan every fingerprint URL
minted against that commit. The deploy workflow does not
support `--force` and the maintainer commits to never running
it manually against master.

**Restore-from-backup posture.** GitHub stores the `gh-pages`
branch and the source repo. A catastrophic GitHub failure +
local clone loss would lose the deploy, but the source repo
plus the deterministic build pipeline can reconstruct any
release: `git checkout <commit-short>` + `npm ci && npm run
build && npm run gen-atlas` reproduces the exact bytes. The
fingerprint pre-image is build-time-derivable from the source
+ the seed, so old `?run=<fp>&seed=<seed>` URLs remain
verifiable even after a complete `gh-pages` rebuild from the
source repo's history.

**Manual fallback for action-log import.** If the in-page
"Paste log" textarea is broken in some browser, the verifier
CLI (`tools/verify.ts`) accepts the same wire form on stdin
and emits the same `VerifyResult`. The CLI is part of the
8.A.2 deliverable list (memo addendum B9) and is exercised in
`tests/verifier/verify.test.ts`.
