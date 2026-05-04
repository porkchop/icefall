/**
 * Phase 4 frozen-contract item 8 — the cyberpunk-neon-v1 16-color
 * indexed palette (memo decision 5). Pinned in this file. Per-entry RGB
 * values are part of the frozen contract; tweaking any byte is a
 * `rulesetVersion` bump.
 *
 * Slot conventions:
 *   - Index 0 is **fully transparent** (r=g=b=a=0). Recipes that paint
 *     palette index 0 produce a transparent pixel.
 *   - Indices 1..15 are **fully opaque** (a=255). No partial alpha
 *     anywhere — keeps the PNG `tRNS` chunk minimal (entry 0 = 0x00,
 *     entries 1..15 = 0xFF) and avoids per-pixel blending in Phase 5+.
 *
 * Design notes (programmer art per `docs/PHASES.md:222`):
 *   - Slots 1..3 are deep dark backgrounds (sub-floor void, dark grey,
 *     dark navy) for tile interiors.
 *   - Slots 4..6 are mid-tone structural colors (steel grey, neon-rim
 *     blues/purples) for walls, doors, NPC silhouettes.
 *   - Slots 7..15 are bright neon accents (cyan, magenta, yellow,
 *     green, orange, white) for hot-spots, eyes, weapon glows.
 */

export type PaletteColorName =
  | "transparent"
  | "void-black"
  | "dark-grey"
  | "deep-blue"
  | "deep-purple"
  | "steel-grey"
  | "rim-blue"
  | "neon-cyan"
  | "neon-magenta"
  | "neon-yellow"
  | "neon-green"
  | "neon-orange"
  | "blood-red"
  | "flesh-pink"
  | "ice-white"
  | "warning-amber";

export type RgbaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

export type Palette = {
  readonly id: string;
  readonly colors: readonly RgbaColor[];
  readonly names: ReadonlyMap<PaletteColorName, number>;
};

const COLORS: readonly RgbaColor[] = Object.freeze([
  Object.freeze({ r: 0, g: 0, b: 0, a: 0 }), //   0  transparent
  Object.freeze({ r: 8, g: 6, b: 16, a: 255 }), //  1  void-black
  Object.freeze({ r: 32, g: 28, b: 40, a: 255 }), // 2  dark-grey
  Object.freeze({ r: 12, g: 24, b: 56, a: 255 }), // 3  deep-blue
  Object.freeze({ r: 40, g: 16, b: 64, a: 255 }), // 4  deep-purple
  Object.freeze({ r: 80, g: 80, b: 96, a: 255 }), // 5  steel-grey
  Object.freeze({ r: 64, g: 96, b: 160, a: 255 }), // 6 rim-blue
  Object.freeze({ r: 64, g: 224, b: 240, a: 255 }), // 7 neon-cyan
  Object.freeze({ r: 240, g: 64, b: 192, a: 255 }), // 8 neon-magenta
  Object.freeze({ r: 240, g: 224, b: 64, a: 255 }), // 9 neon-yellow
  Object.freeze({ r: 64, g: 240, b: 128, a: 255 }), // 10 neon-green
  Object.freeze({ r: 240, g: 144, b: 32, a: 255 }), // 11 neon-orange
  Object.freeze({ r: 192, g: 32, b: 48, a: 255 }), //  12 blood-red
  Object.freeze({ r: 224, g: 168, b: 144, a: 255 }), // 13 flesh-pink
  Object.freeze({ r: 224, g: 240, b: 248, a: 255 }), // 14 ice-white
  Object.freeze({ r: 240, g: 192, b: 96, a: 255 }), //  15 warning-amber
]);

const NAMES_MAP = new Map<PaletteColorName, number>([
  ["transparent", 0],
  ["void-black", 1],
  ["dark-grey", 2],
  ["deep-blue", 3],
  ["deep-purple", 4],
  ["steel-grey", 5],
  ["rim-blue", 6],
  ["neon-cyan", 7],
  ["neon-magenta", 8],
  ["neon-yellow", 9],
  ["neon-green", 10],
  ["neon-orange", 11],
  ["blood-red", 12],
  ["flesh-pink", 13],
  ["ice-white", 14],
  ["warning-amber", 15],
]);

export const PALETTE_NAMES: ReadonlyMap<PaletteColorName, number> = NAMES_MAP;

export const CYBERPUNK_NEON_V1: Palette = Object.freeze({
  id: "cyberpunk-neon-v1",
  colors: COLORS,
  names: PALETTE_NAMES,
});
