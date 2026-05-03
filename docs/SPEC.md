# SPEC — ICEFALL (working title)

> **Working title.** "ICEFALL" picks up Gibson's term for cybersecurity countermeasures (Intrusion Countermeasures Electronics) and the descent metaphor of a dungeon crawl. Replace freely.

## High Concept

A deterministic, top-down, pixel-art roguelike with a cyberpunk theme. The player descends through a procedurally generated darknet dungeon — "the stack" — defeating ICE constructs and corp sec, collecting eddies and gear, and confronting a final black-ICE boss on the deepest floor. Every run is fully reproducible from a short fingerprint composed of code commit hash, ruleset version, seed, and active mod IDs. **The visual atlas itself is procedurally generated and version-pinned**, so the game is deterministic from seed all the way down to the pixel. Any run can be shared, replayed, and verified by anyone, on any machine, exactly.

## Why This Exists

Seeded roguelikes are common (Brogue, DCSS, Caves of Qud, Slay the Spire dailies). What is uncommon is treating the **code version itself** as part of the run identity. By fingerprinting `(commit, ruleset, seed, mods)`, ICEFALL is fearlessly evolvable: balance changes, new content, art revisions, and major rewrites never break old runs because old runs replay against their pinned code and pinned atlas. New runs use new rules; old runs stay valid. There is no "backward compatibility" problem because the version is part of the fingerprint.

Glitch art and procedural visuals are also the canonical cyberpunk aesthetic, so the procedural-atlas approach is not just a determinism trick — it deepens the theme. The art *is* data, generated from a seed, the same way the rules are.

This makes the project a long-lived testbed for procedural content, deterministic simulation, and reproducible play — properties that align well with phasekit's emphasis on methodical, gated delivery.

## Principles (immutable)

1. **Determinism is the contract.** Same fingerprint + same input sequence → bit-identical run. No `Math.random()`, no wall-clock dependencies, no floating-point in simulation logic, no nondeterministic iteration order.
2. **Action log is the save.** State is never serialized; saves are seed + ordered inputs. Resume = silent replay.
3. **Version is part of identity.** Every run carries its commit hash. Old runs replay against their pinned release. New code does not have to be backward-compatible with old saved state — the fingerprint mismatch tells the player to load the right release.
4. **Art is data, generated from a seed.** The sprite atlas is produced by a deterministic generator script at build time. The atlas binary's hash is part of the ruleset version. Visuals are versioned the same way rules are.
5. **Designed for mods, even before mods exist.** Monsters, items, rooms, encounter tables, and atlas recipes live in registries with stable IDs from day one. The mod *loader* comes later; its *contract* is honored from the start.
6. **Browser-first, no backend.** v1 ships as a static site. Sharing is URLs and clipboard. Leaderboards and accounts are explicitly out of scope.

## Theme

Cyberpunk in the Akira / Neuromancer / Snatcher tradition. Top-down pixel art, neon palette over dark backgrounds, optional CRT/scanline post-processing. Synthwave / darksynth audio.

Mechanical reskins from the standard fantasy roguelike vocabulary:

| Fantasy concept | ICEFALL concept |
|---|---|
| Dungeon | "The stack" — a darknet cluster, deeper floors are deeper subnets |
| Monsters | ICE constructs, corp sec, drones, gangers |
| Final boss | Black-ICE construct or zaibatsu enforcer |
| Treasure | Cred chips, data shards |
| Gold | Eddies (eb) |
| Healing potions | Stim patches, trauma packs |
| Equipment | Cyberware, weapons, deck modules |
| Wizards / shops | Ripperdocs, fixers, info-brokers |

A `theme` registry exists from day one (palette + atlas generator + copy strings). Theme is **not** runtime-swappable in v1, but the seam is cut so a "fantasy" or "horror" theme can be a mod later — including swapping in a different atlas generator.

## Sprite Atlas — Procedural Generation

