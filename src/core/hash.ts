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

const B64URL_REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    table[B64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

// `c >= 128` is the bounds guard — short-circuits before the typed-array
// read so an out-of-range char code never silently returns `undefined`.
function b64urlLookup(c: number): number {
  if (c >= 128 || B64URL_REVERSE[c]! < 0) {
    throw new Error(`decodeBase64Url: invalid base64url char code ${c}`);
  }
  return B64URL_REVERSE[c]!;
}

/**
 * RFC 4648 §5 base64url decode, unpadded. Inverse of `base64url`.
 * Length `r = s.length mod 4` may be 0, 2, or 3 (1 is illegal).
 *
 * Frozen contract — see Phase 3 decision memo addendum B6 for the
 * relocation from `src/mapgen/serialize.ts`.
 */
export function decodeBase64Url(s: string): Uint8Array {
  const r = s.length & 3;
  if (r === 1) {
    throw new Error("decodeBase64Url: illegal length (mod 4 == 1)");
  }
  const fullQuads = (s.length - r) >> 2;
  const outLen = fullQuads * 3 + (r === 0 ? 0 : r === 2 ? 1 : 2);
  const out = new Uint8Array(outLen);
  let outOff = 0;

  for (let i = 0; i < fullQuads; i++) {
    const a = b64urlLookup(s.charCodeAt(i * 4 + 0));
    const b = b64urlLookup(s.charCodeAt(i * 4 + 1));
    const c = b64urlLookup(s.charCodeAt(i * 4 + 2));
    const d = b64urlLookup(s.charCodeAt(i * 4 + 3));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
    out[outOff++] = ((b << 4) | (c >> 2)) & 0xff;
    out[outOff++] = ((c << 6) | d) & 0xff;
  }
  if (r === 2) {
    const a = b64urlLookup(s.charCodeAt(fullQuads * 4 + 0));
    const b = b64urlLookup(s.charCodeAt(fullQuads * 4 + 1));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
  } else if (r === 3) {
    const a = b64urlLookup(s.charCodeAt(fullQuads * 4 + 0));
    const b = b64urlLookup(s.charCodeAt(fullQuads * 4 + 1));
    const c = b64urlLookup(s.charCodeAt(fullQuads * 4 + 2));
    out[outOff++] = ((a << 2) | (b >> 4)) & 0xff;
    out[outOff++] = ((b << 4) | (c >> 2)) & 0xff;
  }
  return out;
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
