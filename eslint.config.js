import { createRequire } from "node:module";
import tseslint from "typescript-eslint";

const require = createRequire(import.meta.url);
const noFloatArithmetic = require("./eslint-rules/no-float-arithmetic.cjs");

const determinismPlugin = {
  rules: {
    "no-float-arithmetic": noFloatArithmetic,
  },
};

const FORBIDDEN_TIME = [
  {
    selector:
      "MemberExpression[object.name='Math'][property.name='random']",
    message: "Math.random is banned in deterministic code.",
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: "Date.now is banned in deterministic code.",
  },
  {
    selector:
      "MemberExpression[object.name='performance'][property.name='now']",
    message: "performance.now is banned in deterministic code.",
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: "new Date() is banned in deterministic code.",
  },
];

const SIM_UNORDERED = [
  {
    selector: "ForInStatement",
    message:
      "for..in iterates in implementation-defined order — use a sorted array.",
  },
  {
    selector:
      "ForOfStatement > CallExpression.right > MemberExpression.callee[object.name='Object'][property.name=/^(keys|values|entries)$/]",
    message:
      "Object.keys/values/entries are insertion-order — use sortedEntries(...) for determinism.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", "playwright-report", "test-results"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts", "src/sim/**/*.ts", "src/mapgen/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...FORBIDDEN_TIME],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Date is banned in deterministic code." },
        {
          name: "performance",
          message: "performance is banned in deterministic code.",
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sim/**", "**/render/**", "**/input/**", "**/mapgen/**"],
              message:
                "src/core may not depend on higher layers (sim/render/input/mapgen).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/sim/**/*.ts", "src/mapgen/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/render/**", "**/input/**"],
              message:
                "sim/mapgen may not depend on render or input layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/render/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/core/streams", "**/sim/combat"],
              message:
                "render must not import core/streams or sim/combat — it is read-only over sim state.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/sim/**/*.ts", "src/mapgen/**/*.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
      "no-restricted-syntax": [
        "error",
        ...FORBIDDEN_TIME,
        ...SIM_UNORDERED,
      ],
    },
  },
  {
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
    },
  },
);
