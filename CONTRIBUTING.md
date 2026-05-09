# Contributing to icefall

Thanks for considering a contribution. ICEFALL is a deterministic-shareable
cyberpunk roguelike with strict invariants — please read this file in full
before opening a pull request.

## Status note (Phase 9 polish)

The project is in **Phase 9 (Polish & Release Hardening)** before its v1
release. The cross-runtime golden chain, fingerprint contract, and
content-addressed `releases/<commit>/` layout are all stable and considered
load-bearing. Touching any of them requires either a `rulesetVersion` bump
(reviewed by `architecture-red-team`) or a fix to the regression that
caused the change.

A `LICENSE` file lands later in Phase 9 polish; until then, all rights are
reserved by the maintainer. By contributing in the interim you grant the
maintainer permission to incorporate your work under whichever
OSI-approved license the project ships under at v1.

## Development setup

```sh
git clone https://github.com/porkchop/icefall
cd icefall
npm install
```

Common workflows:

```sh
npm run dev          # Vite dev server at http://localhost:5173/icefall/
npm test             # Vitest with v8 coverage; 100% line gate on src/core/*
npm run lint         # ESLint — also enforces deterministic-discipline rules
npm run typecheck    # tsc -b --noEmit
npm run build        # Production bundle into dist/
npm run preview      # Serves dist/ at http://127.0.0.1:4173/icefall/
npm run test:e2e     # Playwright cross-runtime (chromium/firefox/webkit)
npm run gen-atlas    # Regenerate assets/atlas.png from tools/gen-atlas.ts
```

Browser binaries for `test:e2e` install on first run via
`npx playwright install --with-deps`. CI runs all three browsers on every
push to `master`.

## The phase-gated workflow

