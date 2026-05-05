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

/**
 * RunStreams gives keyed PRNGs derived from a single root seed. Each
 * accessor records its key into the per-instance `__consumed` set on
 * first call, which mapgen's runtime guard reads to assert that floor
 * generation only consumed the `mapgen:<floorN>` stream.
 *
 * `__consumed` is a `ReadonlySet<string>` view; the underlying mutable
 * set is private to this module. Frozen contract — see
 * `artifacts/decision-memo-phase-2.md` addendum B4.
 *
 * `simFloor(floorN)` is the Phase 3 addition (memo addendum B4). It
 * derives `streamPrng(rootSeed, "sim", floorN)` and records
 * `"sim:" + floorN` into `__consumed`. The salt encoding
 * `(name="sim", salts=[floorN])` is byte-distinct from `sim()`'s
 * zero-salt pre-image (different total length, different tail bytes).
 */
export type RunStreams = {
  mapgen(floor: number): PRNG;
  sim(): PRNG;
  simFloor(floorN: number): PRNG;
  ui(): PRNG;
  /**
   * Phase 4 frozen contract — `streams.atlas(recipeId)` accessor (memo
   * decision 1a + addendum B8). Per-call invariant: a single call
   * advances `__consumed.size` by exactly 1 and records the key
   * `"atlas:" + recipeId`. Repeat calls with the same `recipeId` are
   * Set-deduplicated (advance by 0). The salt encoding `(name="atlas",
   * salts=[recipeId])` is byte-distinct from `sim()` / `simFloor(N)` /
   * `mapgen(N)` / `ui()` by construction.
   *
   * `recipeId` validation (decision 1a): well-formed UTF-16, 7-bit
   * ASCII, `1 ≤ utf8(recipeId).length ≤ 64`. Violations throw the
   * pinned error message.
   */
  atlas(recipeId: string): PRNG;
  /**
   * Phase 7.A.2 frozen contract — `streams.npcStock(floorN)` accessor.
   * Mirrors the `simFloor(floorN)` shape (Phase 3 frozen contract item
   * 8 + addendum B4). Records `"npc-stock:" + floorN` into
   * `__consumed`; the salt encoding `(name="npc-stock", salts=[floorN])`
   * is byte-distinct from every other accessor's pre-image by
   * construction.
   *
   * Introduced specifically to keep the Phase 3 SIM_DIGEST golden
   * preserved when NPC spawn lands on floor 1 — the existing
   * 100-action SELF_TEST_LOG re-enters floor 1's spawn block and
   * monster-spawn rolls must keep consuming the SAME `simFloor(1)`
   * cursor. NPC stock-roll consumes a separate stream so
   * `streams.simFloor(1).next()` produces identical bytes after this
   * change.
   *
   * `floorN` must satisfy `Number.isInteger(floorN) && 1 ≤ floorN ≤ 10`
   * (same range as `simFloor`); violations throw `npcStock: floorN
   * must be 1..10 (got N)`.
   */
  npcStock(floorN: number): PRNG;
  readonly __consumed: ReadonlySet<string>;
};

const RECIPE_ID_BYTE_MAX = 64;

/**
 * Validate a recipe ID per the Phase 4 frozen contract (memo decision
 * 1a). Recipe IDs are programmer-authored stable identifiers so the
 * check is stricter than user-facing seed validation: 7-bit ASCII only,
 * UTF-8 byte length in `[1, 64]`, well-formed UTF-16 (no lone
 * surrogates).
 */
function validateRecipeId(recipeId: string): Uint8Array {
  // The `isWellFormedUtf16` + ASCII-only checks both flow through the
  // utf8 byte-length error message per addendum prose: "recipeId must
  // be 7-bit ASCII, 1..64 utf8 bytes (got <length>: <repr>)". We
  // collapse any well-formedness or non-ASCII failure into that single
  // pinned message so test regex matches one shape.
  const wellFormed = isWellFormedUtf16(recipeId);
  const bytes = wellFormed ? utf8(recipeId) : new Uint8Array(0);
  let asciiOk = wellFormed;
  if (asciiOk) {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i]! > 0x7f) {
        asciiOk = false;
        break;
      }
    }
  }
  const len = bytes.length;
  const lengthOk = len >= 1 && len <= RECIPE_ID_BYTE_MAX;
  if (!wellFormed || !asciiOk || !lengthOk) {
    throw new Error(
      `atlas: recipeId must be 7-bit ASCII, 1..${RECIPE_ID_BYTE_MAX} utf8 bytes (got ${len}: ${JSON.stringify(recipeId)})`,
    );
  }
  return bytes;
}

export function streamsForRun(rootSeed: Uint8Array): RunStreams {
  const consumed = new Set<string>();
  return {
    mapgen(floor: number): PRNG {
      consumed.add(`mapgen:${floor}`);
      return streamPrng(rootSeed, "mapgen", floor);
    },
    sim(): PRNG {
      consumed.add("sim");
      return streamPrng(rootSeed, "sim");
    },
    simFloor(floorN: number): PRNG {
      if (!Number.isInteger(floorN) || floorN < 1 || floorN > 10) {
        throw new Error(`simFloor: floorN must be 1..10 (got ${floorN})`);
      }
      consumed.add(`sim:${floorN}`);
      return streamPrng(rootSeed, "sim", floorN);
    },
    ui(): PRNG {
      consumed.add("ui");
      return streamPrng(rootSeed, "ui");
    },
    atlas(recipeId: string): PRNG {
      validateRecipeId(recipeId);
      consumed.add(`atlas:${recipeId}`);
      return streamPrng(rootSeed, "atlas", recipeId);
    },
    npcStock(floorN: number): PRNG {
      if (!Number.isInteger(floorN) || floorN < 1 || floorN > 10) {
        throw new Error(`npcStock: floorN must be 1..10 (got ${floorN})`);
      }
      consumed.add(`npc-stock:${floorN}`);
      return streamPrng(rootSeed, "npc-stock", floorN);
    },
    get __consumed(): ReadonlySet<string> {
      return consumed;
    },
  };
}
