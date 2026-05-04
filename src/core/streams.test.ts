import { describe, expect, it } from "vitest";
import {
  encodeSalt,
  streamSeed,
  streamPrng,
  streamsForRun,
  STREAM_DOMAIN,
} from "./streams";
import { sha256Hex } from "./hash";
import { drawN } from "./prng";

const ROOT_A = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);
const ROOT_B = new Uint8Array([
  0x01, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

describe("encodeSalt", () => {
  it("encodes positive int32 little-endian with tag 0x01", () => {
    expect(Array.from(encodeSalt(1))).toEqual([0x01, 0x01, 0x00, 0x00, 0x00]);
  });

  it("encodes negative int32 as two's complement little-endian", () => {
    expect(Array.from(encodeSalt(-1))).toEqual([0x01, 0xff, 0xff, 0xff, 0xff]);
  });

  it("encodes int32 boundary values", () => {
    expect(Array.from(encodeSalt(2147483647))).toEqual([0x01, 0xff, 0xff, 0xff, 0x7f]);
    expect(Array.from(encodeSalt(-2147483648))).toEqual([0x01, 0x00, 0x00, 0x00, 0x80]);
  });

  it("rejects non-integers", () => {
    expect(() => encodeSalt(1.5)).toThrowError(/int32/);
  });

  it("rejects integers outside int32 range", () => {
    expect(() => encodeSalt(2147483648)).toThrowError(/int32/);
    expect(() => encodeSalt(-2147483649)).toThrowError(/int32/);
  });

  it("encodes string with tag 0x02 and 1-byte length prefix", () => {
    expect(Array.from(encodeSalt("ab"))).toEqual([0x02, 0x02, 0x61, 0x62]);
  });

  it("encodes empty string with length zero", () => {
    expect(Array.from(encodeSalt(""))).toEqual([0x02, 0x00]);
  });

  it("uses byte length, not codepoint length, for strings", () => {
    expect(Array.from(encodeSalt("💩"))).toEqual([
      0x02, 0x04, 0xf0, 0x9f, 0x92, 0xa9,
    ]);
  });

  it("rejects strings with unpaired surrogates", () => {
    expect(() => encodeSalt("\uD800")).toThrowError(/surrogate/);
  });

  it("rejects strings whose UTF-8 byte length exceeds 255", () => {
    const big = "a".repeat(256);
    expect(() => encodeSalt(big)).toThrowError(/255 bytes/);
  });

  it("encodes Uint8Array with tag 0x03 and 2-byte little-endian length", () => {
    expect(Array.from(encodeSalt(new Uint8Array([0xaa, 0xbb])))).toEqual([
      0x03, 0x02, 0x00, 0xaa, 0xbb,
    ]);
  });

  it("encodes empty Uint8Array with length zero", () => {
    expect(Array.from(encodeSalt(new Uint8Array(0)))).toEqual([0x03, 0x00, 0x00]);
  });

  it("rejects Uint8Array longer than 65535 bytes", () => {
    expect(() => encodeSalt(new Uint8Array(65536))).toThrowError(/65535/);
  });

  it("rejects unsupported types", () => {
    expect(() =>
      encodeSalt(true as unknown as number),
    ).toThrowError(/unsupported/);
    expect(() =>
      encodeSalt(null as unknown as number),
    ).toThrowError(/unsupported/);
    expect(() =>
      encodeSalt({} as unknown as number),
    ).toThrowError(/unsupported/);
  });
});

describe("STREAM_DOMAIN", () => {
  it("is the v1 namespace", () => {
    expect(STREAM_DOMAIN).toBe("icefall:v1:");
  });
});

describe("streamSeed", () => {
  it("is deterministic", () => {
    const a = streamSeed(ROOT_A, "mapgen", 0);
    const b = streamSeed(ROOT_A, "mapgen", 0);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("differs across stream names", () => {
    expect(sha256Hex(streamSeed(ROOT_A, "mapgen", 0))).not.toBe(
      sha256Hex(streamSeed(ROOT_A, "sim")),
    );
  });

  it("differs across salts", () => {
    expect(sha256Hex(streamSeed(ROOT_A, "mapgen", 0))).not.toBe(
      sha256Hex(streamSeed(ROOT_A, "mapgen", 1)),
    );
  });

  it("differs across root seeds", () => {
    expect(sha256Hex(streamSeed(ROOT_A, "mapgen", 0))).not.toBe(
      sha256Hex(streamSeed(ROOT_B, "mapgen", 0)),
    );
  });

  it("rejects empty stream name", () => {
    expect(() => streamSeed(ROOT_A, "")).toThrowError(/1..255/);
  });

  it("rejects overlong stream name", () => {
    expect(() => streamSeed(ROOT_A, "x".repeat(256))).toThrowError(/1..255/);
  });

  it("rejects stream name with unpaired surrogate", () => {
    expect(() => streamSeed(ROOT_A, "\uD800")).toThrowError(/surrogate/);
  });

  it("matches a hardcoded golden digest for a fixed input", () => {
    expect(sha256Hex(streamSeed(ROOT_A, "mapgen", 0))).toBe(
      "5999929e93512a520f744d64780e768b48d33064e6efe0adae606e428c6df425",
    );
  });
});

describe("streamPrng + streamsForRun", () => {
  it("produces reproducible sequences", () => {
    const a = streamPrng(ROOT_A, "mapgen", 0);
    const b = streamPrng(ROOT_A, "mapgen", 0);
    for (let i = 0; i < 32; i++) expect(a()).toBe(b());
  });

  it("mapgen and sim streams produce different sequences", () => {
    const m = drawN(streamPrng(ROOT_A, "mapgen", 0), 8);
    const s = drawN(streamPrng(ROOT_A, "sim"), 8);
    expect(Array.from(m)).not.toEqual(Array.from(s));
  });

  it("mapgen(0) and mapgen(1) produce different sequences", () => {
    const m0 = drawN(streamPrng(ROOT_A, "mapgen", 0), 8);
    const m1 = drawN(streamPrng(ROOT_A, "mapgen", 1), 8);
    expect(Array.from(m0)).not.toEqual(Array.from(m1));
  });

  it("mapgen(0) under different roots produces different sequences", () => {
    const a = drawN(streamPrng(ROOT_A, "mapgen", 0), 8);
    const b = drawN(streamPrng(ROOT_B, "mapgen", 0), 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("streamsForRun returns the same prngs as direct streamPrng calls", () => {
    const streams = streamsForRun(ROOT_A);
    const a = streams.mapgen(0);
    const expected = streamPrng(ROOT_A, "mapgen", 0);
    for (let i = 0; i < 8; i++) expect(a()).toBe(expected());

    const sa = streams.sim();
    const sExpected = streamPrng(ROOT_A, "sim");
    for (let i = 0; i < 8; i++) expect(sa()).toBe(sExpected());

    const ua = streams.ui();
    const uExpected = streamPrng(ROOT_A, "ui");
    for (let i = 0; i < 8; i++) expect(ua()).toBe(uExpected());
  });

  it("matches a hardcoded golden 8-value sequence for mapgen(0) under ROOT_A", () => {
    const r = streamPrng(ROOT_A, "mapgen", 0);
    const got: number[] = [];
    for (let i = 0; i < 8; i++) got.push(r());
    expect(got).toEqual([
      2530522461, 2884288766, 1774446726, 1434154978, 74230500, 598396109, 1826277906, 126639865,
    ]);
  });
});

describe("RunStreams.__consumed tracker (frozen contract 11)", () => {
  it("starts empty before any accessor is called", () => {
    const streams = streamsForRun(ROOT_A);
    expect([...streams.__consumed]).toEqual([]);
  });

  it("records mapgen:floor on first mapgen() call", () => {
    const streams = streamsForRun(ROOT_A);
    streams.mapgen(3);
    expect([...streams.__consumed].sort()).toEqual(["mapgen:3"]);
  });

  it("records sim and ui keys on those accessors", () => {
    const streams = streamsForRun(ROOT_A);
    streams.sim();
    streams.ui();
    expect([...streams.__consumed].sort()).toEqual(["sim", "ui"]);
  });

  it("accumulates keys across calls; per-instance, never global", () => {
    const a = streamsForRun(ROOT_A);
    const b = streamsForRun(ROOT_A);
    a.mapgen(0);
    a.mapgen(1);
    b.sim();
    expect([...a.__consumed].sort()).toEqual(["mapgen:0", "mapgen:1"]);
    expect([...b.__consumed].sort()).toEqual(["sim"]);
  });

  it("repeated calls for the same key do not duplicate entries", () => {
    const streams = streamsForRun(ROOT_A);
    streams.mapgen(2);
    streams.mapgen(2);
    expect([...streams.__consumed]).toEqual(["mapgen:2"]);
  });

  it("__consumed is a live view: reads after mutation see new entries", () => {
    const streams = streamsForRun(ROOT_A);
    const view = streams.__consumed;
    expect(view.size).toBe(0);
    streams.mapgen(7);
    expect(view.size).toBe(1);
    expect(view.has("mapgen:7")).toBe(true);
  });
});

describe("simFloor accessor (Phase 3 addendum B4)", () => {
  it("records sim:<floorN> on first call", () => {
    const streams = streamsForRun(ROOT_A);
    streams.simFloor(3);
    expect([...streams.__consumed]).toEqual(["sim:3"]);
  });

  it("returns the same PRNG sequence as streamPrng(rootSeed, 'sim', floorN)", () => {
    const streams = streamsForRun(ROOT_A);
    const got = streams.simFloor(5);
    const expected = streamPrng(ROOT_A, "sim", 5);
    for (let i = 0; i < 8; i++) expect(got()).toBe(expected());
  });

  it("simFloor(N) and sim() produce distinct sequences (non-collision)", () => {
    const a = drawN(streamPrng(ROOT_A, "sim"), 8);
    const b = drawN(streamPrng(ROOT_A, "sim", 1), 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("simFloor(1) and simFloor(2) produce distinct sequences", () => {
    const a = drawN(streamPrng(ROOT_A, "sim", 1), 8);
    const b = drawN(streamPrng(ROOT_A, "sim", 2), 8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("__consumed records 'sim' (no colon) for sim() and 'sim:N' for simFloor(N) — distinct keys", () => {
    const streams = streamsForRun(ROOT_A);
    streams.sim();
    streams.simFloor(1);
    expect([...streams.__consumed].sort()).toEqual(["sim", "sim:1"]);
  });

  it("rejects floorN below 1", () => {
    const streams = streamsForRun(ROOT_A);
    expect(() => streams.simFloor(0)).toThrowError(/floorN must be 1\.\.10/);
    expect(() => streams.simFloor(-1)).toThrowError(/floorN must be 1\.\.10/);
  });

  it("rejects floorN above 10", () => {
    const streams = streamsForRun(ROOT_A);
    expect(() => streams.simFloor(11)).toThrowError(/floorN must be 1\.\.10/);
    expect(() => streams.simFloor(99)).toThrowError(/floorN must be 1\.\.10/);
  });

  it("rejects non-integer floorN", () => {
    const streams = streamsForRun(ROOT_A);
    expect(() => streams.simFloor(1.5)).toThrowError(/floorN must be 1\.\.10/);
    expect(() => streams.simFloor(NaN)).toThrowError(/floorN must be 1\.\.10/);
  });

  it("accepts the boundary values 1 and 10", () => {
    const streams = streamsForRun(ROOT_A);
    expect(() => streams.simFloor(1)).not.toThrow();
    expect(() => streams.simFloor(10)).not.toThrow();
  });
});
