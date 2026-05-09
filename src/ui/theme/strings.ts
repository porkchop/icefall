/**
 * Phase 9.A.3 theme registry — every UI-text constant flows through
 * this single registry. Per `docs/PHASES.md:591` acceptance criterion 3
 * ("All text rendered through the theme registry (so a future theme
 * mod can replace it)"), each UI module references a typed string
 * key instead of inlining a literal. The registry exposes a single
 * default theme; future Phase 9 mod-loader work can replace the
 * default by binding a different theme at runtime.
 *
 * **Layer.** This module lives at `src/ui/theme/` and inherits the
 * existing `src/ui/**` lint scope (no Date access, no PRNG, no
 * floats). The registry is a pure mapping from typed keys to
 * template strings; the only logic is a small `formatString` helper
 * that does `{token}` substitution.
 *
 * **Mod-overlay surface (deferred to Phase 9+ mod-loader).** The
 * default registry is a `const` object; a future mod can override
 * entries by calling a `bindTheme(overrides)` function that swaps
 * in a layered registry. For 9.A.3 we ship only the default; the
 * `getString` indirection makes the future swap a one-line change
 * with no consumer-side refactoring.
 */

/**
 * The default English theme. Add a new entry here AND add its key to
 * the `StringKey` union below so `getString` is type-checked at every
 * call site. Tokens like `{date}` are substituted at call time via
 * `formatString` / `getString(key, params)`.
 */
const DEFAULT_THEME = {
  // Title screen (Phase 9.A.2 + 9.A.3).
  "title.heading": "ICEFALL",
  "title.subtitle":
    "Deterministic-shareable cyberpunk roguelike. Pick a seed and start descending the stack.",
  "title.seedLabel": "Seed",
  "title.seedPlaceholder": "alpha-1",
  "title.newRunButton": "New Run",
  "title.randomSeedButton": "Random Seed (today: {date})",
  "title.pasteFpButton": "Paste Fingerprint",
  "title.pasteLabel": "Paste a fingerprint URL or 22-char fingerprint",
  "title.pastePlaceholder":
    "https://porkchop.github.io/icefall/?run=...&seed=...",
  "title.pasteSubmit": "Open pasted run",
  "title.footer":
    "Tab to navigate · Enter to activate · The same seed always produces the same dungeon",

  // HUD (Phase 5.A.2).
  "hud.hpLabel": "HP",
  "hud.floorLabel": "FLOOR",
  "hud.outcomeLabel": "OUTCOME",
  "hud.fingerprintLabel": "FP",

  // Inventory (Phase 6.A.2). Pluralization handled by selecting
  // singular/plural noun forms; the count template assembles the
  // final string from the parts. A future locale overlay can swap
  // the noun forms or the template independently.
  "inventory.heading": "Inventory",
  "inventory.stackNounSingular": "stack",
  "inventory.stackNounPlural": "stacks",
  "inventory.itemNounSingular": "item",
  "inventory.itemNounPlural": "items",
  "inventory.countTemplate": "{stackCount} {stackNoun} · {itemCount} {itemNoun}",

  // Equipment (Phase 6.A.2).
  "equipment.heading": "Equipment",
  "equipment.emptySlot": "(empty)",

  // Win screen (Phase 7.A.2).
  "winScreen.heading": "ICEFALL — Run Complete",
  "winScreen.fingerprintLabel": "Fingerprint",
  "winScreen.floorLabel": "Final Floor",
  "winScreen.hpLabel": "Final HP",
  "winScreen.wonMessage":
    "You defeated the floor-10 boss. The shareable fingerprint below proves your run.",
  "winScreen.notWonMessage": "Run not yet complete.",
} as const;

/**
 * Typed string-key union derived from the DEFAULT_THEME shape. Every
 * `getString(key, ...)` call at every UI-module call site type-checks
 * against this union; a typo at the call site is a compile-time error.
 */
export type StringKey = keyof typeof DEFAULT_THEME;

/**
 * Substitute `{token}` placeholders in a template. Each placeholder
 * in `params` is matched exactly (e.g. `{date}` not `{Date}`);
 * unspecified placeholders are left intact for diagnostic visibility
 * (a developer reading `{date}` in an unfilled message can tell the
 * substitution map was incomplete).
 *
 * Single-pass substitution: a param value containing a `{token}`
 * substring will NOT be re-substituted by a later iteration. This
 * matters once Phase 9+ mod-loader work allows a mod to supply
 * theme overrides — without single-pass scanning, an attacker
 * could craft a value `{otherKey}` that re-injects another param's
 * value (code-review-phase-9-A-3.md S1 fix).
 *
 * Mirrors the `fillTemplate` helper from `src/router/messages.ts`
 * (which uses `<token>` syntax — different syntax intentionally to
 * keep the URL-error templates byte-distinguishable from the
 * UI-theme strings; Phase 8 router error strings include literal
 * angle-bracketed text in their pinned form so `<token>` is the
 * substitution syntax there).
 */
export function formatString(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  // Single-pass scan: replace every `{token}` occurrence with the
  // matching param value (or leave intact if no match). The regex
  // matches one bracketed token at a time and the replace callback
  // looks up each independently, so a substituted value containing
  // `{otherKey}` is NOT re-scanned for further substitution.
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return whole;
  });
}

/**
 * Look up a typed string key in the active theme, applying optional
 * `{token}` substitutions from `params`.
 *
 * Phase 9.A.3 ships only the default theme. The `getString`
 * indirection is the seam for future mod-loader theme overlays:
 * binding a different theme would replace the lookup table without
 * touching the caller-side syntax.
 */
export function getString(
  key: StringKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = DEFAULT_THEME[key];
  if (params === undefined || Object.keys(params).length === 0) {
    return template;
  }
  return formatString(template, params);
}

/**
 * The set of all string keys in the default theme. Exposed so tests
 * can iterate the registry shape.
 */
export const STRING_KEYS: readonly StringKey[] = Object.freeze(
  Object.keys(DEFAULT_THEME) as StringKey[],
);
