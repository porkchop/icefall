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
    // The self-test composer at `src/core/self-test.ts` is the one
    // exception — it imports mapgen / registries to wire in the
    // cross-runtime golden-digest and stream-isolation checks. The
    // import is one-way (self-test → mapgen) and only inside the
    // diagnostic harness; it does not introduce a cycle.
    ignores: ["src/core/self-test.ts"],
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
    // Stream-isolation contract for `src/sim/**`: sim may consume only
    // `streams.simFloor(floorN)` (Phase 3 addendum B4 + B5). The
    // member-access bans on `.mapgen` / `.ui` and the no-arg `.sim`
    // mirror the existing mapgen pattern (see further down).
    //
    // Phase 3 sim must not import the public mapgen surface — it is a
    // forbidden cross-layer edge — except for `src/sim/harness.ts`,
    // which orchestrates the floor-entry block (`generateFloor` +
    // `spawnFloorEntities`) per addendum B5. The harness ban is
    // disabled below by a tighter scope.
    files: ["src/sim/**/*.ts"],
    ignores: ["src/sim/**/*.test.ts", "src/sim/harness.ts"],
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
            {
              group: ["**/mapgen/index", "**/mapgen/generate"],
              message:
                "sim modules other than src/sim/harness.ts must not import the mapgen public surface — Phase 3 addendum B5.",
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
    // `tools/**` is the build-time-only Node code surface (memo
    // addendum N1). Node globals are allowed; render/input layers and
    // any browser-only path are forbidden. Phase 2 establishes the
    // boundary; Phase 4 will adopt the same pattern.
    files: ["tools/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/render/**", "**/input/**", "**/main"],
              message:
                "tools/ is build-time-only Node code — it must not import the running game's render/input layers or browser entry point.",
            },
          ],
        },
      ],
    },
  },
  {
    // Stream-isolation contract for `src/mapgen/**`: mapgen may only
    // consume `streams.mapgen(floorN)`. The runtime guard inside
    // `generateFloor` enforces the per-call delta, but a lint rule
    // catches the easy mistakes (wrong accessor name) at edit time.
    //
    // We can't ban the entire `core/streams` module — mapgen needs
    // `streamsForRun`, the `RunStreams` type, etc. Instead we ban any
    // member-expression that *names* `.sim` or `.ui` on any object
    // inside this scope. This is over-broad in principle (it would
    // also reject `someObject.sim()` if such a method existed in
    // mapgen for non-stream reasons), but no other module under
    // `src/mapgen/**` defines a `.sim` or `.ui` member, so the
    // false-positive surface is empty.
    files: ["src/mapgen/**/*.ts"],
    ignores: ["src/mapgen/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...FORBIDDEN_TIME,
        ...SIM_UNORDERED,
        {
          selector:
            "MemberExpression[property.type='Identifier'][property.name='sim']",
          message:
            "mapgen may not access `.sim` on any object — stream-isolation contract (memo decision 7).",
        },
        {
          selector:
            "MemberExpression[property.type='Identifier'][property.name='ui']",
          message:
            "mapgen may not access `.ui` on any object — stream-isolation contract (memo decision 7).",
        },
      ],
    },
  },
  {
    // Stream-isolation contract for `src/sim/**`: sim may consume only
    // `streams.simFloor(floorN)` (Phase 3 frozen contract 8 + addendum
    // B4). Member-access bans on `.mapgen`, `.ui`, and the no-arg
    // `.sim` are enforced via `no-restricted-syntax`. The selectors
    // also catch the `const { mapgen, ui } = streams` destructuring
    // escape via `ObjectPattern > Property[key.name=...]` (addendum
    // N3). `simFloor` is permitted — different identifier name.
    files: ["src/sim/**/*.ts"],
    ignores: ["src/sim/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...FORBIDDEN_TIME,
        ...SIM_UNORDERED,
        {
          selector:
            "MemberExpression[property.type='Identifier'][property.name='mapgen']",
          message:
            "sim may not access `.mapgen` on any object — stream-isolation contract (memo decision 8).",
        },
        {
          selector:
            "MemberExpression[property.type='Identifier'][property.name='ui']",
          message:
            "sim may not access `.ui` on any object — stream-isolation contract (memo decision 8).",
        },
        {
          selector:
            "MemberExpression[property.type='Identifier'][property.name='sim']",
          message:
            "sim may not access `streams.sim()` (no-arg) — Phase 1 reserved accessor; use streams.simFloor(floorN) instead (memo decision 6 + addendum B4).",
        },
        {
          selector:
            "ObjectPattern > Property[key.type='Identifier'][key.name='mapgen']",
          message:
            "sim may not destructure `.mapgen` from any object — stream-isolation contract escape (addendum N3).",
        },
        {
          selector:
            "ObjectPattern > Property[key.type='Identifier'][key.name='ui']",
          message:
            "sim may not destructure `.ui` from any object — stream-isolation contract escape (addendum N3).",
        },
        {
          selector:
            "ObjectPattern > Property[key.type='Identifier'][key.name='sim']",
          message:
            "sim may not destructure no-arg `.sim` from any object — Phase 1 reserved accessor; use simFloor instead (addendum N3).",
        },
      ],
    },
  },
  {
    // Tests live under the same scope as the production code they
    // exercise. Determinism rules — `no-float-arithmetic`, the
    // `no-restricted-syntax` time/iteration bans — are off inside
    // tests so a test fixture can construct an "almost-good" floor
    // (e.g. with a deliberately illegal float) and still drive the
    // production code's strict path. The production code under test
    // remains under the full rule set in the layer-scoped overrides
    // above.
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
      "determinism/no-float-arithmetic": "off",
    },
  },
);