icefall uses the [phasekit](https://github.com/anthropic-experimental/phasekit)
phase-gated workflow, documented in `AGENTS.md`. Every change lands in a
named phase with an approval artifact at `artifacts/phase-approval-<N>.json`.
For a one-off bug fix, the phase is implicit (`phase-fix-<commit-short>`);
for net-new functionality, you create a sub-phase under the next unapproved
phase in `docs/PHASES.md`.

If your change touches:

- **The fingerprint pre-image** (any byte that feeds `sha256(commit ‖ ruleset ‖ seed ‖ mods)`)
- **The action wire format** (`encodeAction` / `decodeAction`)
- **The deterministic stream derivation** (any new `streams.*(salts...)` accessor)
- **The atlas binary layout** (`src/atlas/png.ts`, recipes, palette)
- **The router / verifier / share-codec / save-layer wire formats**

…you MUST treat the change as an `architecture-red-team` review event, not a
typical PR.

## Coding conventions

### Deterministic discipline (load-bearing)

The simulation core is bit-identical across Node 20+, Chromium, Firefox,
and WebKit. Every PR that touches `src/core/`, `src/sim/`, `src/mapgen/`,
or `src/atlas/` must preserve this property. ESLint enforces:

- **No `Math.random`** anywhere in the deterministic layers
- **No `Date.now()`, `performance.now()`, or `new Date()`** in deterministic code
- **No floating-point arithmetic** in `src/sim/`, `src/mapgen/`, `src/atlas/`
  (custom `eslint-rules/no-float-arithmetic.cjs`)
- **No iteration over `Map`/`Set`/`Object.entries`/`Object.keys`/`Object.values`
  without `sortedEntries(...)`** in sim/mapgen — insertion-order iteration
  is implementation-defined and would silently break cross-runtime determinism
- **No `JSON.parse`** inside `src/sim/`/`src/mapgen/` — data ingestion happens
  at boundaries (`src/router/`, `src/save/`), not inside the deterministic core
- **Layer-import boundaries** — see the table in `docs/ARCHITECTURE.md`. The
  ESLint `no-restricted-imports` rules enforce them; a violation is a CI fail

If you need to do something the lint rules forbid, please open an issue
first — there's almost always a reason for the rule.

### Cross-runtime golden chain

Several digests are pinned in `src/core/self-test.ts` and asserted on
chromium/firefox/webkit on every push:

| Digest | Layer | Pinned in |
|---|---|---|
| `RANDOM_WALK_DIGEST` | core PRNG + state-chain | Phase 1 |
| `MAPGEN_DIGEST` | floor generator | Phase 2 |
| `SIM_DIGEST` | sim turn loop | Phase 3 |
| `ATLAS_DIGEST` + 4 preset-seed `expectedHash` | atlas encoder | Phase 4 |
| `INVENTORY_DIGEST` | inventory + equipment | Phase 6 |
| `WIN_DIGEST` | win-state replay | Phase 7 |
| `REPLAY_DIGEST` | action-log codec round-trip | Phase 8 |

Any change to any of these digests requires either a fix to the regression
that caused it OR a deliberate `rulesetVersion` bump (an
`architecture-red-team` review event). PRs that change a digest without
bumping `rulesetVersion` will be blocked.

### Test-driven development

Tests are written **before or alongside** implementation, never after. The
review gate looks for a test that would fail if the change were reverted.
If you can't write one, you don't understand the change well enough to ship it.

Coverage thresholds are enforced via `vitest.config.ts`:
- `src/core/**`: 100/100/100/90 (lines/statements/functions/branches)
- `src/sim/**`: 95/95/100/85
- `src/mapgen/**`: 100/100/100/85
- `src/render/**`, `src/input/**`, `src/ui/**`: 95/95/100/85
- `src/atlas/**`: 100/100/100/100
- `src/share/**`, `src/verifier/**`: 100/100/100/90

A PR that drops coverage below threshold fails CI.

### Theme-registry for UI text

All user-visible UI text routes through `src/ui/theme/strings.ts` (Phase
9.A.3). When adding a new UI string, register it as a typed key in
`DEFAULT_THEME` and call `getString("section.key", params?)` from the
consumer. Hardcoding strings inline blocks the Phase 9 acceptance
criterion 3 (theme-mod overlay support).

## PR process

1. **Fork + branch.** Branch off `master`.
2. **Tests first.** Write the failing test, then the implementation.
3. **Local gates green.** Run `npm run lint && npm run typecheck && npm test
   && npm run build && npm run test:e2e`. All must pass.
4. **Open the PR.** Link to the relevant `docs/PHASES.md` section if your
   change is part of a planned sub-phase.
5. **CI runs the full suite** including the cross-runtime Playwright
   matrix and the cross-OS atlas-equality job. PRs are blocked by red CI.
6. **Code review.** A maintainer (or `code-reviewer` agent) reviews the
   change. Architecture-touching work may also pull in
   `architecture-red-team`.
7. **Squash merge.** Keep the commit history linear; the `phase-N: <summary>`
   commit-message convention is preferred but not required for non-phase
   work.

## Bug reports

Open an issue with:

- A reproducible **fingerprint** (the 22-character `?run=` value), seed,
  and action log if relevant — this lets a maintainer replay the exact
  scenario byte-for-byte
- The commit hash you observed it on (the diagnostic page surfaces this in
  the HUD's `FP` widget when running locally)
- Browser + OS + the cross-runtime golden-chain values from the diagnostic
  page if any of them disagrees with the pinned constant

## Feature proposals

For non-trivial features:

1. Open an issue describing the feature + its acceptance criteria
2. Wait for maintainer feedback on whether it fits the project's scope
3. If accepted, draft a sub-phase entry in `docs/PHASES.md` (planning
   gate; `architecture-red-team` review required for any change touching
   the load-bearing surfaces listed above)
4. Implement per the phase-gated workflow

The project has explicit non-goals (per `docs/SPEC.md` principle 6):

- **No backend** — v1 ships as a static site; sharing is URLs and clipboard
- **No accounts / leaderboards** — out of scope
- **No HTTP-endpoint verifier** — the verifier is in-page + CLI only

PRs that violate these will be closed.

## Acknowledgments

Special thanks to William Gibson and Hideo Kojima for the cyberpunk
vocabulary the project re-skins, and to the `phasekit` workflow that
keeps every commit gated, reviewable, and reproducible.
