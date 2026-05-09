import { sha256, sha256Hex, utf8, concat } from "./core/hash";

declare const __COMMIT_HASH__: string;
declare const __RULESET_VERSION__: string;
declare const __ATLAS_BINARY_HASH__: string;
declare const __ATLAS_MISSING__: boolean;

export const PLACEHOLDER_RULESET_VERSION = "phase1-placeholder-do-not-share";

/** SHA-256 of the empty byte string — the empty-atlas fallback. */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const commitHash: string =
  typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev000000000";

export const rulesetVersion: string =
  typeof __RULESET_VERSION__ !== "undefined"
    ? __RULESET_VERSION__
    : PLACEHOLDER_RULESET_VERSION;

/**
 * SHA-256 of the build-time `assets/atlas.png` (lowercase hex, 64
 * chars). Injected by `scripts/vite-plugin-atlas-binary-hash.mjs`. When
 * the file is missing the plugin injects `EMPTY_SHA256` and
 * `__ATLAS_MISSING__ = true` (Phase 4 addendum B5).
 */
export const atlasBinaryHash: string =
  typeof __ATLAS_BINARY_HASH__ !== "undefined"
    ? __ATLAS_BINARY_HASH__
    : EMPTY_SHA256;

/**
 * `true` when `assets/atlas.png` was absent at Vite-config-load time.
 * Consumed by the atlas loader (refusal path) and the diagnostic
 * preview UI (status banner).
 */
export const atlasMissing: boolean =
  typeof __ATLAS_MISSING__ !== "undefined" ? __ATLAS_MISSING__ : true;

/**
 * Canonical, alphabetically-sorted list of source files whose contents
 * feed `rulesetTextHash` (Phase 4 frozen contract; addendum B2). The
 * sort is the contract — reordering this array literal is a *test
 * failure*, not a `rulesetVersion` bump.
 *
 * Adding/removing/renaming an entry is a `rulesetVersion` bump *by
 * construction*: the path bytes feed the pre-image directly (B2
 * properties 1 and 2). Phase 6/7 planning gates will append entries.
 *
 * `existsInPhase` marks entries whose source files do not exist on
 * master at this phase — the LF/BOM scan in
 * `tests/build/rules-text.test.ts` skips them until they land (per
 * red-team follow-up N18, option (a)). When 4.A.2 lands the three
 * `4.A.2` entries below, the field can be flipped to `4.A.1` and
 * the field eventually retired once every entry is present.
 */
export type RulesFileEntry = {
  readonly path: string;
  readonly existsInPhase: "4.A.1" | "4.A.2";
};

export const RULES_FILES: readonly RulesFileEntry[] = [
  { path: "src/atlas/palette.ts", existsInPhase: "4.A.1" },
  { path: "src/atlas/params.ts", existsInPhase: "4.A.1" },
  { path: "src/registries/atlas-recipes.ts", existsInPhase: "4.A.1" },
  { path: "src/registries/encounters.ts", existsInPhase: "4.A.1" },
  { path: "src/registries/items.ts", existsInPhase: "4.A.1" },
  { path: "src/registries/monsters.ts", existsInPhase: "4.A.1" },
  { path: "src/registries/rooms.ts", existsInPhase: "4.A.1" },
  { path: "src/sim/ai.ts", existsInPhase: "4.A.1" },
  { path: "src/sim/combat.ts", existsInPhase: "4.A.1" },
  { path: "src/sim/params.ts", existsInPhase: "4.A.1" },
  { path: "src/sim/run.ts", existsInPhase: "4.A.1" },
  { path: "src/sim/turn.ts", existsInPhase: "4.A.1" },
];

/**
 * Strip a leading UTF-8 BOM (U+FEFF, encoded as `0xEF 0xBB 0xBF`)
 * from a string. Pinned by Phase 4 addendum B2.
 */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Normalize a source file's text for content hashing. Strips a leading
 * UTF-8 BOM and replaces every CRLF with LF. Returns the UTF-8 bytes.
 *
 * Defense-in-depth on top of `.gitattributes`'s LF rule (B3): a
 * Windows clone whose `.gitattributes` was missed still computes the
 * same hash as a Linux clone.
 */
export function normalizeForHash(content: string): Uint8Array {
  return utf8(stripBom(content).replace(/\r\n/g, "\n"));
}

/**
 * Map of `RULES_FILES` path → file content. Caller (build-time tooling
 * or the Vite plugin) is responsible for reading the bytes; this
 * helper does no I/O so it stays Node/browser-agnostic and synchronous.
 */
export type RulesText = ReadonlyMap<string, string>;

const NUL = new Uint8Array([0x00]);

/**
 * Compute `rulesetTextHash` from a `RulesText` map. The pre-image is
 * the alphabetically-sorted concatenation of
 * `(utf8(path), 0x00, sha256(normalizeForHash(content)), 0x00)` tuples
 * for each entry of `RULES_FILES` (Phase 4 frozen contract; addendum
 * B2).
 *
 * The sort is canonical: `RULES_FILES` is already in alphabetical order
 * (the order is itself a contract — see `tests/build/rules-text.test.ts`),
 * so iteration order is the contract order.
 *
 * A path missing from `rulesText` throws — every entry of
 * `RULES_FILES` must be supplied. The Vite plugin call site reads the
 * disk; the unit-test call site supplies hand-built fixtures.
 */
export function rulesetTextHash(rulesText: RulesText): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < RULES_FILES.length; i++) {
    const entry = RULES_FILES[i]!;
    const content = rulesText.get(entry.path);
    if (content === undefined) {
      throw new Error(
        `rulesetTextHash: missing content for path ${entry.path}`,
      );
    }
    parts.push(utf8(entry.path));
    parts.push(NUL);
    parts.push(sha256(normalizeForHash(content)));
    parts.push(NUL);
  }
  return sha256(concat(parts));
}

/**
 * Compute `rulesetVersion` from `rulesText` and the atlas binary hash.
 *
 * ```
 * rulesetVersion = sha256(
 *   utf8(rulesetTextHashHex) ‖ utf8("|") ‖ utf8(atlasBinaryHash)
 * )
 * ```
 *
 * Phase 4 frozen contract — see `artifacts/decision-memo-phase-4.md`
 * addendum B2. `atlasBinaryHash` is a 64-char lowercase hex string
 * (SHA-256 of `assets/atlas.png`); the empty-atlas fallback (B5) is
 * the SHA-256 of the empty byte string.
 *
 * **Defined but not yet called at the `define`-block site in
 * Phase 4.A.1** (addendum B1). `vite.config.ts` and `vitest.config.ts`
 * continue to inject `PLACEHOLDER_RULESET_VERSION` for
 * `__RULESET_VERSION__` until Phase 4.A.2 lands `assets/atlas.png` and
 * flips the call sites. The helper is exported now so the Phase 4
 * frozen contract is byte-pinned and unit-tested ahead of the flip.
 */
export function deriveRulesetVersion(
  rulesText: RulesText,
  atlasBinaryHash: string,
): string {
  const textHashHex = sha256Hex(rulesetTextHash(rulesText));
  return sha256Hex(
    concat([utf8(textHashHex), utf8("|"), utf8(atlasBinaryHash)]),
  );
}
