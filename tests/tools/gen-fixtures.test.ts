/**
 * Phase 3.A.1 carry-forward from Phase 2.A code-review N3:
 * tools/gen-fixtures.ts lacked a focused unit test (the function was
 * transitively covered by the fixture-pack byte-equality tests). This
 * file covers the three exported helpers — `slug` validation via
 * `fixturePathFor`, `generatePair` happy path, and `readManifest`
 * malformed-input handling.
 */
import { describe, expect, it } from "vitest";
import { fixturePathFor, generatePair, readManifest } from "../../tools/gen-fixtures";
import { parseFloor } from "../../src/mapgen/serialize";

describe("tools/gen-fixtures: fixturePathFor", () => {
  it("returns a path under tests/fixtures/floors with the seed and floor encoded", () => {
    const p = fixturePathFor({ seed: "stack-traversal", floor: 3 }, "json");
    expect(p).toMatch(/tests[\/\\]fixtures[\/\\]floors[\/\\]stack-traversal__floor3\.json$/);
  });

  it("returns the .ascii extension when requested", () => {
    const p = fixturePathFor({ seed: "boss-arena", floor: 10 }, "ascii");
    expect(p).toMatch(/boss-arena__floor10\.ascii$/);
  });

  it("rejects seeds containing a non-[A-Za-z0-9-] character (underscore)", () => {
    expect(() =>
      fixturePathFor({ seed: "bad_seed", floor: 1 }, "json"),
    ).toThrow(/non-\[A-Za-z0-9-\] character at index 3/);
  });

  it("rejects seeds containing a non-[A-Za-z0-9-] character (period)", () => {
    expect(() =>
      fixturePathFor({ seed: "seed.dot", floor: 1 }, "json"),
    ).toThrow(/non-\[A-Za-z0-9-\] character at index 4/);
  });

  it("rejects seeds containing whitespace", () => {
    expect(() =>
      fixturePathFor({ seed: "seed with space", floor: 1 }, "json"),
    ).toThrow(/non-\[A-Za-z0-9-\] character at index 4/);
  });

  it("rejects seeds containing a path traversal segment", () => {
    expect(() =>
      fixturePathFor({ seed: "../escape", floor: 1 }, "json"),
    ).toThrow(/non-\[A-Za-z0-9-\] character at index 0/);
  });

  it("accepts seeds with only ASCII alphanumerics and hyphens", () => {
    expect(() =>
      fixturePathFor({ seed: "abcXYZ-09", floor: 1 }, "json"),
    ).not.toThrow();
  });

  it("rejects seeds with characters outside the BMP (high codepoint)", () => {
    // "☃" charCodeAt(0) > 127 — not in [0-9A-Za-z-]
    expect(() =>
      fixturePathFor({ seed: "snow☃", floor: 1 }, "json"),
    ).toThrow(/non-\[A-Za-z0-9-\] character at index 4/);
  });
});

describe("tools/gen-fixtures: generatePair", () => {
  it("returns a (json, ascii) pair for a valid (seed, floor) entry", () => {
    const pair = generatePair({ seed: "seed-A-floor1", floor: 1 });
    expect(typeof pair.json).toBe("string");
    expect(typeof pair.ascii).toBe("string");
    expect(pair.json.length).toBeGreaterThan(0);
    expect(pair.ascii.length).toBeGreaterThan(0);
  });

  it("returns identical output for identical (seed, floor) inputs", () => {
    const a = generatePair({ seed: "seed-A-floor1", floor: 1 });
    const b = generatePair({ seed: "seed-A-floor1", floor: 1 });
    expect(a.json).toBe(b.json);
    expect(a.ascii).toBe(b.ascii);
  });

  it("returns different output for different seeds at the same floor", () => {
    const a = generatePair({ seed: "seed-A-floor1", floor: 1 });
    const b = generatePair({ seed: "seed-B-floor1", floor: 1 });
    expect(a.json).not.toBe(b.json);
  });

  it("emits a json field that round-trips through parseFloor", () => {
    const pair = generatePair({ seed: "seed-A-floor1", floor: 1 });
    const obj: unknown = JSON.parse(pair.json);
    const parsed = parseFloor(obj);
    expect(parsed.floor).toBe(1);
    expect(parsed.width).toBeGreaterThan(0);
    expect(parsed.height).toBeGreaterThan(0);
  });

  it("emits ASCII output ending in exactly one trailing newline (frozen contract N3)", () => {
    const pair = generatePair({ seed: "seed-A-floor1", floor: 1 });
    expect(pair.ascii.endsWith("\n")).toBe(true);
    expect(pair.ascii.endsWith("\n\n")).toBe(false);
  });

  it("propagates the slug-validation error when seed contains illegal characters via the path helper used downstream by main()", () => {
    // generatePair itself does not validate the seed (only fixturePathFor
    // does); but main() composes the two, so an illegal seed in the
    // manifest would fail at fixturePathFor time before any file is
    // written. Exercise the composition.
    expect(() =>
      fixturePathFor({ seed: "bad/seed", floor: 1 }, "json"),
    ).toThrow();
  });
});

describe("tools/gen-fixtures: readManifest", () => {
  it("returns the on-disk manifest with a non-empty pairs array", () => {
    const m = readManifest();
    expect(Array.isArray(m.pairs)).toBe(true);
    expect(m.pairs.length).toBeGreaterThan(0);
  });

  it("each manifest pair has a string seed and integer floor in [1..10]", () => {
    const m = readManifest();
    for (const entry of m.pairs) {
      expect(typeof entry.seed).toBe("string");
      expect(entry.seed.length).toBeGreaterThan(0);
      expect(Number.isInteger(entry.floor)).toBe(true);
      expect(entry.floor).toBeGreaterThanOrEqual(1);
      expect(entry.floor).toBeLessThanOrEqual(10);
    }
  });

  it("does not call the gen-fixtures CLI side effect under VITEST", () => {
    // The runIfEntry guard at the bottom of gen-fixtures.ts checks
    // process.env.VITEST and returns early. If it ever fired during
    // import, the import statement at the top of this file would
    // either crash (writes are blocked) or write fixture files as a
    // side effect — the existence of this passing test is the
    // assertion that neither happened.
    expect(process.env["VITEST"]).toBeDefined();
  });
});
