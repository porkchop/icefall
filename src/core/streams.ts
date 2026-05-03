import { sha256, utf8, concat, isWellFormedUtf16 } from "./hash";
import { sfc32FromBytes, type PRNG } from "./prng";

export const STREAM_DOMAIN = "icefall:v1:";
const STREAM_DOMAIN_BYTES = utf8(STREAM_DOMAIN);

const SALT_TAG_INT = 0x01;
const SALT_TAG_STRING = 0x02;
const SALT_TAG_BYTES = 0x03;

export type StreamSalt = number | string | Uint8Array;

/**
 * Encode one salt into its canonical bytes. Throws on inputs that fall
 * outside the closed type set, on out-of-range integers, on non-well-formed
 * strings, on overlong strings or byte arrays.
 *
 * Frozen contract — see docs/ARCHITECTURE.md.
 */
export function encodeSalt(value: StreamSalt): Uint8Array {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      throw new Error(`encodeSalt: integer out of int32 range: ${value}`);
    }
    const out = new Uint8Array(5);
    out[0] = SALT_TAG_INT;
    new DataView(out.buffer).setInt32(1, value, true);
    return out;
  }
  if (typeof value === "string") {
    if (!isWellFormedUtf16(value)) {
      throw new Error("encodeSalt: string contains unpaired surrogate");
    }
    const bytes = utf8(value);
    if (bytes.length > 255) {
      throw new Error(`encodeSalt: string > 255 bytes (${bytes.length})`);
    }
    const out = new Uint8Array(2 + bytes.length);
    out[0] = SALT_TAG_STRING;
    out[1] = bytes.length;
    out.set(bytes, 2);
    return out;
  }
  if (value instanceof Uint8Array) {
    if (value.length > 65535) {
      throw new Error(`encodeSalt: byte array > 65535 bytes (${value.length})`);
    }
    const out = new Uint8Array(3 + value.length);
    out[0] = SALT_TAG_BYTES;
    out[1] = value.length & 0xff;
    out[2] = (value.length >> 8) & 0xff;
    out.set(value, 3);
    return out;
  }
  throw new Error("encodeSalt: unsupported salt type");
}

/**
 * Compute the seed bytes for a stream from a root seed plus a name and
 * any number of salts. Returns the full SHA-256 digest (32 bytes); the
 * first 16 bytes feed sfc32.
 */
export function streamSeed(
  rootSeed: Uint8Array,
  name: string,
  ...salts: StreamSalt[]
): Uint8Array {
  if (!isWellFormedUtf16(name)) {
    throw new Error("streamSeed: stream name contains unpaired surrogate");
  }
  const nameBytes = utf8(name);
  if (nameBytes.length === 0 || nameBytes.length > 255) {
    throw new Error(
      `streamSeed: stream name byte length must be 1..255 (got ${nameBytes.length})`,
    );
  }
  const lpName = new Uint8Array(1 + nameBytes.length);
  lpName[0] = nameBytes.length;
  lpName.set(nameBytes, 1);

  const parts: Uint8Array[] = [rootSeed, STREAM_DOMAIN_BYTES, lpName];
  for (let i = 0; i < salts.length; i++) parts.push(encodeSalt(salts[i]!));
  return sha256(concat(parts));
}

export function streamPrng(
  rootSeed: Uint8Array,
  name: string,
  ...salts: StreamSalt[]
): PRNG {
  return sfc32FromBytes(streamSeed(rootSeed, name, ...salts));
}

export type RunStreams = {
  mapgen(floor: number): PRNG;
  sim(): PRNG;
  ui(): PRNG;
};

export function streamsForRun(rootSeed: Uint8Array): RunStreams {
  return {
    mapgen(floor: number): PRNG {
      return streamPrng(rootSeed, "mapgen", floor);
    },
    sim(): PRNG {
      return streamPrng(rootSeed, "sim");
    },
    ui(): PRNG {
      return streamPrng(rootSeed, "ui");
    },
  };
}
