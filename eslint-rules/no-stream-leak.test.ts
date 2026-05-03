import { describe, it, expect } from "vitest";
import { Linter } from "eslint";

/**
 * Verifies the `no-restricted-syntax` rule that bans `streams.sim()`
 * and `streams.ui()` member-expression access inside `src/mapgen/**`.
 *
 * Phase 2.A frozen contract 11: mapgen consumes only the `mapgen:N`
 * stream. Three layers enforce it — type discipline, this lint rule,
 * and the runtime per-call delta guard inside `generateFloor`.
 */

const SIM_RULE = {
  selector:
    "MemberExpression[property.type='Identifier'][property.name='sim']",
  message: "no .sim",
};
const UI_RULE = {
  selector:
    "MemberExpression[property.type='Identifier'][property.name='ui']",
  message: "no .ui",
};

function lint(code: string): Linter.LintMessage[] {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-restricted-syntax": ["error", SIM_RULE, UI_RULE],
    },
  });
}

describe("mapgen stream-isolation lint rule (frozen contract 11)", () => {
  it("flags `streams.sim()` as a violation", () => {
    const msgs = lint("function f(s) { return s.sim(); }");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]!.message).toBe("no .sim");
  });

  it("flags `streams.ui()` as a violation", () => {
    const msgs = lint("function f(s) { return s.ui(); }");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]!.message).toBe("no .ui");
  });

  it("flags rebound names too: `bound.sim()` and `bound.ui()`", () => {
    const msgs = lint(
      "function f(s) { const bound = s; bound.sim(); bound.ui(); }",
    );
    expect(msgs.filter((m) => m.message === "no .sim").length).toBe(1);
    expect(msgs.filter((m) => m.message === "no .ui").length).toBe(1);
  });

  it("does NOT flag `streams.mapgen()` (the only allowed accessor)", () => {
    const msgs = lint("function f(s) { return s.mapgen(0); }");
    expect(msgs.filter((m) => m.message === "no .sim").length).toBe(0);
    expect(msgs.filter((m) => m.message === "no .ui").length).toBe(0);
  });
});
