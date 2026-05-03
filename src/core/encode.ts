import { utf8, isWellFormedUtf16 } from "./hash";

export const ACTION_VERSION = 0x01;

export const TAG_TARGET = 0x10;
export const TAG_ITEM = 0x20;
export const TAG_DIR = 0x30;

export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Action = {
  type: string;
  target?: number;
  item?: string;
  dir?: Direction;
};

const TYPE_BYTE_MAX = 64;
const ITEM_BYTE_MAX = 255;

function checkInt32(v: number, label: string): void {
  if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
    throw new Error(`encodeAction: ${label} out of int32 range: ${v}`);
  }
}

function checkDir(v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 7) {
    throw new Error(`encodeAction: dir must be integer 0..7 (got ${v})`);
  }
}

function encodeUtf8Field(s: string, max: number, label: string): Uint8Array {
  if (!isWellFormedUtf16(s)) {
    throw new Error(`encodeAction: ${label} contains unpaired surrogate`);
  }
  const bytes = utf8(s);
  if (bytes.length > max) {
    throw new Error(`encodeAction: ${label} byte length > ${max} (${bytes.length})`);
  }
  return bytes;
}

/**
 * Encode an action into its canonical bytes. Frozen contract; bumping
 * ACTION_VERSION is the only allowed way to change this.
 *
 * Format:
 *   [ACTION_VERSION:1]
 *   [type_len:1][type_bytes...]                            (1..64 bytes)
 *   [TAG_TARGET:1][int32 LE]                               present iff target ∈ Action
 *   [TAG_ITEM:1][item_len:1][item_bytes...]                present iff item   ∈ Action
 *   [TAG_DIR:1][dir:1]                                     present iff dir    ∈ Action
 *
 * Optional fields are emitted in strictly increasing tag order.
 */
export function encodeAction(action: Action): Uint8Array {
  const typeBytes = encodeUtf8Field(action.type, TYPE_BYTE_MAX, "type");
  if (typeBytes.length === 0) {
    throw new Error("encodeAction: type must be non-empty");
  }

  const parts: number[] = [];
  parts.push(ACTION_VERSION);
  parts.push(typeBytes.length);
  for (let i = 0; i < typeBytes.length; i++) parts.push(typeBytes[i]!);

  if (action.target !== undefined) {
    checkInt32(action.target, "target");
    parts.push(TAG_TARGET);
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setInt32(0, action.target, true);
    parts.push(buf[0]!, buf[1]!, buf[2]!, buf[3]!);
  }

  if (action.item !== undefined) {
    const itemBytes = encodeUtf8Field(action.item, ITEM_BYTE_MAX, "item");
    parts.push(TAG_ITEM);
    parts.push(itemBytes.length);
    for (let i = 0; i < itemBytes.length; i++) parts.push(itemBytes[i]!);
  }

  if (action.dir !== undefined) {
    checkDir(action.dir);
    parts.push(TAG_DIR);
    parts.push(action.dir);
  }

  return Uint8Array.from(parts);
}
