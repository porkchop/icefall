import { sha256 as nobleSha256 } from "@noble/hashes/sha256";

export function sha256(bytes: Uint8Array): Uint8Array {
  return nobleSha256(bytes);
}

const HEX = "0123456789abcdef";

export function sha256Hex(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  let out = "";
  for (let i = 0; i < digest.length; i++) {
    const b = digest[i]!;
    out += HEX[b >> 4]! + HEX[b & 0xf]!;
  }
  return out;
}

const B64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    out += B64URL_ALPHABET[a >> 2]!;
    out += B64URL_ALPHABET[((a & 0x03) << 4) | (b >> 4)]!;
    out += B64URL_ALPHABET[((b & 0x0f) << 2) | (c >> 6)]!;
    out += B64URL_ALPHABET[c & 0x3f]!;
  }
  if (i < bytes.length) {
    const a = bytes[i]!;
    out += B64URL_ALPHABET[a >> 2]!;
    if (i + 1 < bytes.length) {
      const b = bytes[i + 1]!;
      out += B64URL_ALPHABET[((a & 0x03) << 4) | (b >> 4)]!;
      out += B64URL_ALPHABET[(b & 0x0f) << 2]!;
    } else {
      out += B64URL_ALPHABET[(a & 0x03) << 4]!;
    }
  }
  return out;
}

export function sha256B64Url(bytes: Uint8Array): string {
  return base64url(sha256(bytes));
}

const utf8Encoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return utf8Encoder.encode(s);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i]!.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * True iff the string is well-formed UTF-16 — no unpaired surrogates.
 * A lone surrogate would be silently replaced by U+FFFD on TextEncoder
 * round-trip, which is a determinism hazard.
 */
export function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}
