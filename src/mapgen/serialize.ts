/**
 * Canonical JSON (de)serialization for `Floor`. Frozen contracts 4, 6,
 * and addendum B2/B3 from `artifacts/decision-memo-phase-2.md`.
 *
 * The serializer hand-writes the JSON byte-by-byte in a fixed top-level
 * key order (alphabetical) with each array pre-sorted by its
 * decision-5 comparator. We do not rely on `JSON.stringify` insertion
 * order. The parser is strict — unknown keys, missing keys, contradict-
 * ory `bossArena`/`exit` pairings, mismatched `tilesShape`, and any
 * `schemaVersion` other than 1 all cause a throw.
 *
 * `parseFloor` accepts an `unknown` because the determinism lint rule
 * bans `JSON.parse` inside `src/mapgen/**`. Callers JSON-parse outside
 * mapgen and pass the resulting object in.
 */

import { base64url } from "../core/hash";
import type { Door, Encounter, Floor, Point, Rect, Room } from "./types";
import { TILE_CODE_MAX, TILE_CODE_MIN } from "./tiles";
import { ROOM_KIND_IDS, type RoomKindId } from "../registries/rooms";
import {
  ENCOUNTER_KIND_IDS,
  type EncounterKindId,
} from "../registries/encounters";

export const FLOOR_SCHEMA_VERSION = 1;

const TOP_LEVEL_KEYS: readonly string[] = Object.freeze([
  "bossArena",
  "doors",
  "encounters",
  "entrance",
  "exit",
  "floor",
  "height",
  "rooms",
  "schemaVersion",
  "tilesB64",
  "tilesShape",
  "width",
]);

const ROOM_KIND_ID_SET: ReadonlySet<string> = new Set<string>(ROOM_KIND_IDS);
const ENCOUNTER_KIND_ID_SET: ReadonlySet<string> = new Set<string>(
  ENCOUNTER_KIND_IDS,
);

/**
 * Serialize a `Floor` to canonical JSON. Top-level keys are emitted in
 * alphabetical order; arrays are pre-sorted by their decision-5
 * comparator; numeric values are emitted as integer literals; strings
 * use `JSON.stringify`'s string escape (which is byte-stable across
 * runtimes for ASCII keys / kind ids).
 */
export function serializeFloor(floor: Floor): string {
  const sortedDoors = [...floor.doors].sort(compareDoors);
  const sortedEncs = [...floor.encounters].sort(compareEncounters);
  const sortedRooms = [...floor.rooms].sort(compareRoomsById);

  const parts: string[] = [];
  parts.push("{");
  parts.push(`"bossArena":${rectOrNull(floor.bossArena)}`);
  parts.push(`,"doors":[${sortedDoors.map(pointStr).join(",")}]`);
  parts.push(`,"encounters":[${sortedEncs.map(encounterStr).join(",")}]`);
  parts.push(`,"entrance":${pointStr(floor.entrance)}`);
  parts.push(`,"exit":${floor.exit === null ? "null" : pointStr(floor.exit)}`);
  parts.push(`,"floor":${asInt(floor.floor)}`);
  parts.push(`,"height":${asInt(floor.height)}`);
  parts.push(`,"rooms":[${sortedRooms.map(roomStr).join(",")}]`);
  parts.push(`,"schemaVersion":${FLOOR_SCHEMA_VERSION}`);
  parts.push(`,"tilesB64":${jsonString(base64url(floor.tiles))}`);
  parts.push(
    `,"tilesShape":[${asInt(floor.width)},${asInt(floor.height)}]`,
  );
  parts.push(`,"width":${asInt(floor.width)}`);
  parts.push("}");
  return parts.join("");
}

function asInt(n: number): string {
  /* v8 ignore start */
  if (!Number.isInteger(n)) {
    throw new Error(`serializeFloor: non-integer value ${n}`);
  }
  /* v8 ignore stop */
  return String(n | 0);
}

function jsonString(s: string): string {
  // Restricted to ASCII alphabet for room-kind / encounter-kind /
  // base64url strings, so a manual quote-and-escape is sufficient and
  // byte-stable. We do not call JSON.stringify here because it can
  // emit lowercase \uXXXX escapes whose case is implementation-defined
  // for some inputs; restricting to ASCII sidesteps the issue. The
  // strings used in canonical floors are all ASCII (registry IDs and
  // base64url alphabet) so this is exact.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    /* v8 ignore start */
    if (c < 0x20 || c === 0x22 || c === 0x5c || c > 126) {
      throw new Error(
        `serializeFloor: refused non-ASCII or control character at index ${i}`,
      );
    }
    /* v8 ignore stop */
    out += s.charAt(i);
  }
  out += '"';
  return out;
}

function pointStr(p: Point): string {
  return `{"x":${asInt(p.x)},"y":${asInt(p.y)}}`;
}

function encounterStr(e: Encounter): string {
  return `{"kind":${jsonString(e.kind)},"x":${asInt(e.x)},"y":${asInt(e.y)}}`;
}

