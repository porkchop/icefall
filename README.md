# icefall

[![deploy](https://github.com/porkchop/icefall/actions/workflows/deploy.yml/badge.svg)](https://github.com/porkchop/icefall/actions/workflows/deploy.yml)

▶ **[Play live](https://porkchop.github.io/icefall/)** — the latest build is
auto-deployed to GitHub Pages on every push to `master`.

ICEFALL is a deterministic, top-down, pixel-art roguelike with a cyberpunk
theme. Every run is fully reproducible from a short fingerprint composed of
code commit hash, ruleset version, seed, and active mod IDs. The visual
atlas itself is procedurally generated and version-pinned, so the game is
deterministic from seed all the way down to the pixel — any run can be
shared, replayed, and verified by anyone, on any machine, exactly.

See [`docs/SPEC.md`](docs/SPEC.md) for the full specification, and
[`docs/PHASES.md`](docs/PHASES.md) for the phase plan.

## Project status

Phase 1 (deterministic core + public deployment): in progress.

The currently-deployed page is a diagnostic that runs the in-browser
self-tests and reports green/red. Fingerprints displayed during this phase
are tagged `DEV-` and are intentionally non-shareable; the real ruleset
version wires in once Phase 4 (procedural atlas generator) lands.

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
```
