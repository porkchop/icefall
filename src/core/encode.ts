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

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type DecodedAction = {
  readonly action: Action;
  readonly bytesConsumed: number;
};

/**
 * Decode a single action from a byte buffer at the given offset.
 *
 * Inverse of `encodeAction`. Phase 8 sub-deliverable per
 * `artifacts/decision-memo-phase-8.md` addendum B2 — the byte-explicit
 * validation rules below are pinned with exact error-message prefixes
 * (`"decodeAction: "`), Phase-4-style for exact-match testing.
 *
 * Validation rules (each rejection produces a pinned error string):
 *
 *   1. `bytes[offset] === ACTION_VERSION (0x01)`
 *   2. `type_len ∈ [1, 64]`, type bytes are well-formed UTF-8
 *   3. Optional fields parsed in tag order:
 *        - tag must be one of TAG_TARGET/TAG_ITEM/TAG_DIR
 *        - tag must be strictly greater than the previous tag
 *        - payload is read with strict length matching
 *   4. The action ends when the next byte is the next ACTION_VERSION
 *      or past the buffer end
 *
 * Phase 8 v1 decoder REJECTS unknown tags (forces forward-compatibility
 * through release pinning, not silent corruption).
 */
export function decodeAction(
  bytes: Uint8Array,
  offset: number,
): DecodedAction {
  let cursor = offset;

  if (cursor >= bytes.length) {
    throw new Error(
      `decodeAction: truncated at offset ${cursor} (need version byte)`,
    );
  }
  const ver = bytes[cursor]!;
  if (ver !== ACTION_VERSION) {
    throw new Error(
      `decodeAction: unsupported action version ${ver} at offset ${cursor}`,
    );
  }
  cursor++;

  if (cursor >= bytes.length) {
    throw new Error(
      `decodeAction: truncated at offset ${cursor} (need type_len byte)`,
    );
  }
  const typeLen = bytes[cursor]!;
  if (typeLen < 1 || typeLen > TYPE_BYTE_MAX) {
    throw new Error(
      `decodeAction: type_len ${typeLen} out of range [1, 64] at offset ${cursor}`,
    );
  }
  cursor++;

  if (cursor + typeLen > bytes.length) {
    throw new Error(
      `decodeAction: truncated type at offset ${cursor} (need ${typeLen}, have ${bytes.length - cursor})`,
    );
  }
  const typeBytes = bytes.subarray(cursor, cursor + typeLen);
  let type: string;
  try {
    type = utf8Decoder.decode(typeBytes);
  } catch {
    throw new Error(
      `decodeAction: type at offset ${cursor} is not valid UTF-8`,
    );
  }
  cursor += typeLen;

  let target: number | undefined;
  let item: string | undefined;
  let dir: Direction | undefined;
  let previousTag = 0;

  while (cursor < bytes.length) {
    const tag = bytes[cursor]!;
    // Stop when we hit the start of the next action.
    if (tag === ACTION_VERSION) break;

    if (tag !== TAG_TARGET && tag !== TAG_ITEM && tag !== TAG_DIR) {
      throw new Error(
        `decodeAction: unknown tag 0x${tag.toString(16).padStart(2, "0")} at offset ${cursor} (this build supports v1 tags 0x10, 0x20, 0x30 only — load 'releases/<commit>/' for the build that produced this log)`,
      );
    }
    if (tag <= previousTag) {
      throw new Error(
        `decodeAction: tag 0x${tag.toString(16).padStart(2, "0")} appears after tag 0x${previousTag.toString(16).padStart(2, "0")} at offset ${cursor} (tags must be strictly increasing)`,
      );
    }
    cursor++;

    if (tag === TAG_TARGET) {
      if (cursor + 4 > bytes.length) {
        throw new Error(
          `decodeAction: truncated tag 0x10 payload at offset ${cursor}`,
        );
      }
      const dv = new DataView(
        bytes.buffer,
        bytes.byteOffset + cursor,
        4,
      );
      target = dv.getInt32(0, true);
      cursor += 4;
    } else if (tag === TAG_ITEM) {
      if (cursor >= bytes.length) {
        throw new Error(
          `decodeAction: truncated tag 0x20 payload at offset ${cursor}`,
        );
      }
      const itemLen = bytes[cursor]!;
      cursor++;
      if (cursor + itemLen > bytes.length) {
        throw new Error(
          `decodeAction: truncated tag 0x20 payload at offset ${cursor}`,
        );
      }
      const itemBytes = bytes.subarray(cursor, cursor + itemLen);
      try {
        item = utf8Decoder.decode(itemBytes);
      } catch {
        throw new Error(
          `decodeAction: item at offset ${cursor} is not valid UTF-8`,
        );
      }
      cursor += itemLen;
    } else {
      // TAG_DIR
      if (cursor >= bytes.length) {
        throw new Error(
          `decodeAction: truncated tag 0x30 payload at offset ${cursor}`,
        );
      }
      const d = bytes[cursor]!;
      if (d > 7) {
        throw new Error(
          `decodeAction: truncated tag 0x30 payload at offset ${cursor}`,
        );
      }
      dir = d as Direction;
      cursor++;
    }

    previousTag = tag;
  }

  const action: Action = { type };
  if (target !== undefined) (action as { target?: number }).target = target;
  if (item !== undefined) (action as { item?: string }).item = item;
  if (dir !== undefined) (action as { dir?: Direction }).dir = dir;

  return { action, bytesConsumed: cursor - offset };
}
