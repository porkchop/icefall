import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rule = require("./no-float-arithmetic.cjs") as Parameters<
  RuleTester["run"]
>[1];

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

// Hand RuleTester the vitest globals so each fixture surfaces as its own
// test in the runner output.
RuleTester.it = it as unknown as typeof RuleTester.it;
RuleTester.describe = describe as unknown as typeof RuleTester.describe;

tester.run("no-float-arithmetic", rule, {
  valid: [
    "const x = 1 + 2;",
    "const y = 1 - 2;",
    "const z = 3 * 4;",
    "const a = 5 % 2;",
    "const b = 2 ** 10;",
    "const c = 0xff | 0x0f;",
    "const d = (1 & 2) | 3;",
    "const e = 1 << 2;",
    "const f = 1 >> 2;",
    "const g = 1 >>> 2;",
    "const h = ~1;",
    "import { idiv } from '../sim/math'; const x = idiv(10, 3);",
    "const arr = [1, 2, 3]; const n = arr.length;",
    "const big = 0x7fffffff;",
    "const neg = -123;",
  ],
  invalid: [
    { code: "const x = 0.5;", errors: [{ messageId: "decimalLiteral" }] },
    { code: "const x = 1.0;", errors: [{ messageId: "decimalLiteral" }] },
    { code: "const x = -0.5;", errors: [{ messageId: "decimalLiteral" }] },
    { code: "const x = 1e10;", errors: [{ messageId: "exponentLiteral" }] },
    { code: "const x = 5e-1;", errors: [{ messageId: "exponentLiteral" }] },
    { code: "const x = 1E5;", errors: [{ messageId: "exponentLiteral" }] },
    { code: "const x = 1 / 2;", errors: [{ messageId: "divOperator" }] },
    { code: "let a = 10; a /= 2;", errors: [{ messageId: "divOperator" }] },
    {
      code: "const arr = [1]; const x = arr.length / 2;",
      errors: [{ messageId: "divOperator" }],
    },
    {
      code: "const x = (1 / 2) | 0;",
      errors: [{ messageId: "divOperator" }],
    },
    { code: "const x = Math.PI;", errors: [{ messageId: "mathMember" }] },
    {
      code: "const x = Math.floor(1.5);",
      errors: [{ messageId: "mathMember" }, { messageId: "decimalLiteral" }],
    },
    { code: "const x = Math.sqrt(4);", errors: [{ messageId: "mathMember" }] },
    { code: "const x = Math.random();", errors: [{ messageId: "mathMember" }] },
    { code: "const x = Math.E;", errors: [{ messageId: "mathMember" }] },
    {
      code: "const x = Number.EPSILON;",
      errors: [{ messageId: "numberMember" }],
    },
    {
      code: "const x = Number.MAX_VALUE;",
      errors: [{ messageId: "numberMember" }],
    },
    {
      code: "const x = parseFloat('0.5');",
      errors: [{ messageId: "globalParseFloat" }],
    },
    {
      code: "const x = Number.parseFloat('0.5');",
      errors: [{ messageId: "numberMember" }],
    },
    {
      code: "const x = JSON.parse('{\"x\":0.5}');",
      errors: [{ messageId: "jsonParse" }],
    },
  ],
});
