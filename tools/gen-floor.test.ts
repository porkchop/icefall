import { describe, expect, it } from "vitest";
import { main } from "./gen-floor";

describe("gen-floor CLI", () => {
  it("writes an ASCII rendering of the requested floor to stdout", () => {
    let captured = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
      captured += s;
      return true;
    };
    try {
      main(["--seed", "phase2-test", "--floor", "1"]);
    } finally {
      (process.stdout as { write: typeof origWrite }).write = origWrite;
    }
    // ASCII output ends with a single trailing newline.
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.endsWith("\n")).toBe(true);
    // 60×24 standard floor → 24 rows × 60 chars + 24 newlines = 1464 chars
    expect(captured.length).toBe(60 * 24 + 24);
  });

  it("rejects missing --seed", () => {
    expect(() => main(["--floor", "1"])).toThrow(/--seed/);
  });

  it("rejects floor out of 1..10 range", () => {
    expect(() => main(["--seed", "x", "--floor", "0"])).toThrow(/1\.\.10/);
    expect(() => main(["--seed", "x", "--floor", "11"])).toThrow(/1\.\.10/);
  });

  it("rejects non-integer floor strings (e.g. 1.5)", () => {
    expect(() => main(["--seed", "x", "--floor", "1.5"])).toThrow(/1\.\.10/);
    expect(() => main(["--seed", "x", "--floor", "abc"])).toThrow(/1\.\.10/);
  });

  it("rejects unknown arguments", () => {
    expect(() => main(["--bogus"])).toThrow(/unrecognized/);
  });

  it("renders the same output across two runs with the same args", () => {
    let a = "";
    let b = "";
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
      a += s;
      return true;
    };
    main(["--seed", "phase2-cli-determinism", "--floor", "3"]);
    (process.stdout as { write: (s: string) => boolean }).write = (s: string) => {
      b += s;
      return true;
    };
    main(["--seed", "phase2-cli-determinism", "--floor", "3"]);
    (process.stdout as { write: typeof orig }).write = orig;
    expect(a).toBe(b);
  });
});