function roomStr(r: Room): string {
  return `{"id":${asInt(r.id)},"kind":${jsonString(r.kind)},"x":${asInt(
    r.x,
  )},"y":${asInt(r.y)},"w":${asInt(r.w)},"h":${asInt(r.h)}}`;
}

function rectOrNull(r: Rect | null): string {
  if (r === null) return "null";
  return `{"x":${asInt(r.x)},"y":${asInt(r.y)},"w":${asInt(r.w)},"h":${asInt(
    r.h,
  )}}`;
}

function compareDoors(a: Door, b: Door): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

function compareEncounters(a: Encounter, b: Encounter): number {
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

function compareRoomsById(a: Room, b: Room): number {
  return a.id - b.id;
}

/**
 * Stable sorted key list for an object. Wraps `Object.keys` and sorts
 * the result so the determinism lint rule (which forbids iteration over
 * `Object.keys` directly) is satisfied — and the parser observes keys
 * in deterministic order.
 */
function sortedKeys(o: Record<string, unknown>): string[] {
  const list = Object.keys(o);
  list.sort();
  return list;
}

/**
 * Strict parser. Asserts every required key is present, every value is
 * an integer (or a non-empty string for `kind` fields), and the bossArena
 * / exit invariant `bossArena!=null xor exit!=null`. Throws on any
 * deviation.
 *
 * Accepts an `unknown` — callers `JSON.parse` outside this module and
 * pass the result here.
 */
export function parseFloor(input: unknown): Floor {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("parseFloor: input must be a JSON object");
  }
  const obj = input as Record<string, unknown>;
  // Reject unknown keys.
  const allowed = new Set(TOP_LEVEL_KEYS);
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    if (!allowed.has(k)) {
      throw new Error(`parseFloor: unknown top-level key "${k}"`);
    }
  }
  // Require every key to be present.
  for (const k of TOP_LEVEL_KEYS) {
    if (!(k in obj)) {
      throw new Error(`parseFloor: missing required key "${k}"`);
    }
  }

  const schemaVersion = obj["schemaVersion"];
  if (schemaVersion !== FLOOR_SCHEMA_VERSION) {
    throw new Error(
      `parseFloor: unsupported schemaVersion ${String(schemaVersion)}`,
    );
  }

  const floor = expectInt(obj["floor"], "floor", 1, 1000);
  const width = expectInt(obj["width"], "width", 1, 4096);
  const height = expectInt(obj["height"], "height", 1, 4096);

  const tilesShape = obj["tilesShape"];
  if (
    !Array.isArray(tilesShape) ||
    tilesShape.length !== 2 ||
    tilesShape[0] !== width ||
    tilesShape[1] !== height
  ) {
    throw new Error("parseFloor: tilesShape must equal [width, height]");
  }

  const tilesB64 = obj["tilesB64"];
  if (typeof tilesB64 !== "string") {
    throw new Error("parseFloor: tilesB64 must be a string");
  }
  const tiles = decodeBase64Url(tilesB64);
  if (tiles.length !== width * height) {
    throw new Error(
      `parseFloor: decoded tile count ${tiles.length} != width*height ${width * height}`,
    );
  }
  /* v8 ignore start */
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (t < TILE_CODE_MIN || t > TILE_CODE_MAX) {
      throw new Error(`parseFloor: tile byte ${t} out of range at index ${i}`);
    }
  }
  /* v8 ignore stop */

  const rooms = parseRooms(obj["rooms"]);
  const doors = parseDoors(obj["doors"]);
  const encounters = parseEncounters(obj["encounters"]);
  const entrance = parsePoint(obj["entrance"], "entrance");
  const exit = parsePointOrNull(obj["exit"], "exit");
  const bossArena = parseRectOrNull(obj["bossArena"], "bossArena");

  if (bossArena !== null && exit !== null) {
    throw new Error("parseFloor: both bossArena and exit are non-null");
  }
  if (bossArena === null && exit === null) {
    throw new Error("parseFloor: both bossArena and exit are null");
  }

  return {
    floor,
    width,
    height,
    tiles,
    rooms,
    doors,
    encounters,
    entrance,
    exit,
    bossArena,
  };
}

function expectInt(
  v: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`parseFloor: ${label} not an integer in [${min},${max}]`);
  }
  return v;
}

function parsePoint(v: unknown, label: string): Point {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`parseFloor: ${label} must be an object {x,y}`);
  }
  const o = v as Record<string, unknown>;
  for (const k of sortedKeys(o)) {
    if (k !== "x" && k !== "y") {
      throw new Error(`parseFloor: ${label} has unexpected key "${k}"`);
    }
  }
  return {
    x: expectInt(o["x"], `${label}.x`, 0, 4096),
    y: expectInt(o["y"], `${label}.y`, 0, 4096),
  };
}

function parsePointOrNull(v: unknown, label: string): Point | null {
  if (v === null) return null;
  return parsePoint(v, label);
}

