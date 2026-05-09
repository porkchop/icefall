# icefall

[![deploy](https://github.com/porkchop/icefall/actions/workflows/deploy.yml/badge.svg)](https://github.com/porkchop/icefall/actions/workflows/deploy.yml)

▶ **[Play live](https://porkchop.github.io/icefall/)** — the latest build is
auto-deployed to GitHub Pages on every push to `master`. Past releases are
content-addressed at `https://porkchop.github.io/icefall/releases/<commit-12>/`.

ICEFALL is a deterministic, top-down, pixel-art roguelike with a cyberpunk
theme. Every run is fully reproducible from a short fingerprint composed of
code commit hash, ruleset version, seed, and active mod IDs. The visual
atlas itself is procedurally generated and version-pinned, so the game is
deterministic from seed all the way down to the pixel — any run can be
shared, replayed, and verified by anyone, on any machine, exactly.

See [`docs/SPEC.md`](docs/SPEC.md) for the full specification,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layer model and
frozen contracts, and [`docs/PHASES.md`](docs/PHASES.md) for the phase
plan.

## Project status

**Phase 8 complete** — the deterministic core, procedural atlas, playable
game, content-addressed releases, URL fingerprint sharing, action-log
verifier, and localStorage save layer all ship in the latest deploy.
**Phase 9 (polish & release hardening)** is the final phase before the
v1 release.

What works today on the live deploy:
- **Playable game** — keyboard-driven roguelike with 10 floors of
  procedurally-generated dungeons, monster combat, NPC shops on
  earlier floors, an inventory + equipment surface, and a multi-phase
  black-ICE boss on floor 10.
- **Reproducible runs** — every run is identified by a 22-character
  base64url fingerprint that hashes `(commitHash, rulesetVersion, seed,
  modIds)`. Two players running the same fingerprint with the same
  inputs land on the same final state hash, byte-for-byte.
- **URL sharing** — paste a `?run=<fp>&seed=<s>#log=<wire>` URL into
  any browser; the page recomputes the fingerprint, redirects to the
  matching `releases/<commit>/` if the build differs, and silently
  replays the action log.
- **Action-log verifier** — paste a wire-form action log into the
  diagnostic page's "Verify a pasted log" form; the verifier replays
  the log against the current build and reports `valid` /
  `fingerprint-mismatch` / `state-hash-mismatch` / `log-rejected`
  / etc. Also available as a Node CLI: `npx tsx tools/verify.ts < args.json`.
- **Multi-slot save** — every active run auto-saves to localStorage
  every 10 actions; closing and reopening the tab resumes at the same
  floor. Stale-release saves (different commitHash, same seed) are
  preserved indefinitely so you can always recover via the
  `releases/<commit>/` URL.
- **Cross-runtime determinism** — the same digests
  (`RANDOM_WALK_DIGEST`, `MAPGEN_DIGEST`, `SIM_DIGEST`,
  `ATLAS_DIGEST`, `INVENTORY_DIGEST`, `WIN_DIGEST`, `REPLAY_DIGEST`)
  are pinned in CI and asserted on Chromium / Firefox / WebKit on
  every push.

## How to share a run

1. Play through to a state worth sharing (e.g., a winning floor-10 run).
2. The action log auto-saves to localStorage. To get a shareable URL,
   open the diagnostic page (scroll past the playable canvas) and use
   the **"Share this run"** section.
3. Type the seed (and optional comma-separated mod IDs), click
   **Mint share URL** — the page computes the canonical
   `?run=<fp>&seed=<s>` URL, copies it to your clipboard, and exposes
   it in the `<pre>` output.
4. Send the URL to a friend. When they open it, the page recomputes
   the fingerprint under their build's `commitHash` +
   `rulesetVersion`. If the fingerprints match, they see the same
   game; if they don't (your friend's build is newer), the router
   automatically redirects to `releases/<your-commit>/` so the run
   loads with its pinned visuals + pinned rules.

## How to verify a shared run

1. Open the diagnostic page.
2. Scroll to **"Verify a pasted log"**.
3. Paste:
   - The seed
   - The 22- or 43-character fingerprint
   - The 64-hex final state hash (visible in the win-screen panel
     once the run terminates)
   - The base64url action-log wire string (the `#log=` value from
     the share URL)
4. Click **Verify**. The result JSON shows the `kind` discriminator
   plus any mismatch details.

## Daily-seed convention

The daily seed for any date is the date string in `YYYY-MM-DD` form
(e.g., `2026-05-09`). To play today's run:

```
https://porkchop.github.io/icefall/?seed=2026-05-09
```

Friends comparing their daily-seed runs only need to share the
fingerprint — the seed is implicit in the date.

## Local development

```sh
npm install
npm run dev          # Vite dev server at http://localhost:5173/icefall/
npm test             # Vitest with v8 coverage; 100% line gate on src/core/*
npm run lint
npm run typecheck
npm run build        # production bundle into dist/
npm run preview      # serves dist/ at http://127.0.0.1:4173/icefall/
npm run test:e2e     # Playwright cross-runtime suite (chromium/firefox/webkit)
npm run gen-atlas    # regenerate assets/atlas.png from tools/gen-atlas.ts
```

## Deploy structure

The deploy publishes both the latest tree and a content-addressed
per-release tree on every push:

```
https://porkchop.github.io/icefall/                    # latest
https://porkchop.github.io/icefall/releases/<commit>/  # pinned per-commit
https://porkchop.github.io/icefall/releases/index.json # release manifest
```

A shared `?run=<fingerprint>` URL on `latest/` recomputes the
fingerprint under the current build; on a mismatch the router
fetches `releases/index.json`, finds the matching commit, and
redirects via `window.location.replace(...)` to the pinned URL.
This means an old shared URL keeps loading even after master moves
on — the visuals + rules are pinned per-release.

## Architecture

The codebase is organized into hard-bounded layers enforced by
ESLint `no-restricted-imports` rules. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full layer
table; in brief:

```
src/core/        deterministic primitives (PRNG, hash, encode, fingerprint)
src/registries/  pure data tables (items, monsters, encounters, NPCs)
src/sim/         game logic (turn loop, AI, combat, inventory)
src/mapgen/      floor generator (BSP rooms, corridors, encounters)
src/atlas/       PNG atlas pipeline (recipes + encoder)
src/render/      canvas drawing (read-only sink on sim state)
src/input/       keyboard handling
src/ui/          HUD / inventory / equipment / win-screen panels
src/router/      Phase 8 URL parser + redirect (auto-route stale fps)
src/share/       Phase 8 action-log codec (zlib-wrapped + base64url)
src/verifier/    Phase 8 verifier (build-context-trust-anchored)
src/save/        Phase 8 localStorage save layer
src/main.ts      browser entry — orchestrator wiring all layers together
tools/           Node-only build / probe scripts
```

The `src/sim/`, `src/mapgen/`, `src/atlas/` layers are deterministic:
no `Math.random`, no `Date.now()`, no `performance.now()`, no
floating-point arithmetic, no iteration over un-ordered collections.
A custom `eslint-rules/no-float-arithmetic.cjs` lint rule + several
`no-restricted-syntax` selectors pin these constraints.

## Performance

- JS bundle: **41 KB gzipped** (110 KB CI budget per Phase 8 memo
  decision 16). Includes fflate (used by the atlas encoder + the
  action-log codec) plus all Phase 8 layers.
- Atlas binary: **1610 bytes** (256 KB Phase 4 budget).
- Cross-OS atlas-equality: pairwise SHA-256 byte-equality verified
  on `ubuntu-latest` / `macos-latest` / `windows-latest` runners on
  every commit (Phase 4.B `cross-os-atlas-equality` matrix).

## Browser support

Latest two stable Chromium, Firefox, WebKit. The cross-runtime
determinism contract is asserted on all three browsers via the
Playwright suite on every commit.

## Accessibility

- **Keyboard-only**: the game is fully keyboard-driven (arrow keys
  + WASD + space). The canvas is `tabindex=0` and accepts focus;
  every action has a key binding. No pointer-required interactions
  in the playable surface.
- **prefers-reduced-motion**: the page respects the system
  preference; the (currently minimal) UI animations are gated behind
  `@media (prefers-reduced-motion: no-preference)`. The deterministic
  rendering itself has no animation that would conflict.
- **Contrast**: the cyberpunk neon palette is high-contrast against
  the dark background by design. A formal contrast audit lands in
  Phase 9.

## Determinism guards

The cross-runtime golden chain pins every layer's byte output
across Node, Chromium, Firefox, and WebKit:

| Digest | Layer | Pinned in |
|---|---|---|
| `RANDOM_WALK_DIGEST` | core PRNG + state-chain | Phase 1 |
| `MAPGEN_DIGEST` | floor generator | Phase 2 |
| `SIM_DIGEST` | sim turn loop | Phase 3 |
| `ATLAS_DIGEST` + 4 preset-seed `expectedHash` | atlas encoder | Phase 4 |
| `INVENTORY_DIGEST` | inventory + equipment | Phase 6 |
| `WIN_DIGEST` | win-state replay | Phase 7 |
| `REPLAY_DIGEST` | action-log codec round-trip | Phase 8 |

Any change to any of these digests requires either a fix to the
regression that caused it or a deliberate `rulesetVersion` bump
(an architecture-red-team review event).

## License

A LICENSE file lands in Phase 9 polish. Until then, all rights
reserved by the maintainer.