The visual layer is a single PNG **tile atlas** plus a **JSON manifest** mapping logical IDs (`monster.ice_daemon`, `tile.floor.cyberfloor_03`, `item.stim_patch`) to atlas coordinates. The renderer uploads one texture, batches draws, and gameplay code never touches pixel coordinates.

The atlas is **not hand-drawn**. It is produced by a deterministic generator (`tools/gen-atlas.ts`) at build time:

- Generator takes an atlas seed (`atlasSeed`, distinct from run seed) plus a ruleset version
- Generator emits `assets/atlas.png` and `assets/atlas.json`
- Generator uses techniques aligned with the cyberpunk theme: dithering patterns, parameterized geometric shapes, palette-mapped noise, deliberate glitch artifacts, line/grid motifs, scanline residue
- Each logical sprite slot has its own sub-generator (e.g. `monster.ice_daemon` is a different recipe than `tile.floor`) but all share a palette and noise vocabulary
- The atlas binary hash is computed at build time and bundled into the ruleset version: `rulesetVersion = sha256(rulesText ‖ atlasBinaryHash)`

This means: bumping the atlas seed is a visual-only revision and produces a new ruleset version. Old runs replay against their pinned release with their pinned atlas. The player sees the dungeon exactly as it looked when the run was first played.

## Scope (v1, in)

### Core engine

- Seeded PRNG (`mulberry32` or `sfc32`)
- Sync SHA-256 (browser SubtleCrypto + small JS fallback for hot paths)
- Two independent RNG streams off the root seed: `mapgen` and `sim`
- State-hash chain advanced by deterministic action descriptors
- Run fingerprint: `sha256(commitHash ‖ rulesetVersion ‖ seed ‖ sortedModIds)`
- Build-time injection of `commitHash` and `rulesetVersion` (which already incorporates `atlasBinaryHash`)

### Procedural atlas

- `tools/gen-atlas.ts` — deterministic generator producing `assets/atlas.png` + `assets/atlas.json`
- A small library of sprite-recipe primitives (palette ops, dither, noise, masks, glitch ops)
- Per-slot recipes for: floor tiles, wall tiles, doors, ~12–15 monsters, boss, ~20 items, ~3 NPCs, UI chrome
- Build script: regeneration is reproducible and produces a stable atlas binary hash
- Optional dev-mode UI for previewing atlas-seed variants side by side

### Gameplay

- Fixed depth: 10 floors. Boss arena on floor 10.
- Turn-based, grid-based movement
- Combat resolved deterministically: each roll = `H(currentStateHash ‖ actionDescriptor)`
- ~12–15 monster types distributed across floors
- ~20 items: weapons, cyberware, stim/trauma consumables, currency
- 2–3 NPC types: ripperdoc, fixer, info-broker
- Room / corridor / encounter generators with stable IDs

### UX

- Title screen → seed entry / random seed → run
- HUD: HP, eddies, current floor, fingerprint
- Inventory + equipment screens
- Death screen with shareable fingerprint
- Replay viewer that auto-steps through an action log
- localStorage saves (action log format), one slot per fingerprint

### Distribution

- Browser, static site (GitHub Pages or itch.io)
- Content-addressed releases: every commit publishes `releases/<commit-short>/index.html`, including its pinned atlas
- Bare URL serves the latest release; `?run=<fingerprint>` resolves to the matching pinned release

## Scope (explicitly out of v1)

- Multiplayer, online leaderboards, accounts, any backend
- Real-time / twitch action combat
- Native builds (Electron, mobile app stores)
- Mod loader (interfaces designed for it; loader itself deferred)
- Theme switching at runtime (interface designed for it; alternate themes deferred)
- Hand-drawn art (the procedural generator *is* the art pipeline)
- Localization (English only)
- Audio dynamics (start with canned tracks + simple SFX)
- Full accessibility pass beyond keyboard + reasonable contrast

## Glossary

