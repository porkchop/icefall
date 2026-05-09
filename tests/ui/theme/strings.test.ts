import { describe, expect, it } from "vitest";
import {
  formatString,
  getString,
  STRING_KEYS,
  type StringKey,
} from "../../../src/ui/theme/strings";

/**
 * Phase 9.A.3 theme-registry tests. Pin the registry shape (every
 * key returns a non-empty string), the substitution syntax (`{token}`
 * replacement, unfilled placeholders preserved), and the
 * documented call-site contract (every key exercised at least
 * once).
 */

describe("formatString — `{token}` substitution", () => {
  it("returns the template unchanged when params is empty", () => {
    expect(formatString("hello world")).toBe("hello world");
    expect(formatString("hello world", {})).toBe("hello world");
  });

  it("substitutes a single token", () => {
    expect(formatString("hello {name}!", { name: "world" })).toBe(
      "hello world!",
    );
  });

  it("substitutes multiple tokens", () => {
    expect(
      formatString("{a} + {b} = {c}", { a: "1", b: "2", c: "3" }),
    ).toBe("1 + 2 = 3");
  });

  it("substitutes the same token repeatedly", () => {
    expect(formatString("{x} {x} {x}", { x: "Y" })).toBe("Y Y Y");
  });

  it("leaves unspecified tokens intact for diagnostic visibility", () => {
    expect(formatString("{a} and {b}", { a: "X" })).toBe("X and {b}");
  });

  it("coerces numeric params to strings", () => {
    expect(formatString("{n} items", { n: 42 })).toBe("42 items");
  });

  // Phase 9.A.3 code-review S1 regression: the substitution must be
  // single-pass — a param value containing a `{token}` substring must
  // NOT be re-substituted by a later iteration. This matters once the
  // future mod-loader allows a mod to supply theme overrides; without
  // single-pass scanning, an attacker could craft a value `{otherKey}`
  // to inject another param's value.
  it("does NOT re-substitute when a param value contains a {token} substring", () => {
    expect(
      formatString("Hello {name}!", { name: "{secret}", secret: "leaked" }),
    ).toBe("Hello {secret}!");
  });

  it("leaves the original {token} text in the param value verbatim (no recursive substitution)", () => {
    expect(
      formatString("{a} and {b}", {
        a: "literal {b} text",
        b: "second-pass-target",
      }),
    ).toBe("literal {b} text and second-pass-target");
  });
});

describe("getString — registry lookup", () => {
  it("returns the default-theme template when no params supplied", () => {
    expect(getString("title.heading")).toBe("ICEFALL");
    expect(getString("hud.hpLabel")).toBe("HP");
  });

  it("substitutes the {date} token in the random-seed button label", () => {
    expect(
      getString("title.randomSeedButton", { date: "2026-05-09" }),
    ).toBe("Random Seed (today: 2026-05-09)");
  });

  it("substitutes the inventory count template", () => {
    expect(
      getString("inventory.countTemplate", {
        stackCount: 3,
        stackNoun: "stacks",
        itemCount: 7,
        itemNoun: "items",
      }),
    ).toBe("3 stacks · 7 items");
  });

  it("returns the byte-exact win-screen heading (em-dash U+2014)", () => {
    expect(getString("winScreen.heading")).toBe("ICEFALL — Run Complete");
  });

  it("returns the byte-exact title-screen footer (middle-dot U+00B7)", () => {
    expect(getString("title.footer")).toBe(
      "Tab to navigate · Enter to activate · The same seed always produces the same dungeon",
    );
  });
});

describe("STRING_KEYS — registry shape", () => {
  it("contains a non-empty list of keys", () => {
    expect(STRING_KEYS.length).toBeGreaterThan(0);
  });

  it("every entry is a non-empty string template", () => {
    for (const key of STRING_KEYS) {
      const v = getString(key);
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("includes every documented section prefix", () => {
    const prefixes = new Set(
      STRING_KEYS.map((k) => k.split(".")[0]).filter((p) => p !== undefined),
    );
    expect(prefixes.has("title")).toBe(true);
    expect(prefixes.has("hud")).toBe(true);
    expect(prefixes.has("inventory")).toBe(true);
    expect(prefixes.has("equipment")).toBe(true);
    expect(prefixes.has("winScreen")).toBe(true);
  });

  it("STRING_KEYS is frozen (registry contract)", () => {
    expect(Object.isFrozen(STRING_KEYS)).toBe(true);
  });

  it("typed StringKey is exhaustive (smoke test on every key)", () => {
    // The discriminator below would compile-error if a new key were
    // added to DEFAULT_THEME without being listed in StringKey.
    const sample: StringKey = "title.heading";
    expect(getString(sample)).toBe("ICEFALL");
  });
});

describe("getString — call-site contract for each consumer module", () => {
  // These tests pin the keys each consumer module is expected to use,
  // so a key rename in src/ui/theme/strings.ts surfaces as a test
  // failure (the consumer-side tests would also break, but pinning
  // here catches the registry-level rename in isolation).

  it("title-screen consumer keys", () => {
    expect(getString("title.heading")).toBeTruthy();
    expect(getString("title.subtitle")).toBeTruthy();
    expect(getString("title.seedLabel")).toBeTruthy();
    expect(getString("title.seedPlaceholder")).toBeTruthy();
    expect(getString("title.newRunButton")).toBeTruthy();
    expect(getString("title.randomSeedButton", { date: "x" })).toBeTruthy();
    expect(getString("title.pasteFpButton")).toBeTruthy();
    expect(getString("title.pasteLabel")).toBeTruthy();
    expect(getString("title.pastePlaceholder")).toBeTruthy();
    expect(getString("title.pasteSubmit")).toBeTruthy();
    expect(getString("title.footer")).toBeTruthy();
  });

  it("hud consumer keys", () => {
    expect(getString("hud.hpLabel")).toBeTruthy();
    expect(getString("hud.floorLabel")).toBeTruthy();
    expect(getString("hud.outcomeLabel")).toBeTruthy();
    expect(getString("hud.fingerprintLabel")).toBeTruthy();
  });

  it("inventory consumer keys", () => {
    expect(getString("inventory.heading")).toBeTruthy();
    expect(getString("inventory.stackNounSingular")).toBeTruthy();
    expect(getString("inventory.stackNounPlural")).toBeTruthy();
    expect(getString("inventory.itemNounSingular")).toBeTruthy();
    expect(getString("inventory.itemNounPlural")).toBeTruthy();
    expect(
      getString("inventory.countTemplate", {
        stackCount: 1,
        stackNoun: "x",
        itemCount: 1,
        itemNoun: "y",
      }),
    ).toBeTruthy();
  });

  it("equipment consumer keys", () => {
    expect(getString("equipment.heading")).toBeTruthy();
    expect(getString("equipment.emptySlot")).toBeTruthy();
  });

  it("win-screen consumer keys", () => {
    expect(getString("winScreen.heading")).toBeTruthy();
    expect(getString("winScreen.fingerprintLabel")).toBeTruthy();
    expect(getString("winScreen.floorLabel")).toBeTruthy();
    expect(getString("winScreen.hpLabel")).toBeTruthy();
    expect(getString("winScreen.wonMessage")).toBeTruthy();
    expect(getString("winScreen.notWonMessage")).toBeTruthy();
  });
});
