import { sha256, sha256Hex, utf8, concat } from "./hash";
import { sfc32 } from "./prng";
import { genesis, advance } from "./state-chain";
import { streamPrng, streamsForRun } from "./streams";
import {
  fingerprint,
  fingerprintFull,
  FINGERPRINT_SHORT_LEN,
  DEV_PREFIX,
} from "./fingerprint";
import { PLACEHOLDER_RULESET_VERSION } from "../build-info";
import { generateFloor } from "../mapgen/generate";
import { serializeFloor } from "../mapgen/serialize";

/**
 * Hardcoded golden digest of a 1,000-step random walk over the state
 * chain, driven by a fixed PRNG. Same value asserted in
 * src/core/self-test.test.ts (Node) and tests/e2e/diagnostic.spec.ts
 * (browsers, via window.__RANDOM_WALK_DIGEST__).
 *
 * If this digest changes, every fingerprint shared so far is
 * unreproducible — the change is a rulesetVersion bump.
 */
export const RANDOM_WALK_DIGEST =
  "142c5ee954cbcd40ea846f00c117bb59828bd61256729b2079c875d2c85dbac4";

/**
 * Hardcoded golden digest of the canonical-JSON serializations of
 * floors 1..10 generated from the fixed self-test root seed (`ROOT`),
 * concatenated as UTF-8 and SHA-256'd.
 *
 * Pinning point for cross-runtime mapgen determinism: any silent drift
 * in BSP partitioning, room placement, corridor carving, encounter
 * placement, tile encoding, or canonical JSON shape surfaces here in
 * any runtime (Node, Chromium, Firefox, WebKit).
 *
 * Changing this constant is a `rulesetVersion` bump and requires
 * `architecture-red-team` review per the planning gate.
 */
export const MAPGEN_DIGEST =
  "d212f5cfe17ae03d03433a4119103a003f0ecfee6a2e6c0610a383d506e4473d";

const DIRECTIONS = ["wait", "move", "use", "attack"] as const;

/**
 * Run a deterministic 1,000-step state-chain walk. Used in both Node
 * and browser tests to prove cross-runtime determinism.
 */
export function randomWalkDigest(): string {
  const r = sfc32(0xdeadbeef, 0x0badf00d, 0xcafebabe, 0x12345678);
  let state = genesis();
  for (let i = 0; i < 1000; i++) {
    const v = r();
    const type = DIRECTIONS[v & 0x03]!;
    const dir = ((v >> 2) & 0x07) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const target = (v >> 5) & 0xff;
    state = advance(state, { type, dir, target });
  }
  return sha256Hex(state);
}

export type SelfTestResult = {
  ok: boolean;
  passed: number;
  total: number;
  failures: string[];
};

export type Check = { name: string; run: () => void };