function parseRect(v: unknown, label: string): Rect {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`parseFloor: ${label} must be an object {x,y,w,h}`);
  }
  const o = v as Record<string, unknown>;
  for (const k of sortedKeys(o)) {
    if (k !== "x" && k !== "y" && k !== "w" && k !== "h") {
      throw new Error(`parseFloor: ${label} has unexpected key "${k}"`);
    }
  }
  return {
    x: expectInt(o["x"], `${label}.x`, 0, 4096),
    y: expectInt(o["y"], `${label}.y`, 0, 4096),
    w: expectInt(o["w"], `${label}.w`, 1, 4096),
    h: expectInt(o["h"], `${label}.h`, 1, 4096),
  };
}

function parseRectOrNull(v: unknown, label: string): Rect | null {
  if (v === null) return null;
  return parseRect(v, label);
}

function parseDoors(v: unknown): Door[] {
  if (!Array.isArray(v)) throw new Error("parseFloor: doors must be array");
  const out: Door[] = [];
  for (let i = 0; i < v.length; i++) {
    out.push(parsePoint(v[i], `doors[${i}]`));
  }
  return out;
}

function parseEncounters(v: unknown): Encounter[] {
  if (!Array.isArray(v))
    throw new Error("parseFloor: encounters must be array");
  const out: Encounter[] = [];
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      throw new Error(`parseFloor: encounters[${i}] must be object`);
    }
    const o = e as Record<string, unknown>;
    for (const k of sortedKeys(o)) {
      if (k !== "kind" && k !== "x" && k !== "y") {
        throw new Error(
          `parseFloor: encounters[${i}] has unexpected key "${k}"`,
        );
      }
    }
    const kind = o["kind"];
    if (typeof kind !== "string" || !ENCOUNTER_KIND_ID_SET.has(kind)) {
      throw new Error(
        `parseFloor: encounters[${i}].kind not a registered encounter kind`,
      );
    }
    out.push({
      kind: kind as EncounterKindId,
      x: expectInt(o["x"], `encounters[${i}].x`, 0, 4096),
      y: expectInt(o["y"], `encounters[${i}].y`, 0, 4096),
    });
  }
  return out;
}

function parseRooms(v: unknown): Room[] {
  if (!Array.isArray(v)) throw new Error("parseFloor: rooms must be array");
  const out: Room[] = [];
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`parseFloor: rooms[${i}] must be object`);
    }
    const o = r as Record<string, unknown>;
    for (const k of sortedKeys(o)) {
      if (
        k !== "id" &&
        k !== "kind" &&
        k !== "x" &&
        k !== "y" &&
        k !== "w" &&
        k !== "h"
      ) {
        throw new Error(`parseFloor: rooms[${i}] has unexpected key "${k}"`);
      }
    }
    const kind = o["kind"];
    if (typeof kind !== "string" || !ROOM_KIND_ID_SET.has(kind)) {
      throw new Error(
        `parseFloor: rooms[${i}].kind not a registered room kind`,
      );
    }
    out.push({
      id: expectInt(o["id"], `rooms[${i}].id`, 0, 1024),
      kind: kind as RoomKindId,
      x: expectInt(o["x"], `rooms[${i}].x`, 0, 4096),
      y: expectInt(o["y"], `rooms[${i}].y`, 0, 4096),
      w: expectInt(o["w"], `rooms[${i}].w`, 1, 4096),
      h: expectInt(o["h"], `rooms[${i}].h`, 1, 4096),
    });
  }
  return out;
}

const B64URL_REVERSE = (() => {
  const table = new Int16Array(128).fill(-1);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charCodeAt(i)] = i;
  }
  return table;
})();

function decodeBase64Url(s: string): Uint8Array {
  // RFC 4648 §5 base64url, unpadded. Length r mod 4 may be 0, 2, or 3.
  const r = s.length & 3;
  if (r === 1) {
    throw new Error("parseFloor: tilesB64 has illegal length (mod 4 == 1)");
  }
  const fullQuads = (s.length - r) >> 2;
  const outLen = fullQuads * 3 + (r === 0 ? 0 : r === 2 ? 1 : 2);
  const out = new Uint8Array(outLen);
  let outOff = 0;

  function lookup(c: number): number {
    if (c >= 128 || B64URL_REVERSE[c]! < 0) {
      throw new Error(`parseFloor: invalid base64url char code ${c}`);
    }
    return B64URL_REVERSE[c]!;
  }

  for (let i = 0; i < fullQuads; i++) {
    const a = lookup(s.charCodeAt(i * 4 + 0));
    const b = lookup(s.charCodeAt(i * 4 + 1));
    const c = lookup(s.charCodeAt(i * 4 + 2));
    const d = lookup(s.charCodeAt(i * 4 + 3));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
    out[outOff++] = ((b << 4) | (c >> 2)) & 0xff;
    out[outOff++] = ((c << 6) | d) & 0xff;
  }
  if (r === 2) {
    const a = lookup(s.charCodeAt(fullQuads * 4 + 0));
    const b = lookup(s.charCodeAt(fullQuads * 4 + 1));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
  } else if (r === 3) {
    const a = lookup(s.charCodeAt(fullQuads * 4 + 0));
    const b = lookup(s.charCodeAt(fullQuads * 4 + 1));
    const c = lookup(s.charCodeAt(fullQuads * 4 + 2));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
    out[outOff++] = ((b << 4) | (c >> 2)) & 0xff;
  }
  return out;
}
