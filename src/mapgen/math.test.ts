import { describe, expect, it } from "vitest";
import { idiv, imod } from "./math";

describe("idiv (integer division, deterministic, no float operator)", () => {
  it("returns floor of a/b for positive integers", () => {
    expect(idiv(10, 3)).toBe(3);
    expect(idiv(0, 3)).toBe(0);
    expect(idiv(1, 1)).toBe(1);
    expect(idiv(99, 100)).toBe(0);
    expect(idiv(100, 100)).toBe(1);
    expect(idiv(101, 100)).toBe(1);
  });

  it("matches a reference for many positive cases", () => {
    for (let a = 0; a < 200; a++) {
      for (let b = 1; b < 17; b++) {
        const expected = (a - (a % b)) / b;
        expect(idiv(a, b)).toBe(expected);
      }
    }
  });

  it("handles large operands within safe integer range", () => {
    expect(idiv(60 * 24, 60)).toBe(24);
    expect(idiv(0x7fffffff, 1)).toBe(0x7fffffff);
    expect(idiv(0x7fffffff, 2)).toBe(0x3fffffff);
  });

  it("throws on zero divisor", () => {
    expect(() => idiv(10, 0)).toThrow();
  });

  it("throws on non-integer or negative operands", () => {
    expect(() => idiv(-1, 2)).toThrow();
    expect(() => idiv(1, -2)).toThrow();
    expect(() => idiv(1.5, 2)).toThrow();
  });

  it("throws on out-of-int32-range operands", () => {
    expect(() => idiv(0x80000000, 1)).toThrow();
    expect(() => idiv(1, 0x80000000)).toThrow();
  });
});

describe("imod (integer modulo, no float operator)", () => {
  it("returns a%b for positive integers", () => {
    expect(imod(10, 3)).toBe(1);
    expect(imod(0, 3)).toBe(0);
    expect(imod(9, 3)).toBe(0);
  });

  it("agrees with idiv on the division identity a = idiv(a,b)*b + imod(a,b)", () => {
    for (let a = 0; a < 200; a++) {
      for (let b = 1; b < 17; b++) {
        expect(idiv(a, b) * b + imod(a, b)).toBe(a);
      }
    }
  });

  it("throws on zero divisor", () => {
    expect(() => imod(10, 0)).toThrow();
  });

  it("throws on out-of-range operands", () => {
    expect(() => imod(0x80000000, 1)).toThrow();
    expect(() => imod(1, 0x80000000)).toThrow();
    expect(() => imod(-1, 1)).toThrow();
    expect(() => imod(1.5, 1)).toThrow();
  });
});