const ROOT = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eqArr(a: number[] | Uint32Array, b: number[] | Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const checks: Check[] = [
  {
    name: "PRNG repeatability",
    run() {
      const r = sfc32(1, 2, 3, 4);
      const got: number[] = [];
      for (let i = 0; i < 8; i++) got.push(r());
      const expected = [
        7, 34, 56623200, 188882296, 3431242869, 399395954, 785775158, 3843710725,
      ];
      assert(eqArr(got, expected), `golden vector mismatch: ${got.join(",")}`);
    },
  },
  {
    name: "SHA-256 NIST 'abc' vector",
    run() {
      const h = sha256Hex(utf8("abc"));
      assert(
        h === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        `wrong sha256('abc'): ${h}`,
      );
    },
  },
  {
    name: "Stream independence + reproducibility",
    run() {
      const m = streamPrng(ROOT, "mapgen", 0);
      const m2 = streamPrng(ROOT, "mapgen", 0);
      for (let i = 0; i < 8; i++) assert(m() === m2(), "mapgen not reproducible");

      // mapgen(0, ROOT) is byte-pinned to a golden vector so a silent change
      // to the stream-derivation formula or sfc32 implementation surfaces
      // here, in any runtime.
      const golden = streamPrng(ROOT, "mapgen", 0);
      const expected = [
        2530522461, 2884288766, 1774446726, 1434154978,
        74230500, 598396109, 1826277906, 126639865,
      ];
      const got: number[] = [];
      for (let i = 0; i < 8; i++) got.push(golden());
      assert(eqArr(got, expected), `mapgen golden mismatch: ${got.join(",")}`);

      const a = streamPrng(ROOT, "mapgen", 0);
      const b = streamPrng(ROOT, "mapgen", 1);
      let same = 0;
      for (let i = 0; i < 8; i++) if (a() === b()) same++;
      assert(same < 4, "mapgen(0) and mapgen(1) too similar");

      // One-byte-different root: must produce a divergent sequence,
      // proving that root entropy actually flows into derivation.
      const altRoot = ROOT.slice();
      altRoot[0] = (altRoot[0]! ^ 0xff) & 0xff;
      const c = streamPrng(altRoot, "mapgen", 0);
      const d = streamPrng(ROOT, "mapgen", 0);
      let sameRoots = 0;
      for (let i = 0; i < 8; i++) if (c() === d()) sameRoots++;
      assert(sameRoots < 4, "alt-root mapgen produced same sequence");

      const s = streamPrng(ROOT, "sim");
      const m3 = streamPrng(ROOT, "mapgen", 0);
      let same2 = 0;
      for (let i = 0; i < 8; i++) if (s() === m3()) same2++;
      assert(same2 < 4, "sim and mapgen too similar");
    },
  },
  {
    name: "streamsForRun accessors are consistent",
    run() {
      const streams = streamsForRun(ROOT);
      const a = streams.mapgen(0);
      const b = streamPrng(ROOT, "mapgen", 0);
      for (let i = 0; i < 8; i++) assert(a() === b(), "mapgen accessor diverged");
    },
  },
  {
    name: "State chain advances and is order-sensitive",
    run() {
      const A = { type: "move", dir: 1 as const };
      const B = { type: "move", dir: 2 as const };
      const ab = advance(advance(genesis(), A), B);
      const ba = advance(advance(genesis(), B), A);
      assert(sha256Hex(ab) !== sha256Hex(ba), "chain not order-sensitive");
      const same1 = advance(genesis(), A);
      const same2 = advance(genesis(), A);
      assert(sha256Hex(same1) === sha256Hex(same2), "chain not deterministic");
    },
  },
  {
    name: "Fingerprint round-trip + sort stability",
    run() {
      const f1 = fingerprintFull({
        commitHash: "abc",
        rulesetVersion: "ruleset-v1-test",
        seed: "s",
        modIds: ["x", "a", "m"],
      });
      const f2 = fingerprintFull({
        commitHash: "abc",
        rulesetVersion: "ruleset-v1-test",
        seed: "s",
        modIds: ["m", "a", "x"],
      });
      assert(f1 === f2, "modId sort instability");
      assert(f1.length === 43, `wrong full fingerprint length: ${f1.length}`);
      const fp = fingerprint({
        commitHash: "abc",
        rulesetVersion: "ruleset-v1-test",
        seed: "s",
        modIds: [],
      });
      assert(
        fp.length === FINGERPRINT_SHORT_LEN,
        `wrong short fingerprint length: ${fp.length}`,
      );
    },
  },
  {
    name: "Placeholder ruleset emits DEV- prefix",
    run() {
      const fp = fingerprint({
        commitHash: "abc",
        rulesetVersion: PLACEHOLDER_RULESET_VERSION,
        seed: "s",
        modIds: [],
      });
      assert(fp.startsWith(DEV_PREFIX), `expected DEV- prefix, got ${fp}`);
    },
  },
  {
    name: "Cross-runtime random walk digest",
    run() {
      const got = randomWalkDigest();
      assert(
        got === RANDOM_WALK_DIGEST,
        `random walk digest mismatch: ${got}`,
      );
    },
  },
  {
    name: "mapgen-cross-runtime-digest",
    run() {
      const parts: Uint8Array[] = [];
      for (let n = 1; n <= 10; n++) {
        const streams = streamsForRun(ROOT);
        const floor = generateFloor(n, streams);
        parts.push(utf8(serializeFloor(floor)));
      }
      const got = sha256Hex(sha256(concat(parts)));
      assert(
        got === MAPGEN_DIGEST,
        `mapgen-cross-runtime-digest mismatch: actual=${got}`,
      );
    },
  },
  {
    name: "mapgen-stream-isolation",
    run() {
      const streams = streamsForRun(ROOT);
      const before0 = [...streams.__consumed];
      assert(
        before0.length === 0,
        `expected fresh __consumed empty, got ${JSON.stringify(before0)}`,
      );
      generateFloor(1, streams);
      const after1 = [...streams.__consumed].sort();
      assert(
        after1.length === 1 && after1[0] === "mapgen:1",
        `expected ['mapgen:1'] after first call, got ${JSON.stringify(after1)}`,
      );
      generateFloor(2, streams);
      const after2 = [...streams.__consumed].sort();
      assert(
        after2.length === 2 && after2[0] === "mapgen:1" && after2[1] === "mapgen:2",
        `expected ['mapgen:1','mapgen:2'] after second call, got ${JSON.stringify(after2)}`,
      );
    },
  },
];

export function runChecks(list: readonly Check[]): SelfTestResult {
  const failures: string[] = [];
  let passed = 0;
  for (const c of list) {
    try {
      c.run();
      passed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${c.name}: ${msg}`);
    }
  }
  return {
    ok: failures.length === 0,
    passed,
    total: list.length,
    failures,
  };
}

export function runSelfTests(): SelfTestResult {
  return runChecks(checks);
}

export function selfTestNames(): readonly string[] {
  return checks.map((c) => c.name);
}
