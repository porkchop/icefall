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
    files: ["src/core/**/*.ts", "src/sim/**/*.ts", "src/mapgen/**/*.ts", "src/atlas/**/*.ts"],
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
    // Phase 5.A.2 lint-rule body for `src/render/**`. The rows are
    // documented in `docs/ARCHITECTURE.md`'s "Phase 5 frozen contracts
    // (renderer + input + ui)" section. Renderer is a read-only sink
    // on sim state — banning every sim write path keeps the contract
    // type-checkable AND lint-checkable. The Phase 5 layer-table also
    // forbids `src/mapgen/generate.ts` write paths and `src/main.ts`,
    // and forbids mutating any imported state (the runtime
    // architectural test in tests/render/render-readonly.test.ts
    // pins the latter).
    files: ["src/render/**/*.ts"],
    ignores: ["src/render/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/core/streams",
                "**/sim/combat",
                "**/sim/turn",
                "**/sim/run",
                "**/sim/harness",
                "**/sim/ai",
                "**/mapgen/generate",
                "**/input/**",
                "**/main",
              ],
              message:
                "render is a read-only sink on sim state — no sim/mapgen write paths, no input layer, no main orchestrator (Phase 5 frozen contracts).",
            },
          ],
        },
      ],
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
    // Phase 5.A.2 — extend the determinism plugin's float-arithmetic
    // ban to `src/render/**`. The renderer handles integer pixel
    // coordinates only; floor dimensions × TILE_SIZE produces integer
    // canvas dimensions. Float arithmetic creeping in here would be a
    // determinism regression even though canvas blits are not on the
    // state-hash chain.
    files: ["src/render/**/*.ts"],
    ignores: ["src/render/**/*.test.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
    },
  },
  {
    // Phase 5.A.2 lint-rule body for `src/input/**`. The input layer
    // is a peer of `src/render/**` and `src/ui/**` with the same
    // write-path bans. The Phase 5 layer table forbids
    // `src/render/**`, `src/mapgen/**`, and `src/main.ts` imports;
    // ARCHITECTURE.md also calls out the single-orchestrator rule
    // (only `src/main.ts` wires input → sim → render → ui).
    files: ["src/input/**/*.ts"],
    ignores: ["src/input/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/core/streams",
                "**/sim/combat",
                "**/sim/turn",
                "**/sim/run",
                "**/sim/harness",
                "**/sim/ai",
                "**/mapgen/**",
                "**/render/**",
                "**/main",
              ],
              message:
                "input must not import sim/mapgen write paths, render, or main — only `src/main.ts` wires input → sim → render → ui (Phase 5 frozen contracts).",
            },
          ],
        },
      ],
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
    files: ["src/input/**/*.ts"],
    ignores: ["src/input/**/*.test.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
    },
  },
  {
    // Phase 5.A.2 lint-rule body for `src/ui/**`. The HUD is a
    // read-only sink on RunState; same write-path bans as renderer.
    // ARCHITECTURE.md row: "src/ui/" Imports allowed: src/core/
    // (read-only types + fingerprint), src/sim/types, src/build-info.ts.
    files: ["src/ui/**/*.ts"],
    ignores: ["src/ui/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/core/streams",
                "**/sim/combat",
                "**/sim/turn",
                "**/sim/run",
                "**/sim/harness",
                "**/sim/ai",
                "**/mapgen/**",
                "**/render/**",
                "**/input/**",
                "**/main",
              ],
              message:
                "ui must not import sim/mapgen write paths, render, input, or main — only `src/main.ts` wires the four layers together (Phase 5 frozen contracts).",
            },
          ],
        },
      ],
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
    files: ["src/ui/**/*.ts"],
    ignores: ["src/ui/**/*.test.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
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
    // boundary; Phase 4 adopts the same pattern.
    //
    // Phase 4 addendum N10: `tools/**` must use the `node:` prefix on
    // Node built-ins — `node:fs`, `node:path`, `node:url`, never the
    // bare forms (which resolve through Vite's resolver and can
    // collide with a mod's local module).
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
          paths: [
            {
              name: "fs",
              message:
                "node-builtin: use 'node:fs' (or 'node:path', etc.); the bare form resolves through Vite's resolver and can collide with a mod's local module.",
            },
            {
              name: "path",
              message:
                "node-builtin: use 'node:fs' (or 'node:path', etc.); the bare form resolves through Vite's resolver and can collide with a mod's local module.",
            },
            {
              name: "url",
              message:
                "node-builtin: use 'node:fs' (or 'node:path', etc.); the bare form resolves through Vite's resolver and can collide with a mod's local module.",
            },
            {
              name: "fs/promises",
              message:
                "node-builtin: use 'node:fs/promises'; the bare form resolves through Vite's resolver and can collide with a mod's local module.",
            },
          ],
        },
      ],
    },
  },
  {
    // `src/atlas/**` is the Phase 4 atlas-pipeline layer (decision 11
    // + addendum B4). Constraints in 4.A.1 (the layer is empty except
    // for `seed.ts`); constraints enforced for every future entry:
    //
    //   - No `Buffer` (global or `node:buffer` import). Cross-runtime
    //     byte-equality requires `Uint8Array`-only encoding.
    //   - No `crypto.subtle` (async; the build pipeline is sync).
    //   - No `node:crypto` / bare `crypto` import. The pipeline uses
    //     `@noble/hashes/sha256` exclusively (already re-exported from
    //     `src/core/hash.ts`).
    //   - No imports from `sim`, `mapgen`, `render`, `input`, `main`.
    //     Atlas is a peer of sim/mapgen, not a dependent.
    //
    // The `crypto.subtle` ban is a member-access selector, mirroring
    // the `.mapgen` / `.ui` / `.sim` member-access bans elsewhere.
    files: ["src/atlas/**/*.ts"],
    ignores: ["src/atlas/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/sim/**",
                "**/mapgen/**",
                "**/render/**",
                "**/input/**",
                "**/main",
              ],
              message:
                "src/atlas/** is a peer of sim/mapgen — no upward or sibling layer imports allowed (memo decision 11).",
            },
          ],
          paths: [
            {
              name: "node:buffer",
              message:
                "src/atlas/** must use Uint8Array only — no `Buffer` (cross-runtime byte-equality, addendum B4).",
            },
            {
              name: "crypto",
              message:
                "src/atlas/** must use `@noble/hashes/sha256` via src/core/hash — no `crypto` (addendum B4).",
            },
            {
              name: "node:crypto",
              message:
                "src/atlas/** must use `@noble/hashes/sha256` via src/core/hash — no `node:crypto` (addendum B4).",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Date is banned in deterministic code." },
        {
          name: "performance",
          message: "performance is banned in deterministic code.",
        },
        {
          name: "Buffer",
          message:
            "src/atlas/** must use Uint8Array only — no `Buffer` (cross-runtime byte-equality, addendum B4).",
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...FORBIDDEN_TIME,
        ...SIM_UNORDERED,
        {
          selector:
            "MemberExpression[object.name='crypto'][property.name='subtle']",
          message:
            "src/atlas/** must not use `crypto.subtle` — async API; pipeline is sync via `@noble/hashes/sha256` (addendum B4).",
        },
      ],
    },
  },
  {
    // Phase 4.A.2 — extend the determinism plugin to `src/atlas/**`.
    // Memo decision 11 pins `no-float-arithmetic` for the atlas layer
    // (every primitive is integer-only; the encoder is byte-deterministic
    // by construction). The float ban applies to the production code
    // only; tests are exempted by the test-scope override below.
    files: ["src/atlas/**/*.ts"],
    ignores: ["src/atlas/**/*.test.ts"],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
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
    // Phase 8.A.1 — `src/router/**` is the URL parser + redirect +
    // route-error message layer (memo decision 6 + addendum B3, B5,
    // B7). The router does not participate in deterministic
    // simulation byte output (B8) — it consumes URL parameters and
    // routes between `latest/` and `releases/<commit>/`. Layer rules:
    //
    //   - No imports from `src/sim/**`, `src/mapgen/**`,
    //     `src/render/**`, `src/input/**`, `src/atlas/**`. The router
    //     speaks to the URL bar and to `src/share/**` (for action-log
    //     decoding); the rest of the game's state is downstream.
    //   - No `Math.random`, `Date.now`, `performance.now`, `new Date()`.
    //     Routing is deterministic — given the same URL plus the same
    //     `releases/index.json`, the redirect target is fixed.
    //   - Date *consumption* (`Date.toISOString()` to compare-only
    //     ISO-8601 strings from `releases/index.json`'s `publishedAt`
    //     field) is permitted ONLY inside
    //     `src/router/release-index-parse.ts` (advisory A1). All other
    //     router files inherit the deterministic-code Date ban.
    //
    // The directory is empty in 8.A.1; Phase 8.A.2 lands url-parse.ts,
    // redirect.ts, messages.ts, release-index-parse.ts. The
    // release-index-parse.ts file inherits all bans below EXCEPT
    // the Date global / new-Date() ban (that exception lives in a
    // tighter scope below — fix for code-review-phase-8-A-1.md N1).
    files: ["src/router/**/*.ts"],
    ignores: ["src/router/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/sim/**",
                "**/mapgen/**",
                "**/render/**",
                "**/input/**",
                "**/atlas/**",
                "**/main",
              ],
              message:
                "src/router/** may import only src/core/** and src/share/** — routing is upstream of sim/render/input/atlas (memo decision 6 + addendum B5).",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...FORBIDDEN_TIME],
    },
  },
  {
    // Phase 8.A.1 — `src/router/**` Date global ban applies to every
    // file EXCEPT `src/router/release-index-parse.ts` (advisory A1).
    // The exception is for the read-only consumption path of
    // `releases/index.json`'s `publishedAt` ISO-8601 field via
    // `Date.toISOString()`. Math.random / performance.now /
    // cross-layer imports remain banned for that file (inherited
    // from the broader src/router/** block above) — only the Date
    // global is lifted here. Scoping correctness: the broader block
    // above declares `no-restricted-globals` ONLY in this tighter
    // override block, so files under src/router/** that are NOT
    // release-index-parse.ts get the Date ban applied here, while
    // release-index-parse.ts is excluded by the file pattern.
    files: ["src/router/**/*.ts"],
    ignores: [
      "src/router/**/*.test.ts",
      "src/router/release-index-parse.ts",
    ],
    rules: {
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
    // Phase 8.A.1 — advisory A1: `src/router/release-index-parse.ts`
    // is the ONE file in src/router/** allowed to use `Date` (for
    // `new Date(publishedAt).toISOString()` round-trip consumption
    // of `releases/index.json`'s `publishedAt` ISO-8601 field). The
    // input is a fixed string from a JSON manifest, so the use is
    // determinism-safe. Bans preserved for THIS file:
    //   - Math.random  (no PRNG-as-time-source)
    //   - Date.now()   (no clock-as-time-source — the time source is
    //                   the publishedAt string, not the current time)
    //   - performance.now()
    //   - cross-layer imports (inherited from the broader
    //     `src/router/**` block above)
    //
    // Lifted: `Date` global + `new Date(...)` constructor (so the
    // file may parse the publishedAt string and call .toISOString()
    // for round-trip).
    //
    // Not in scope: the file MUST NOT use `Date.now()` or zero-arg
    // `new Date()` (clock reads); the FORBIDDEN_TIME entries for
    // those remain enforced via the `no-restricted-syntax` rule in
    // this override.
    files: ["src/router/release-index-parse.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='Math'][property.name='random']",
          message: "Math.random is banned in deterministic code.",
        },
        {
          selector:
            "MemberExpression[object.name='Date'][property.name='now']",
          message:
            "Date.now is banned even in src/router/release-index-parse.ts — the file may parse the publishedAt string but must not read the wall clock.",
        },
        {
          selector:
            "MemberExpression[object.name='performance'][property.name='now']",
          message: "performance.now is banned in deterministic code.",
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "performance",
          message: "performance is banned in deterministic code.",
        },
      ],
    },
  },
  {
    // Phase 8.A.1 — `src/verifier/**` is the pure verifier layer
    // (memo decision 10 + addendum B8). Unlike the rest of the new
    // layers, the verifier IS allowed to import `src/sim/harness.ts`
    // because verification runs a fresh simulation under the action
    // log and asserts the resulting state hash matches the claim.
    // The verifier is NOT in `RULES_FILES` because its content does
    // not affect simulation byte output — it consumes the output.
    // The reachability test in `tests/build/rules-files-reachability
    // .test.ts` defends against accidental `harness → verifier`
    // imports.
    files: ["src/verifier/**/*.ts"],
    ignores: ["src/verifier/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/render/**",
                "**/input/**",
                "**/atlas/**",
                "**/router/**",
                "**/save/**",
                "**/main",
              ],
              message:
                "src/verifier/** may import src/core/**, src/share/**, src/sim/harness, src/sim/types only — verifier consumes simulation output (memo decision 10 + addendum B8).",
            },
          ],
        },
      ],
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
    // Phase 8.A.1 — `src/share/**` is the action-log codec layer
    // (memo decision 2 + addendum B1, B2). The wire form is
    // `base64url(fflate.zlibSync(envelope, { level: 1 }))`; the
    // decoder is `fflate.unzlibSync(base64urlDecode(s))`. The
    // sibling `deflateSync` / `inflateSync` functions emit raw
    // DEFLATE without the zlib header + Adler-32 trailer and are
    // byte-distinct from the `zlibSync` wire form — using them
    // would silently fork the cross-runtime byte-identity guarantee
    // inherited from `src/atlas/png.ts`'s `zlibSync` usage. Lint
    // bans the wrong fflate functions here.
    files: ["src/share/**/*.ts"],
    ignores: ["src/share/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/sim/**",
                "**/mapgen/**",
                "**/render/**",
                "**/input/**",
                "**/atlas/**",
                "**/router/**",
                "**/verifier/**",
                "**/save/**",
                "**/main",
              ],
              message:
                "src/share/** may import only src/core/** and the fflate `zlibSync`/`unzlibSync` pair (memo addendum B1).",
            },
          ],
          paths: [
            {
              name: "fflate",
              importNames: ["deflateSync", "inflateSync"],
              message:
                "src/share/** must use `zlibSync`/`unzlibSync` (memo addendum B1) — the raw `deflateSync`/`inflateSync` functions emit byte-distinct output without the zlib header + Adler-32 trailer and would fork cross-runtime byte-identity.",
            },
          ],
        },
      ],
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
    // Phase 8.A.1 — `src/save/**` is the localStorage persistence
    // layer (memo decision 8 + addendum B6). Save slots are keyed
    // by fingerprint short-form; build-mismatched slots are routed
    // through release-redirect rather than deleted. The save layer
    // imports `src/share/**` (for action-log encoding) and
    // `src/core/**` only.
    files: ["src/save/**/*.ts"],
    ignores: ["src/save/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/sim/**",
                "**/mapgen/**",
                "**/render/**",
                "**/input/**",
                "**/atlas/**",
                "**/router/**",
                "**/verifier/**",
                "**/main",
              ],
              message:
                "src/save/** may import only src/core/** and src/share/** — save layer is upstream of sim (memo decision 8 + addendum B6).",
            },
          ],
        },
      ],
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
    // Phase 8.A.1 code-review N3 — extend the determinism plugin's
    // no-float-arithmetic ban to src/share/** and src/verifier/**:
    // both are integer-only by construction (the codec is
    // byte-deterministic; the verifier hashes integers).
    //
    // Phase 8.A.2b note: src/router/** and src/save/** are EXCLUDED
    // from this scope because they legitimately use `JSON.parse` at
    // the data-ingestion boundary (releases/index.json + localStorage
    // SaveSlot records — both are external untrusted strings). The
    // current `determinism/no-float-arithmetic` rule bundles a
    // `JSON.parse` ban that's appropriate for the deterministic
    // simulation core but not for the URL-routing and save-slot
    // boundary layers. Float arithmetic is still discouraged in
    // those layers but not lint-enforced; future polish can split
    // the rule and re-extend.
    files: [
      "src/verifier/**/*.ts",
      "src/share/**/*.ts",
    ],
    ignores: [
      "src/verifier/**/*.test.ts",
      "src/share/**/*.test.ts",
    ],
    plugins: { determinism: determinismPlugin },
    rules: {
      "determinism/no-float-arithmetic": "error",
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
