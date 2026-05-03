import { describe, expect, it } from "vitest";
import {
  randomWalkDigest,
  RANDOM_WALK_DIGEST,
  runChecks,
  runSelfTests,
  selfTestNames,
} from "./self-test";

describe("randomWalkDigest", () => {
  it("matches the cross-runtime golden constant", () => {
    expect(randomWalkDigest()).toBe(RANDOM_WALK_DIGEST);
  });
});

describe("runSelfTests", () => {
  it("reports all checks passing", () => {
    const result = runSelfTests();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.passed).toBe(result.total);
    expect(result.total).toBeGreaterThanOrEqual(8);
  });

  it("exposes the list of check names", () => {
    expect(selfTestNames().length).toBe(runSelfTests().total);
  });

  it("collects failures with name + message and reports ok=false", () => {
    const result = runChecks([
      { name: "ok-check", run: () => {} },
      {
        name: "throwing-error",
        run: () => {
          throw new Error("boom");
        },
      },
      {
        name: "throwing-string",
        run: () => {
          throw "bare-string";
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.passed).toBe(1);
    expect(result.total).toBe(3);
    expect(result.failures).toEqual([
      "throwing-error: boom",
      "throwing-string: bare-string",
    ]);
  });
});
