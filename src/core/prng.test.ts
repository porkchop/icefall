import { describe, expect, it } from "vitest";
import { sfc32, sfc32FromBytes, drawN } from "./prng";
import { sha256Hex } from "./hash";

describe("sfc32", () => {
  it("is deterministic given the same seed", () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("differs from a one-bit-different seed", () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 5);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a() === b()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  it("produces u32 outputs", () => {
    const r = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("matches a golden 8-value sequence for seed (1,2,3,4)", () => {
    const r = sfc32(1, 2, 3, 4);
    const got: number[] = [];
    for (let i = 0; i < 8; i++) got.push(r());
    expect(got).toEqual([
      7, 34, 56623200, 188882296, 3431242869, 399395954, 785775158, 3843710725,
    ]);
  });

  it("matches a hardcoded SHA-256 digest of 1000 outputs (seed 0xDEADBEEF/etc)", () => {
    const r = sfc32(0xdeadbeef, 0x0badf00d, 0xcafebabe, 0x12345678);
    const buf = new Uint8Array(4000);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 1000; i++) {
      view.setUint32(i * 4, r(), true);
    }
    expect(sha256Hex(buf)).toBe(
      "cf98df0b135cee6dfe9677d6c40623a8def78e4ddc3539fc8dfa4b8fe3e1595d",
    );
  });
});

describe("sfc32FromBytes", () => {
  it("seeds from the first 16 bytes (little-endian)", () => {
    const bytes = new Uint8Array([
      0x01, 0x00, 0x00, 0x00,
      0x02, 0x00, 0x00, 0x00,
      0x03, 0x00, 0x00, 0x00,
      0x04, 0x00, 0x00, 0x00,
    ]);
    const a = sfc32FromBytes(bytes);
    const b = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });

  it("ignores bytes beyond the 16th", () => {
    const base = new Uint8Array(16);
    for (let i = 0; i < 16; i++) base[i] = i;
    const ext = new Uint8Array(32);
    ext.set(base, 0);
    for (let i = 16; i < 32; i++) ext[i] = 0xff;
    const a = sfc32FromBytes(base);
    const b = sfc32FromBytes(ext);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });

  it("throws on input shorter than 16 bytes", () => {
    expect(() => sfc32FromBytes(new Uint8Array(15))).toThrowError(/16 bytes/);
    expect(() => sfc32FromBytes(new Uint8Array(0))).toThrowError(/16 bytes/);
  });

  it("works when the source has a non-zero byteOffset", () => {
    const buf = new Uint8Array(20);
    for (let i = 0; i < 20; i++) buf[i] = 0xa5;
    const window = new Uint8Array(buf.buffer, 4, 16);
    const a = sfc32FromBytes(window);
    const expected = sfc32(0xa5a5a5a5, 0xa5a5a5a5, 0xa5a5a5a5, 0xa5a5a5a5);
    for (let i = 0; i < 8; i++) expect(a()).toBe(expected());
  });
});

describe("drawN", () => {
  it("returns the requested number of u32s", () => {
    const r = sfc32(1, 2, 3, 4);
    expect(drawN(r, 5).length).toBe(5);
  });

  it("draws values in PRNG order", () => {
    const r1 = sfc32(1, 2, 3, 4);
    const r2 = sfc32(1, 2, 3, 4);
    const arr = drawN(r1, 5);
    for (let i = 0; i < 5; i++) expect(arr[i]).toBe(r2());
  });

  it("returns empty for n=0", () => {
    expect(drawN(sfc32(1, 2, 3, 4), 0).length).toBe(0);
  });
});