| Term | Definition |
|---|---|
| **Run** | A single playthrough from floor 1 to death or boss kill. |
| **Fingerprint** | `sha256(commitHash ‖ rulesetVersion ‖ seed ‖ sortedModIds)`, truncated to a URL-safe string. Uniquely identifies the rules and visuals of a run. |
| **Action Log** | Ordered list of player inputs since the start of a run. Replay against the fingerprint to reconstruct the run. |
| **Mapgen Stream** | RNG stream used only for level layout. Seeded from `H(seed ‖ "mapgen" ‖ floorN)`. |
| **Sim Stream** | RNG stream used for combat and entity behavior. Each roll: `H(currentStateHash ‖ actionDescriptor)`. |
| **State Hash** | Running hash of all events that have advanced the simulation since run start. Drives the sim stream. |
| **Atlas Seed** | Seed used by `tools/gen-atlas.ts`. Distinct from run seed. Bumping it produces a new visual revision and a new `rulesetVersion`. |
| **Atlas Binary Hash** | SHA-256 of `assets/atlas.png`. Folded into `rulesetVersion`. |
| **Ruleset Version** | `sha256(rulesText ‖ atlasBinaryHash)`. Changes whenever rules or visuals change. |
| **Stack** | In-game name for the dungeon. |
| **Eddies (eb)** | In-game currency. |
| **ICE** | Generic name for hostile programs / monsters. |

## User Journeys

1. **First run.** Player opens the page, clicks "New Run." A random seed is generated. They descend, die on floor 4, see the death screen with fingerprint, copy the URL to clipboard.
2. **Replay a friend's run.** Player clicks a shared link. Game loads with seed pre-filled; the linked release is served from `releases/<commit>/`, including the pinned atlas. They play the same dungeon, with the same sprites, that their friend faced.
3. **Verify a brag.** Player pastes a fingerprint + action log into the replay viewer. The game replays input-by-input; if the final state hash matches the claim, the run is verified.
4. **Resume after closing the tab.** Player reopens the page; localStorage holds the action log; the game replays it silently and drops them at their current floor with their current state.
5. **Daily seed (informal).** Player tweets `?seed=2026-05-03`. Anyone using the same release plays the same dungeon with the same sprites.
6. **Visual revision.** Maintainer bumps the atlas seed in `tools/gen-atlas.ts`. Atlas regenerates, atlas hash changes, ruleset version changes, the new release is published to `releases/<new-commit>/`. Old fingerprints continue to load their pinned old releases. New runs get the new look.

## Success Criteria (v1 done)

- Two browsers given the same fingerprint and same input sequence produce identical action logs and identical final state hashes.
- A run shared by URL is reproducible by a stranger on a different machine, exactly — including identical visuals.
- The full game (10 floors + boss) is winnable from a clean start.
- The atlas regenerates reproducibly: `npm run gen-atlas` followed by `git diff assets/` is empty across machines and CI.
- All gameplay registries (monsters, items, rooms, encounters, atlas recipes) use stable IDs and are loaded from JSON. No code-level mod surface yet, but the data shape is fixed.
- The game is hosted as a static site at `releases/<commit>/index.html`. The bare domain redirects to the latest release.
- A first-time visitor can land on the page, click "New Run," and play to floor 1 without reading docs.

## Open Questions (deferred)

- Mod sandbox model — data-only first, scripted later. Specced in a separate document after v1 ships. Atlas-recipe mods are a particularly interesting later category.
- Theme-switching UX — phase 9 polish or later.
- Audio: procedural too, or canned synthwave tracks? (Lean: canned for v1, procedural in a future revision.)
- Whether to expose a JSON-RPC mode so AI agents can play the game (post-v1, possibly very interesting).

## Document Pointers

- Technical architecture: `docs/ARCHITECTURE.md` (drafted in the planning gate at the start of Phase 1)
- Phase plan: `docs/PHASES.md`
- Production / deployment requirements: `docs/PROD_REQUIREMENTS.md` (drafted before Phase 8)
- Atlas generator design notes: `docs/ATLAS_GENERATOR.md` (drafted in the Phase 4 planning gate)
